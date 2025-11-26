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
              .flatMap((id: string) => id.trim().split(/[\s,]+/))
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

        // Step 3c: Fetch fiches (DB-first, then API for missing with max 3 concurrent)
        const allFiches = await step.run("fetch-all-fiches", async () => {
          const { getFichesByDateRangeWithStatus } = await import("../fiches/fiches.service.js");
          const { hasDataForDate } = await import("../fiches/fiches.repository.js");
          
          // Convert DD/MM/YYYY to YYYY-MM-DD for DB queries
          const convertDate = (d: string) => {
            const [day, month, year] = d.split("/");
            return `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
          };
          
          // Check which dates are in DB
          const dateStatus = await Promise.all(
            dates.map(async date => ({
              date,
              inDB: await hasDataForDate(convertDate(date))
            }))
          );
          
          const datesInDB = dateStatus.filter(d => d.inDB).map(d => d.date);
          const datesMissing = dateStatus.filter(d => !d.inDB).map(d => d.date);
          
          await log("info", `Dates in DB: ${datesInDB.length}, Missing: ${datesMissing.length}`);
          
          // Fetch from DB
          const sortedDates = dates.sort((a, b) => {
            const [dayA, monthA, yearA] = a.split("/");
            const [dayB, monthB, yearB] = b.split("/");
            return new Date(+yearA, +monthA - 1, +dayA).getTime() - 
                   new Date(+yearB, +monthB - 1, +dayB).getTime();
          });
          
          const startDate = convertDate(sortedDates[0]);
          const endDate = convertDate(sortedDates[sortedDates.length - 1]);
          
          const dbResult = await getFichesByDateRangeWithStatus(startDate, endDate);
          await log("info", `Loaded ${dbResult.fiches.length} fiches from DB`);
          
          // Fetch missing dates from API (max 3 concurrent)
          const apiFiches: any[] = [];
          if (datesMissing.length > 0) {
            await log("info", `Fetching ${datesMissing.length} missing dates from API (max 3 concurrent)`);
            
            for (let i = 0; i < datesMissing.length; i += 3) {
              const batch = datesMissing.slice(i, i + 3);
              const batchResults = await Promise.allSettled(
                batch.map(async date => {
                  try {
                    const fiches = await automationApi.fetchFichesForDate(date, false, apiKey);
                    await log("info", `Fetched ${fiches.length} fiches for ${date} from API`);
                    
                    // Cache them
                    for (const fiche of fiches) {
                      if (fiche.cle) {
                        const { cacheFicheSalesSummary } = await import("../fiches/fiches.cache.js");
                        await cacheFicheSalesSummary({
                          id: fiche.id,
                          cle: fiche.cle,
                          nom: fiche.nom,
                          prenom: fiche.prenom,
                          email: fiche.email,
                          telephone: fiche.telephone,
                          recordings: fiche.recordings,
                        }, { salesDate: convertDate(date) });
                      }
                    }
                    
                    return fiches;
                  } catch (error: any) {
                    await log("error", `Failed to fetch ${date}: ${error.message}`);
                    return [];
                  }
                })
              );
              
              batchResults.forEach(r => {
                if (r.status === "fulfilled") apiFiches.push(...r.value);
              });
              
              // Small delay between API batches
              if (i + 3 < datesMissing.length) {
                await new Promise(resolve => setTimeout(resolve, 1000));
              }
            }
          }
          
          return [...dbResult.fiches, ...apiFiches];
        });
        
        // Process fiches (extract IDs)
        await log("info", `Processing ${allFiches.length} fiches from DB+API`);
        
        // Extract all IDs
        const allIds = allFiches.map(f => f.ficheId || f.fiche_id || f.id).filter(Boolean);
        
        // Apply recording filter if needed
        let filteredFiches = allFiches;
        if (selection.onlyWithRecordings) {
          filteredFiches = allFiches.filter(f => {
            const recCount = f.transcription?.total || f.recordingsCount || (f.recordings?.length || 0);
            return recCount > 0;
          });
          await log("info", `Filtered to ${filteredFiches.length}/${allFiches.length} fiches with recordings`);
        }
        
        // Apply max limit
        if (selection.maxFiches && filteredFiches.length > selection.maxFiches) {
          filteredFiches = filteredFiches.slice(0, selection.maxFiches);
          await log("info", `Limited to ${selection.maxFiches} fiches`);
        }
        
        // Extract final IDs
        ficheIds = filteredFiches.map(f => f.ficheId || f.fiche_id || f.id).filter(Boolean);
        fichesData = filteredFiches;
        fichesCles = {};
        
        await log("info", `Final: ${ficheIds.length} fiches to process`);
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

      // STEP 1: Ensure all fiches cached (in batches to avoid API overload)
      const {
        withRecordings: fichesWithRecordings,
        withoutRecordings: fichesWithoutRecordings,
      } = await step.run("ensure-all-fiches-cached", async () => {
        const { getFicheWithCache } = await import("../fiches/fiches.cache.js");

        // Process in batches of 50 to avoid overwhelming the API
        const FETCH_BATCH_SIZE = 50;
        const allResults = [];

        for (let i = 0; i < ficheIds.length; i += FETCH_BATCH_SIZE) {
          const batchIds = ficheIds.slice(i, i + FETCH_BATCH_SIZE);
          await log(
            "info",
            `Fetching batch ${Math.floor(i / FETCH_BATCH_SIZE) + 1}/${Math.ceil(
              ficheIds.length / FETCH_BATCH_SIZE
            )} (${batchIds.length} fiches)`
          );

          const batchResults = await Promise.allSettled(
            batchIds.map(async (ficheId) => {
              const ficheData = await getFicheWithCache(ficheId);
              return {
                ficheId,
                recordingsCount: (ficheData as any).recordings?.length || 0,
              };
            })
          );

          allResults.push(...batchResults);

          // Small delay between batches
          if (i + FETCH_BATCH_SIZE < ficheIds.length) {
            await new Promise((resolve) => setTimeout(resolve, 2000));
          }
        }

        const fetchResults = allResults;

        const withRecordings: string[] = [];
        const withoutRecordings: string[] = [];

        for (let i = 0; i < fetchResults.length; i++) {
          if (fetchResults[i].status === "fulfilled") {
            const { ficheId, recordingsCount } = (fetchResults[i] as any).value;
            if (recordingsCount > 0) withRecordings.push(ficheId);
            else withoutRecordings.push(ficheId);
          } else {
            results.failed.push({
              ficheId: ficheIds[i],
              error: (fetchResults[i] as any).reason?.message,
            });
          }
        }

        return { withRecordings, withoutRecordings };
      });

      // STEP 2: Fan out ALL transcriptions at once
      if (schedule.runTranscription && fichesWithRecordings.length > 0) {
        await log(
          "info",
          `Sending ${fichesWithRecordings.length} transcription events (FULL FAN-OUT)`
        );

        await step.sendEvent(
          "fan-out-all-transcriptions",
          fichesWithRecordings.map((ficheId, idx) => ({
            name: "fiche/transcribe",
            data: {
              fiche_id: ficheId,
              priority:
                (schedule.transcriptionPriority as "normal" | "high" | "low") ||
                "normal",
            },
            id: `transcribe-${ficheId}-${Date.now()}-${idx}`,
          }))
        );

        // Wait for transcriptions with smart completion detection
        await step.run("wait-for-transcriptions", async () => {
          const { getFicheTranscriptionStatus } = await import(
            "../transcriptions/transcriptions.service.js"
          );

          const maxWait = 15 * 60 * 1000; // 15 min max
          const pollInterval = 30000; // 30 seconds
          const startTime = Date.now();
          let lastCompleted = 0;
          let stableCount = 0;

          while (Date.now() - startTime < maxWait) {
            const statuses = await Promise.all(
              fichesWithRecordings.map((id) => getFicheTranscriptionStatus(id))
            );
            const completed = statuses.filter(
              (s) => s.total && s.transcribed === s.total
            ).length;

            await log(
              "info",
              `Transcription progress: ${completed}/${fichesWithRecordings.length}`
            );

            // Exit if all complete
            if (completed === fichesWithRecordings.length) {
              results.transcriptions = completed;
              await log(
                "info",
                `All transcriptions complete in ${Math.round(
                  (Date.now() - startTime) / 1000
                )}s!`
              );
              return { completed };
            }

            // Exit if progress has stalled for 3 polls (likely some failed)
            if (completed === lastCompleted) {
              stableCount++;
              if (stableCount >= 3) {
                results.transcriptions = completed;
                await log(
                  "info",
                  `Transcriptions stable at ${completed}/${fichesWithRecordings.length} - continuing`
                );
                return { completed };
              }
            } else {
              stableCount = 0;
              lastCompleted = completed;
            }

            await new Promise((resolve) => setTimeout(resolve, pollInterval));
          }

          // Timeout - use whatever we have
          results.transcriptions = lastCompleted;
          await log("warning", `Transcription timeout - completed ${lastCompleted}/${fichesWithRecordings.length}`);
          return { completed: lastCompleted };
        });
      }

      // STEP 3: Fan out ALL audits at once
      if (schedule.runAudits && fichesWithRecordings.length > 0) {
        const auditConfigIds = await step.run(
          "resolve-all-audit-configs",
          async () => {
            let configIds: number[] = [];

            if (schedule.specificAuditConfigs?.length > 0) {
              configIds.push(
                ...schedule.specificAuditConfigs
                  .filter((id) => id && id !== 0)
                  .map((id) => Number(id))
              );
            }

            if (schedule.useAutomaticAudits) {
              const automaticConfigs =
                await automationRepository.getAutomaticAuditConfigs();
              configIds.push(...automaticConfigs.map((c) => Number(c.id)));
            }

            configIds = [...new Set(configIds)];
            await log(
              "info",
              `Running ${configIds.length} configs × ${
                fichesWithRecordings.length
              } fiches = ${
                configIds.length * fichesWithRecordings.length
              } total audits`
            );
            return configIds;
          }
        );

        const auditTasks = fichesWithRecordings.flatMap((ficheId) =>
          auditConfigIds.map((configId) => ({ ficheId, configId }))
        );

        if (auditTasks.length > 0) {
          await log(
            "info",
            `Sending ${auditTasks.length} audit events (FULL FAN-OUT)`
          );

          await step.sendEvent(
            "fan-out-all-audits",
            auditTasks.map(({ ficheId, configId }, idx) => ({
              name: "audit/run",
              data: { fiche_id: ficheId, audit_config_id: configId },
              id: `audit-${ficheId}-${configId}-${Date.now()}-${idx}`,
            }))
          );

            // Poll for audits with smart completion detection
            await step.run("wait-for-audits", async () => {
              const { prisma } = await import("../../shared/prisma.js");

              const maxWait = 30 * 60 * 1000; // 30 min max
              const pollInterval = 60000; // 60 seconds
              const startTime = Date.now();
              let lastCompleted = 0;
              let stableCount = 0;

              while (Date.now() - startTime < maxWait) {
                const completed = await prisma.audit.count({
                  where: {
                    ficheCache: { ficheId: { in: fichesWithRecordings } },
                    auditConfigId: { in: auditConfigIds.map((id) => BigInt(id)) },
                    status: "completed",
                  },
                });

                await log(
                  "info",
                  `Audit progress: ${completed}/${auditTasks.length}`
                );

                // Exit if all complete
                if (completed === auditTasks.length) {
                  results.audits = completed;
                  results.successful = [...fichesWithRecordings];
                  await log("info", `All audits complete in ${Math.round((Date.now() - startTime)/1000)}s!`);
                  return { completed };
                }

                // Exit if progress has stalled for 3 polls (some may have failed)
                if (completed === lastCompleted) {
                  stableCount++;
                  if (stableCount >= 3) {
                    results.audits = completed;
                    results.successful = [...fichesWithRecordings];
                    await log("info", `Audits stable at ${completed}/${auditTasks.length} - continuing`);
                    return { completed };
                  }
                } else {
                  stableCount = 0;
                  lastCompleted = completed;
                }

                await new Promise((resolve) => setTimeout(resolve, pollInterval));
              }

              // Timeout - use whatever we have
              results.audits = lastCompleted;
              results.successful = [...fichesWithRecordings];
              await log("warning", `Audit timeout - completed ${lastCompleted}/${auditTasks.length}`);
              return { completed: lastCompleted };
            });
        }
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
