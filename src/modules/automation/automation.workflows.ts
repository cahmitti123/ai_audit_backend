/**
 * Automation Workflows
 * ====================
 * Inngest workflow functions for automated audit processing
 */

import fs from "node:fs/promises";
import path from "node:path";

import { NonRetriableError } from "inngest";

import { inngest } from "../../inngest/client.js";
import { sanitizeForLogging } from "../../shared/log-sanitizer.js";
import { publishPusherEvent } from "../../shared/pusher.js";
import { createWorkflowLogger } from "../../shared/workflow-logger.js";
import { createWorkflowTracer } from "../../shared/workflow-tracer.js";
import type { RecordingLike } from "../../utils/recording-parser.js";
import * as automationApi from "./automation.api.js";
import * as automationRepository from "./automation.repository.js";
import type {
  AutomationLogLevel,
  FicheSelection,
  ScheduleType,
  TranscriptionPriority,
} from "./automation.schemas.js";
import { validateFicheSelection } from "./automation.schemas.js";
import * as automationService from "./automation.service.js";

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
  lastRunStatus: string | null;
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

function isFullFicheDetailsRawData(value: unknown): boolean {
  if (!isRecord(value)) {return false;}
  const success = (value as { success?: unknown }).success;
  const information = (value as { information?: unknown }).information;
  if (success !== true) {return false;}
  if (!isRecord(information)) {return false;}
  const ficheId = (information as { fiche_id?: unknown }).fiche_id;
  return typeof ficheId === "string" && ficheId.trim().length > 0;
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
  if (!raw) {throw new NonRetriableError("Missing schedule_id");}
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
  if (!isRecord(value)) {return null;}
  const a = getStringField(value, "ficheId");
  if (a) {return a;}
  const b = getStringField(value, "fiche_id");
  if (b) {return b;}
  const c = getStringField(value, "id");
  if (c) {return c;}
  const n = value.id;
  if (typeof n === "number" && Number.isFinite(n)) {return String(n);}
  return null;
}

function toSalesSummaryCacheInput(value: unknown): {
  id: string;
  cle: string | null;
  nom: string;
  prenom: string;
  email: string;
  telephone: string;
  recordings?: RecordingLike[];
} | null {
  if (!isRecord(value)) {return null;}

  const id = getFicheId(value);
  if (!id) {return null;}
  const cle = getStringField(value, "cle");

  const recordingsRaw = value.recordings;
  const recordings = Array.isArray(recordingsRaw)
    ? recordingsRaw.filter(isRecord).map((r) => r as RecordingLike)
    : undefined;

  return {
    id,
    cle: cle || null,
    nom: getStringField(value, "nom") || "",
    prenom: getStringField(value, "prenom") || "",
    email: getStringField(value, "email") || "",
    telephone: getStringField(value, "telephone") || "",
    ...(recordings ? { recordings } : {}),
  };
}

function toLogContext(metadata: unknown): Record<string, unknown> | undefined {
  if (metadata === undefined) {return undefined;}
  const sanitized = sanitizeForLogging(metadata);
  if (isRecord(sanitized) && !Array.isArray(sanitized)) {return sanitized;}
  return { metadata: sanitized };
}

function envFlag(name: string): boolean {
  const raw = String(process.env[name] ?? "").trim().toLowerCase();
  return raw === "1" || raw === "true" || raw === "yes" || raw === "on";
}

function safeOneLineJson(value: unknown, maxChars = 15_000): string {
  try {
    const sanitized = sanitizeForLogging(value);
    const json = JSON.stringify(sanitized);
    if (typeof json !== "string") {return "";}
    if (json.length <= maxChars) {return json;}
    return `${json.slice(0, maxChars)}…(truncated ${json.length - maxChars} chars)`;
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return `{"_error":"failed to stringify metadata","message":${JSON.stringify(msg)}}`;
  }
}

