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
import { validateFicheSelection } from "./automation.schemas.js";
import { TIMEOUTS } from "../../shared/constants.js";
import { runAuditFunction } from "../audits/audits.workflows.js";
import { fetchFicheFunction } from "../fiches/fiches.workflows.js";
import { transcribeFicheFunction } from "../transcriptions/transcriptions.workflows.js";
import type {
  AutomationLogLevel,
  FicheSelection,
  ScheduleType,
  TranscriptionPriority,
} from "./automation.schemas.js";
import type { RecordingLike } from "../../utils/recording-parser.js";

type WorkflowSchedule = {
  id: string;
  name: string;
  scheduleType: ScheduleType;
  ficheSelection: FicheSelection;
  externalApiKey: string | null;
  runTranscription: boolean;
  skipIfTranscribed: boolean;
  transcriptionPriority: TranscriptionPriority;
  runAudits: boolean;
  useAutomaticAudits: boolean;
  specificAuditConfigs: number[];
  continueOnError: boolean;
  retryFailed: boolean;
  maxRetries: number;
  notifyOnComplete: boolean;
  notifyOnError: boolean;
  webhookUrl: string | null;
  notifyEmails: string[];
};

type ActiveScheduleSerializable = {
  id: string;
  name: string;
  scheduleType: ScheduleType;
  cronExpression: string | null;
  timezone: string;
  timeOfDay: string | null;
  dayOfWeek: number | null;
  dayOfMonth: number | null;
  lastRunAt: string | null;
};

type DueSchedule = {
  id: string;
  name: string;
  scheduleType: ScheduleType;
  cronExpression: string;
  dueAt: string;
  lastRun: string;
};

