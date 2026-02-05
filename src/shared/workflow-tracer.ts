/**
 * Workflow Tracer
 * ===============
 * Shared helper for high-signal workflow logging with:
 * - Redaction + bounded metadata (via `sanitizeForLogging`)
 * - Correlation fields (workflow/entity/trace/event/function/step)
 * - Multiple sinks: stdout + per-trace file + DB (`workflow_logs`)
 *
 * Notes (Inngest replay semantics):
 * - If you call tracer logging *outside* of `step.run`, logs may be duplicated on replay.
 * - If you call tracer logging *inside* `step.run`, logs are durable once and won't re-run on replay.
 */
import fs from "node:fs/promises";
import path from "node:path";

import type { SanitizeForLoggingOptions } from "./log-sanitizer.js";
import { sanitizeForLogging } from "./log-sanitizer.js";
import { logger as appLogger } from "./logger.js";
import type {
  CreateWorkflowLogInput,
  WorkflowLogLevel,
  WorkflowLogWorkflow,
} from "./workflow-logs.repository.js";
import { addWorkflowLog } from "./workflow-logs.repository.js";

type StdoutLogger = {
  info(message: string, context?: Record<string, unknown>): void;
  warn(message: string, context?: Record<string, unknown>): void;
  error(message: string, context?: Record<string, unknown>): void;
  debug?: (message: string, context?: Record<string, unknown>) => void;
};

export type WorkflowTraceEntity = {
  type: string;
  id: string;
};

export type WorkflowTraceContext = {
  workflow: WorkflowLogWorkflow;
  levelPrefix?: string;

  entity?: WorkflowTraceEntity | null;
  traceId?: string | null;
  inngestEventId?: string | null;
  functionId?: string | null;
  stepName?: string | null;
};

export type WorkflowTracerOptions = {
  /**
   * Logger used for stdout. Defaults to the app structured logger.
   * In Inngest functions, you can pass the Inngest logger.
   */
  stdout?: StdoutLogger;

  /**
   * Redaction + bounding options for metadata.
   */
  sanitize?: SanitizeForLoggingOptions;

  /**
   * DB persistence toggle (workflow_logs table).
   * Defaults to env flag `WORKFLOW_LOG_DB_ENABLED`.
   */
  db?: { enabled?: boolean };

  /**
   * File persistence toggle (append-only, ordered writes).
   * By default enabled via per-workflow env flags:
   * - `AUDIT_DEBUG_LOG_TO_FILE`
   * - `TRANSCRIPTION_DEBUG_LOG_TO_FILE`
   * - `AUTOMATION_DEBUG_LOG_TO_FILE`
   * - `FICHE_DEBUG_LOG_TO_FILE`
   * or `WORKFLOW_DEBUG_LOG_TO_FILE` as a global fallback.
   */
  file?: {
    enabled?: boolean;
    dir?: string;
    filePath?: string;
    /**
     * Optional header lines to write at file creation.
     * If omitted, a sensible default header is used.
     */
    headerLines?: string[];
  };
};

export type WorkflowTracer = {
  readonly context: Readonly<{
    workflow: WorkflowLogWorkflow;
    entityType?: string;
    entityId?: string;
    traceId?: string;
    inngestEventId?: string;
    functionId?: string;
    stepName?: string;
    levelPrefix?: string;
  }>;

  getFilePath(): string | null;
  flush(): Promise<void>;

  step(stepName: string): WorkflowTracer;
  withFields(fields: Partial<Pick<CreateWorkflowLogInput, "functionId" | "traceId" | "inngestEventId" | "stepName" | "entityType" | "entityId">> & { levelPrefix?: string }): WorkflowTracer;

  log(level: WorkflowLogLevel, message: string, data?: unknown): Promise<void>;
  debug(message: string, data?: unknown): Promise<void>;
  info(message: string, data?: unknown): Promise<void>;
  warn(message: string, data?: unknown): Promise<void>;
  warning(message: string, data?: unknown): Promise<void>;
  error(message: string, data?: unknown): Promise<void>;
};

