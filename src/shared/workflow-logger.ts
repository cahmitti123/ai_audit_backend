/**
 * Workflow Logger (Terminal-First Debug Helper)
 * =============================================
 * Makes Inngest workflow execution clearly visible in the terminal.
 *
 * Usage in any workflow:
 *   const wlog = createWorkflowLogger("transcription", "fiche-123");
 *   wlog.start("transcribe-fiche");
 *   wlog.step("force-refresh", { fiche_id: "123" });
 *   wlog.stepDone("force-refresh", { cached: true });
 *   wlog.warn("Missing recording URL", { call_id: "abc" });
 *   wlog.end("completed", { total: 5, transcribed: 5 });
 *
 * Output in terminal:
 *   [14:23:01] ========== TRANSCRIPTION | fiche-123 | START: transcribe-fiche ==========
 *   [14:23:01]   >> STEP: force-refresh { fiche_id: "123" }
 *   [14:23:02]   << DONE: force-refresh (1.2s) { cached: true }
 *   [14:23:03]   !! WARN: Missing recording URL { call_id: "abc" }
 *   [14:23:10] ========== TRANSCRIPTION | fiche-123 | END: completed (9.0s) ==========
 */

type LogData = Record<string, unknown> | undefined;

function ts(): string {
  return new Date().toISOString().slice(11, 19);
}

function shortJson(data: LogData, maxLen = 300): string {
  if (!data) return "";
  try {
    const json = JSON.stringify(data);
    if (json === "{}") return "";
    if (json.length <= maxLen) return ` ${json}`;
    return ` ${json.slice(0, maxLen)}...`;
  } catch {
    return "";
  }
}

function elapsed(startMs: number): string {
  const ms = Date.now() - startMs;
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

export type WorkflowLogger = {
  /** Log workflow start */
  start(functionName: string, data?: LogData): void;
  /** Log a step starting */
  step(stepName: string, data?: LogData): void;
  /** Log a step completing */
  stepDone(stepName: string, data?: LogData): void;
  /** Log a step failing */
  stepFail(stepName: string, error: string, data?: LogData): void;
  /** Log an info message */
  info(message: string, data?: LogData): void;
  /** Log a warning */
  warn(message: string, data?: LogData): void;
  /** Log an error */
  error(message: string, data?: LogData): void;
  /** Log a fan-out dispatch */
  fanOut(eventName: string, count: number, data?: LogData): void;
  /** Log waiting / polling */
  waiting(what: string, data?: LogData): void;
  /** Log workflow end */
  end(status: string, data?: LogData): void;
  /** Create a child logger for a sub-context (e.g., per-recording) */
  child(subContext: string): WorkflowLogger;
};

/**
 * Create a workflow logger that outputs clearly to terminal.
 *
 * @param workflow - e.g., "transcription", "audit", "automation", "fiche"
 * @param entityId - e.g., fiche_id, audit_db_id, run_id
 * @param options  - optional overrides
 */
export function createWorkflowLogger(
  workflow: string,
  entityId: string,
  options?: { parentContext?: string }
): WorkflowLogger {
  const tag = workflow.toUpperCase();
  const ctx = options?.parentContext
    ? `${options.parentContext} > ${entityId}`
    : entityId;

  const startMs = Date.now();
  const stepTimers = new Map<string, number>();

  const prefix = `[${tag}|${ctx}]`;

  const logger: WorkflowLogger = {
    start(functionName, data) {
      const line = `\n[${ts()}] ${"=".repeat(10)} ${tag} | ${ctx} | START: ${functionName} ${"=".repeat(10)}`;
      console.log(line + shortJson(data));
    },

    step(stepName, data) {
      stepTimers.set(stepName, Date.now());
      console.log(`[${ts()}] ${prefix}   >> STEP: ${stepName}${shortJson(data)}`);
    },

    stepDone(stepName, data) {
      const t = stepTimers.get(stepName);
      const dur = t ? ` (${elapsed(t)})` : "";
      stepTimers.delete(stepName);
      console.log(`[${ts()}] ${prefix}   << DONE: ${stepName}${dur}${shortJson(data)}`);
    },

    stepFail(stepName, error, data) {
      const t = stepTimers.get(stepName);
      const dur = t ? ` (${elapsed(t)})` : "";
      stepTimers.delete(stepName);
      console.error(
        `[${ts()}] ${prefix}   !! FAIL: ${stepName}${dur} | ${error}${shortJson(data)}`
      );
    },

    info(message, data) {
      console.log(`[${ts()}] ${prefix}   -- ${message}${shortJson(data)}`);
    },

    warn(message, data) {
      console.warn(`[${ts()}] ${prefix}   !! WARN: ${message}${shortJson(data)}`);
    },

    error(message, data) {
      console.error(`[${ts()}] ${prefix}   !! ERROR: ${message}${shortJson(data)}`);
    },

    fanOut(eventName, count, data) {
      console.log(
        `[${ts()}] ${prefix}   => FAN-OUT: ${eventName} x${count}${shortJson(data)}`
      );
    },

    waiting(what, data) {
      console.log(`[${ts()}] ${prefix}   .. WAITING: ${what}${shortJson(data)}`);
    },

    end(status, data) {
      const dur = elapsed(startMs);
      const line = `[${ts()}] ${"=".repeat(10)} ${tag} | ${ctx} | END: ${status} (${dur}) ${"=".repeat(10)}\n`;
      console.log(line + shortJson(data));
    },

    child(subContext) {
      return createWorkflowLogger(workflow, subContext, {
        parentContext: ctx,
      });
    },
  };

  return logger;
}