type TriggerResult =
  | { schedule_id: string; name: string; status: "triggered"; dueAt: string }
  | { schedule_id: string; name: string; status: "failed"; dueAt: string; error: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function toTranscriptionPriority(value: unknown): TranscriptionPriority {
  return value === "low" || value === "normal" || value === "high" ? value : "normal";
}

function toScheduleType(value: unknown): ScheduleType {
  return value === "MANUAL" ||
    value === "DAILY" ||
    value === "WEEKLY" ||
    value === "MONTHLY" ||
    value === "CRON"
    ? value
    : "MANUAL";
}

function toBigIntId(value: number | string): bigint {
  const raw = String(value).trim();
  if (!raw) throw new NonRetriableError("Missing schedule_id");
  try {
    return BigInt(raw);
  } catch {
    throw new NonRetriableError(`Invalid schedule_id: ${raw}`);
  }
}

function getStringField(obj: Record<string, unknown>, key: string): string | null {
  const v = obj[key];
  return typeof v === "string" ? v : null;
}

function getFicheId(value: unknown): string | null {
  if (!isRecord(value)) return null;
  const a = getStringField(value, "ficheId");
  if (a) return a;
  const b = getStringField(value, "fiche_id");
  if (b) return b;
  const c = getStringField(value, "id");
  if (c) return c;
  const n = value.id;
  if (typeof n === "number" && Number.isFinite(n)) return String(n);
  return null;
}

function toSalesSummaryCacheInput(value: unknown): {
  id: string;
  cle: string;
  nom: string;
  prenom: string;
  email: string;
  telephone: string;
  recordings?: RecordingLike[];
} | null {
  if (!isRecord(value)) return null;

  const id = getFicheId(value);
  const cle = getStringField(value, "cle");
  if (!id || !cle) return null;

  const recordingsRaw = value.recordings;
  const recordings = Array.isArray(recordingsRaw)
    ? recordingsRaw.filter(isRecord).map((r) => r as RecordingLike)
    : undefined;

  return {
    id,
    cle,
    nom: getStringField(value, "nom") || "",
    prenom: getStringField(value, "prenom") || "",
    email: getStringField(value, "email") || "",
    telephone: getStringField(value, "telephone") || "",
    ...(recordings ? { recordings } : {}),
  };
}

function toLogContext(metadata: unknown): Record<string, unknown> | undefined {
  if (metadata === undefined) return undefined;
  if (isRecord(metadata)) return metadata;
  return { metadata };
}

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
    const scheduleId = toBigIntId(schedule_id);

    // Capture start time in a step to persist it across Inngest checkpoints
    const startTime = await step.run(
      "capture-automation-start-time",
      async (): Promise<number> => {
        return Date.now();
      }
    );

    logger.info("Starting automation run", { schedule_id });

    // Step 1: Load schedule configuration
    const schedule = await step.run("load-schedule", async (): Promise<WorkflowSchedule> => {
      const scheduleData =
        await automationRepository.getAutomationScheduleById(scheduleId);
      if (!scheduleData) {
        throw new NonRetriableError(`Schedule ${schedule_id} not found`);
      }
      if (!scheduleData.isActive) {
        throw new NonRetriableError(`Schedule ${schedule_id} is not active`);
      }

      const ficheSelection = validateFicheSelection(scheduleData.ficheSelection);

      // Inngest step results must be JSON-serializable.
      // Convert BigInt values explicitly.
      const specificAuditConfigs = (scheduleData.specificAuditConfigs || [])
        .map((id) => Number(id))
        .filter((id) => Number.isFinite(id) && id > 0);

      return {
        id: String(scheduleData.id),
        name: scheduleData.name,
        scheduleType: toScheduleType(scheduleData.scheduleType),
        ficheSelection,
        externalApiKey: scheduleData.externalApiKey,

        runTranscription: Boolean(scheduleData.runTranscription),
        skipIfTranscribed: Boolean(scheduleData.skipIfTranscribed),
        transcriptionPriority: toTranscriptionPriority(scheduleData.transcriptionPriority),

        runAudits: Boolean(scheduleData.runAudits),
        useAutomaticAudits: Boolean(scheduleData.useAutomaticAudits),
        specificAuditConfigs,

        continueOnError: Boolean(scheduleData.continueOnError),
        retryFailed: Boolean(scheduleData.retryFailed),
        maxRetries: Number(scheduleData.maxRetries || 0),

        notifyOnComplete: Boolean(scheduleData.notifyOnComplete),
        notifyOnError: Boolean(scheduleData.notifyOnError),
        webhookUrl: scheduleData.webhookUrl,
        notifyEmails: Array.isArray(scheduleData.notifyEmails)
          ? scheduleData.notifyEmails
          : [],
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
    const log = async (
      level: AutomationLogLevel,
      message: string,
      metadata?: unknown
    ) => {
      await automationRepository.addAutomationLog(
        runId,
        level,
        message,
        metadata
      );
      const ctx = toLogContext(metadata);
      if (level === "debug") logger.debug(message, ctx);
      else if (level === "warning") logger.warn(message, ctx);
      else if (level === "error") logger.error(message, ctx);
      else logger.info(message, ctx);
    };

    try {
      // Step 3: Calculate dates to query
      const selection = override_fiche_selection ?? schedule.ficheSelection;
      const apiKey = schedule.externalApiKey || undefined;

      // Declare variables that will be set in either manual or API mode
      let ficheIds: string[] = [];

      // Step 3a: Handle manual mode
      if (selection.mode === "manual" && selection.ficheIds) {
        const rawFicheIds = selection.ficheIds;
        const maxFiches = selection.maxFiches;
        const manualResult = await step.run(
          "process-manual-fiches",
          async () => {
            await log("info", "Processing manual fiche selection");

            // Parse fiche IDs - handle various separators (spaces, commas, mixed)
            // Split on any combination of commas, spaces, tabs, newlines
            const allIds = rawFicheIds
              .flatMap((id: string) => id.trim().split(/[\s,]+/))
              .filter(Boolean) // Remove empty strings
              .map((id: string) => id.trim()); // Trim each ID

            const limitedIds = allIds.slice(
              0,
              maxFiches || allIds.length
            );
            await log(
              "info",
              `Using ${limitedIds.length} manually selected fiches`,
              { ficheIds: limitedIds }
            );
            return { ficheIds: limitedIds };
          }
        );

        ficheIds = manualResult.ficheIds;

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
        const allFiches = await step.run("fetch-all-fiches", async (): Promise<unknown[]> => {
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
          const apiFiches: unknown[] = [];
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
                    const { cacheFicheSalesSummary } = await import("../fiches/fiches.cache.js");
                    for (const fiche of fiches) {
                      const cacheInput = toSalesSummaryCacheInput(fiche);
                      if (!cacheInput) continue;
                      await cacheFicheSalesSummary(cacheInput, {
                        salesDate: convertDate(date),
                      });
                    }
                    
                    return fiches;
                  } catch (error: unknown) {
                    await log("error", `Failed to fetch ${date}: ${errorMessage(error)}`);
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
        
        // NOTE: Do NOT filter by recordings here.
        // Date-range lists are often "sales list only" until we fetch fiche details.
        // We'll fetch fiche details in the next step and then determine which fiches truly have recordings.
        let filteredFiches: unknown[] = allFiches;
        if (selection.onlyWithRecordings) {
          await log(
            "info",
            "onlyWithRecordings is enabled - will filter AFTER fetching fiche details",
            { totalCandidates: allFiches.length }
          );
        }
        
        // Apply max limit
        if (selection.maxFiches && filteredFiches.length > selection.maxFiches) {
          filteredFiches = filteredFiches.slice(0, selection.maxFiches);
          await log("info", `Limited to ${selection.maxFiches} fiches`);
        }
        
        // Extract final IDs
        ficheIds = filteredFiches
          .map(getFicheId)
          .filter((id): id is string => typeof id === "string" && id.length > 0);
        
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

      // STEP 1: Ensure all fiches have FULL details cached (distributed across replicas)
      await log(
        "info",
        `Ensuring fiche details via distributed 'fiche/fetch' fan-out (${ficheIds.length} fiches)`
      );

      await step.sendEvent(
        "fan-out-fiche-fetches",
        ficheIds.map((ficheId, idx) => ({
          name: "fiche/fetch",
          data: {
            fiche_id: ficheId,
            force_refresh: false,
          },
          // Deterministic id: retries won't dispatch duplicate fetches for the same run+fiche
          id: `automation-${runIdString}-fetch-${ficheId}`,
        }))
      );

      // Durable wait (no in-step busy polling): poll DB snapshot with `step.run` + `step.sleep`.
      const ficheDetailsMaxWaitMs = Math.max(
        60_000,
        Number(
          process.env.AUTOMATION_FICHE_DETAILS_MAX_WAIT_MS || 10 * 60 * 1000
        )
      );
      const ficheDetailsPollIntervalSeconds = Math.max(
        5,
        Number(process.env.AUTOMATION_FICHE_DETAILS_POLL_INTERVAL_SECONDS || 20)
      );

      const ficheDetailsStarted = Date.now();
      let lastReady = 0;
      let stableCount = 0;
      let lastSnapshot: Array<{
        ficheId: string;
        exists: boolean;
        recordingsCount: number | null;
        hasRecordings: boolean;
        isSalesListOnly: boolean;
      }> = [];

      let ficheDetailsPollAttempt = 0;
      while (Date.now() - ficheDetailsStarted < ficheDetailsMaxWaitMs) {
        lastSnapshot = await step.run(
          `poll-fiche-details-${runIdString}-${ficheDetailsPollAttempt}`,
          async () => {
            const { prisma } = await import("../../shared/prisma.js");

            const rows = await prisma.ficheCache.findMany({
              where: { ficheId: { in: ficheIds } },
              select: {
                ficheId: true,
                recordingsCount: true,
                hasRecordings: true,
                rawData: true,
              },
            });

            const byId = new Map(rows.map((r) => [r.ficheId, r]));

            return ficheIds.map((id) => {
              const r = byId.get(id);
              if (!r) {
                return {
                  ficheId: id,
                  exists: false,
                  recordingsCount: null,
                  hasRecordings: false,
                  isSalesListOnly: true,
                };
              }
              const raw = r.rawData ?? null;
              const isSalesListOnly = isRecord(raw) && raw._salesListOnly === true;
              return {
                ficheId: id,
                exists: true,
                recordingsCount: r.recordingsCount ?? null,
                hasRecordings: Boolean(r.hasRecordings),
                isSalesListOnly,
              };
            });
          }
        );

        const ready = lastSnapshot.filter(
          (r) => r.exists && r.isSalesListOnly === false
        ).length;

        await log(
          "info",
          `Fiche details progress: ${ready}/${ficheIds.length}`
        );

        if (ready === ficheIds.length) break;

        if (ready === lastReady) {
          stableCount++;
          if (stableCount >= 3) break; // likely some failed; proceed with what we have
        } else {
          stableCount = 0;
          lastReady = ready;
        }

        ficheDetailsPollAttempt++;
        await step.sleep(
          `sleep-fiche-details-${runIdString}-${ficheDetailsPollAttempt}`,
          `${ficheDetailsPollIntervalSeconds}s`
        );
      }

      const ficheFetchFailures: Array<{ ficheId: string; error: string }> = [];
      const fichesWithRecordings: string[] = [];
      const fichesWithoutRecordings: string[] = [];

      for (const snap of lastSnapshot) {
        if (!snap.exists || snap.isSalesListOnly) {
          ficheFetchFailures.push({
            ficheId: snap.ficheId,
            error: snap.exists
              ? "Fiche details not fetched (still sales-list-only cache)"
              : "Fiche not found in cache",
          });
          continue;
        }

        if ((snap.recordingsCount ?? 0) > 0 || snap.hasRecordings) {
          fichesWithRecordings.push(snap.ficheId);
        } else {
          fichesWithoutRecordings.push(snap.ficheId);
        }
      }

      // Merge failures into run results
      results.failed.push(...ficheFetchFailures);

      await log("info", "Fiche detail fetch complete (distributed)", {
        total: ficheIds.length,
        withRecordings: fichesWithRecordings.length,
        withoutRecordings: fichesWithoutRecordings.length,
        failed: results.failed.length,
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
              // Automation doesn't need each fiche-level transcription orchestrator to block;
              // we wait/poll at the automation level (and audits also ensure transcription when needed).
              wait_for_completion: false,
            },
            // Deterministic id: avoid duplicate transcription dispatch on retries
            id: `automation-${runIdString}-transcribe-${ficheId}`,
          }))
        );

        // Durable wait (no in-step busy polling): poll status with `step.run` + `step.sleep`.
        const transcriptionMaxWaitMs = Math.max(
          60_000,
          Number(process.env.AUTOMATION_TRANSCRIPTION_MAX_WAIT_MS || 15 * 60 * 1000)
        );
        const transcriptionPollIntervalSeconds = Math.max(
          5,
          Number(process.env.AUTOMATION_TRANSCRIPTION_POLL_INTERVAL_SECONDS || 30)
        );

        const transcriptionStarted = Date.now();
        let lastCompleted = 0;
        let stableCount = 0;
        let transcriptionPollAttempt = 0;

        while (Date.now() - transcriptionStarted < transcriptionMaxWaitMs) {
          const completed = await step.run(
            `poll-transcriptions-${runIdString}-${transcriptionPollAttempt}`,
            async () => {
              const { getFicheTranscriptionStatus } = await import(
                "../transcriptions/transcriptions.service.js"
              );

              const statuses = await Promise.all(
                fichesWithRecordings.map((id) => getFicheTranscriptionStatus(id))
              );
              return statuses.filter((s) => s.total && s.transcribed === s.total).length;
            }
          );

          await log(
            "info",
            `Transcription progress: ${completed}/${fichesWithRecordings.length}`
          );

          if (completed === fichesWithRecordings.length) {
            results.transcriptions = completed;
            await log(
              "info",
              `All transcriptions complete in ${Math.round(
                (Date.now() - transcriptionStarted) / 1000
              )}s!`
            );
            break;
          }

          if (completed === lastCompleted) {
            stableCount++;
            if (stableCount >= 3) {
              results.transcriptions = completed;
              await log(
                "info",
                `Transcriptions stable at ${completed}/${fichesWithRecordings.length} - continuing`
              );
              break;
            }
          } else {
            stableCount = 0;
            lastCompleted = completed;
          }

          transcriptionPollAttempt++;
          await step.sleep(
            `sleep-transcriptions-${runIdString}-${transcriptionPollAttempt}`,
            `${transcriptionPollIntervalSeconds}s`
          );
        }

        if (results.transcriptions === 0 && lastCompleted > 0) {
          results.transcriptions = lastCompleted;
        }

        if (results.transcriptions < fichesWithRecordings.length) {
          await log(
            "warning",
            `Transcription timeout/stall - completed ${results.transcriptions}/${fichesWithRecordings.length}`
          );

          // Mark remaining fiches as failed to avoid reporting a false "completed" run.
          const incomplete = await step.run(
            `find-incomplete-transcriptions-${runIdString}`,
            async () => {
              const { getFicheTranscriptionStatus } = await import(
                "../transcriptions/transcriptions.service.js"
              );
              const statuses = await Promise.all(
                fichesWithRecordings.map((id) => getFicheTranscriptionStatus(id))
              );
              return statuses
                .filter((s) => !(s.total && s.transcribed === s.total))
                .map((s) => s.ficheId);
            }
          );

          for (const ficheId of incomplete) {
            results.failed.push({
              ficheId,
              error: "Transcription incomplete (timeout/stall)",
            });
          }
        }
      }

      // STEP 3: Fan out ALL audits at once
      if (schedule.runAudits && fichesWithRecordings.length > 0) {
        const auditConfigIds = await step.run(
          "resolve-all-audit-configs",
          async (): Promise<number[]> => {
            let configIds: number[] = [];

            if (schedule.specificAuditConfigs.length > 0) {
              configIds.push(
                ...schedule.specificAuditConfigs.filter(
                  (id) => Number.isFinite(id) && id > 0
                )
              );
            }

            if (schedule.useAutomaticAudits) {
              const automaticConfigs =
                await automationRepository.getAutomaticAuditConfigs();
              configIds.push(
                ...automaticConfigs
                  .map((c) => Number(c.id))
                  .filter((id) => Number.isFinite(id) && id > 0)
              );
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

        // Inngest JSONifies step outputs; be defensive and normalize to numbers
        const auditConfigIdsClean = (auditConfigIds || []).filter(
          (id) => Number.isFinite(id) && id > 0
        );

        const auditTasks = fichesWithRecordings.flatMap((ficheId) =>
          auditConfigIdsClean.map((configId) => ({
            ficheId,
            configId: Number(configId),
          }))
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
              data: { fiche_id: ficheId, audit_config_id: Number(configId) },
              // Deterministic id: avoid duplicate audit dispatch on retries
              id: `automation-${runIdString}-audit-${ficheId}-${configId}`,
            }))
          );

          // Durable wait (no in-step busy polling): poll audit table with `step.run` + `step.sleep`.
          const auditMaxWaitMs = Math.max(
            60_000,
            Number(process.env.AUTOMATION_AUDIT_MAX_WAIT_MS || 30 * 60 * 1000)
          );
          const auditPollIntervalSeconds = Math.max(
            5,
            Number(process.env.AUTOMATION_AUDIT_POLL_INTERVAL_SECONDS || 60)
          );

          const auditWaitStarted = Date.now();
          let lastDone = 0;
          let stableCount = 0;
          let auditPollAttempt = 0;

          let completedAudits = 0;
          let failedAudits = 0;
          let doneAudits = 0;

          while (Date.now() - auditWaitStarted < auditMaxWaitMs) {
            const counts = await step.run(
              `poll-audits-${runIdString}-${auditPollAttempt}`,
              async () => {
                const { prisma } = await import("../../shared/prisma.js");
                const startedAt = new Date(
                  typeof startTime === "number" && Number.isFinite(startTime)
                    ? startTime
                    : Date.now()
                );
                const configIds = auditConfigIdsClean.map((id) => BigInt(Number(id)));

                const baseWhere = {
                  ficheCache: { ficheId: { in: fichesWithRecordings } },
                  auditConfigId: { in: configIds },
                  createdAt: { gte: startedAt },
                } as const;

                const [completed, failed] = await Promise.all([
                  prisma.audit.count({ where: { ...baseWhere, status: "completed" } }),
                  prisma.audit.count({ where: { ...baseWhere, status: "failed" } }),
                ]);

                return { completed, failed };
              }
            );

            completedAudits =
              isRecord(counts) && typeof counts.completed === "number"
                ? counts.completed
                : 0;
            failedAudits =
              isRecord(counts) && typeof counts.failed === "number"
                ? counts.failed
                : 0;
            doneAudits = completedAudits + failedAudits;

            await log(
              "info",
              `Audit progress: ${doneAudits}/${auditTasks.length} (completed=${completedAudits}, failed=${failedAudits})`
            );

            if (doneAudits >= auditTasks.length) {
              results.audits = doneAudits;
              await log(
                "info",
                `All audits finished in ${Math.round(
                  (Date.now() - auditWaitStarted) / 1000
                )}s!`
              );
              break;
            }

            if (doneAudits === lastDone) {
              stableCount++;
              if (stableCount >= 3) {
                results.audits = doneAudits;
                await log(
                  "info",
                  `Audits stable at ${doneAudits}/${auditTasks.length} - continuing`
                );
                break;
              }
            } else {
              stableCount = 0;
              lastDone = doneAudits;
            }

            auditPollAttempt++;
            await step.sleep(
              `sleep-audits-${runIdString}-${auditPollAttempt}`,
              `${auditPollIntervalSeconds}s`
            );
          }

          if (results.audits === 0 && doneAudits > 0) {
            results.audits = doneAudits;
          }

          if (results.audits < auditTasks.length) {
            await log(
              "warning",
              `Audit timeout/stall - finished ${results.audits}/${auditTasks.length} (completed=${completedAudits}, failed=${failedAudits})`
            );
          }

          // Attribute failures/incomplete work to fiches so run status is accurate.
          const auditFicheOutcomes = await step.run(
            `summarize-audit-outcomes-${runIdString}`,
            async () => {
              const { prisma } = await import("../../shared/prisma.js");
              const startedAt = new Date(
                typeof startTime === "number" && Number.isFinite(startTime)
                  ? startTime
                  : Date.now()
              );
              const configIds = auditConfigIdsClean.map((id) => BigInt(Number(id)));

              const rows = await prisma.audit.findMany({
                where: {
                  ficheCache: { ficheId: { in: fichesWithRecordings } },
                  auditConfigId: { in: configIds },
                  createdAt: { gte: startedAt },
                },
                select: {
                  status: true,
                  errorMessage: true,
                  auditConfigId: true,
                  ficheCache: { select: { ficheId: true } },
                },
              });

              return rows.map((r) => ({
                ficheId: r.ficheCache.ficheId,
                status: r.status,
                audit_config_id: r.auditConfigId.toString(),
                error: r.errorMessage || null,
              }));
            }
          );

          const expectedConfigs = auditConfigIdsClean.map((id) => String(id));
          const expectedCount = expectedConfigs.length;

          const perFiche = new Map<
            string,
            { completed: Set<string>; failed: Set<string>; errors: string[] }
          >();
          for (const row of auditFicheOutcomes) {
            const ficheId = isRecord(row) && typeof row.ficheId === "string" ? row.ficheId : null;
            const status = isRecord(row) && typeof row.status === "string" ? row.status : null;
            const cfg = isRecord(row) && typeof row.audit_config_id === "string" ? row.audit_config_id : null;
            const err = isRecord(row) && typeof row.error === "string" ? row.error : null;
            if (!ficheId || !status || !cfg) continue;

            let agg = perFiche.get(ficheId);
            if (!agg) {
              agg = { completed: new Set(), failed: new Set(), errors: [] };
              perFiche.set(ficheId, agg);
            }

            if (status === "completed") agg.completed.add(cfg);
            if (status === "failed") {
              agg.failed.add(cfg);
              if (err) agg.errors.push(err);
            }
          }

          for (const ficheId of fichesWithRecordings) {
            const agg = perFiche.get(ficheId) || {
              completed: new Set<string>(),
              failed: new Set<string>(),
              errors: [],
            };

            if (agg.failed.size > 0) {
              results.failed.push({
                ficheId,
                error:
                  agg.errors[0] ||
                  `Audit failed (${agg.failed.size}/${expectedCount} config(s))`,
              });
              continue;
            }

            if (expectedCount > 0 && agg.completed.size < expectedCount) {
              results.failed.push({
                ficheId,
                error: "Audit incomplete (timeout/stall)",
              });
            }
          }
        }
      }

      // Step 6: Finalize run
      const durationMs = Date.now() - startTime!;

      // Deduplicate failures (same fiche can fail multiple stages) and compute successful list.
      const failedByFiche = new Map<string, { ficheId: string; error: string }>();
      for (const f of results.failed) {
        if (!f || typeof f.ficheId !== "string" || f.ficheId.length === 0) continue;
        if (!failedByFiche.has(f.ficheId)) {
          failedByFiche.set(f.ficheId, f);
        }
      }
      results.failed = Array.from(failedByFiche.values());
      const failedSet = new Set(results.failed.map((f) => f.ficheId));
      results.successful = ficheIds.filter((id) => !failedSet.has(id));

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
    } catch (error: unknown) {
      // Handle catastrophic failure
      const durationMs = Date.now() - startTime;
      const msg = errorMessage(error);

      await step.run("handle-failure", async () => {
        await automationRepository.updateAutomationRun(runId, {
          status: "failed",
          completedAt: new Date(),
          durationMs,
          errorMessage: msg,
          errorDetails:
            error instanceof Error
              ? { stack: error.stack, name: error.name }
              : { error: msg },
        });

        await automationRepository.updateScheduleStats(
          scheduleId,
          "failed"
        );
        await log("error", `Automation failed: ${msg}`, {
          error: msg,
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
            error: msg,
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
              `Automation failed with error: ${msg}`
            );
          }
        });
      }

      throw error instanceof Error ? error : new Error(msg);
    }
  }
);