function envFlag(name: string): boolean {
  const raw = String(process.env[name] ?? "").trim().toLowerCase();
  return raw === "1" || raw === "true" || raw === "yes" || raw === "on";
}

function normalizeOptionalString(value: unknown): string | undefined {
  if (typeof value !== "string") {return undefined;}
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function sanitizeFilenamePart(value: string, maxLen = 80): string {
  const trimmed = value.trim();
  const safe = trimmed.replace(/[^a-zA-Z0-9._-]+/g, "-");
  return safe.length > maxLen ? safe.slice(0, maxLen) : safe;
}

function safeOneLineJson(value: unknown, maxChars = 15_000): string {
  try {
    const json = JSON.stringify(value);
    if (typeof json !== "string") {return "";}
    if (json.length <= maxChars) {return json;}
    return `${json.slice(0, maxChars)}…(truncated ${json.length - maxChars} chars)`;
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return `{"_error":"failed to stringify metadata","message":${JSON.stringify(msg)}}`;
  }
}

function isFileLoggingEnabledByEnv(workflow: string): boolean {
  const w = workflow.trim().toLowerCase();
  if (w === "audit") {return envFlag("AUDIT_DEBUG_LOG_TO_FILE");}
  if (w === "transcription") {return envFlag("TRANSCRIPTION_DEBUG_LOG_TO_FILE");}
  if (w === "automation") {return envFlag("AUTOMATION_DEBUG_LOG_TO_FILE");}
  if (w === "fiche") {return envFlag("FICHE_DEBUG_LOG_TO_FILE");}
  return envFlag("WORKFLOW_DEBUG_LOG_TO_FILE");
}

function resolveDefaultFilePath(ctx: {
  workflow: string;
  traceId?: string;
  entityType?: string;
  entityId?: string;
  inngestEventId?: string;
  functionId?: string;
}, dir: string): string {
  const parts: string[] = [];

  const workflowPart = sanitizeFilenamePart(ctx.workflow || "workflow");
  parts.push(workflowPart);

  if (ctx.traceId) {parts.push(`trace-${sanitizeFilenamePart(ctx.traceId)}`);}
  if (ctx.entityType && ctx.entityId) {
    parts.push(
      `${sanitizeFilenamePart(ctx.entityType)}-${sanitizeFilenamePart(ctx.entityId)}`
    );
  }
  if (ctx.inngestEventId) {parts.push(`event-${sanitizeFilenamePart(ctx.inngestEventId)}`);}
  if (ctx.functionId) {parts.push(`fn-${sanitizeFilenamePart(ctx.functionId)}`);}

  const base = parts.filter(Boolean).join("__") || `workflow__${Date.now()}`;
  // Keep filenames reasonably short (Windows path safety)
  const fileName = base.length > 180 ? `${base.slice(0, 180)}…` : base;
  return path.join(dir, `${fileName}.txt`);
}

export function createWorkflowTracer(
  context: WorkflowTraceContext,
  options: WorkflowTracerOptions = {}
): WorkflowTracer {
  const stdout: StdoutLogger = options.stdout ?? appLogger;
  const sanitizeOpts = options.sanitize;

  const workflow = normalizeOptionalString(context.workflow) ?? "unknown";
  const entityType = normalizeOptionalString(context.entity?.type);
  const entityId = normalizeOptionalString(context.entity?.id);

  const baseContext = {
    workflow: workflow as WorkflowLogWorkflow,
    levelPrefix: normalizeOptionalString(context.levelPrefix),
    ...(entityType ? { entityType } : {}),
    ...(entityId ? { entityId } : {}),
    ...(normalizeOptionalString(context.traceId) ? { traceId: normalizeOptionalString(context.traceId) } : {}),
    ...(normalizeOptionalString(context.inngestEventId) ? { inngestEventId: normalizeOptionalString(context.inngestEventId) } : {}),
    ...(normalizeOptionalString(context.functionId) ? { functionId: normalizeOptionalString(context.functionId) } : {}),
    ...(normalizeOptionalString(context.stepName) ? { stepName: normalizeOptionalString(context.stepName) } : {}),
  } as const;

  const dbEnabled =
    typeof options.db?.enabled === "boolean"
      ? options.db.enabled
      : envFlag("WORKFLOW_LOG_DB_ENABLED");

  const fileEnabled =
    typeof options.file?.enabled === "boolean"
      ? options.file.enabled
      : isFileLoggingEnabledByEnv(workflow);

  const fileLogDir = options.file?.dir
    ? path.resolve(options.file.dir)
    : path.resolve(process.cwd(), "workflow-debug-logs");

  const computedFilePath = fileEnabled
    ? options.file?.filePath
      ? path.resolve(options.file.filePath)
      : resolveDefaultFilePath(
          {
            workflow,
            traceId: baseContext.traceId,
            entityType: baseContext.entityType,
            entityId: baseContext.entityId,
            inngestEventId: baseContext.inngestEventId,
            functionId: baseContext.functionId,
          },
          fileLogDir
        )
    : null;

  let fileWriteQueue: Promise<void> = Promise.resolve();
  let fileInitPromise: Promise<void> | null = null;
  let fileInitFailed = false;

  const ensureFileInitialized = async (headerCtx: typeof baseContext) => {
    if (!computedFilePath || fileInitFailed) {return;}
    if (fileInitPromise) {return fileInitPromise;}

    fileInitPromise = (async () => {
      try {
        await fs.mkdir(path.dirname(computedFilePath), { recursive: true });

        let hasContent = false;
        try {
          const st = await fs.stat(computedFilePath);
          hasContent = st.size > 0;
        } catch {
          // File doesn't exist yet
        }

        if (!hasContent) {
          const headerLines =
            Array.isArray(options.file?.headerLines) &&
            options.file?.headerLines.length > 0
              ? options.file.headerLines
              : [
                  "================================================================================",
                  "AI Audit - Workflow debug log (file logging enabled)",
                  `workflow=${workflow}`,
                  `trace_id=${headerCtx.traceId ?? ""}`,
                  `entity=${headerCtx.entityType ?? ""}:${headerCtx.entityId ?? ""}`,
                  `inngest_event_id=${headerCtx.inngestEventId ?? ""}`,
                  `function_id=${headerCtx.functionId ?? ""}`,
                  `step_name=${headerCtx.stepName ?? ""}`,
                  `started_at=${new Date().toISOString()}`,
                  `cwd=${process.cwd()}`,
                  "================================================================================",
                  "",
                ];
          await fs.appendFile(computedFilePath, `${headerLines.join("\n")}\n`, "utf8");
        }
      } catch (err: unknown) {
        fileInitFailed = true;
        stdout.warn("Failed to initialize workflow debug log file (non-fatal)", {
          workflow,
          filePath: computedFilePath,
          error: sanitizeForLogging(err, sanitizeOpts) as unknown as Record<string, unknown>,
        });
      }
    })();

    return fileInitPromise;
  };

  const appendToFile = (line: string) => {
    if (!computedFilePath || fileInitFailed) {return;}
    fileWriteQueue = fileWriteQueue
      .then(async () => {
        await fs.appendFile(computedFilePath, line, "utf8");
      })
      .catch(() => undefined);
  };

  let dbErrorLogged = false;

  const writeToDb = async (input: CreateWorkflowLogInput) => {
    if (!dbEnabled) {return;}
    try {
      await addWorkflowLog(input);
    } catch (err: unknown) {
      if (!dbErrorLogged) {
        dbErrorLogged = true;
        stdout.warn("Failed to persist workflow log to DB (non-fatal)", {
          workflow: input.workflow,
          traceId: input.traceId ?? undefined,
          error: sanitizeForLogging(err, sanitizeOpts) as unknown as Record<string, unknown>,
        });
      }
    }
  };

  const emitStdout = (
    level: WorkflowLogLevel,
    message: string,
    meta: Record<string, unknown>
  ) => {
    const prefix = normalizeOptionalString(meta.levelPrefix);
    const msg = prefix ? `${prefix} ${message}` : message;

    if (level === "error") {
      stdout.error(msg, meta);
      return;
    }
    if (level === "warning") {
      stdout.warn(msg, meta);
      return;
    }
    if (level === "debug") {
      if (typeof stdout.debug === "function") {
        stdout.debug(msg, meta);
      } else {
        stdout.info(msg, meta);
      }
      return;
    }
    stdout.info(msg, meta);
  };

  const makeTracer = (overrides: Partial<typeof baseContext>): WorkflowTracer => {
    const ctx = {
      ...baseContext,
      ...overrides,
    };

    const getFilePath = () => computedFilePath;
    const flush = async () => {
      await fileWriteQueue;
    };

    const step = (stepName: string) =>
      makeTracer({ stepName: normalizeOptionalString(stepName) });

    const withFields: WorkflowTracer["withFields"] = (fields) =>
      makeTracer({
        ...(normalizeOptionalString(fields.functionId) ? { functionId: normalizeOptionalString(fields.functionId) } : {}),
        ...(normalizeOptionalString(fields.traceId) ? { traceId: normalizeOptionalString(fields.traceId) } : {}),
        ...(normalizeOptionalString(fields.inngestEventId) ? { inngestEventId: normalizeOptionalString(fields.inngestEventId) } : {}),
        ...(normalizeOptionalString(fields.stepName) ? { stepName: normalizeOptionalString(fields.stepName) } : {}),
        ...(normalizeOptionalString(fields.entityType) ? { entityType: normalizeOptionalString(fields.entityType) } : {}),
        ...(normalizeOptionalString(fields.entityId) ? { entityId: normalizeOptionalString(fields.entityId) } : {}),
        ...(normalizeOptionalString(fields.levelPrefix) ? { levelPrefix: normalizeOptionalString(fields.levelPrefix) } : {}),
      });

    const log: WorkflowTracer["log"] = async (level, message, data) => {
      const safeMessageUnknown = sanitizeForLogging(message, sanitizeOpts);
      const safeMessage =
        typeof safeMessageUnknown === "string"
          ? safeMessageUnknown
          : String(safeMessageUnknown);

      const safeData = data === undefined ? undefined : sanitizeForLogging(data, sanitizeOpts);

      const meta: Record<string, unknown> = {
        workflow: ctx.workflow,
        level,
        ...(ctx.entityType ? { entityType: ctx.entityType } : {}),
        ...(ctx.entityId ? { entityId: ctx.entityId } : {}),
        ...(ctx.traceId ? { traceId: ctx.traceId } : {}),
        ...(ctx.inngestEventId ? { inngestEventId: ctx.inngestEventId } : {}),
        ...(ctx.functionId ? { functionId: ctx.functionId } : {}),
        ...(ctx.stepName ? { stepName: ctx.stepName } : {}),
        ...(ctx.levelPrefix ? { levelPrefix: ctx.levelPrefix } : {}),
        ...(safeData !== undefined ? { data: safeData } : {}),
      };

      emitStdout(level, safeMessage, meta);

      if (computedFilePath && !fileInitFailed) {
        await ensureFileInitialized(ctx);
        const ts = new Date().toISOString();
        appendToFile(`${ts} [${String(level).toUpperCase()}] ${safeMessage} ${safeOneLineJson(meta)}\n`);
      }

      await writeToDb({
        workflow: ctx.workflow,
        level,
        message: safeMessage,
        data: safeData ?? {},
        entityType: ctx.entityType ?? null,
        entityId: ctx.entityId ?? null,
        traceId: ctx.traceId ?? null,
        inngestEventId: ctx.inngestEventId ?? null,
        functionId: ctx.functionId ?? null,
        stepName: ctx.stepName ?? null,
      });
    };

    return {
      context: ctx,
      getFilePath,
      flush,
      step,
      withFields,
      log,
      debug: async (message, data) => log("debug", message, data),
      info: async (message, data) => log("info", message, data),
      warn: async (message, data) => log("warning", message, data),
      warning: async (message, data) => log("warning", message, data),
      error: async (message, data) => log("error", message, data),
    };
  };

  return makeTracer({});
}

