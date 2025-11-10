/**
 * Automation Workflows
 * ====================
 * Inngest workflow functions for automated audit processing
 */

import { inngest } from "../../inngest/client.js";
import { NonRetriableError } from "inngest";
import {
  getAutomationScheduleById,
  createAutomationRun,
  updateAutomationRun,
  updateScheduleStats,
  addAutomationLog,
  getAutomaticAuditConfigs,
} from "./automation.repository.js";
import {
  fetchFichesBySelection,
  sendNotificationWebhook,
  sendEmailNotification,
} from "./automation.service.js";
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
    const startTime = Date.now();

    logger.info("Starting automation run", { schedule_id });

    // Step 1: Load schedule configuration
    const schedule = await step.run("load-schedule", async () => {
      const scheduleData = await getAutomationScheduleById(BigInt(schedule_id));
      if (!scheduleData) {
        throw new NonRetriableError(`Schedule ${schedule_id} not found`);
      }
      if (!scheduleData.isActive) {
        throw new NonRetriableError(`Schedule ${schedule_id} is not active`);
      }
      return scheduleData;
    });

    logger.info("Schedule loaded", {
      name: schedule.name,
      schedule_type: schedule.scheduleType,
    });

    // Step 2: Create automation run record
    const run = await step.run("create-run-record", async () => {
      return await createAutomationRun(BigInt(schedule_id), {
        schedule: {
          name: schedule.name,
          scheduleType: schedule.scheduleType,
        },
        overrides: override_fiche_selection || null,
      });
    });

    const runId = run.id;
    logger.info("Run record created", { run_id: String(runId) });

    // Helper to add logs
    const log = async (level: string, message: string, metadata?: any) => {
      await addAutomationLog(runId, level, message, metadata);
      logger.info(message, metadata);
    };

    try {
      // Step 3: Fetch fiche IDs
      const ficheIds = await step.run("fetch-fiches", async () => {
        await log("info", "Fetching fiches based on selection criteria");

        const selection = override_fiche_selection || (schedule.ficheSelection as any);
        const apiKey = schedule.externalApiKey || undefined;

        try {
          const ids = await fetchFichesBySelection(selection, apiKey);
          await log("info", `Found ${ids.length} fiches to process`, {
            count: ids.length,
          });
          return ids;
        } catch (error: any) {
          await log("error", `Failed to fetch fiches: ${error.message}`);
          throw error;
        }
      });

      if (ficheIds.length === 0) {
        await log("warning", "No fiches found matching criteria");
        
        // Update run status
        await step.run("update-run-no-fiches", async () => {
          await updateAutomationRun(runId, {
            status: "completed",
            completedAt: new Date(),
            durationMs: Date.now() - startTime,
            totalFiches: 0,
            successfulFiches: 0,
            failedFiches: 0,
            resultSummary: {
              message: "No fiches found",
              ficheIds: [],
            },
          });
          await updateScheduleStats(BigInt(schedule_id), "success");
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
        await updateAutomationRun(runId, {
          totalFiches: ficheIds.length,
        });
      });

      // Step 4: Process each fiche
      const results = {
        successful: [] as string[],
        failed: [] as { ficheId: string; error: string }[],
        transcriptions: 0,
        audits: 0,
      };

      for (const ficheId of ficheIds) {
        try {
          await log("info", `Processing fiche ${ficheId}`);

          // Step 4a: Fetch fiche
          await step.invoke(`fetch-fiche-${ficheId}`, {
            function: fetchFicheFunction,
            data: { fiche_id: ficheId },
          });

          // Step 4b: Transcribe if configured
          if (schedule.runTranscription) {
            await log("info", `Transcribing fiche ${ficheId}`);
            
            try {
              await step.invoke(`transcribe-fiche-${ficheId}`, {
                function: transcribeFicheFunction,
                data: {
                  fiche_id: ficheId,
                  priority: schedule.transcriptionPriority || "normal",
                },
              });
              results.transcriptions++;
            } catch (error: any) {
              if (schedule.skipIfTranscribed && error.message?.includes("already transcribed")) {
                await log("info", `Fiche ${ficheId} already transcribed, skipping`);
              } else {
                throw error;
              }
            }
          }

          // Step 4c: Run audits if configured
          if (schedule.runAudits) {
            // Determine which audit configs to run
            let auditConfigIds: number[] = [];

            if (schedule.useAutomaticAudits) {
              const automaticConfigs = await step.run(
                `get-automatic-audits-${ficheId}`,
                async () => {
                  return await getAutomaticAuditConfigs();
                }
              );
              auditConfigIds = automaticConfigs.map((c) => Number(c.id));
            }

            if (schedule.specificAuditConfigs.length > 0) {
              auditConfigIds = [
                ...auditConfigIds,
                ...schedule.specificAuditConfigs.map(Number),
              ];
            }

            // Remove duplicates
            auditConfigIds = [...new Set(auditConfigIds)];

            await log("info", `Running ${auditConfigIds.length} audits for fiche ${ficheId}`);

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
                await log("error", `Audit failed for fiche ${ficheId}, config ${auditConfigId}`, {
                  error: error.message,
                });
                
                if (!schedule.continueOnError) {
                  throw error;
                }
              }
            }
          }

          results.successful.push(ficheId);
          await log("info", `Successfully processed fiche ${ficheId}`);
        } catch (error: any) {
          await log("error", `Failed to process fiche ${ficheId}: ${error.message}`);
          results.failed.push({ ficheId, error: error.message });

          if (!schedule.continueOnError) {
            throw error;
          }
        }
      }

      // Step 5: Finalize run
      const durationMs = Date.now() - startTime;
      const finalStatus =
        results.failed.length === 0
          ? "completed"
          : results.successful.length > 0
          ? "partial"
          : "failed";

      await step.run("finalize-run", async () => {
        await updateAutomationRun(runId, {
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

        await updateScheduleStats(
          BigInt(schedule_id),
          finalStatus === "completed" ? "success" : finalStatus
        );
      });

      // Step 6: Send notifications
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
            await sendNotificationWebhook(schedule.webhookUrl, notification);
          }

          // Email notification
          if (schedule.notifyEmails.length > 0) {
            const subject = `Automation ${schedule.name} - ${finalStatus.toUpperCase()}`;
            const message = `
Automation completed with status: ${finalStatus}

Summary:
- Total Fiches: ${ficheIds.length}
- Successful: ${results.successful.length}
- Failed: ${results.failed.length}
- Transcriptions: ${results.transcriptions}
- Audits: ${results.audits}
- Duration: ${Math.round(durationMs / 1000)}s

${results.failed.length > 0 ? `\nFailures:\n${results.failed.map((f) => `- ${f.ficheId}: ${f.error}`).join("\n")}` : ""}
            `.trim();

            await sendEmailNotification(schedule.notifyEmails, subject, message);
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
      const durationMs = Date.now() - startTime;

      await step.run("handle-failure", async () => {
        await updateAutomationRun(runId, {
          status: "failed",
          completedAt: new Date(),
          durationMs,
          errorMessage: error.message,
          errorDetails: {
            stack: error.stack,
            name: error.name,
          },
        });

        await updateScheduleStats(BigInt(schedule_id), "failed");
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
            await sendNotificationWebhook(schedule.webhookUrl, notification);
          }

          if (schedule.notifyEmails.length > 0) {
            await sendEmailNotification(
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
 * Daily automation check (runs at 2 AM UTC)
 */
export const dailyAutomationCheck = inngest.createFunction(
  {
    id: "daily-automation-check",
    name: "Daily Automation Check",
    retries: 1,
  },
  { cron: "0 2 * * *" },
  async ({ step, logger }) => {
    logger.info("Running daily automation check");

    // This would check for schedules that need to run today
    // For now, it's a placeholder - schedules will be triggered manually via API
    
    return {
      success: true,
      message: "Daily check completed",
    };
  }
);

export const functions = [runAutomationFunction, dailyAutomationCheck];

