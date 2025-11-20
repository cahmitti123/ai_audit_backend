/**
 * Automation Workflows
 * ====================
 * Inngest workflow functions for automated audit processing
 */

import { inngest } from "../../inngest/client.js";
import { NonRetriableError } from "inngest";
import * as automationRepository from "./automation.repository.js";
import * as automationService from "./automation.service.js";
import * as automationApi from "./automation.api.js";
import { TIMEOUTS } from "../../shared/constants.js";
import { runAuditFunction } from "../audits/audits.workflows.js";
import { fetchFicheFunction } from "../fiches/fiches.workflows.js";
import { transcribeFicheFunction } from "../transcriptions/transcriptions.workflows.js";

/**
 * Run Automation Function
 * =======================
 * Main automation workflow that:
 * 1. Fetches fiches based on selection criteria
 * 2. Runs transcriptions (if configured)
 * 3. Runs audits (if configured)
 * 4. Sends notifications
 */
export const runAutomationFunction = inngest.createFunction(
  {
    id: "run-automation",
    name: "Run Automated Audit Processing",
    retries: 2,
    timeouts: {
      finish: "2h", // 2 hours max
    },
  },
  { event: "automation/run" },
  async ({ event, step, logger }) => {
    const { schedule_id, override_fiche_selection } = event.data;

    // Capture start time in a step to persist it across Inngest checkpoints
    const startTime = await step.run(
      "capture-automation-start-time",
      async (): Promise<number> => {
        return Date.now();
      }
    );

    logger.info("Starting automation run", { schedule_id });

    // Step 1: Load schedule configuration
    const schedule = await step.run("load-schedule", async () => {
      const scheduleData = await automationRepository.getAutomationScheduleById(
        BigInt(schedule_id)
      );
      if (!scheduleData) {
        throw new NonRetriableError(`Schedule ${schedule_id} not found`);
      }
      if (!scheduleData.isActive) {
        throw new NonRetriableError(`Schedule ${schedule_id} is not active`);
      }

      // Convert BigInt values to numbers for JSON serialization
      // Inngest steps can't return BigInts as they're not JSON-serializable
      return {
        ...scheduleData,
        specificAuditConfigs:
          scheduleData.specificAuditConfigs?.map((id: any) =>
            typeof id === "bigint" ? Number(id) : id
          ) || [],
      };
    });

    logger.info("Schedule loaded", {
      name: schedule.name,
      schedule_type: schedule.scheduleType,
    });

    // Step 2: Create automation run record
    const runIdString = await step.run("create-run-record", async () => {
      const run = await automationRepository.createAutomationRun(
        BigInt(schedule_id),
        {
          schedule: {
            name: schedule.name,
            scheduleType: schedule.scheduleType,
          },
          overrides: override_fiche_selection || null,
        }
      );
      return String(run.id); // Convert BigInt to string for serialization
    });

    const runId = BigInt(runIdString);
    logger.info("Run record created", { run_id: runIdString });

    // Helper to add logs
    const log = async (level: string, message: string, metadata?: any) => {
      await automationRepository.addAutomationLog(
        runId,
        level,
        message,
        metadata
      );
      logger.info(message, metadata);
    };

    try {
      // Step 3: Calculate dates to query
      const selection =
        override_fiche_selection || (schedule.ficheSelection as any);
      const apiKey = schedule.externalApiKey || undefined;

      // Declare variables that will be set in either manual or API mode
      let ficheIds: string[] = [];
      let fichesData: any[] = [];
      let fichesCles: Record<string, string> = {};

      // Step 3a: Handle manual mode
      if (selection.mode === "manual" && selection.ficheIds) {
        const manualResult = await step.run(
          "process-manual-fiches",
          async () => {
            await log("info", "Processing manual fiche selection");
            
            // Parse fiche IDs - handle various separators (spaces, commas, mixed)
            // Split on any combination of commas, spaces, tabs, newlines
            const allIds = selection.ficheIds
              .flatMap((id: string) => 
                id.trim().split(/[\s,]+/)
              )
              .filter(Boolean) // Remove empty strings
              .map((id: string) => id.trim()); // Trim each ID
            
            const limitedIds = allIds.slice(
              0,
              selection.maxFiches || allIds.length
            );
            await log(
              "info",
              `Using ${limitedIds.length} manually selected fiches`,
              { ficheIds: limitedIds }
            );
            return { ficheIds: limitedIds, fichesData: [], cles: {} };
          }
        );

        ficheIds = manualResult.ficheIds;
        fichesData = manualResult.fichesData;
        fichesCles = manualResult.cles;

        if (ficheIds.length === 0) {
          await log("warning", "No fiches in manual selection");
          await step.run("update-run-no-fiches", async () => {
            await automationRepository.updateAutomationRun(runId, {
              status: "completed",
              completedAt: new Date(),
              durationMs: Date.now() - startTime!,
              totalFiches: 0,
              successfulFiches: 0,
              failedFiches: 0,
              resultSummary: { message: "No fiches found", ficheIds: [] },
            });
            await automationRepository.updateScheduleStats(
              BigInt(schedule_id),
              "success"
            );
          });

          return {
            success: true,
            schedule_id,
            run_id: String(runId),
            total_fiches: 0,
            message: "No fiches in manual selection",
          };
        }
      } else {
        // Step 3b: Calculate dates for API mode
        const dates = await step.run("calculate-dates", async () => {
          const datesToQuery =
            automationService.calculateDatesToQuery(selection);
          await log(
            "info",
            `Calculated ${datesToQuery.length} dates to query`,
            {
              dateCount: datesToQuery.length,
              dates:
                datesToQuery.length <= 10
                  ? datesToQuery
                  : `${datesToQuery.slice(0, 5).join(", ")}...`,
            }
          );
          return datesToQuery;
        });

        if (dates.length === 0) {
          await log("warning", "No dates to query");
          await step.run("update-run-no-dates", async () => {
            await automationRepository.updateAutomationRun(runId, {
              status: "completed",
              completedAt: new Date(),
              durationMs: Date.now() - startTime!,
              totalFiches: 0,
              successfulFiches: 0,
              failedFiches: 0,
              resultSummary: { message: "No dates to query", ficheIds: [] },
            });
            await automationRepository.updateScheduleStats(
              BigInt(schedule_id),
              "success"
            );
          });

          return {
            success: true,
            schedule_id,
            run_id: String(runId),
            total_fiches: 0,
            message: "No dates to query",
          };
        }

        // Step 3c: Fetch fiches for each date in PARALLEL
        // Split into batches for better control (batch of 2 concurrent requests to avoid overloading API)
        const BATCH_SIZE = 2;
        const allFiches: any[] = [];

        for (
          let batchStart = 0;
          batchStart < dates.length;
          batchStart += BATCH_SIZE
        ) {
          const batchDates = dates.slice(batchStart, batchStart + BATCH_SIZE);
          const batchIndex = Math.floor(batchStart / BATCH_SIZE);

          await log(
            "info",
            `Fetching batch ${batchIndex + 1} of ${Math.ceil(
              dates.length / BATCH_SIZE
            )}`,
            {
              dates: batchDates,
            }
          );

          // Fetch all dates in this batch in parallel with retry logic
          const batchResults = await Promise.all(
            batchDates.map((date, idx) =>
              step.run(`fetch-date-${date}`, async () => {
                // Retry logic: try up to 3 times with exponential backoff
                let lastError: any = null;
                for (let attempt = 1; attempt <= 3; attempt++) {
                  try {
                    await log(
                      "info",
                      `Fetching fiches for ${date} (attempt ${attempt}/3)`
                    );

                    const dateFiches = await automationApi.fetchFichesForDate(
                      date,
                      selection.onlyWithRecordings || false,
                      apiKey
                    );

                    await log(
                      "info",
                      `Fetched ${dateFiches.length} fiches for ${date}`
                    );
                    return dateFiches;
                  } catch (error: any) {
                    lastError = error;
                    await log(
                      "warning",
                      `Attempt ${attempt} failed for ${date}: ${error.message}`
                    );

                    // If not the last attempt, wait before retrying (exponential backoff)
                    if (attempt < 3) {
                      const waitTime = Math.pow(2, attempt) * 1000; // 2s, 4s
                      await log(
                        "info",
                        `Waiting ${waitTime}ms before retry for ${date}`
                      );
                      await new Promise((resolve) =>
                        setTimeout(resolve, waitTime)
                      );
                    }
                  }
                }

                // All retries failed
                await log(
                  "error",
                  `Failed to fetch fiches for ${date} after 3 attempts: ${lastError?.message}`
                );

                if (!schedule.continueOnError) {
                  throw lastError;
                }
                return []; // Return empty array to continue
              })
            )
          );

          // Flatten batch results
          batchResults.forEach((result) => allFiches.push(...result));

          await log("info", `Batch ${batchIndex + 1} complete`, {
            batchFiches: batchResults.reduce((sum, r) => sum + r.length, 0),
            totalSoFar: allFiches.length,
          });
        }

        // Step 3d: Process and transform all fetched fiches
        const processedData = await step.run(
          "process-fiches-data",
          async () => {
            const result = automationService.processFichesData(
              allFiches,
              selection.maxFiches,
              selection.onlyWithRecordings
            );
            await log("info", `Processed ${result.ficheIds.length} fiches`, {
              count: result.ficheIds.length,
              hasFichesData: result.fichesData.length > 0,
              hasCles: Object.keys(result.cles).length > 0,
            });
            return result;
          }
        );
        ficheIds = processedData.ficheIds;
        fichesData = processedData.fichesData;
        fichesCles = processedData.cles;
      }

      // Step 4: Check if we have fiches to process
      if (ficheIds.length === 0) {
        await log("warning", "No fiches found matching criteria");

        // Update run status
        await step.run("update-run-no-fiches-found", async () => {
          await automationRepository.updateAutomationRun(runId, {
            status: "completed",
            completedAt: new Date(),
            durationMs: Date.now() - startTime!,
            totalFiches: 0,
            successfulFiches: 0,
            failedFiches: 0,
            resultSummary: {
              message: "No fiches found",
              ficheIds: [],
            },
          });
          await automationRepository.updateScheduleStats(
            BigInt(schedule_id),
            "success"
          );
        });

        return {
          success: true,
          schedule_id,
          run_id: String(runId),
          total_fiches: 0,
          message: "No fiches found",
        };
      }

      // Update run with total fiches
      await step.run("update-run-total", async () => {
        await automationRepository.updateAutomationRun(runId, {
          totalFiches: ficheIds.length,
        });
      });

      // Step 5: Process fiches in batches for better parallelism
      const results = {
        successful: [] as string[],
        failed: [] as { ficheId: string; error: string }[],
        transcriptions: 0,
        audits: 0,
      };

      // Process fiches in batches to leverage parallelism while maintaining control
      const FICHE_BATCH_SIZE = 5; // Process 5 fiches in parallel (balanced for Inngest limits)

      for (
        let batchStart = 0;
        batchStart < ficheIds.length;
        batchStart += FICHE_BATCH_SIZE
      ) {
        const batchFicheIds = ficheIds.slice(
          batchStart,
          batchStart + FICHE_BATCH_SIZE
        );
        const batchIndex = Math.floor(batchStart / FICHE_BATCH_SIZE);

        await log(
          "info",
          `Processing fiche batch ${batchIndex + 1} of ${Math.ceil(
            ficheIds.length / FICHE_BATCH_SIZE
          )}`,
          {
            fiches: batchFicheIds,
          }
        );

        // Process each fiche in the batch
        // STEP 1: Ensure all fiches have full details (same as frontend flow)
        // Track which fiches have recordings AFTER fetching full details
        const fichesWithRecordings: string[] = [];
        const fichesWithoutRecordings: string[] = [];

        for (let i = 0; i < batchFicheIds.length; i++) {
          const ficheId = batchFicheIds[i];

          try {
            // Add delay to avoid overwhelming API
            if (i > 0) {
              await step.sleep(`delay-fetch-${ficheId}`, 2000);
            }

            // Use the SAME function the frontend uses when clicking on a sale
            // This handles everything automatically:
            // - Checks cache
            // - If _salesListOnly, fetches full details with cle
            // - Caches full details
            // - Returns complete data with recordings
            const fetchResult = await step.run(
              `ensure-fiche-${ficheId}`,
              async () => {
                const { getFicheWithCache } = await import(
                  "../fiches/fiches.cache.js"
                );

                await log("info", `Ensuring fiche ${ficheId} has full details`);
                const ficheData = await getFicheWithCache(ficheId);
                const recordingsCount =
                  (ficheData as any).recordings?.length || 0;

                await log(
                  "info",
                  `Fiche ${ficheId} ready with ${recordingsCount} recordings`
                );
                return { ficheId, recordingsCount };
              }
            );

            // Track fiches based on whether they have recordings (AFTER full details fetched)
            if (fetchResult.recordingsCount > 0) {
              fichesWithRecordings.push(ficheId);
              await log(
                "info",
                `Fiche ${ficheId} has ${fetchResult.recordingsCount} recordings - will process`
              );
            } else {
              fichesWithoutRecordings.push(ficheId);
              await log(
                "info",
                `Fiche ${ficheId} has no recordings - skipping transcription and audit`
              );
            }
          } catch (error: any) {
            await log(
              "error",
              `Failed to fetch fiche ${ficheId}: ${error.message}`
            );
            results.failed.push({ ficheId, error: error.message });

            if (!schedule.continueOnError) {
              throw error;
            }
          }
        }

        // Log summary of fiches with/without recordings
        await log("info", `Batch fiche check complete`, {
          total: batchFicheIds.length,
          withRecordings: fichesWithRecordings.length,
          withoutRecordings: fichesWithoutRecordings.length,
          skipped: fichesWithoutRecordings,
        });

        // STEP 2: Transcribe fiches sequentially with delays (to avoid Inngest rate limits)
        // Note: The actual transcription work happens in parallel via the transcribeFicheFunction
        // ONLY process fiches that have recordings
        if (schedule.runTranscription && fichesWithRecordings.length > 0) {
          await log(
            "info",
            `Transcribing ${fichesWithRecordings.length} fiches with recordings (skipping ${fichesWithoutRecordings.length} without recordings)`
          );

          for (let i = 0; i < fichesWithRecordings.length; i++) {
            const ficheId = fichesWithRecordings[i];

            try {
              // Add delay between transcription invocations (deterministic step IDs)
              if (i > 0) {
                await step.sleep(
                  `delay-transcribe-batch-${batchStart}-${i}`,
                  1000
                ); // 1s delay between invocations
              }

              await log("info", `Starting transcription for fiche ${ficheId}`);

              await step.invoke(`transcribe-fiche-${ficheId}`, {
                function: transcribeFicheFunction,
                data: {
                  fiche_id: ficheId,
                  priority:
                    (schedule.transcriptionPriority as
                      | "normal"
                      | "high"
                      | "low") || "normal",
                },
              });
              results.transcriptions++;
              await log("info", `Transcription complete for fiche ${ficheId}`);
            } catch (error: any) {
              if (
                schedule.skipIfTranscribed &&
                error.message?.includes("already transcribed")
              ) {
                await log(
                  "info",
                  `Fiche ${ficheId} already transcribed, skipping`
                );
              } else {
                await log(
                  "error",
                  `Transcription failed for fiche ${ficheId}: ${error.message}`
                );
                if (!schedule.continueOnError) {
                  throw error;
                }
              }
            }
          }

          await log("info", `Batch transcriptions complete`);
        } else if (fichesWithRecordings.length === 0) {
          await log(
            "info",
            `No fiches with recordings to transcribe in this batch`
          );
        }

        // STEP 3: Run audits for each fiche in the batch
        // ONLY audit fiches that have recordings
        for (const ficheId of fichesWithRecordings) {
          try {
            await log("info", `Running audits for fiche ${ficheId}`);

            // Step 5c: Run audits if configured
            if (schedule.runAudits) {
              // Determine which audit configs to run
              let auditConfigIds: number[] = [];

              // Log schedule audit configuration for debugging
              await log("debug", `Audit configuration for schedule`, {
                useAutomaticAudits: schedule.useAutomaticAudits,
                specificAuditConfigs: schedule.specificAuditConfigs,
                specificAuditConfigsType: typeof schedule.specificAuditConfigs,
                specificAuditConfigsIsArray: Array.isArray(
                  schedule.specificAuditConfigs
                ),
                specificAuditConfigsLength:
                  schedule.specificAuditConfigs?.length,
              });

              // First, add specific audit configs if provided
              if (
                schedule.specificAuditConfigs &&
                Array.isArray(schedule.specificAuditConfigs) &&
                schedule.specificAuditConfigs.length > 0
              ) {
                // Handle Number formats, filter out null/undefined/invalid
                // Note: BigInts are already converted to Numbers in load-schedule step
                const specificIds = schedule.specificAuditConfigs
                  .filter((id) => {
                    // Filter out null, undefined, 0, and invalid values
                    if (id === null || id === undefined || id === 0) {
                      return false;
                    }
                    return true;
                  })
                  .map((id) => Number(id)) // Ensure it's a number
                  .filter((id) => !isNaN(id) && id > 0); // Additional safety check

                if (specificIds.length > 0) {
                  auditConfigIds.push(...specificIds);

                  await log(
                    "info",
                    `Added ${specificIds.length} specific audit configs`,
                    { specific_audit_config_ids: specificIds }
                  );
                } else {
                  await log(
                    "warning",
                    `Specific audit configs array contains only null/invalid values`,
                    {
                      raw_configs: schedule.specificAuditConfigs,
                      hint: "The schedule was saved with invalid audit config IDs. Please edit the schedule and re-select audit configs.",
                    }
                  );
                }
              } else {
                await log("info", `No specific audit configs configured`, {
                  specificAuditConfigsProvided: !!schedule.specificAuditConfigs,
                  specificAuditConfigsLength:
                    schedule.specificAuditConfigs?.length || 0,
                });
              }

              // Then, add automatic audits ONLY if explicitly enabled
              // (removed fallback behavior - only use selected audits)
              if (schedule.useAutomaticAudits) {
                const automaticConfigs = await step.run(
                  `get-automatic-audits-${ficheId}`,
                  async () => {
                    return await automationRepository.getAutomaticAuditConfigs();
                  }
                );
                const automaticIds = automaticConfigs.map((c) => Number(c.id));

                if (automaticIds.length > 0) {
                  auditConfigIds.push(...automaticIds);

                  await log(
                    "info",
                    `Added ${automaticIds.length} automatic audit configs`,
                    { automatic_audit_config_ids: automaticIds }
                  );
                } else {
                  await log(
                    "info",
                    `No automatic audit configs found in database`,
                    { checked_automatic_audits: true }
                  );
                }
              }

              // Remove duplicates
              auditConfigIds = [...new Set(auditConfigIds)];

              if (auditConfigIds.length === 0) {
                await log(
                  "warning",
                  `No valid audit configs found for fiche ${ficheId}, skipping audits`,
                  {
                    useAutomaticAudits: schedule.useAutomaticAudits,
                    specificAuditConfigs: schedule.specificAuditConfigs,
                    troubleshooting:
                      "Please ensure: 1) Specific audit config IDs are saved in the schedule, OR 2) At least one audit config is marked as 'automatic' in the database",
                  }
                );
              } else {
                await log(
                  "info",
                  `Running ${auditConfigIds.length} audit(s) for fiche ${ficheId}`,
                  { audit_config_ids: auditConfigIds }
                );
              }

              // Run each audit
              for (const auditConfigId of auditConfigIds) {
                try {
                  await step.invoke(`audit-${ficheId}-${auditConfigId}`, {
                    function: runAuditFunction,
                    data: {
                      fiche_id: ficheId,
                      audit_config_id: auditConfigId,
                    },
                  });
                  results.audits++;
                } catch (error: any) {
                  await log(
                    "error",
                    `Audit failed for fiche ${ficheId}, config ${auditConfigId}`,
                    {
                      error: error.message,
                    }
                  );

                  if (!schedule.continueOnError) {
                    throw error;
                  }
                }
              }
            }

            results.successful.push(ficheId);
            await log("info", `Successfully processed fiche ${ficheId}`);
          } catch (error: any) {
            await log(
              "error",
              `Failed to process fiche ${ficheId}: ${error.message}`
            );
            results.failed.push({ ficheId, error: error.message });

            if (!schedule.continueOnError) {
              throw error;
            }
          }
        }

        // Log audit completion summary
        if (fichesWithoutRecordings.length > 0) {
          await log(
            "info",
            `Skipped ${fichesWithoutRecordings.length} fiches without recordings`,
            {
              skipped_fiches: fichesWithoutRecordings,
            }
          );
        }

        // Log batch completion
        await log("info", `Completed batch ${batchIndex + 1}`, {
          successful: results.successful.length,
          failed: results.failed.length,
          withRecordings: fichesWithRecordings.length,
          withoutRecordings: fichesWithoutRecordings.length,
        });
      }

      // Step 6: Finalize run
      const durationMs = Date.now() - startTime!;
      const finalStatus =
        results.failed.length === 0
          ? "completed"
          : results.successful.length > 0
          ? "partial"
          : "failed";

      await step.run("finalize-run", async () => {
        await automationRepository.updateAutomationRun(runId, {
          status: finalStatus,
          completedAt: new Date(),
          durationMs,
          totalFiches: ficheIds.length,
          successfulFiches: results.successful.length,
          failedFiches: results.failed.length,
          transcriptionsRun: results.transcriptions,
          auditsRun: results.audits,
          resultSummary: {
            successful: results.successful,
            failed: results.failed,
            transcriptions: results.transcriptions,
            audits: results.audits,
          },
        });

        await automationRepository.updateScheduleStats(
          BigInt(schedule_id),
          finalStatus === "completed" ? "success" : finalStatus
        );
      });

      // Step 7: Send notifications
      if (
        (schedule.notifyOnComplete && finalStatus === "completed") ||
        (schedule.notifyOnError && finalStatus !== "completed")
      ) {
        await step.run("send-notifications", async () => {
          const notification = {
            schedule_id,
            schedule_name: schedule.name,
            run_id: String(runId),
            status: finalStatus,
            duration_seconds: Math.round(durationMs / 1000),
            total_fiches: ficheIds.length,
            successful_fiches: results.successful.length,
            failed_fiches: results.failed.length,
            transcriptions_run: results.transcriptions,
            audits_run: results.audits,
            failures: results.failed,
          };

          // Webhook notification
          if (schedule.webhookUrl) {
            await automationApi.sendNotificationWebhook(
              schedule.webhookUrl,
              notification
            );
          }

          // Email notification
          if (schedule.notifyEmails.length > 0) {
            const subject = `Automation ${
              schedule.name
            } - ${finalStatus.toUpperCase()}`;
            const message = `
Automation completed with status: ${finalStatus}

Summary:
- Total Fiches: ${ficheIds.length}
- Successful: ${results.successful.length}
- Failed: ${results.failed.length}
- Transcriptions: ${results.transcriptions}
- Audits: ${results.audits}
- Duration: ${Math.round(durationMs / 1000)}s

${
  results.failed.length > 0
    ? `\nFailures:\n${results.failed
        .map((f) => `- ${f.ficheId}: ${f.error}`)
        .join("\n")}`
    : ""
}
            `.trim();

            await automationApi.sendEmailNotification(
              schedule.notifyEmails,
              subject,
              message
            );
          }
        });
      }

      await log("info", "Automation run completed", {
        status: finalStatus,
        duration_ms: durationMs,
      });

      return {
        success: true,
        schedule_id,
        run_id: String(runId),
        status: finalStatus,
        total_fiches: ficheIds.length,
        successful_fiches: results.successful.length,
        failed_fiches: results.failed.length,
        transcriptions_run: results.transcriptions,
        audits_run: results.audits,
        duration_ms: durationMs,
      };
    } catch (error: any) {
      // Handle catastrophic failure
      const durationMs = Date.now() - startTime!;

      await step.run("handle-failure", async () => {
        await automationRepository.updateAutomationRun(runId, {
          status: "failed",
          completedAt: new Date(),
          durationMs,
          errorMessage: error.message,
          errorDetails: {
            stack: error.stack,
            name: error.name,
          },
        });

        await automationRepository.updateScheduleStats(
          BigInt(schedule_id),
          "failed"
        );
        await log("error", `Automation failed: ${error.message}`, {
          error: error.stack,
        });
      });

      // Send error notification
      if (schedule.notifyOnError) {
        await step.run("send-error-notification", async () => {
          const notification = {
            schedule_id,
            schedule_name: schedule.name,
            run_id: String(runId),
            status: "failed",
            error: error.message,
            duration_seconds: Math.round(durationMs / 1000),
          };

          if (schedule.webhookUrl) {
            await automationApi.sendNotificationWebhook(
              schedule.webhookUrl,
              notification
            );
          }

          if (schedule.notifyEmails.length > 0) {
            await automationApi.sendEmailNotification(
              schedule.notifyEmails,
              `Automation ${schedule.name} - FAILED`,
              `Automation failed with error: ${error.message}`
            );
          }
        });
      }

      throw error;
    }
  }
);

