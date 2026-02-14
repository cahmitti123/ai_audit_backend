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
import { processDayFunction as registeredProcessDayFunction } from "./automation.day-worker.js";
import { processFicheFunction as registeredProcessFicheFunction } from "./automation.fiche-worker.js";
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

function _isFullFicheDetailsRawData(value: unknown): boolean {
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

function _toSalesSummaryCacheInput(value: unknown): {
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
    return `${json.slice(0, maxChars)}â€¦(truncated ${json.length - maxChars} chars)`;
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

function _isNotFoundMarker(detailsSuccess: unknown, detailsMessage: unknown): boolean {
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
  // New architecture: orchestrator (5h) invokes day workers (4h each) which invoke
  // fiche workers (1h each). The stale threshold should be the orchestrator finish
  // timeout plus a grace period.
  const msEnv = (name: string, fallback: number, min = 60_000) => {
    const raw = process.env[name];
    const n = raw === undefined || raw === "" ? fallback : Number(raw);
    const safe = Number.isFinite(n) ? n : fallback;
    return Math.max(min, safe);
  };

  const orchestratorTimeoutMs = msEnv(
    "AUTOMATION_STALE_THRESHOLD_MS",
    5 * 60 * 60 * 1000 // 5h (matches orchestrator finish timeout)
  );
  const graceMs = msEnv("AUTOMATION_SCHEDULER_STALE_GRACE_MS", 30 * 60 * 1000); // 30 min grace

  return orchestratorTimeoutMs + graceMs;
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
      finish: "5h", // 2 hours max
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
      const _apiKey = schedule.externalApiKey || undefined;

      // Declare variables that will be set in either manual or API mode
      let ficheIds: string[] = [];
      let dates: string[] = [];

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
        dates = await step.run("calculate-dates", async () => {
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

        // CRM fetching is now handled per-day by day workers (no upfront fetch needed).
        // Emit realtime selection event with dates info.
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
              total_dates: dates.length,
            },
          });
          return { ok: true };
        });
      }

      // In API mode ficheIds are empty here (day workers fetch per-day).
      // In manual mode ficheIds are already populated.
      // The "no fiches" early-exit only applies to manual mode.
      if (selection.mode === "manual" && ficheIds.length === 0) {
        await log("warning", "No fiches found matching criteria (manual mode)");
        await step.run("update-run-no-fiches-found", async () => {
          await automationRepository.updateAutomationRun(runId, {
            status: "completed",
            completedAt: new Date(),
            durationMs: Date.now() - startTime!,
            totalFiches: 0, successfulFiches: 0, failedFiches: 0,
            resultSummary: { message: "No fiches found", ficheIds: [] },
          });
          await automationRepository.updateScheduleStats(scheduleId, "success");
        });
        await step.sendEvent("emit-automation-completed-no-fiches-found", {
          name: "automation/completed",
          data: { schedule_id, run_id: String(runId), status: "completed", total_fiches: 0, successful_fiches: 0, failed_fiches: 0, duration_ms: Date.now() - startTime! },
          id: `automation-completed-${runIdString}-no-fiches-found`,
        });
        await step.run("realtime-run-finished", async () => {
          await publishPusherEvent({ event: "automation.run.completed", payload: { job_id: realtimeJobId, schedule_id: String(schedule_id), run_id: runIdString, status: "completed", total_fiches: 0, successful_fiches: 0, failed_fiches: 0, reason: "no_fiches_manual" } });
          return { ok: true };
        });
        return { success: true, schedule_id, run_id: String(runId), total_fiches: 0, message: "No fiches found" };
      }

      // Step 5: Resolve audit config(s) for this run
      const auditConfigIds = await step.run(
        "resolve-audit-configs",
        async (): Promise<number[]> => {
          let configIds: number[] = [];

          if (schedule.specificAuditConfigs.length > 0) {
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
              const n = typeof cfg.id === "bigint" ? Number(cfg.id) : Number(cfg.id);
              if (!Number.isFinite(n) || n <= 0) {continue;}
              configIds.push(n);
            }
          }

          configIds = [...new Set(configIds)];
          await log("info", `Resolved ${configIds.length} audit config(s)`, { configIds });
          return configIds;
        }
      );

      const cleanConfigIds: number[] = Array.isArray(auditConfigIds)
        ? (auditConfigIds as unknown[])
            .filter((id): id is number => typeof id === "number" && Number.isFinite(id) && id > 0)
        : [];

      if (cleanConfigIds.length === 0 && schedule.runAudits) {
        await log("error", "No audit configs resolved; cannot proceed with audits");
      }

      const primaryConfigId = cleanConfigIds.length > 0 ? cleanConfigIds[0]! : 0;

      // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
      // Step 6: Process days using bounded-parallel day workers
      // Each day fetches its own fiche IDs from CRM, then invokes fiche workers.
      // Architecture: orchestrator â†’ day workers â†’ fiche workers
      //
      // Concurrency controls:
      //   AUTOMATION_DAY_CONCURRENCY (default 3) â€” how many days run in parallel
      //   AUTOMATION_FICHE_WORKER_CONCURRENCY (default 5) â€” how many fiches run in parallel
      // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

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

      // For API mode: process each date via day workers
      // For manual mode: ficheIds are already set, process them directly
      const isManualMode = selection.mode === "manual";

      if (!isManualMode && dates.length > 0) {
        // â”€â”€ Day-by-day processing (API mode) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
        const { processDayFunction } = await import("./automation.day-worker.js");
        type ProcessDayResultType = import("./automation.day-worker.js").ProcessDayResult;

        const HARD_MAX_RECORDINGS_PER_FICHE = 50;
        const maxRecordingsPerFicheEnv = Number(process.env.AUTOMATION_MAX_RECORDINGS_PER_FICHE || 0);
        const configuredMax =
          typeof selection.maxRecordingsPerFiche === "number" && selection.maxRecordingsPerFiche > 0
            ? selection.maxRecordingsPerFiche
            : Number.isFinite(maxRecordingsPerFicheEnv) && maxRecordingsPerFicheEnv > 0
            ? Math.floor(maxRecordingsPerFicheEnv)
            : HARD_MAX_RECORDINGS_PER_FICHE;
        const maxRecordingsPerFiche = Math.min(configuredMax, HARD_MAX_RECORDINGS_PER_FICHE);
        const useRlm = Boolean((selection as unknown as { useRlm?: unknown }).useRlm);

        await log("info", `Processing ${dates.length} day(s) via bounded-parallel day workers`, {
          dates: dates.length <= 15 ? dates : `${dates.slice(0, 5).join(", ")}... (${dates.length} total)`,
          audit_config_id: primaryConfigId,
          run_transcription: schedule.runTranscription,
          max_recordings_per_fiche: maxRecordingsPerFiche,
          use_rlm: useRlm,
          day_concurrency: process.env.AUTOMATION_DAY_CONCURRENCY || 3,
          fiche_concurrency: process.env.AUTOMATION_FICHE_WORKER_CONCURRENCY || 5,
        });

        // Process days in batches â€” each batch of days runs in parallel
        const DAY_BATCH_SIZE = toPositiveInt(process.env.AUTOMATION_DAY_BATCH_SIZE, 3);
        const dayChunks = chunkArray(dates, DAY_BATCH_SIZE);

        for (let dayBatchIdx = 0; dayBatchIdx < dayChunks.length; dayBatchIdx++) {
          const dayBatch = dayChunks[dayBatchIdx]!;

          // Invoke all days in this batch in parallel
          const dayPromises = dayBatch.map((date) =>
            step.invoke(`process-day-${date.replace(/\//g, "")}`, {
              function: processDayFunction,
              data: {
                date,
                schedule_id: String(schedule_id),
                run_id: runIdString,
                audit_config_id: primaryConfigId,
                run_transcription: schedule.runTranscription,
                run_audits: schedule.runAudits !== false,
                max_recordings: maxRecordingsPerFiche,
                ...(typeof selection.maxFiches === "number" && selection.maxFiches > 0
                  ? { max_fiches: selection.maxFiches }
                  : {}),
                only_with_recordings: Boolean(selection.onlyWithRecordings),
                use_rlm: useRlm,
                api_key: schedule.externalApiKey || undefined,
                only_unaudited: Boolean(selection.onlyUnaudited),
                ...(Array.isArray(selection.groupes) && selection.groupes.length > 0
                  ? { groupes: selection.groupes }
                  : {}),
              },
            })
          );

          const dayResults = await Promise.all(dayPromises);

          // Aggregate results from all days in this batch
          for (const raw of dayResults) {
            const dayResult = raw as unknown as ProcessDayResultType;
            if (!dayResult) {continue;}

            results.successful.push(...(dayResult.successful || []));
            results.audits += dayResult.audits || 0;

            for (const f of dayResult.failed || []) {
              results.failed.push(f);
            }
            for (const f of dayResult.ignored || []) {
              results.ignored.push({ ficheId: f.ficheId, reason: f.reason });
            }
          }

          // Progress update after each day batch
          const daysProcessed = Math.min((dayBatchIdx + 1) * DAY_BATCH_SIZE, dates.length);
          await step.run(`progress-day-batch-${dayBatchIdx}`, async () => {
            await publishPusherEvent({
              event: "automation.run.progress",
              payload: {
                job_id: realtimeJobId,
                schedule_id: String(schedule_id),
                run_id: runIdString,
                days_processed: daysProcessed,
                days_total: dates.length,
                successful: results.successful.length,
                failed: results.failed.length,
                ignored: results.ignored.length,
                audits: results.audits,
              },
            });
            return { ok: true };
          });

          await log("info", `Day batch ${dayBatchIdx + 1}/${dayChunks.length} complete: ${daysProcessed}/${dates.length} days`, {
            successful: results.successful.length,
            failed: results.failed.length,
            ignored: results.ignored.length,
            audits: results.audits,
          });
        }

        // Update ficheIds for finalization (include all processed fiches: successful + failed + ignored)
        ficheIds = [
          ...results.successful,
          ...results.failed.map((f) => f.ficheId),
          ...results.ignored.map((f) => f.ficheId).filter((id) => id !== "*"),
        ];
      } else {
        // â”€â”€ Manual mode: process fiches directly (no day splitting) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
        const { processFicheFunction } = await import("./automation.fiche-worker.js");
        type ProcessFicheResultType = import("./automation.fiche-worker.js").ProcessFicheResult;

        const HARD_MAX_RECORDINGS_PER_FICHE = 50;
        const maxRecordingsPerFicheEnv = Number(process.env.AUTOMATION_MAX_RECORDINGS_PER_FICHE || 0);
        const configuredMax =
          typeof selection.maxRecordingsPerFiche === "number" && selection.maxRecordingsPerFiche > 0
            ? selection.maxRecordingsPerFiche
            : Number.isFinite(maxRecordingsPerFicheEnv) && maxRecordingsPerFicheEnv > 0
            ? Math.floor(maxRecordingsPerFicheEnv)
            : HARD_MAX_RECORDINGS_PER_FICHE;
        const maxRecordingsPerFiche = Math.min(configuredMax, HARD_MAX_RECORDINGS_PER_FICHE);
        const useRlm = Boolean((selection as unknown as { useRlm?: unknown }).useRlm);

        const FICHE_BATCH_SIZE = toPositiveInt(process.env.AUTOMATION_FICHE_BATCH_SIZE, 5);
        const ficheChunks = chunkArray(ficheIds, FICHE_BATCH_SIZE);

        await log("info", `Processing ${ficheIds.length} manual fiches via child workers`, {
          total_fiches: ficheIds.length,
          audit_config_id: primaryConfigId,
        });

        for (let batchIdx = 0; batchIdx < ficheChunks.length; batchIdx++) {
          const batch = ficheChunks[batchIdx]!;
          const batchPromises = batch.map((ficheId) =>
            step.invoke(`process-fiche-${ficheId}`, {
              function: processFicheFunction,
              data: {
                fiche_id: ficheId,
                audit_config_id: primaryConfigId,
                schedule_id: String(schedule_id),
                run_id: runIdString,
                run_transcription: schedule.runTranscription,
                run_audits: schedule.runAudits !== false,
                max_recordings: maxRecordingsPerFiche,
                only_with_recordings: Boolean(selection.onlyWithRecordings),
                use_rlm: useRlm,
              },
            })
          );

          const batchResults = await Promise.all(batchPromises);
          for (const raw of batchResults) {
            const r = raw as unknown as ProcessFicheResultType;
            if (!r || typeof r.ficheId !== "string") {continue;}
            if (r.status === "success") {
              results.successful.push(r.ficheId);
              results.audits++;
            } else if (r.status === "failed") {
              results.failed.push({ ficheId: r.ficheId, error: r.error || "Unknown error" });
            } else {
              results.ignored.push({ ficheId: r.ficheId, reason: r.error || "Skipped" });
            }
          }
        }
      }

      wlog.stepDone("process-fiches");
      results.transcriptions = results.successful.length;


      // Old fan-out/poll/reconcile code fully removed (2000+ lines).
      // The per-fiche processing is now handled by:
      //   - automation.day-worker.ts (per-day CRM fetch + fiche dispatch)
      //   - automation.fiche-worker.ts (per-fiche: fetch -> transcribe -> analyze -> save)


      // Step 7: Finalize run
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

export const functions = [runAutomationFunction, scheduledAutomationCheck, registeredProcessDayFunction, registeredProcessFicheFunction];