function toPositiveInt(value: unknown, fallback: number): number {
  const n =
    typeof value === "number"
      ? value
      : Number.parseInt(String(value ?? ""), 10);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

function chunkArray<T>(items: T[], chunkSize: number): T[][] {
  const size = Math.max(1, Math.floor(chunkSize));
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}

function isNotFoundMarker(detailsSuccess: unknown, detailsMessage: unknown): boolean {
  if (detailsSuccess !== false) {return false;}
  if (typeof detailsMessage !== "string") {return false;}
  const msg = detailsMessage.trim();
  if (!msg) {return false;}
  const upper = msg.toUpperCase();
  return (
    upper === "NOT_FOUND" ||
    upper.includes("NOT_FOUND") ||
    msg.toLowerCase().includes("not found")
  );
}

function getAutomationDerivedStaleThresholdMs(): number {
  // Derived from per-stage max waits so scheduler can self-heal faster than the
  // Inngest finish timeout when waits are configured smaller.
  const msEnv = (name: string, fallback: number, min = 60_000) => {
    const raw = process.env[name];
    const n = raw === undefined || raw === "" ? fallback : Number(raw);
    const safe = Number.isFinite(n) ? n : fallback;
    return Math.max(min, safe);
  };

  const ficheDetailsMaxWaitMs = msEnv(
    "AUTOMATION_FICHE_DETAILS_MAX_WAIT_MS",
    10 * 60 * 1000
  );
  const transcriptionMaxWaitMs = msEnv(
    "AUTOMATION_TRANSCRIPTION_MAX_WAIT_MS",
    15 * 60 * 1000
  );
  const auditMaxWaitMs = msEnv("AUTOMATION_AUDIT_MAX_WAIT_MS", 30 * 60 * 1000);
  const graceMs = msEnv("AUTOMATION_SCHEDULER_STALE_GRACE_MS", 15 * 60 * 1000);

  return ficheDetailsMaxWaitMs + transcriptionMaxWaitMs + auditMaxWaitMs + graceMs;
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
    const { schedule_id, override_fiche_selection, due_at } = event.data as unknown as {
      schedule_id: number | string;
      override_fiche_selection?: FicheSelection;
      due_at?: string;
    };
    const scheduleId = toBigIntId(schedule_id);

    const tracer = createWorkflowTracer({
      workflow: "automation",
      entity: { type: "schedule", id: String(schedule_id) },
      inngestEventId: typeof event.id === "string" ? event.id : undefined,
    });
    const wlog = createWorkflowLogger("automation", `schedule-${schedule_id}`, { tracer });
    wlog.start("run-automation", { schedule_id, due_at, has_override: Boolean(override_fiche_selection) });

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

      const ficheSelection = validateFicheSelection({
        mode: scheduleData.ficheSelectionMode,
        ...(scheduleData.ficheSelectionDateRange
          ? { dateRange: scheduleData.ficheSelectionDateRange }
          : {}),
        ...(scheduleData.ficheSelectionCustomStartDate
          ? { customStartDate: scheduleData.ficheSelectionCustomStartDate }
          : {}),
        ...(scheduleData.ficheSelectionCustomEndDate
          ? { customEndDate: scheduleData.ficheSelectionCustomEndDate }
          : {}),
        ...(Array.isArray(scheduleData.ficheSelectionGroupes) &&
        scheduleData.ficheSelectionGroupes.length > 0
          ? { groupes: scheduleData.ficheSelectionGroupes }
          : {}),
        onlyWithRecordings: Boolean(scheduleData.ficheSelectionOnlyWithRecordings),
        onlyUnaudited: Boolean(scheduleData.ficheSelectionOnlyUnaudited),
        useRlm: Boolean(scheduleData.ficheSelectionUseRlm),
        ...(typeof scheduleData.ficheSelectionMaxFiches === "number"
          ? { maxFiches: scheduleData.ficheSelectionMaxFiches }
          : {}),
        ...(typeof scheduleData.ficheSelectionMaxRecordingsPerFiche === "number"
          ? { maxRecordingsPerFiche: scheduleData.ficheSelectionMaxRecordingsPerFiche }
          : {}),
        ...(Array.isArray(scheduleData.ficheSelectionFicheIds) &&
        scheduleData.ficheSelectionFicheIds.length > 0
          ? { ficheIds: scheduleData.ficheSelectionFicheIds }
          : {}),
      });

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
        scheduleId,
        {
          schedule: {
            name: schedule.name,
            scheduleType: schedule.scheduleType,
          },
          overrides: override_fiche_selection || null,
          due_at: typeof due_at === "string" ? due_at : null,
        }
      );
      return String(run.id); // Convert BigInt to string for serialization
    });

    const runId = BigInt(runIdString);
    logger.info("Run record created", { run_id: runIdString });

    const fileLoggingEnabled = envFlag("AUTOMATION_DEBUG_LOG_TO_FILE");
    const fileLogDir = path.resolve(process.cwd(), "automation-debug-logs");
    const fileLogPath = fileLoggingEnabled
      ? path.join(fileLogDir, `automation-run-${runIdString}.txt`)
      : null;

    // Best-effort: initialize file log (never fail the run due to filesystem issues)
    await step.run("init-automation-debug-log-file", async () => {
      if (!fileLogPath) {return { enabled: false };}
      try {
        await fs.mkdir(fileLogDir, { recursive: true });
        const header = [
          "================================================================================",
          "AI Audit - Automation debug log (file logging enabled)",
          `run_id=${runIdString}`,
          `schedule_id=${String(schedule_id)}`,
          `due_at=${typeof due_at === "string" ? due_at : ""}`,
          `started_at=${new Date().toISOString()}`,
          "================================================================================",
          "",
        ].join("\n");
        await fs.appendFile(fileLogPath, header, "utf8");
        return { enabled: true, path: fileLogPath };
      } catch (err: unknown) {
        logger.warn("Failed to initialize automation debug log file (non-fatal)", {
          run_id: runIdString,
          error: errorMessage(err),
        });
        return { enabled: false, error: errorMessage(err) };
      }
    });

    // Serialize file writes so lines remain ordered.
    let fileWriteQueue: Promise<void> = Promise.resolve();
    const appendToFile = (line: string) => {
      if (!fileLogPath) {return;}
      fileWriteQueue = fileWriteQueue
        .then(async () => {
          await fs.appendFile(fileLogPath, line, "utf8");
        })
        .catch(() => undefined);
    };

    // Mark schedule as "running" even for manual triggers (prevents overlapping scheduled runs).
    // If due_at is provided (scheduler dispatch), use it; otherwise use "now".
    await step.run("mark-schedule-running", async () => {
      try {
        const dueAtDate =
          typeof due_at === "string" && Number.isFinite(Date.parse(due_at))
            ? new Date(due_at)
            : new Date();
        await automationRepository.markAutomationScheduleTriggered(scheduleId, dueAtDate);
        return { ok: true };
      } catch (err: unknown) {
        logger.warn("Failed to mark schedule as running", {
          schedule_id: String(schedule_id),
          error: errorMessage(err),
        });
        return { ok: false, error: errorMessage(err) };
      }
    });

    const realtimeJobId = `automation-run-${runIdString}`;
    await step.run("realtime-run-started", async () => {
      await publishPusherEvent({
        event: "automation.run.started",
        payload: {
          job_id: realtimeJobId,
          schedule_id: String(schedule_id),
          run_id: runIdString,
          due_at: typeof due_at === "string" ? due_at : null,
          status: "running",
        },
      });
      return { ok: true };
    });

    // Helper to add logs
    const log = async (
      level: AutomationLogLevel,
      message: string,
      metadata?: unknown
    ) => {
      const safeMetadata = metadata === undefined ? undefined : sanitizeForLogging(metadata);
      await automationRepository.addAutomationLog(
        runId,
        level,
        message,
        safeMetadata
      );

      // Optional: also persist a human-readable line to a local txt file for debugging.
      // This is best-effort and should never break the automation.
      if (fileLogPath) {
        const ts = new Date().toISOString();
        const meta = safeMetadata === undefined ? "" : ` ${safeOneLineJson(safeMetadata)}`;
        appendToFile(`${ts} [${level.toUpperCase()}] ${message}${meta}\n`);
      }

      const ctx = toLogContext(safeMetadata);
      if (level === "debug") {
        if (ctx) {logger.debug(message, ctx);}
        else {logger.debug(message);}
      } else if (level === "warning") {
        if (ctx) {logger.warn(message, ctx);}
        else {logger.warn(message);}
      } else if (level === "error") {
        if (ctx) {logger.error(message, ctx);}
        else {logger.error(message);}
      } else {
        if (ctx) {logger.info(message, ctx);}
        else {logger.info(message);}
      }
    };

    try {
      // Step 3: Calculate dates to query
      const rawSelection = override_fiche_selection ?? schedule.ficheSelection;
      // Be tolerant of older/hand-crafted payloads that may send `maxFiches: null`.
      // Convert it to `undefined` so Zod can apply defaults and validate.
      const selection = validateFicheSelection(
        isRecord(rawSelection) &&
          (rawSelection.maxFiches === null ||
            rawSelection.maxRecordingsPerFiche === null)
          ? {
              ...rawSelection,
              ...(rawSelection.maxFiches === null ? { maxFiches: undefined } : {}),
              ...(rawSelection.maxRecordingsPerFiche === null
                ? { maxRecordingsPerFiche: undefined }
                : {}),
            }
          : rawSelection
      );
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

        await step.run("realtime-selection", async () => {
          const groupes =
            Array.isArray(selection.groupes) && selection.groupes.length <= 10
              ? selection.groupes
              : undefined;
          await publishPusherEvent({
            event: "automation.run.selection",
            payload: {
              job_id: realtimeJobId,
              schedule_id: String(schedule_id),
              run_id: runIdString,
              mode: selection.mode,
              dateRange: selection.dateRange ?? null,
              ...(groupes ? { groupes } : {}),
              groupes_count: Array.isArray(selection.groupes)
                ? selection.groupes.length
                : 0,
              onlyWithRecordings: Boolean(selection.onlyWithRecordings),
              onlyUnaudited: Boolean(selection.onlyUnaudited),
              maxFiches:
                typeof selection.maxFiches === "number" ? selection.maxFiches : null,
              maxRecordingsPerFiche:
                typeof selection.maxRecordingsPerFiche === "number"
                  ? selection.maxRecordingsPerFiche
                  : null,
              useRlm: Boolean((selection as unknown as { useRlm?: unknown }).useRlm),
              total_fiches: ficheIds.length,
            },
          });
          return { ok: true };
        });

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
              scheduleId,
              "success"
            );
          });

          await step.sendEvent("emit-automation-completed-no-fiches", {
            name: "automation/completed",
            data: {
              schedule_id,
              run_id: String(runId),
              status: "completed",
              total_fiches: 0,
              successful_fiches: 0,
              failed_fiches: 0,
              duration_ms: Date.now() - startTime!,
            },
            id: `automation-completed-${runIdString}-no-fiches`,
          });

          await step.run("realtime-run-finished", async () => {
            await publishPusherEvent({
              event: "automation.run.completed",
              payload: {
                job_id: realtimeJobId,
                schedule_id: String(schedule_id),
                run_id: runIdString,
                status: "completed",
                total_fiches: 0,
                successful_fiches: 0,
                failed_fiches: 0,
                reason: "no_fiches_manual",
              },
            });
            return { ok: true };
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
              scheduleId,
              "success"
            );
          });

          await step.sendEvent("emit-automation-completed-no-dates", {
            name: "automation/completed",
            data: {
              schedule_id,
              run_id: String(runId),
              status: "completed",
              total_fiches: 0,
              successful_fiches: 0,
              failed_fiches: 0,
              duration_ms: Date.now() - startTime!,
            },
            id: `automation-completed-${runIdString}-no-dates`,
          });

          await step.run("realtime-run-finished", async () => {
            await publishPusherEvent({
              event: "automation.run.completed",
              payload: {
                job_id: realtimeJobId,
                schedule_id: String(schedule_id),
                run_id: runIdString,
                status: "completed",
                total_fiches: 0,
                successful_fiches: 0,
                failed_fiches: 0,
                reason: "no_dates",
              },
            });
            return { ok: true };
          });

          return {
            success: true,
            schedule_id,
            run_id: String(runId),
            total_fiches: 0,
            message: "No dates to query",
          };
        }

        // Step 3c: Fetch fiches (ALWAYS revalidate cache first, then read from DB)
        const allFiches = await step.run(
          "fetch-all-fiches",
          async (): Promise<unknown[]> => {
            const { getFichesByDateRangeWithStatus } = await import(
              "../fiches/fiches.service.js"
            );
            const { cacheFicheSalesSummary } = await import(
              "../fiches/fiches.cache.js"
            );

            // Convert DD/MM/YYYY to YYYY-MM-DD for DB queries
            const convertDate = (d: string) => {
              const [day, month, year] = d.split("/");
              return `${year}-${month.padStart(2, "0")}-${day.padStart(
                2,
                "0"
              )}`;
            };

            // Compute the encompassing date range (in DB format)
            const sortedDates = [...dates].sort((a, b) => {
              const [dayA, monthA, yearA] = a.split("/");
              const [dayB, monthB, yearB] = b.split("/");
              return (
                new Date(+yearA, +monthA - 1, +dayA).getTime() -
                new Date(+yearB, +monthB - 1, +dayB).getTime()
              );
            });

            const startDate = convertDate(sortedDates[0]);
            const endDate = convertDate(sortedDates[sortedDates.length - 1]);

            // Always revalidate cache for the requested dates before running automation.
            // This prevents automation from relying solely on potentially stale cached sales lists.
            const revalidatedAt = new Date();
            const apiErrors: Array<{ date: string; error: string }> = [];

            await log(
              "info",
              `Revalidating fiche cache for ${sortedDates.length} date(s) before automation`,
              {
                startDate,
                endDate,
                dates: sortedDates.length <= 10 ? sortedDates : undefined,
              }
            );

            // Fetch from external API in small batches (max 3 concurrent) to avoid hammering CRM.
            for (let i = 0; i < sortedDates.length; i += 3) {
              const batch = sortedDates.slice(i, i + 3);
              const batchResults = await Promise.allSettled(
                batch.map(async (date) => {
                  const fiches = await automationApi.fetchFichesForDate(
                    date,
                    // IMPORTANT: never pre-filter by recordings at this stage.
                    // Sales-list endpoints are often incomplete; we enforce `onlyWithRecordings`
                    // only AFTER fetching full fiche details.
                    false,
                    apiKey
                  );

                  // Cache them (sales-list summary)
                  const cacheConcurrency = Math.max(
                    1,
                    Number(process.env.FICHE_SALES_CACHE_CONCURRENCY || 10)
                  );
                  const { mapWithConcurrency } = await import("../../utils/concurrency.js");

                  type CacheOneResult =
                    | { ok: true; ficheId: string; hasCle: boolean }
                    | { ok: false; error: string };

                  const perFicheCache = await mapWithConcurrency<unknown, CacheOneResult>(
                    fiches,
                    cacheConcurrency,
                    async (fiche) => {
                      try {
                        const cacheInput = toSalesSummaryCacheInput(fiche);
                        if (!cacheInput) {return { ok: false, error: "missing fiche id" };}
                        await cacheFicheSalesSummary(cacheInput, {
                          salesDate: convertDate(date),
                          lastRevalidatedAt: revalidatedAt,
                        });
                        return {
                          ok: true,
                          ficheId: cacheInput.id,
                          hasCle: typeof cacheInput.cle === "string" && cacheInput.cle.length > 0,
                        };
                      } catch (err: unknown) {
                        return {
                          ok: false,
                          error: err instanceof Error ? err.message : String(err),
                        };
                      }
                    }
                  );

                  const cached = perFicheCache.filter(
                    (r): r is { ok: true; ficheId: string; hasCle: boolean } => r.ok
                  );
                  const missingCleCount = cached.filter((r) => !r.hasCle).length;

                  await log("info", `Revalidated ${date} (${fiches.length} fiches)`, {
                    cached: cached.length,
                    cacheConcurrency,
                    missingCle: missingCleCount,
                  });
                  return { date, count: fiches.length };
                })
              );

              for (let j = 0; j < batchResults.length; j++) {
                const r = batchResults[j];
                const date = batch[j] || "unknown";
                if (r.status === "rejected") {
                  const msg = errorMessage(r.reason);
                  apiErrors.push({ date, error: msg });
                  await log(
                    "error",
                    `Failed to revalidate ${date}: ${msg} (will fall back to existing cache if present)`
                  );
                }
              }

              // Small delay between API batches
              if (i + 3 < sortedDates.length) {
                await new Promise((resolve) => setTimeout(resolve, 1000));
              }
            }

            // Now read from DB (cache) for the whole range
            const dbResult = await getFichesByDateRangeWithStatus(
              startDate,
              endDate
            );
            await log("info", `Loaded ${dbResult.fiches.length} fiches from DB`, {
              startDate,
              endDate,
              cache_revalidated_at: revalidatedAt.toISOString(),
              api_errors: apiErrors.length,
            });

            return dbResult.fiches;
          }
        );
        
        // Process fiches (extract IDs)
        await log(
          "info",
          `Processing ${allFiches.length} fiches from DB (post-revalidation)`
        );
        
        // NOTE: Do NOT filter by recordings here.
        // Date-range lists are often "sales list only" until we fetch fiche details.
        // We'll fetch fiche details in the next step and then determine which fiches truly have recordings.
        let filteredFiches: unknown[] = allFiches;

        // Optional DB-level filters (applied on the post-revalidation DB snapshot)
        if (Array.isArray(selection.groupes) && selection.groupes.length > 0) {
          const allowed = new Set(
            selection.groupes
              .map((g) => (typeof g === "string" ? g.trim() : ""))
              .filter(Boolean)
          );
          if (allowed.size > 0) {
            const before = filteredFiches.length;
            let unknownGroupKept = 0;
            filteredFiches = filteredFiches.filter((fiche) => {
              if (!isRecord(fiche)) {return false;}
              const g = getStringField(fiche, "groupe");
              // IMPORTANT: sales-list-only cache rows may not have `groupe` yet.
              // If groupe is missing, keep the fiche and apply the real group filter
              // AFTER fetching full fiche details (where groupe is authoritative).
              if (typeof g !== "string" || !g.trim()) {
                unknownGroupKept++;
                return true;
              }
              return allowed.has(g);
            });
            await log("info", `Filtered fiches by groupes (${allowed.size}) (best-effort)`, {
              before,
              after: filteredFiches.length,
              unknown_group_kept: unknownGroupKept,
              groupes: Array.from(allowed),
            });
          }
        }

        if (selection.onlyUnaudited === true) {
          const before = filteredFiches.length;
          filteredFiches = filteredFiches.filter((fiche) => {
            if (!isRecord(fiche)) {return false;}
            const audit = fiche.audit;
            if (!isRecord(audit)) {return true;}
            const total = (audit as { total?: unknown }).total;
            return typeof total === "number" ? total === 0 : true;
          });
          await log("info", "Filtered fiches: onlyUnaudited=true", {
            before,
            after: filteredFiches.length,
          });
        }

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
        
        // Extract final IDs (deduped, stable order)
        const extractedIds = filteredFiches
          .map(getFicheId)
          .filter((id): id is string => typeof id === "string" && id.length > 0);
        ficheIds = Array.from(new Set(extractedIds));
        
        await log("info", `Final: ${ficheIds.length} fiches to process`);

        await step.run("realtime-selection", async () => {
          const groupes =
            Array.isArray(selection.groupes) && selection.groupes.length <= 10
              ? selection.groupes
              : undefined;
          await publishPusherEvent({
            event: "automation.run.selection",
            payload: {
              job_id: realtimeJobId,
              schedule_id: String(schedule_id),
              run_id: runIdString,
              mode: selection.mode,
              dateRange: selection.dateRange ?? null,
              ...(groupes ? { groupes } : {}),
              groupes_count: Array.isArray(selection.groupes)
                ? selection.groupes.length
                : 0,
              onlyWithRecordings: Boolean(selection.onlyWithRecordings),
              onlyUnaudited: Boolean(selection.onlyUnaudited),
              maxFiches:
                typeof selection.maxFiches === "number" ? selection.maxFiches : null,
              maxRecordingsPerFiche:
                typeof selection.maxRecordingsPerFiche === "number"
                  ? selection.maxRecordingsPerFiche
                  : null,
              useRlm: Boolean((selection as unknown as { useRlm?: unknown }).useRlm),
              total_fiches: ficheIds.length,
            },
          });
          return { ok: true };
        });
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
            scheduleId,
            "success"
          );
        });

        await step.sendEvent("emit-automation-completed-no-fiches-found", {
          name: "automation/completed",
          data: {
            schedule_id,
            run_id: String(runId),
            status: "completed",
            total_fiches: 0,
            successful_fiches: 0,
            failed_fiches: 0,
            duration_ms: Date.now() - startTime!,
          },
          id: `automation-completed-${runIdString}-no-fiches-found`,
        });

        await step.run("realtime-run-finished", async () => {
          await publishPusherEvent({
            event: "automation.run.completed",
            payload: {
              job_id: realtimeJobId,
              schedule_id: String(schedule_id),
              run_id: runIdString,
              status: "completed",
              total_fiches: 0,
              successful_fiches: 0,
              failed_fiches: 0,
              reason: "no_fiches_found",
            },
          });
          return { ok: true };
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
        ignored: [] as Array<{
          ficheId: string;
          reason: string;
          recordingsCount?: number;
        }>,
        transcriptions: 0,
        audits: 0,
      };
      // Track fiches that become terminal NOT_FOUND at any stage so later gates
      // (transcription/audit) can exclude them from waiting/fan-out.
      const terminalNotFoundFicheIds = new Set<string>();

      // STEP 1: Ensure all fiches have FULL details cached (distributed across replicas)
      const sendChunkSize = toPositiveInt(process.env.AUTOMATION_SEND_EVENT_CHUNK_SIZE, 200);
      const fetchEvents = ficheIds.map((ficheId) => ({
        name: "fiche/fetch" as const,
        data: {
          fiche_id: ficheId,
          // Always refresh to avoid stale recordings/details during automation fan-out.
          force_refresh: true,
        },
        // Deterministic id: retries won't dispatch duplicate fetches for the same run+fiche
        id: `automation-${runIdString}-fetch-${ficheId}`,
      }));

      const fetchChunks = chunkArray(fetchEvents, sendChunkSize);
      await log(
        "info",
        `Ensuring fiche details via distributed 'fiche/fetch' fan-out (${ficheIds.length} fiches)`,
        {
          inngest_event_id: event.id,
          force_refresh: true,
          total: ficheIds.length,
          send_event_chunk_size: sendChunkSize,
          chunks: fetchChunks.length,
          deterministic_event_id_prefix: `automation-${runIdString}-fetch-`,
        }
      );

      let fetchFanoutEventIdsCount = 0;
      const fetchFanoutEventIdsSample: string[] = [];
      for (let i = 0; i < fetchChunks.length; i++) {
        const stepName = `fan-out-fiche-fetches-${i + 1}-of-${fetchChunks.length}`;
        const sendResult = await step.sendEvent(stepName, fetchChunks[i]!);

        const eventIdsRaw =
          isRecord(sendResult) && Array.isArray(sendResult.ids)
            ? (sendResult.ids as unknown[])
            : null;
        if (eventIdsRaw) {
          for (const v of eventIdsRaw) {
            if (typeof v !== "string" || !v.trim()) {continue;}
            fetchFanoutEventIdsCount++;
            if (fetchFanoutEventIdsSample.length < 10) {
              fetchFanoutEventIdsSample.push(v);
            }
          }
        }
      }

      await log("info", "Dispatched fiche/fetch fan-out events", {
        total_events: fetchEvents.length,
        chunks: fetchChunks.length,
        ...(fetchFanoutEventIdsCount > 0
          ? { inngest_event_ids_count: fetchFanoutEventIdsCount }
          : {}),
        ...(fetchFanoutEventIdsSample.length > 0
          ? { inngest_event_ids_sample: fetchFanoutEventIdsSample }
          : {}),
      });
      wlog.fanOut("fiche/fetch", fetchEvents.length);
      wlog.waiting("fiche-details gate (polling DB for full details)");

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

      // IMPORTANT (Inngest replay semantics):
      // Use a memoized step value for "started at" so the max-wait window is durable across replays.
      const ficheDetailsStartedRaw = await step.run(
        `started-at-fiche-details-${runIdString}`,
        async () => Date.now()
      );
      const ficheDetailsStarted =
        typeof ficheDetailsStartedRaw === "number" && Number.isFinite(ficheDetailsStartedRaw)
          ? ficheDetailsStartedRaw
          : Date.now();
      let lastReady = 0;
      let stableCount = 0;
      let ficheDetailsStallRetries = 0;
      const maxRetriesRaw = schedule.maxRetries;
      const maxFicheDetailsStallRetries =
        schedule.retryFailed &&
        typeof maxRetriesRaw === "number" &&
        Number.isFinite(maxRetriesRaw) &&
        maxRetriesRaw > 0
          ? Math.floor(maxRetriesRaw)
          : 0;
      let lastSnapshot: Array<{
        ficheId: string;
        exists: boolean;
        groupe: string | null;
        recordingsCount: number | null;
        hasRecordings: boolean;
        isSalesListOnly: boolean;
        isFullDetails: boolean;
        detailsSuccess: boolean | null;
        detailsMessage: string | null;
        isNotFound: boolean;
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
                groupe: true,
                recordingsCount: true,
                hasRecordings: true,
                detailsSuccess: true,
                detailsMessage: true,
                rawData: true,
                information: { select: { id: true } },
              },
            });

            const byId = new Map(rows.map((r) => [r.ficheId, r]));

            return ficheIds.map((id) => {
              const r = byId.get(id);
              if (!r) {
                return {
                  ficheId: id,
                  exists: false,
                  groupe: null,
                  recordingsCount: null,
                  hasRecordings: false,
                  isSalesListOnly: true,
                  isFullDetails: false,
                  detailsSuccess: null,
                  detailsMessage: null,
                  isNotFound: false,
                };
              }
              const raw = r.rawData ?? null;
              const isSalesListOnly = isRecord(raw) && raw._salesListOnly === true;
              const detailsSuccess =
                typeof r.detailsSuccess === "boolean" ? r.detailsSuccess : null;
              const detailsMessage =
                typeof r.detailsMessage === "string" && r.detailsMessage.trim().length > 0
                  ? r.detailsMessage.trim()
                  : null;
              const isNotFound = isNotFoundMarker(detailsSuccess, detailsMessage);
              const isFullDetails =
                Boolean(r.information) ||
                (isFullFicheDetailsRawData(raw) && !isSalesListOnly);
              const rawRecordings = isRecord(raw)
                ? (raw as { recordings?: unknown }).recordings
                : undefined;
              const derivedRecordingsCount =
                typeof r.recordingsCount === "number"
                  ? r.recordingsCount
                  : Array.isArray(rawRecordings)
                  ? rawRecordings.length
                  : null;
              return {
                ficheId: id,
                exists: true,
                groupe: typeof r.groupe === "string" && r.groupe.trim() ? r.groupe.trim() : null,
                recordingsCount: derivedRecordingsCount,
                hasRecordings: Boolean(r.hasRecordings),
                isSalesListOnly,
                isFullDetails,
                detailsSuccess,
                detailsMessage,
                isNotFound,
              };
            });
          }
        );

        const notFound = lastSnapshot.filter((r) => r.exists && r.isNotFound === true).length;
        const ready = lastSnapshot.filter(
          (r) => r.exists && (r.isFullDetails === true || r.isNotFound === true)
        ).length;
        const incompleteIds = lastSnapshot
          .filter((r) => (!r.exists || r.isFullDetails !== true) && r.isNotFound !== true)
          .map((r) => r.ficheId);
        const missingCache = lastSnapshot.filter((r) => !r.exists).length;
        const salesListOnly = lastSnapshot.filter((r) => r.exists && r.isSalesListOnly).length;
        const nextStableCount = ready === lastReady ? stableCount + 1 : 0;

        await log("info", `Fiche details progress: ${ready}/${ficheIds.length}`, {
          attempt: ficheDetailsPollAttempt,
          elapsed_ms: Date.now() - ficheDetailsStarted,
          max_wait_ms: ficheDetailsMaxWaitMs,
          poll_interval_seconds: ficheDetailsPollIntervalSeconds,
          ready,
          total: ficheIds.length,
          stable_count: nextStableCount,
          stall_retries: ficheDetailsStallRetries,
          max_stall_retries: maxFicheDetailsStallRetries,
          not_found: notFound,
          incomplete: incompleteIds.length,
          incomplete_sample: incompleteIds.slice(0, 10),
          missing_cache: missingCache,
          sales_list_only: salesListOnly,
        });

        if (ready === ficheIds.length) {break;}

        if (ready === lastReady) {
          stableCount++;
          if (stableCount >= 3) {
            if (
              maxFicheDetailsStallRetries > 0 &&
              ficheDetailsStallRetries < maxFicheDetailsStallRetries
            ) {
              ficheDetailsStallRetries++;
              stableCount = 0;
                  const retryNo = ficheDetailsStallRetries;
                  const incomplete = lastSnapshot
                    .filter((r) => (!r.exists || r.isFullDetails !== true) && r.isNotFound !== true)
                    .map((r) => r.ficheId);

                  await log("warning", "Fiche details stalled; retrying incomplete fetches", {
                    ready,
                    total: ficheIds.length,
                    stall_retry: `${retryNo}/${maxFicheDetailsStallRetries}`,
                    incomplete: incomplete.length,
                    incomplete_sample: incomplete.slice(0, 10),
                  });

                  if (incomplete.length > 0) {
                    const retryEvents = incomplete.map((ficheId) => ({
                      name: "fiche/fetch" as const,
                      data: { fiche_id: ficheId, force_refresh: true },
                      id: `automation-${runIdString}-fetch-${ficheId}-retry-${retryNo}`,
                    }));
                    const retryChunks = chunkArray(retryEvents, sendChunkSize);
                    let retryFetchEventIdsCount = 0;
                    const retryFetchEventIdsSample: string[] = [];
                    for (let i = 0; i < retryChunks.length; i++) {
                      const stepName = `retry-fiche-fetches-${runIdString}-${retryNo}-${i + 1}-of-${retryChunks.length}`;
                      const sendResult = await step.sendEvent(stepName, retryChunks[i]!);

                      const eventIdsRaw =
                        isRecord(sendResult) && Array.isArray(sendResult.ids)
                          ? (sendResult.ids as unknown[])
                          : null;
                      if (eventIdsRaw) {
                        for (const v of eventIdsRaw) {
                          if (typeof v !== "string" || !v.trim()) {continue;}
                          retryFetchEventIdsCount++;
                          if (retryFetchEventIdsSample.length < 10) {
                            retryFetchEventIdsSample.push(v);
                          }
                        }
                      }
                    }

                    await log("info", "Dispatched retry fiche/fetch events", {
                      retry_no: retryNo,
                      total_events: retryEvents.length,
                      chunks: retryChunks.length,
                      ...(retryFetchEventIdsCount > 0
                        ? { inngest_event_ids_count: retryFetchEventIdsCount }
                        : {}),
                      ...(retryFetchEventIdsSample.length > 0
                        ? { inngest_event_ids_sample: retryFetchEventIdsSample }
                        : {}),
                    });
                  }
            } else {
              break; // likely some failed; proceed with what we have
            }
          }
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
      const ignoredNotFound: string[] = [];
      const ignoredTooManyRecordings: Array<{ ficheId: string; recordingsCount: number }> =
        [];
      const ignoredWrongGroup: Array<{ ficheId: string; groupe: string | null }> = [];

      const allowedGroupes = new Set(
        Array.isArray(selection.groupes)
          ? selection.groupes
              .map((g) => (typeof g === "string" ? g.trim() : ""))
              .filter(Boolean)
          : []
      );

      // Ignore fiches with too many recordings (protects transcription/audit fan-out).
      const maxRecordingsPerFicheEnv = Number(
        process.env.AUTOMATION_MAX_RECORDINGS_PER_FICHE || 0
      );
      const maxRecordingsPerFiche =
        typeof selection.maxRecordingsPerFiche === "number"
          ? selection.maxRecordingsPerFiche
          : Number.isFinite(maxRecordingsPerFicheEnv) && maxRecordingsPerFicheEnv > 0
          ? Math.floor(maxRecordingsPerFicheEnv)
          : 0;

      for (const snap of lastSnapshot) {
        if (snap.isNotFound === true) {
          terminalNotFoundFicheIds.add(snap.ficheId);
          ignoredNotFound.push(snap.ficheId);
          results.ignored.push({
            ficheId: snap.ficheId,
            reason: "Fiche not found (404)",
          });
          continue;
        }
        if (!snap.exists || !snap.isFullDetails) {
          ficheFetchFailures.push({
            ficheId: snap.ficheId,
            error: !snap.exists
              ? "Fiche not found in cache"
              : snap.isSalesListOnly
              ? "Fiche details not fetched (still sales-list-only cache)"
              : "Fiche details not fetched (cache incomplete)",
          });
          continue;
        }

        // Enforce group filter AFTER full details are present.
        // Sales-list rows may not contain the group information.
        if (allowedGroupes.size > 0) {
          const g = snap.groupe;
          if (!g || !allowedGroupes.has(g)) {
            ignoredWrongGroup.push({ ficheId: snap.ficheId, groupe: g });
            continue;
          }
        }

        const recordingsCount =
          typeof snap.recordingsCount === "number" && Number.isFinite(snap.recordingsCount)
            ? snap.recordingsCount
            : null;

        const hasAnyRecordings = (recordingsCount ?? 0) > 0 || snap.hasRecordings;

        if (hasAnyRecordings) {
          if (
            maxRecordingsPerFiche > 0 &&
            typeof recordingsCount === "number" &&
            recordingsCount > maxRecordingsPerFiche
          ) {
            ignoredTooManyRecordings.push({
              ficheId: snap.ficheId,
              recordingsCount,
            });
            continue;
          }

          fichesWithRecordings.push(snap.ficheId);
        } else {
          fichesWithoutRecordings.push(snap.ficheId);
        }
      }

      if (ignoredNotFound.length > 0) {
        const ignoredSet = new Set(ignoredNotFound);
        const before = ficheIds.length;
        ficheIds = ficheIds.filter((id) => !ignoredSet.has(id));

        await log("warning", "Ignoring NOT_FOUND fiches (404)", {
          before,
          after: ficheIds.length,
          ignored: ignoredNotFound.length,
          ignored_sample: ignoredNotFound.slice(0, 10),
        });

        // Keep run totals accurate after removing ignored fiches.
        await step.run("update-run-total-after-not-found", async () => {
          await automationRepository.updateAutomationRun(runId, {
            totalFiches: ficheIds.length,
          });
        });
      }

      if (ignoredWrongGroup.length > 0) {
        const ignoredSet = new Set(ignoredWrongGroup.map((f) => f.ficheId));
        const before = ficheIds.length;
        ficheIds = ficheIds.filter((id) => !ignoredSet.has(id));

        for (const f of ignoredWrongGroup) {
          results.ignored.push({
            ficheId: f.ficheId,
            reason: f.groupe ? `Groupe not selected (${f.groupe})` : "Missing groupe",
          });
        }

        await log("info", "Ignoring fiches outside selected groupes", {
          before,
          after: ficheIds.length,
          ignored: ignoredWrongGroup.length,
          groupes: allowedGroupes.size > 0 ? Array.from(allowedGroupes) : undefined,
        });

        await step.run("update-run-total-after-group-filter", async () => {
          await automationRepository.updateAutomationRun(runId, {
            totalFiches: ficheIds.length,
          });
        });
      }

      if (ignoredTooManyRecordings.length > 0) {
        const ignoredSet = new Set(ignoredTooManyRecordings.map((f) => f.ficheId));
        ficheIds = ficheIds.filter((id) => !ignoredSet.has(id));

        for (const f of ignoredTooManyRecordings) {
          results.ignored.push({
            ficheId: f.ficheId,
            reason: `Too many recordings (${f.recordingsCount} > ${maxRecordingsPerFiche})`,
            recordingsCount: f.recordingsCount,
          });
        }

        await log("warning", "Ignoring fiches with too many recordings", {
          maxRecordingsPerFiche,
          ignored: ignoredTooManyRecordings,
        });

        // Keep run totals accurate after removing ignored fiches.
        await step.run("update-run-total-after-ignores", async () => {
          await automationRepository.updateAutomationRun(runId, {
            totalFiches: ficheIds.length,
          });
        });
      }

      // If the schedule requested "onlyWithRecordings", drop fiches that ended up with 0 recordings
      // (after fetching full details) and track them as ignored.
      if (selection.onlyWithRecordings === true && fichesWithoutRecordings.length > 0) {
        const ignoredSet = new Set(fichesWithoutRecordings);
        const before = ficheIds.length;
        ficheIds = ficheIds.filter((id) => !ignoredSet.has(id));

        for (const ficheId of fichesWithoutRecordings) {
          results.ignored.push({
            ficheId,
            reason: "No recordings",
          });
        }

        await log("info", "onlyWithRecordings=true: ignoring fiches without recordings", {
          before,
          after: ficheIds.length,
          ignored: fichesWithoutRecordings.length,
        });

        await step.run("update-run-total-after-only-with-recordings", async () => {
          await automationRepository.updateAutomationRun(runId, {
            totalFiches: ficheIds.length,
          });
        });
      }

      // Merge failures into run results
      results.failed.push(...ficheFetchFailures);

      wlog.stepDone("fiche-details-gate");
      await log("info", "Fiche detail fetch complete (distributed)", {
        total: ficheIds.length,
        withRecordings: fichesWithRecordings.length,
        withoutRecordings: fichesWithoutRecordings.length,
        ignored_too_many_recordings: ignoredTooManyRecordings.length,
        failed: results.failed.length,
        maxRecordingsPerFiche: maxRecordingsPerFiche || undefined,
      });

      const canContinueAfterFicheFetch =
        schedule.continueOnError || results.failed.length === 0;

      if (!canContinueAfterFicheFetch && (schedule.runTranscription || schedule.runAudits)) {
        await log(
          "warning",
          "Aborting remaining stages due to failures (continueOnError=false)",
          { failed: results.failed.length }
        );
      }

      // STEP 2: Fan out transcriptions (optionally skip already-transcribed fiches)
      if (schedule.runTranscription && fichesWithRecordings.length > 0 && canContinueAfterFicheFetch) {
        const transcriptionTargets = fichesWithRecordings.filter(
          (id) => !terminalNotFoundFicheIds.has(id)
        );

        // Load fiche cache IDs once (JSON-safe) so we can poll recordings efficiently without per-fiche DB queries.
        const cacheRows = await step.run(
          `load-fiche-cache-ids-transcriptions-${runIdString}`,
          async () => {
            const { prisma } = await import("../../shared/prisma.js");
            const rows = await prisma.ficheCache.findMany({
              where: { ficheId: { in: transcriptionTargets } },
              select: { ficheId: true, id: true },
            });
            return rows.map((r) => ({ ficheId: r.ficheId, ficheCacheId: r.id.toString() }));
          }
        );

        const cacheIdByFicheId = new Map(
          cacheRows.map((r) => [r.ficheId, r.ficheCacheId] as const)
        );
        const missingCacheIds = transcriptionTargets.filter((id) => !cacheIdByFicheId.has(id));
        if (missingCacheIds.length > 0) {
          await log("error", "Missing fiche cache rows for transcription polling", {
            missing: missingCacheIds.length,
          });
          for (const ficheId of missingCacheIds) {
            results.failed.push({
              ficheId,
              error: "Missing fiche cache row (cannot poll transcription status)",
            });
          }
        }

        let transcriptionTargetsWithCache = transcriptionTargets.filter((id) =>
          cacheIdByFicheId.has(id)
        );
        let targetCount = transcriptionTargetsWithCache.length;

        // Terminal classification: if a fiche is flagged NOT_FOUND, it should not block transcription waiting.
        if (targetCount > 0) {
          const notFoundInitial = await step.run(
            `detect-notfound-transcriptions-${runIdString}`,
            async () => {
              const { prisma } = await import("../../shared/prisma.js");
              const rows = await prisma.ficheCache.findMany({
                where: { ficheId: { in: transcriptionTargetsWithCache } },
                select: { ficheId: true, detailsSuccess: true, detailsMessage: true },
              });

              return rows
                .filter((r) => isNotFoundMarker(r.detailsSuccess, r.detailsMessage))
                .map((r) => r.ficheId);
            }
          );

          const newNotFound = notFoundInitial.filter(
            (id) => !terminalNotFoundFicheIds.has(id)
          );
          if (newNotFound.length > 0) {
            await log(
              "warning",
              "Detected NOT_FOUND fiches before transcription fan-out; skipping",
              {
                not_found: newNotFound.length,
                not_found_sample: newNotFound.slice(0, 10),
              }
            );
            for (const ficheId of newNotFound) {
              terminalNotFoundFicheIds.add(ficheId);
              results.ignored.push({ ficheId, reason: "Fiche not found (404)" });
            }

            const notFoundSet = new Set(newNotFound);
            const beforeTotal = ficheIds.length;
            ficheIds = ficheIds.filter((id) => !notFoundSet.has(id));
            transcriptionTargetsWithCache = transcriptionTargetsWithCache.filter(
              (id) => !notFoundSet.has(id)
            );
            targetCount = transcriptionTargetsWithCache.length;

            if (ficheIds.length !== beforeTotal) {
              await step.run("update-run-total-after-not-found-before-transcriptions", async () => {
                await automationRepository.updateAutomationRun(runId, {
                  totalFiches: ficheIds.length,
                });
              });
            }
          }
        }

        // Pre-check current completion so we can skip already-complete fiches when configured.
        const pre = await step.run(`prefilter-transcriptions-${runIdString}`, async () => {
          const { prisma } = await import("../../shared/prisma.js");
          const cacheIds = transcriptionTargetsWithCache
            .map((ficheId) => cacheIdByFicheId.get(ficheId))
            .filter((v): v is string => typeof v === "string" && v.length > 0)
            .map((idStr) => BigInt(idStr));

          const rows = await prisma.recording.groupBy({
            by: ["ficheCacheId", "hasTranscription"],
            where: { ficheCacheId: { in: cacheIds } },
            _count: { _all: true },
          });

          const agg = new Map<string, { total: number; transcribed: number }>();
          for (const r of rows) {
            const key = r.ficheCacheId.toString();
            const current = agg.get(key) || { total: 0, transcribed: 0 };
            const n = typeof r._count?._all === "number" ? r._count._all : 0;
            current.total += n;
            if (r.hasTranscription) {current.transcribed += n;}
            agg.set(key, current);
          }

          const alreadyComplete: string[] = [];
          const toTranscribe: string[] = [];

          for (const ficheId of transcriptionTargetsWithCache) {
            const cacheId = cacheIdByFicheId.get(ficheId);
            const counts = cacheId ? agg.get(cacheId) : undefined;
            const total = counts?.total ?? 0;
            const transcribed = counts?.transcribed ?? 0;
            const complete = total > 0 && transcribed === total;
            if (complete) {alreadyComplete.push(ficheId);}
            else {toTranscribe.push(ficheId);}
          }

          return {
            target: transcriptionTargetsWithCache.length,
            alreadyCompleteCount: alreadyComplete.length,
            toTranscribe,
          };
        });

        const toTranscribe = schedule.skipIfTranscribed ? pre.toTranscribe : transcriptionTargetsWithCache;

        await log("info", `Sending ${toTranscribe.length} transcription events`, {
          target: transcriptionTargetsWithCache.length,
          skipIfTranscribed: schedule.skipIfTranscribed,
          alreadyComplete: pre.alreadyCompleteCount,
          send_event_chunk_size: sendChunkSize,
        });

        if (toTranscribe.length > 0) {
          const transcriptionEvents = toTranscribe.map((ficheId) => ({
            name: "fiche/transcribe" as const,
            data: {
              fiche_id: ficheId,
              priority:
                (schedule.transcriptionPriority as "normal" | "high" | "low") ||
                "normal",
              // Automation doesn't need each fiche-level transcription orchestrator to block;
              // we wait/poll at the automation level (and audits also ensure transcription when needed).
              wait_for_completion: false,
            },
            id: `automation-${runIdString}-transcribe-${ficheId}`,
          }));

          const txChunks = chunkArray(transcriptionEvents, sendChunkSize);
          let txFanoutEventIdsCount = 0;
          const txFanoutEventIdsSample: string[] = [];
          for (let i = 0; i < txChunks.length; i++) {
            const stepName = `fan-out-transcriptions-${i + 1}-of-${txChunks.length}`;
            const sendResult = await step.sendEvent(stepName, txChunks[i]!);

            const eventIdsRaw =
              isRecord(sendResult) && Array.isArray(sendResult.ids)
                ? (sendResult.ids as unknown[])
                : null;
            if (eventIdsRaw) {
              for (const v of eventIdsRaw) {
                if (typeof v !== "string" || !v.trim()) {continue;}
                txFanoutEventIdsCount++;
                if (txFanoutEventIdsSample.length < 10) {
                  txFanoutEventIdsSample.push(v);
                }
              }
            }
          }

          wlog.fanOut("fiche/transcribe", transcriptionEvents.length);
          wlog.waiting("transcription gate (polling DB for has_transcription)");
          await log("info", "Dispatched fiche/transcribe fan-out events", {
            total_events: transcriptionEvents.length,
            chunks: txChunks.length,
            ...(txFanoutEventIdsCount > 0 ? { inngest_event_ids_count: txFanoutEventIdsCount } : {}),
            ...(txFanoutEventIdsSample.length > 0
              ? { inngest_event_ids_sample: txFanoutEventIdsSample }
              : {}),
          });
        }

        // Durable wait (no in-step busy polling): poll recording table snapshot with `step.run` + `step.sleep`.
        const transcriptionMaxWaitMs = Math.max(
          60_000,
          Number(process.env.AUTOMATION_TRANSCRIPTION_MAX_WAIT_MS || 15 * 60 * 1000)
        );
        const transcriptionPollIntervalSeconds = Math.max(
          5,
          Number(process.env.AUTOMATION_TRANSCRIPTION_POLL_INTERVAL_SECONDS || 30)
        );

        // IMPORTANT (Inngest replay semantics):
        // Use a memoized step value for "started at" so the max-wait window is durable across replays.
      const transcriptionStartedRaw = await step.run(
          `started-at-transcriptions-${runIdString}`,
          async () => Date.now()
        );
      const transcriptionStarted =
        typeof transcriptionStartedRaw === "number" && Number.isFinite(transcriptionStartedRaw)
          ? transcriptionStartedRaw
          : Date.now();
        let lastCompleted = 0;
        let transcriptionStableCount = 0;
        let transcriptionPollAttempt = 0;
        let retryAttempt = 0;

        const maxTranscriptionRetriesRaw = schedule.maxRetries;
        const maxRetries =
          schedule.retryFailed &&
          typeof maxTranscriptionRetriesRaw === "number" &&
          Number.isFinite(maxTranscriptionRetriesRaw) &&
          maxTranscriptionRetriesRaw > 0
            ? Math.floor(maxTranscriptionRetriesRaw)
            : 0;

        while (Date.now() - transcriptionStarted < transcriptionMaxWaitMs) {
          const poll = await step.run(
            `poll-transcriptions-${runIdString}-${transcriptionPollAttempt}`,
            async () => {
              const { prisma } = await import("../../shared/prisma.js");
              const ficheRows = await prisma.ficheCache.findMany({
                where: { ficheId: { in: transcriptionTargetsWithCache } },
                select: { ficheId: true, detailsSuccess: true, detailsMessage: true },
              });
              const notFoundFicheIds = ficheRows
                .filter((r) => isNotFoundMarker(r.detailsSuccess, r.detailsMessage))
                .map((r) => r.ficheId);
              const notFoundSet = new Set(notFoundFicheIds);
              const activeTargets = transcriptionTargetsWithCache.filter(
                (ficheId) => !notFoundSet.has(ficheId)
              );

              const cacheIds = activeTargets
                .map((ficheId) => cacheIdByFicheId.get(ficheId))
                .filter((v): v is string => typeof v === "string" && v.length > 0)
                .map((idStr) => BigInt(idStr));

              const rows = await prisma.recording.groupBy({
                by: ["ficheCacheId", "hasTranscription"],
                where: { ficheCacheId: { in: cacheIds } },
                _count: { _all: true },
              });

              const agg = new Map<string, { total: number; transcribed: number }>();
              for (const r of rows) {
                const key = r.ficheCacheId.toString();
                const current = agg.get(key) || { total: 0, transcribed: 0 };
                const n = typeof r._count?._all === "number" ? r._count._all : 0;
                current.total += n;
                if (r.hasTranscription) {current.transcribed += n;}
                agg.set(key, current);
              }

              let completed = 0;
              let incomplete = 0;
              const incomplete_sample: string[] = [];
              for (const ficheId of activeTargets) {
                const cacheId = cacheIdByFicheId.get(ficheId);
                const counts = cacheId ? agg.get(cacheId) : undefined;
                const total = counts?.total ?? 0;
                const transcribed = counts?.transcribed ?? 0;
                const isComplete = total > 0 && transcribed === total;
                if (isComplete) {completed++;}
                else {
                  incomplete++;
                  if (incomplete_sample.length < 10) {incomplete_sample.push(ficheId);}
                }
              }
              return {
                completed,
                incomplete,
                incomplete_sample,
                not_found_fiche_ids: notFoundFicheIds,
              };
            }
          );

          const completed =
            isRecord(poll) && typeof poll.completed === "number" && Number.isFinite(poll.completed)
              ? poll.completed
              : 0;

          // Terminal classification: if a fiche becomes NOT_FOUND mid-run (e.g., force-refresh 404),
          // exclude it from the waiting target set so the automation run can finish deterministically.
          const notFoundFicheIds =
            isRecord(poll) && Array.isArray(poll.not_found_fiche_ids)
              ? (poll.not_found_fiche_ids as unknown[])
                  .filter((v): v is string => typeof v === "string" && v.trim().length > 0)
                  .map((v) => v.trim())
              : [];
          const newlyNotFound = notFoundFicheIds.filter(
            (id) => !terminalNotFoundFicheIds.has(id)
          );
          if (newlyNotFound.length > 0) {
            await log(
              "warning",
              "Detected NOT_FOUND fiches during transcription wait; skipping",
              {
                not_found: newlyNotFound.length,
                not_found_sample: newlyNotFound.slice(0, 10),
              }
            );
            for (const ficheId of newlyNotFound) {
              terminalNotFoundFicheIds.add(ficheId);
              results.ignored.push({ ficheId, reason: "Fiche not found (404)" });
            }

            const newlyNotFoundSet = new Set(newlyNotFound);
            const notFoundSet = new Set(notFoundFicheIds);
            const beforeTotal = ficheIds.length;
            ficheIds = ficheIds.filter((id) => !newlyNotFoundSet.has(id));
            transcriptionTargetsWithCache = transcriptionTargetsWithCache.filter(
              (id) => !notFoundSet.has(id)
            );
            targetCount = transcriptionTargetsWithCache.length;

            if (ficheIds.length !== beforeTotal) {
              await step.run(
                `update-run-total-after-not-found-during-transcriptions-${runIdString}-${transcriptionPollAttempt}`,
                async () => {
                  await automationRepository.updateAutomationRun(runId, {
                    totalFiches: ficheIds.length,
                  });
                }
              );
            }

            // If all remaining targets became terminal, there's nothing left to wait for.
            if (targetCount === 0) {
              results.transcriptions = 0;
              break;
            }
          }
          const incomplete =
            isRecord(poll) && typeof poll.incomplete === "number" && Number.isFinite(poll.incomplete)
              ? poll.incomplete
              : Math.max(0, targetCount - completed);
          const incompleteSample =
            isRecord(poll) && Array.isArray(poll.incomplete_sample)
              ? (poll.incomplete_sample as unknown[]).filter(
                  (v): v is string => typeof v === "string" && v.trim().length > 0
                ).slice(0, 10)
              : [];
          const nextStableCount = completed === lastCompleted ? transcriptionStableCount + 1 : 0;

          await log("info", `Transcription progress: ${completed}/${targetCount}`, {
            attempt: transcriptionPollAttempt,
            elapsed_ms: Date.now() - transcriptionStarted,
            max_wait_ms: transcriptionMaxWaitMs,
            poll_interval_seconds: transcriptionPollIntervalSeconds,
            completed,
            total: targetCount,
            stable_count: nextStableCount,
            retry_attempt: retryAttempt,
            max_retries: maxRetries,
            incomplete,
            incomplete_sample: incompleteSample,
          });

          if (completed >= targetCount) {
            results.transcriptions = targetCount;
            await log(
              "info",
              `All transcriptions complete in ${Math.round(
                (Date.now() - transcriptionStarted) / 1000
              )}s!`
            );
            break;
          }

          if (completed === lastCompleted) {
            transcriptionStableCount++;
          } else {
            transcriptionStableCount = 0;
            lastCompleted = completed;
          }

          // If progress stalls, optionally retry by re-dispatching `fiche/transcribe` for incomplete fiches.
          if (transcriptionStableCount >= 3 && maxRetries > 0 && retryAttempt < maxRetries) {
            const retryNo = retryAttempt + 1;
            const incompleteFicheIds = await step.run(
              `find-incomplete-transcriptions-${runIdString}-retry-${retryNo}`,
              async () => {
                const { prisma } = await import("../../shared/prisma.js");
                const cacheIds = transcriptionTargetsWithCache
                  .map((ficheId) => cacheIdByFicheId.get(ficheId))
                  .filter((v): v is string => typeof v === "string" && v.length > 0)
                  .map((idStr) => BigInt(idStr));

                const rows = await prisma.recording.groupBy({
                  by: ["ficheCacheId", "hasTranscription"],
                  where: { ficheCacheId: { in: cacheIds } },
                  _count: { _all: true },
                });

                const agg = new Map<string, { total: number; transcribed: number }>();
                for (const r of rows) {
                  const key = r.ficheCacheId.toString();
                  const current = agg.get(key) || { total: 0, transcribed: 0 };
                  const n = typeof r._count?._all === "number" ? r._count._all : 0;
                  current.total += n;
                  if (r.hasTranscription) {current.transcribed += n;}
                  agg.set(key, current);
                }

                return transcriptionTargetsWithCache.filter((ficheId) => {
                  const cacheId = cacheIdByFicheId.get(ficheId);
                  const counts = cacheId ? agg.get(cacheId) : undefined;
                  const total = counts?.total ?? 0;
                  const transcribed = counts?.transcribed ?? 0;
                  return !(total > 0 && transcribed === total);
                });
              }
            );

            if (incompleteFicheIds.length === 0) {
              // Defensive: if the DB snapshot says no incompletes, exit the loop.
              results.transcriptions = completed;
              break;
            }

            retryAttempt = retryNo;
            transcriptionStableCount = 0;

            await log("warning", `Retrying transcriptions (${retryNo}/${maxRetries})`, {
              incomplete: incompleteFicheIds.length,
              incomplete_sample: incompleteFicheIds.slice(0, 10),
            });

            const retryEvents = incompleteFicheIds.map((ficheId) => ({
              name: "fiche/transcribe" as const,
              data: {
                fiche_id: ficheId,
                priority:
                  (schedule.transcriptionPriority as "normal" | "high" | "low") ||
                  "normal",
                wait_for_completion: false,
              },
              id: `automation-${runIdString}-transcribe-${ficheId}-retry-${retryNo}`,
            }));

            const retryChunks = chunkArray(retryEvents, sendChunkSize);
            let retryTxEventIdsCount = 0;
            const retryTxEventIdsSample: string[] = [];
            for (let i = 0; i < retryChunks.length; i++) {
              const stepName = `retry-transcriptions-${retryNo}-${i + 1}-of-${retryChunks.length}`;
              const sendResult = await step.sendEvent(stepName, retryChunks[i]!);

              const eventIdsRaw =
                isRecord(sendResult) && Array.isArray(sendResult.ids)
                  ? (sendResult.ids as unknown[])
                  : null;
              if (eventIdsRaw) {
                for (const v of eventIdsRaw) {
                  if (typeof v !== "string" || !v.trim()) {continue;}
                  retryTxEventIdsCount++;
                  if (retryTxEventIdsSample.length < 10) {
                    retryTxEventIdsSample.push(v);
                  }
                }
              }
            }

            await log("info", "Dispatched retry fiche/transcribe events", {
              retry_no: retryNo,
              total_events: retryEvents.length,
              chunks: retryChunks.length,
              ...(retryTxEventIdsCount > 0
                ? { inngest_event_ids_count: retryTxEventIdsCount }
                : {}),
              ...(retryTxEventIdsSample.length > 0
                ? { inngest_event_ids_sample: retryTxEventIdsSample }
                : {}),
            });
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

        if (results.transcriptions < targetCount) {
          await log(
            "warning",
            `Transcription timeout/stall - completed ${results.transcriptions}/${targetCount}`
          );

          // Mark remaining fiches as failed to avoid reporting a false "completed" run.
          const incomplete = await step.run(
            `find-incomplete-transcriptions-${runIdString}`,
            async () => {
              const { prisma } = await import("../../shared/prisma.js");
              const cacheIds = transcriptionTargetsWithCache
                .map((ficheId) => cacheIdByFicheId.get(ficheId))
                .filter((v): v is string => typeof v === "string" && v.length > 0)
                .map((idStr) => BigInt(idStr));

              const rows = await prisma.recording.groupBy({
                by: ["ficheCacheId", "hasTranscription"],
                where: { ficheCacheId: { in: cacheIds } },
                _count: { _all: true },
              });

              const agg = new Map<string, { total: number; transcribed: number }>();
              for (const r of rows) {
                const key = r.ficheCacheId.toString();
                const current = agg.get(key) || { total: 0, transcribed: 0 };
                const n = typeof r._count?._all === "number" ? r._count._all : 0;
                current.total += n;
                if (r.hasTranscription) {current.transcribed += n;}
                agg.set(key, current);
              }

              return transcriptionTargetsWithCache.filter((ficheId) => {
                const cacheId = cacheIdByFicheId.get(ficheId);
                const counts = cacheId ? agg.get(cacheId) : undefined;
                const total = counts?.total ?? 0;
                const transcribed = counts?.transcribed ?? 0;
                return !(total > 0 && transcribed === total);
              });
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
      const canContinueToAudits =
        schedule.continueOnError || results.failed.length === 0;
      const auditFicheTargets = fichesWithRecordings.filter(
        (id) => !terminalNotFoundFicheIds.has(id)
      );

      if (schedule.runAudits && !canContinueToAudits) {
        await log(
          "warning",
          "Skipping audit stage due to failures (continueOnError=false)",
          { failed: results.failed.length }
        );
      }

      if (schedule.runAudits && auditFicheTargets.length > 0 && canContinueToAudits) {
        const auditConfigIds = await step.run(
          "resolve-all-audit-configs",
          async (): Promise<number[]> => {
            let configIds: number[] = [];

            if (schedule.specificAuditConfigs.length > 0) {
              // Avoid fancy type predicates here — `step.run` serialization and older data
              // can produce unexpected types; do explicit runtime checks.
              for (const maybeId of schedule.specificAuditConfigs as unknown[]) {
                if (typeof maybeId !== "number") {continue;}
                if (!Number.isFinite(maybeId) || maybeId <= 0) {continue;}
                configIds.push(maybeId);
              }
            }

            if (schedule.useAutomaticAudits) {
              const automaticConfigs =
                await automationRepository.getAutomaticAuditConfigs();
              for (const cfg of automaticConfigs as Array<{ id: unknown }>) {
                // Prisma returns BigInt IDs; normalize to number for workflow calculations.
                const n = typeof cfg.id === "bigint" ? Number(cfg.id) : Number(cfg.id);
                if (!Number.isFinite(n) || n <= 0) {continue;}
                configIds.push(n);
              }
            }

            configIds = [...new Set(configIds)];
            await log(
              "info",
              `Running ${configIds.length} configs × ${
                auditFicheTargets.length
              } fiches = ${
                configIds.length * auditFicheTargets.length
              } total audits`
            );
            return configIds;
          }
        );

        // Inngest JSONifies step outputs; be defensive and normalize to numbers
        const auditConfigIdsClean: number[] = [];
        if (Array.isArray(auditConfigIds)) {
          for (const maybeId of auditConfigIds as unknown[]) {
            if (typeof maybeId !== "number") {continue;}
            if (!Number.isFinite(maybeId) || maybeId <= 0) {continue;}
            auditConfigIdsClean.push(maybeId);
          }
        }

        if (auditConfigIdsClean.length === 0) {
          await log("error", "No audit configs resolved; skipping audit stage", {
            useAutomaticAudits: schedule.useAutomaticAudits,
            specificAuditConfigs: schedule.specificAuditConfigs.length,
          });
          for (const ficheId of auditFicheTargets) {
            results.failed.push({
              ficheId,
              error: "No audit configs resolved",
            });
          }
          // Nothing else to do in audit stage; finalization will mark the run as failed/partial.
        }

        const auditTasks = auditFicheTargets.flatMap((ficheId) =>
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

          const auditCacheRows = await step.run(
            `load-fiche-cache-ids-audits-${runIdString}`,
            async () => {
              const { prisma } = await import("../../shared/prisma.js");
              const rows = await prisma.ficheCache.findMany({
                where: { ficheId: { in: auditFicheTargets } },
                select: { ficheId: true, id: true },
              });
              return rows.map((r) => ({ ficheId: r.ficheId, ficheCacheId: r.id.toString() }));
            }
          );
          const auditCacheIdByFicheId = new Map<string, string>();
          if (Array.isArray(auditCacheRows)) {
            for (const row of auditCacheRows as unknown[]) {
              if (!isRecord(row)) {continue;}
              const ficheId =
                typeof row.ficheId === "string" ? row.ficheId.trim() : "";
              const ficheCacheId =
                typeof row.ficheCacheId === "string" ? row.ficheCacheId.trim() : "";
              if (!ficheId || !ficheCacheId) {continue;}
              auditCacheIdByFicheId.set(ficheId, ficheCacheId);
            }
          }
          const missingAuditCacheIds = auditFicheTargets.filter(
            (id) => !auditCacheIdByFicheId.has(id)
          );
          if (missingAuditCacheIds.length > 0) {
            await log("warning", "Missing fiche cache rows for audit polling", {
              missing: missingAuditCacheIds.length,
              missing_sample: missingAuditCacheIds.slice(0, 10),
            });
          }
          const expectedAuditsPerFiche = auditConfigIdsClean.length;

          const auditEvents = auditTasks.map(({ ficheId, configId }) => ({
            name: "audit/run" as const,
            data: {
              fiche_id: ficheId,
              audit_config_id: Number(configId),
              automation_schedule_id: String(schedule_id),
              automation_run_id: String(runIdString),
              trigger_source: "automation",
              use_rlm: Boolean(selection.useRlm),
            },
            // Deterministic id: avoid duplicate audit dispatch on retries
            id: `automation-${runIdString}-audit-${ficheId}-${configId}`,
          }));

          const auditChunks = chunkArray(auditEvents, sendChunkSize);
          let auditFanoutEventIdsCount = 0;
          const auditFanoutEventIdsSample: string[] = [];
          for (let i = 0; i < auditChunks.length; i++) {
            const stepName = `fan-out-all-audits-${i + 1}-of-${auditChunks.length}`;
            const sendResult = await step.sendEvent(stepName, auditChunks[i]!);

            const eventIdsRaw =
              isRecord(sendResult) && Array.isArray(sendResult.ids)
                ? (sendResult.ids as unknown[])
                : null;
            if (eventIdsRaw) {
              for (const v of eventIdsRaw) {
                if (typeof v !== "string" || !v.trim()) {continue;}
                auditFanoutEventIdsCount++;
                if (auditFanoutEventIdsSample.length < 10) {
                  auditFanoutEventIdsSample.push(v);
                }
              }
            }
          }

          wlog.fanOut("audit/run", auditEvents.length);
          wlog.waiting("audit gate (polling DB for audit completion)");
          await log("info", "Dispatched audit/run fan-out events", {
            total_events: auditEvents.length,
            chunks: auditChunks.length,
            ...(auditFanoutEventIdsCount > 0
              ? { inngest_event_ids_count: auditFanoutEventIdsCount }
              : {}),
            ...(auditFanoutEventIdsSample.length > 0
              ? { inngest_event_ids_sample: auditFanoutEventIdsSample }
              : {}),
          });

          // Durable wait (no in-step busy polling): poll audit table with `step.run` + `step.sleep`.
          const auditMaxWaitMs = Math.max(
            60_000,
            Number(process.env.AUTOMATION_AUDIT_MAX_WAIT_MS || 30 * 60 * 1000)
          );
          const auditPollIntervalSeconds = Math.max(
            5,
            Number(process.env.AUTOMATION_AUDIT_POLL_INTERVAL_SECONDS || 60)
          );

          // IMPORTANT (Inngest replay semantics):
          // Use a memoized step value for "started at" so the max-wait window is durable across replays.
          const auditWaitStartedRaw = await step.run(
            `started-at-audits-${runIdString}`,
            async () => Date.now()
          );
          const auditWaitStarted =
            typeof auditWaitStartedRaw === "number" && Number.isFinite(auditWaitStartedRaw)
              ? auditWaitStartedRaw
              : Date.now();
          let lastDone = 0;
          let auditStableCount = 0;
          let auditStallRetries = 0;
          const maxAuditRetriesRaw = schedule.maxRetries;
          const maxAuditStallRetries =
            schedule.retryFailed &&
            typeof maxAuditRetriesRaw === "number" &&
            Number.isFinite(maxAuditRetriesRaw) &&
            maxAuditRetriesRaw > 0
              ? Math.floor(maxAuditRetriesRaw)
              : 0;
          let auditPollAttempt = 0;

          let completedAudits = 0;
          let failedAudits = 0;
          let doneAudits = 0;

          while (Date.now() - auditWaitStarted < auditMaxWaitMs) {
            const counts = await step.run(
              `poll-audits-${runIdString}-${auditPollAttempt}`,
              async () => {
                const { prisma } = await import("../../shared/prisma.js");
                const configIds = auditConfigIdsClean.map((id) => BigInt(Number(id)));
                const cacheIds = Array.from(auditCacheIdByFicheId.values())
                  .filter((v) => typeof v === "string" && /^\d+$/.test(v))
                  .map((idStr) => BigInt(idStr));

                const rows = await prisma.audit.groupBy({
                  by: ["ficheCacheId", "status"],
                  where: {
                    ficheCacheId: { in: cacheIds },
                    auditConfigId: { in: configIds },
                    // Link audits to this automation run explicitly (more reliable than createdAt windows)
                    automationRunId: runId,
                    isLatest: true,
                  },
                  _count: { _all: true },
                });

                let completed = 0;
                let failed = 0;
                const doneByCacheId = new Map<string, number>();
                for (const r of rows) {
                  const n = typeof r._count?._all === "number" ? r._count._all : 0;
                  const cacheKey = r.ficheCacheId.toString();
                  if (r.status === "completed") {completed += n;}
                  if (r.status === "failed") {failed += n;}
                  if (r.status === "completed" || r.status === "failed") {
                    doneByCacheId.set(cacheKey, (doneByCacheId.get(cacheKey) || 0) + n);
                  }
                }

                let incomplete_fiches = 0;
                const incomplete_fiches_sample: string[] = [];
                for (const [ficheId, cacheIdStr] of auditCacheIdByFicheId.entries()) {
                  if (!cacheIdStr || !/^\d+$/.test(cacheIdStr)) {
                    incomplete_fiches++;
                    if (incomplete_fiches_sample.length < 10) {
                      incomplete_fiches_sample.push(ficheId);
                    }
                    continue;
                  }
                  const done = doneByCacheId.get(cacheIdStr) || 0;
                  if (done < expectedAuditsPerFiche) {
                    incomplete_fiches++;
                    if (incomplete_fiches_sample.length < 10) {
                      incomplete_fiches_sample.push(ficheId);
                    }
                  }
                }

                return { completed, failed, incomplete_fiches, incomplete_fiches_sample };
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
            const incompleteFiches =
              isRecord(counts) && typeof counts.incomplete_fiches === "number"
                ? counts.incomplete_fiches
                : null;
            const incompleteFichesSample =
              isRecord(counts) && Array.isArray(counts.incomplete_fiches_sample)
                ? (counts.incomplete_fiches_sample as unknown[])
                    .filter((v): v is string => typeof v === "string" && v.trim().length > 0)
                    .slice(0, 10)
                : [];
            const nextStableCount = doneAudits === lastDone ? auditStableCount + 1 : 0;

            await log(
              "info",
              `Audit progress: ${doneAudits}/${auditTasks.length} (completed=${completedAudits}, failed=${failedAudits})`,
              {
                attempt: auditPollAttempt,
                elapsed_ms: Date.now() - auditWaitStarted,
                max_wait_ms: auditMaxWaitMs,
                poll_interval_seconds: auditPollIntervalSeconds,
                done: doneAudits,
                total: auditTasks.length,
                stable_count: nextStableCount,
                stall_retries: auditStallRetries,
                max_stall_retries: maxAuditStallRetries,
                incomplete_audits: Math.max(0, auditTasks.length - doneAudits),
                ...(typeof incompleteFiches === "number"
                  ? { incomplete_fiches: incompleteFiches }
                  : {}),
                ...(incompleteFichesSample.length > 0
                  ? { incomplete_fiches_sample: incompleteFichesSample }
                  : {}),
              }
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
              auditStableCount++;
              if (auditStableCount >= 3) {
                if (maxAuditStallRetries > 0 && auditStallRetries < maxAuditStallRetries) {
                  auditStallRetries++;
                  auditStableCount = 0;
                  await log("warning", "Audits stalled; extending wait", {
                    done: doneAudits,
                    total: auditTasks.length,
                    stall_retry: `${auditStallRetries}/${maxAuditStallRetries}`,
                  });
                } else {
                  results.audits = doneAudits;
                  await log(
                    "info",
                    `Audits stable at ${doneAudits}/${auditTasks.length} - proceeding`
                  );
                  break;
                }
              }
            } else {
              auditStableCount = 0;
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
              const configIds = auditConfigIdsClean.map((id) => BigInt(Number(id)));

              const rows = await prisma.audit.findMany({
                where: {
                  ficheCache: { ficheId: { in: auditFicheTargets } },
                  auditConfigId: { in: configIds },
                  automationRunId: runId,
                  isLatest: true,
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
            if (!ficheId || !status || !cfg) {continue;}

            let agg = perFiche.get(ficheId);
            if (!agg) {
              agg = { completed: new Set(), failed: new Set(), errors: [] };
              perFiche.set(ficheId, agg);
            }

            if (status === "completed") {agg.completed.add(cfg);}
            if (status === "failed") {
              agg.failed.add(cfg);
              if (err) {agg.errors.push(err);}
            }
          }

          // Terminal classification: a fiche can become NOT_FOUND after initial selection
          // (e.g., CRM deletion between stages). Treat it as "ignored/skip" rather than a run failure.
          const notFoundDuringAudits = await step.run(
            `detect-notfound-audits-${runIdString}`,
            async () => {
              const { prisma } = await import("../../shared/prisma.js");
              const rows = await prisma.ficheCache.findMany({
                where: { ficheId: { in: auditFicheTargets } },
                select: { ficheId: true, detailsSuccess: true, detailsMessage: true },
              });
              return rows
                .filter((r) => isNotFoundMarker(r.detailsSuccess, r.detailsMessage))
                .map((r) => r.ficheId);
            }
          );
          const newlyNotFoundDuringAudits = notFoundDuringAudits.filter(
            (id) => !terminalNotFoundFicheIds.has(id)
          );
          if (newlyNotFoundDuringAudits.length > 0) {
            await log("warning", "Detected NOT_FOUND fiches during audits; skipping", {
              not_found: newlyNotFoundDuringAudits.length,
              not_found_sample: newlyNotFoundDuringAudits.slice(0, 10),
            });

            const notFoundSet = new Set(newlyNotFoundDuringAudits);
            for (const ficheId of newlyNotFoundDuringAudits) {
              terminalNotFoundFicheIds.add(ficheId);
              results.ignored.push({ ficheId, reason: "Fiche not found (404)" });
            }

            const beforeTotal = ficheIds.length;
            ficheIds = ficheIds.filter((id) => !notFoundSet.has(id));
            if (ficheIds.length !== beforeTotal) {
              await step.run(
                `update-run-total-after-not-found-during-audits-${runIdString}`,
                async () => {
                  await automationRepository.updateAutomationRun(runId, {
                    totalFiches: ficheIds.length,
                  });
                }
              );
            }
          }
          const notFoundAuditSet = new Set(notFoundDuringAudits);

          for (const ficheId of auditFicheTargets) {
            if (notFoundAuditSet.has(ficheId)) {
              // Skip terminal NOT_FOUND fiches (do not treat as audit failure/incomplete).
              continue;
            }
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
        if (!f || typeof f.ficheId !== "string" || f.ficheId.length === 0) {continue;}
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
        await automationRepository.finalizeAutomationRunWithFicheResults(
          runId,
          {
            status: finalStatus,
            completedAt: new Date(),
            durationMs,
            totalFiches: ficheIds.length,
            successfulFiches: results.successful.length,
            failedFiches: results.failed.length,
            transcriptionsRun: results.transcriptions,
            auditsRun: results.audits,
          },
          {
            successful: results.successful,
            failed: results.failed,
            ignored: results.ignored,
          }
        );

        await automationRepository.updateScheduleStats(
          scheduleId,
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
            ignored_fiches: results.ignored.length,
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
- Ignored: ${results.ignored.length}
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

      wlog.end(finalStatus, { successful_fiches: results.successful.length, failed_fiches: results.failed.length, ignored_fiches: results.ignored.length });
      await log("info", "Automation run completed", {
        status: finalStatus,
        duration_ms: durationMs,
      });

      await step.sendEvent("emit-automation-completed", {
        name: "automation/completed",
        data: {
          schedule_id,
          run_id: String(runId),
          status: finalStatus,
          total_fiches: ficheIds.length,
          successful_fiches: results.successful.length,
          failed_fiches: results.failed.length,
          duration_ms: durationMs,
        },
        id: `automation-completed-${runIdString}`,
      });

      await step.run("realtime-run-finished", async () => {
        await publishPusherEvent({
          event: "automation.run.completed",
          payload: {
            job_id: realtimeJobId,
            schedule_id: String(schedule_id),
            run_id: runIdString,
            status: finalStatus,
            total_fiches: ficheIds.length,
            successful_fiches: results.successful.length,
            failed_fiches: results.failed.length,
            ignored_fiches: results.ignored.length,
            transcriptions_run: results.transcriptions,
            audits_run: results.audits,
            duration_ms: durationMs,
          },
        });
        return { ok: true };
      });

      return {
        success: true,
        schedule_id,
        run_id: String(runId),
        status: finalStatus,
        total_fiches: ficheIds.length,
        successful_fiches: results.successful.length,
        failed_fiches: results.failed.length,
        ignored_fiches: results.ignored.length,
        transcriptions_run: results.transcriptions,
        audits_run: results.audits,
        duration_ms: durationMs,
      };
    } catch (error: unknown) {
      // Handle catastrophic failure
      const durationMs =
        Date.now() -
        (typeof startTime === "number" && Number.isFinite(startTime)
          ? startTime
          : Date.now());
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

      await step.sendEvent("emit-automation-failed", {
        name: "automation/failed",
        data: {
          schedule_id,
          run_id: String(runId),
          error: msg,
        },
        id: `automation-failed-${runIdString}`,
      });

      await step.run("realtime-run-failed", async () => {
        await publishPusherEvent({
          event: "automation.run.failed",
          payload: {
            job_id: realtimeJobId,
            schedule_id: String(schedule_id),
            run_id: runIdString,
            status: "failed",
            error: msg,
            duration_ms: durationMs,
          },
        });
        return { ok: true };
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
        lastRunStatus: typeof s.lastRunStatus === "string" ? s.lastRunStatus : null,
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
        // Prevent overlapping runs: if the schedule is currently marked "running", skip it,
        // unless it looks stale (e.g., worker crashed). Staleness is derived from the sum of
        // per-stage max waits (fiche details + transcription + audit) plus a grace buffer.
        if (schedule.lastRunStatus === "running") {
          const lastRunAt = schedule.lastRunAt ? new Date(schedule.lastRunAt) : null;
          const ageMs = lastRunAt ? now.getTime() - lastRunAt.getTime() : Number.POSITIVE_INFINITY;
          const staleMs = getAutomationDerivedStaleThresholdMs();

          if (Number.isFinite(ageMs) && ageMs >= staleMs) {
            logger.warn("Schedule appears stuck (running too long); allowing retrigger", {
              schedule_id: schedule.id,
              name: schedule.name,
              lastRunAt: schedule.lastRunAt,
              age_minutes: Math.round(ageMs / 60000),
              stale_minutes: Math.round(staleMs / 60000),
            });

            // Best-effort reconciliation: mark stale runs/schedules as terminal so the UI and
            // scheduler don't remain blocked by a dead run.
            try {
              const idStr = String(schedule.id).trim();
              if (/^\d+$/.test(idStr)) {
                const scheduleId = BigInt(idStr);
                const staleBefore = new Date(now.getTime() - staleMs);
                const reason = `Marked stale by scheduler after ${Math.round(
                  ageMs / 60000
                )}m (threshold ${Math.round(staleMs / 60000)}m)`;

                await automationRepository.markStaleAutomationRunsForSchedule(scheduleId, {
                  staleBefore,
                  markedAt: now,
                  reason,
                });
                await automationRepository.markAutomationScheduleLastRunStatus(scheduleId, "failed");
              }
            } catch (err: unknown) {
              logger.warn("Failed to reconcile stale schedule/run (non-fatal)", {
                schedule_id: schedule.id,
                error: errorMessage(err),
              });
            }
          } else {
            logger.info("Skipping schedule: already running", {
              schedule_id: schedule.id,
              name: schedule.name,
              lastRunAt: schedule.lastRunAt,
            });
            continue;
          }
        }

        // Skip MANUAL schedules for automatic triggering (but still reconcile staleness above).
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

        if (!cronExpression) {continue;}

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

        if (!dueAt) {continue;}

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
            due_at: schedule.dueAt,
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