/**
 * Scheduled Automation Functions
 * ===============================
 * These cron functions check for schedules that should run
 */

/**
 * Check for scheduled automations (runs every 15 minutes)
 * Finds schedules that should run based on their schedule type and triggers them
 */
export const scheduledAutomationCheck = inngest.createFunction(
  {
    id: "scheduled-automation-check",
    name: "Check Scheduled Automations",
    retries: 1,
  },
  { cron: "*/15 * * * *" }, // Every 15 minutes
  async ({ step, logger }) => {
    logger.info("Checking for scheduled automations to run");

    // Get all active schedules
    const schedules = await step.run("get-active-schedules", async () => {
      return await automationRepository.getAllAutomationSchedules(false); // Only active
    });

    logger.info(`Found ${schedules.length} active schedules`);

    // Filter schedules that should run now
    const schedulesToRun = await step.run("filter-schedules", async () => {
      const now = new Date();
      const toRun = [];

      for (const schedule of schedules) {
        // Skip MANUAL schedules
        if (schedule.scheduleType === "MANUAL") {
          continue;
        }

        // Check if schedule needs required fields
        if (schedule.scheduleType === "DAILY" && !schedule.timeOfDay) {
          logger.warn(`Schedule ${schedule.id} (DAILY) missing timeOfDay`);
          continue;
        }

        if (
          schedule.scheduleType === "WEEKLY" &&
          (!schedule.timeOfDay || schedule.dayOfWeek === null)
        ) {
          logger.warn(
            `Schedule ${schedule.id} (WEEKLY) missing timeOfDay or dayOfWeek`
          );
          continue;
        }

        if (
          schedule.scheduleType === "MONTHLY" &&
          (!schedule.timeOfDay || !schedule.dayOfMonth)
        ) {
          logger.warn(
            `Schedule ${schedule.id} (MONTHLY) missing timeOfDay or dayOfMonth`
          );
          continue;
        }

        // Calculate next run time
        const nextRun = automationService.getNextRunTime(
          schedule.scheduleType,
          schedule.cronExpression || undefined,
          schedule.timeOfDay || undefined,
          schedule.dayOfWeek !== null ? schedule.dayOfWeek : undefined,
          schedule.dayOfMonth || undefined,
          schedule.timezone
        );

        if (!nextRun) {
          continue;
        }

        // Check if it should run now (within last 15 minutes to current time)
        const fifteenMinutesAgo = new Date(now.getTime() - 15 * 60 * 1000);

        // Should run if:
        // 1. Next run time is in the past (missed run)
        // 2. Or next run time is within the last 15 minutes
        // 3. And hasn't run in the last 15 minutes (to avoid duplicate runs)
        const shouldRun =
          nextRun <= now &&
          (!schedule.lastRunAt ||
            new Date(schedule.lastRunAt) <= fifteenMinutesAgo);

        if (shouldRun) {
          toRun.push({
            id: String(schedule.id),
            name: schedule.name,
            scheduleType: schedule.scheduleType,
            nextRun: nextRun.toISOString(),
            lastRun: schedule.lastRunAt
              ? new Date(schedule.lastRunAt).toISOString()
              : "never",
          });
        }
      }

      return toRun;
    });

    logger.info(`${schedulesToRun.length} schedules should run now`);

    // Trigger each schedule
    const results = await step.run("trigger-schedules", async () => {
      const triggered = [];

      for (const schedule of schedulesToRun) {
        try {
          // Send automation/run event
          await step.sendEvent(`trigger-schedule-${schedule.id}`, {
            name: "automation/run",
            data: {
              schedule_id: parseInt(schedule.id),
            },
          });

          triggered.push({
            schedule_id: schedule.id,
            name: schedule.name,
            status: "triggered",
          });

          logger.info(`Triggered schedule ${schedule.id} (${schedule.name})`);
        } catch (error: any) {
          logger.error(`Failed to trigger schedule ${schedule.id}`, {
            error: error.message,
          });

          triggered.push({
            schedule_id: schedule.id,
            name: schedule.name,
            status: "failed",
            error: error.message,
          });
        }
      }

      return triggered;
    });

    return {
      success: true,
      checked: schedules.length,
      triggered: results.length,
      results,
    };
  }
);

export const functions = [runAutomationFunction, scheduledAutomationCheck];