/**
 * Scheduled Automation Functions
 * ===============================
 * These cron functions check for schedules that should run
 */

/**
 * Check for scheduled automations (default: every minute; configurable)
 * Finds schedules that should run based on their schedule type and triggers them
 */
export const scheduledAutomationCheck = inngest.createFunction(
  {
    id: "scheduled-automation-check",
    name: "Check Scheduled Automations",
    retries: 1,
    // Prevent overlapping scheduler ticks (cron runs every minute by default)
    concurrency: [{ limit: 1 }],
  },
  // Default: every minute for near-real-time schedules.
  // Override with AUTOMATION_SCHEDULER_CRON (e.g. "*/15 * * * *") if you prefer less frequent checks.
  { cron: process.env.AUTOMATION_SCHEDULER_CRON || "*/1 * * * *" },
  async ({ step, logger }) => {
    logger.info("Checking for scheduled automations to run");

    // Get all active schedules
    const schedules = await step.run(
      "get-active-schedules",
      async (): Promise<ActiveScheduleSerializable[]> => {
      // IMPORTANT: Inngest step results must be JSON-serializable.
      // Prisma returns BigInt IDs; serialize them explicitly or they'll become unusable (e.g. `undefined`).
      const raw = await automationRepository.getAllAutomationSchedules(false); // Only active
      return raw.map((s) => ({
        id: String(s.id),
        name: s.name,
        scheduleType: toScheduleType(s.scheduleType),
        cronExpression: s.cronExpression,
        timezone: s.timezone,
        timeOfDay: s.timeOfDay,
        dayOfWeek: s.dayOfWeek,
        dayOfMonth: s.dayOfMonth,
        lastRunAt: s.lastRunAt ? new Date(s.lastRunAt).toISOString() : null,
      }));
    }
    );

    logger.info(`Found ${schedules.length} active schedules`);

    // Filter schedules that should run now
    const schedulesToRun = await step.run(
      "filter-schedules",
      async (): Promise<DueSchedule[]> => {
      const now = new Date();
      const windowMinutes = Math.max(
        5,
        Number(process.env.AUTOMATION_SCHEDULER_WINDOW_MINUTES || 20)
      );
      const toRun: DueSchedule[] = [];

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

        const cronExpression = automationService.getCronExpressionForSchedule({
          scheduleType: schedule.scheduleType,
          cronExpression: schedule.cronExpression,
          timeOfDay: schedule.timeOfDay,
          dayOfWeek: schedule.dayOfWeek,
          dayOfMonth: schedule.dayOfMonth,
        });

        if (!cronExpression) continue;

        // Find due time within window using cron matching (timezone aware)
        let dueAt: Date | null = null;
        try {
          dueAt = automationService.getMostRecentScheduledTimeWithinWindow({
            cronExpression,
            now,
            windowMinutes,
            timezone: schedule.timezone || "UTC",
          });
        } catch (err: unknown) {
          logger.warn("Invalid cron expression for schedule", {
            schedule_id: String(schedule.id),
            cronExpression,
            error: errorMessage(err),
          });
          continue;
        }

        if (!dueAt) continue;

        const lastRunAt = schedule.lastRunAt ? new Date(schedule.lastRunAt) : null;
        const shouldRun = !lastRunAt || lastRunAt < dueAt;

        if (shouldRun) {
          toRun.push({
            id: String(schedule.id),
            name: schedule.name,
            scheduleType: schedule.scheduleType,
            cronExpression,
            dueAt: dueAt.toISOString(),
            lastRun: schedule.lastRunAt
              ? new Date(schedule.lastRunAt).toISOString()
              : "never",
          });
        }
      }

      return toRun;
    }
    );

    logger.info(`${schedulesToRun.length} schedules should run now`);

    // Trigger due schedules (IMPORTANT: don't nest step.* tooling inside step.run)
    let results: TriggerResult[] = [];
    if (schedulesToRun.length > 0) {
      const events = schedulesToRun.map((schedule, idx) => {
        const dueAtMs = Date.parse(schedule.dueAt);
        const stableDueAtMs = Number.isFinite(dueAtMs) ? dueAtMs : Date.now();
        return {
          name: "automation/run" as const,
          data: {
            schedule_id: schedule.id,
          },
          // Idempotent per schedule + due time (safe chars only)
          id: Number.isFinite(dueAtMs)
            ? `automation-schedule-${schedule.id}-${stableDueAtMs}`
            : `automation-schedule-${schedule.id}-${stableDueAtMs}-${idx}`,
        } as const;
      });

      try {
        const sendResult = await step.sendEvent("trigger-schedules", events);

        // Mark schedules as triggered at their dueAt time (prevents re-dispatch)
        await step.run("mark-schedules-triggered", async () => {
          for (const schedule of schedulesToRun) {
            const dueAtDate = new Date(schedule.dueAt);
            const idStr = String(schedule.id).trim();
            if (!/^\d+$/.test(idStr)) {
              logger.warn("Skipping schedule mark (invalid id)", {
                schedule_id: schedule.id,
                name: schedule.name,
              });
              continue;
            }
            try {
              await automationRepository.markAutomationScheduleTriggered(
                BigInt(idStr),
                isNaN(dueAtDate.getTime()) ? new Date() : dueAtDate
              );
            } catch (err: unknown) {
              logger.warn("Failed to mark schedule as triggered", {
                schedule_id: idStr,
                error: errorMessage(err),
              });
            }
          }
          return { marked: schedulesToRun.length };
        });

        results = schedulesToRun.map((schedule) => ({
          schedule_id: schedule.id,
          name: schedule.name,
          status: "triggered",
          dueAt: schedule.dueAt,
        }));

        const event_ids =
          isRecord(sendResult) && Array.isArray(sendResult.ids)
            ? (sendResult.ids as unknown[])
            : null;

        logger.info("Triggered schedules successfully", {
          count: schedulesToRun.length,
          ...(event_ids ? { event_ids } : {}),
        });
      } catch (error: unknown) {
        logger.error("Failed to trigger schedules", { error: errorMessage(error) });
        const msg = errorMessage(error);
        results = schedulesToRun.map((schedule) => ({
          schedule_id: schedule.id,
          name: schedule.name,
          status: "failed",
          error: msg,
          dueAt: schedule.dueAt,
        }));
      }
    }

    return {
      success: true,
      checked: schedules.length,
      triggered: results.filter((r) => r.status === "triggered").length,
      results: results,
    };
  }
);

export const functions = [runAutomationFunction, scheduledAutomationCheck];
