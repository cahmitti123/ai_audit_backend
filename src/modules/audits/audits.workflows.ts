/**
 * Audits Workflows
 * ================
 * Inngest workflow functions for audit operations
 */

import type { Prisma } from "@prisma/client";
import { NonRetriableError } from "inngest";

import { inngest } from "../../inngest/client.js";
import type {
  ControlPoint,
  TimelineRecording,
  TranscriptionWord,
} from "../../schemas.js";
import {
  CONCURRENCY,
  DEFAULT_AUDIT_CONFIG_ID,
  TIMEOUTS,
} from "../../shared/constants.js";
import {
  getInngestGlobalConcurrency,
  getInngestParallelismPerServer,
} from "../../shared/inngest-concurrency.js";
import { logger as appLogger } from "../../shared/logger.js";
import { getRedisClient } from "../../shared/redis.js";
import { auditWebhooks, batchWebhooks } from "../../shared/webhook.js";
import { createWorkflowLogger } from "../../shared/workflow-logger.js";
import { createWorkflowTracer } from "../../shared/workflow-tracer.js";
import {
  formatBytes,
  getPayloadSize,
} from "../../utils/payload-size.js";
import { buildConversationChunksFromWords } from "../../utils/transcription-chunks.js";
import { getCachedFiche } from "../fiches/fiches.repository.js";
import { fetchFicheFunction } from "../fiches/fiches.workflows.js";
import { getFicheTranscriptionStatus } from "../transcriptions/transcriptions.service.js";
import { transcribeFicheFunction } from "../transcriptions/transcriptions.workflows.js";
import type { analyzeStep as analyzeStepFn } from "./audits.analyzer.js";
import type { AnalyzedAuditStepResult } from "./audits.evidence.js";
import type {
  AuditFunctionResult,
  BatchAuditResult,
} from "./audits.schemas.js";
import type {
  AuditConfigForAnalysis,
  AuditSeverityLevel,
  AuditStepDefinition,
  ProductLinkResult,
} from "./audits.types.js";

type AnalyzeStepResult = Awaited<ReturnType<typeof analyzeStepFn>>;

const DEFAULT_GLOBAL_CONCURRENCY = getInngestGlobalConcurrency();
const DEFAULT_PER_ENTITY_CONCURRENCY = getInngestParallelismPerServer();

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isNotFoundLikeError(error: unknown): boolean {
  const msg = errorMessage(error).toLowerCase();
  // Common forms:
  // - "Fiche <id> not found" (NonRetriableError from fetchFicheFunction)
  // - "NOT_FOUND" codes wrapped upstream
  return msg.includes("not found") || msg.includes("not_found");
}

function getAuditRunFailureMeta(event: unknown): {
  fiche_id: string;
  audit_config_id: number;
} {
  const data =
    isRecord(event) && isRecord(event.data) ? (event.data as Record<string, unknown>) : null;

  const ficheRaw = data?.fiche_id;
  const auditConfigRaw = data?.audit_config_id;

  const fiche_id = typeof ficheRaw === "string" && ficheRaw ? ficheRaw : "unknown";
  const audit_config_id =
    typeof auditConfigRaw === "number"
      ? auditConfigRaw
      : Number.parseInt(String(auditConfigRaw ?? 0), 10) || 0;

  return { fiche_id, audit_config_id };
}

function getAuditDbIdFromEvent(event: unknown): bigint | null {
  const data =
    isRecord(event) && isRecord(event.data) ? (event.data as Record<string, unknown>) : null;
  const raw = data?.audit_db_id;

  if (typeof raw === "bigint") {return raw;}
  if (typeof raw === "number" && Number.isFinite(raw)) {
    try {
      return BigInt(raw);
    } catch {
      return null;
    }
  }
  if (typeof raw === "string" && raw) {
    try {
      return BigInt(raw);
    } catch {
      return null;
    }
  }

  return null;
}

function safeJsonParse(value: string): unknown {
  // JSON.parse returns `any` in lib.dom typings; immediately narrow to `unknown`.
  return JSON.parse(value) as unknown;
}

function toNumberOr(value: unknown, fallback: number): number {
  if (typeof value === "number" && Number.isFinite(value)) {return value;}
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function toIntOr(value: unknown, fallback: number): number {
  const n = toNumberOr(value, fallback);
  return Number.isFinite(n) ? Math.trunc(n) : fallback;
}

function normalizeTimelineRecordings(value: unknown): TimelineRecording[] {
  if (!Array.isArray(value)) {return [];}

  return value.map((rec, recIdx): TimelineRecording => {
    const r = isRecord(rec) ? rec : {};
    const chunksRaw = Array.isArray(r.chunks) ? r.chunks : [];

    const chunks = chunksRaw.map((chunk, chunkIdx) => {
      const c = isRecord(chunk) ? chunk : {};
      const speakersRaw = c.speakers;
      const speakers = Array.isArray(speakersRaw)
        ? speakersRaw.filter((s): s is string => typeof s === "string")
        : [];

      return {
        chunk_index: toIntOr(c.chunk_index, chunkIdx),
        start_timestamp: toNumberOr(c.start_timestamp, 0),
        end_timestamp: toNumberOr(c.end_timestamp, 0),
        message_count: toIntOr(c.message_count, speakers.length),
        speakers,
        full_text: typeof c.full_text === "string" ? c.full_text : "",
      };
    });

    const recording_url =
      typeof r.recording_url === "string" ? r.recording_url : "";

    return {
      recording_index: toIntOr(r.recording_index, recIdx),
      call_id: typeof r.call_id === "string" ? r.call_id : undefined,
      start_time: typeof r.start_time === "string" ? r.start_time : undefined,
      duration_seconds:
        typeof r.duration_seconds === "number" ? r.duration_seconds : undefined,
      recording_url,
      recording_date:
        typeof r.recording_date === "string" ? r.recording_date : undefined,
      recording_time:
        typeof r.recording_time === "string" ? r.recording_time : undefined,
      from_number:
        typeof r.from_number === "string" ? r.from_number : undefined,
      to_number: typeof r.to_number === "string" ? r.to_number : undefined,
      total_chunks: toIntOr(r.total_chunks, chunks.length),
      chunks,
    };
  });
}

function isAuditStepDefinition(value: unknown): value is AuditStepDefinition {
  if (!isRecord(value)) {return false;}
  return (
    typeof value.position === "number" &&
    typeof value.name === "string" &&
    typeof value.prompt === "string" &&
    Array.isArray(value.controlPoints) &&
    Array.isArray(value.keywords) &&
    typeof value.severityLevel === "string" &&
    typeof value.isCritical === "boolean" &&
    typeof value.weight === "number"
  );
}

function isAuditConfigForAnalysis(value: unknown): value is AuditConfigForAnalysis {
  if (!isRecord(value)) {return false;}
  if (typeof value.id !== "string") {return false;}
  if (typeof value.name !== "string") {return false;}
  if (
    value.description !== null &&
    value.description !== undefined &&
    typeof value.description !== "string"
  ) {
    return false;
  }
  if (
    value.systemPrompt !== null &&
    value.systemPrompt !== undefined &&
    typeof value.systemPrompt !== "string"
  ) {
    return false;
  }
  if (!Array.isArray(value.auditSteps)) {return false;}
  return value.auditSteps.every(isAuditStepDefinition);
}

function isProductLinkResult(value: unknown): value is ProductLinkResult {
  if (!isRecord(value)) {return false;}
  return typeof value.matched === "boolean";
}

type DbRecordingForTimeline = {
  callId: string;
  hasTranscription: boolean;
  transcriptionId: string | null;
  transcriptionText: string | null;
  transcriptionData: unknown;
  durationSeconds: number | null;
};

function toTranscriptionWords(value: unknown): TranscriptionWord[] | null {
  if (!isRecord(value)) {return null;}
  const wordsRaw = value.words;
  if (!Array.isArray(wordsRaw) || wordsRaw.length === 0) {return null;}

  const words: TranscriptionWord[] = [];
  for (const w of wordsRaw) {
    if (!isRecord(w)) {continue;}
    const text = typeof w.text === "string" ? w.text : null;
    const start = typeof w.start === "number" ? w.start : null;
    const end = typeof w.end === "number" ? w.end : null;
    const type = typeof w.type === "string" ? w.type : "word";
    const speaker_id =
      typeof w.speaker_id === "string" ? (w.speaker_id as string) : undefined;
    const logprob = typeof w.logprob === "number" ? w.logprob : undefined;

    if (text === null || start === null || end === null) {continue;}

    words.push({
      text,
      start,
      end,
      type,
      ...(speaker_id ? { speaker_id } : {}),
      ...(logprob !== undefined ? { logprob } : {}),
    });
  }

  return words.length > 0 ? words : null;
}

function buildSyntheticWordsFromText(
  text: string,
  durationSeconds: number | null
): TranscriptionWord[] {
  const textWords = text.split(/\s+/).filter(Boolean);
  if (textWords.length === 0) {return [];}

  const duration =
    typeof durationSeconds === "number" && durationSeconds > 0
      ? durationSeconds
      : Math.max(1, Math.round(textWords.length * 0.5));

  const wordDur = Math.max(0.05, duration / Math.max(1, textWords.length));
  return textWords.map((word, idx) => ({
    text: word,
    start: idx * wordDur,
    end: (idx + 1) * wordDur,
    type: "word",
    // Speaker unknown without diarization; keep expected shape.
    speaker_id: idx % 20 < 10 ? "speaker_0" : "speaker_1",
  }));
}

function buildTranscriptionPayload(
  dbRec: DbRecordingForTimeline
): { text: string; language_code?: string; words: TranscriptionWord[] } | null {
  const payload = dbRec.transcriptionData;
  const words = toTranscriptionWords(payload);

  if (words) {
    const payloadObj = isRecord(payload) ? payload : null;
    const text =
      payloadObj && typeof payloadObj.text === "string"
        ? payloadObj.text
        : words.map((w) => w.text).join(" ");
    const language_code =
      payloadObj && typeof payloadObj.language_code === "string"
        ? payloadObj.language_code
        : undefined;
    return { text, language_code, words };
  }

  if (typeof dbRec.transcriptionText === "string" && dbRec.transcriptionText.trim()) {
    const text = dbRec.transcriptionText;
    return {
      text,
      language_code: "fr",
      words: buildSyntheticWordsFromText(text, dbRec.durationSeconds),
    };
  }

  return null;
}

async function rebuildTimelineFromDatabase(ficheId: string): Promise<TimelineRecording[]> {
  const { getRecordingsWithTranscriptionChunksByFiche } = await import(
    "../recordings/recordings.repository.js"
  );

  const dbRecordings = await getRecordingsWithTranscriptionChunksByFiche(ficheId);

  const timeline: TimelineRecording[] = [];

  for (const dbRec of dbRecordings) {
    if (!dbRec.hasTranscription) {continue;}
    if (!dbRec.recordingUrl) {continue;}

    // Prefer normalized chunks (stable indices; avoids huge word-level JSON).
    let chunks = dbRec.transcriptionChunks.map((c) => ({
      chunk_index: c.chunkIndex,
      start_timestamp: c.startTimestamp,
      end_timestamp: c.endTimestamp,
      message_count: c.messageCount,
      speakers: c.speakers,
      full_text: c.fullText,
    }));

    // Fallback for legacy rows that still have word-level JSON but no persisted chunks.
    if (chunks.length === 0) {
      const rec: DbRecordingForTimeline = {
        callId: dbRec.callId,
        hasTranscription: dbRec.hasTranscription,
        transcriptionId: dbRec.transcriptionId,
        transcriptionText: dbRec.transcriptionText,
        transcriptionData: dbRec.transcriptionData,
        durationSeconds: dbRec.durationSeconds,
      };

      const transcription = buildTranscriptionPayload(rec);
      if (!transcription) {continue;}

      chunks = buildConversationChunksFromWords(transcription.words);
    }

    timeline.push({
      recording_index: timeline.length,
      call_id: dbRec.callId,
      start_time: dbRec.startTime?.toISOString() || "",
      duration_seconds: dbRec.durationSeconds ?? 0,
      recording_url: dbRec.recordingUrl,
      recording_date: dbRec.recordingDate ?? "",
      recording_time: dbRec.recordingTime ?? "",
      from_number: dbRec.fromNumber ?? "",
      to_number: dbRec.toNumber ?? "",
      total_chunks: chunks.length,
      chunks,
    });
  }

  return timeline;
}

function toPrismaJsonValue(value: unknown): Prisma.InputJsonValue {
  const json: unknown = JSON.parse(JSON.stringify(value));
  return json as Prisma.InputJsonValue;
}

/**
 * Remove null bytes (\u0000) from strings.
 *
 * Postgres cannot store null bytes in TEXT/VARCHAR columns, and LLM output can
 * occasionally contain them (especially in long JSON payloads).
 */
function sanitizeNullBytes(value: unknown): unknown {
  if (value === null || value === undefined) {return value;}
  // eslint-disable-next-line no-control-regex -- Intentionally remove null bytes for safe Postgres storage
  if (typeof value === "string") {return value.replace(/\u0000/g, "");}
  if (Array.isArray(value)) {return value.map((v) => sanitizeNullBytes(v));}
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = sanitizeNullBytes(v);
    }
    return out;
  }
  return value;
}

function countCitations(points: ReadonlyArray<ControlPoint>): number {
  return points.reduce((sum, pc) => sum + pc.citations.length, 0);
}

function toAuditSeverityLevel(value: unknown): AuditSeverityLevel {
  return value === "LOW" ||
    value === "MEDIUM" ||
    value === "HIGH" ||
    value === "CRITICAL"
    ? value
    : "MEDIUM";
}

function isAnalyzeStepResult(value: unknown): value is AnalyzeStepResult {
  if (!isRecord(value)) {return false;}
  if (typeof value.traite !== "boolean") {return false;}
  if (typeof value.conforme !== "string") {return false;}
  if (typeof value.score !== "number") {return false;}
  if (!Array.isArray(value.points_controle)) {return false;}
  if (!isRecord(value.step_metadata)) {return false;}
  if (!isRecord(value.usage)) {return false;}
  return true;
}

function fallbackAnalyzeStepResult(params: {
  stepPosition: number;
  stepName: string;
  severity: AuditSeverityLevel;
  isCritical: boolean;
  weight: number;
  controlPoints: string[];
  message: string;
}): AnalyzeStepResult {
  return {
    traite: false,
    conforme: "NON_CONFORME",
    minutages: [],
    score: 0,
    points_controle: params.controlPoints.map((cp) => ({
      point: cp,
      statut: "ABSENT",
      commentaire: params.message,
      citations: [],
      minutages: [],
      erreur_transcription_notee: false,
      variation_phonetique_utilisee: null,
    })),
    mots_cles_trouves: [],
    commentaire_global: params.message,
    niveau_conformite: "INSUFFISANT",
    erreurs_transcription_tolerees: 0,
    step_metadata: {
      position: params.stepPosition,
      name: params.stepName,
      severity: params.severity,
      is_critical: params.isCritical,
      weight: params.weight,
    },
    usage: {
      prompt_tokens: 0,
      completion_tokens: 0,
      total_tokens: 0,
    },
  };
}

/**
 * Run Audit Function
 * ==================
 * Orchestrates fiche fetch -> transcription -> audit execution
 * - Concurrency: globally limited + single-flight per fiche_id
 * - Retries: 2 times (expensive operations)
 * - Timeout: 30 minutes
 * - Uses step.invoke() for proper function composition
 */
export const runAuditFunction = inngest.createFunction(
  {
    id: "run-audit",
    name: "Run AI Audit",
    concurrency: [
      {
        limit: CONCURRENCY.AUDIT_RUN.limit,
      },
      // Prevent overlapping audits for the same fiche across replicas
      {
        key: "event.data.fiche_id",
        limit: Math.max(
          1,
          Number(process.env.AUDIT_RUN_PER_FICHE_CONCURRENCY || 1)
        ),
      },
    ],
    retries: 2,
    timeouts: {
      finish: TIMEOUTS.AUDIT_RUN,
    },
    // Remove idempotency to allow same fiche+config to run multiple times
    // The event ID in the route already provides deduplication
    onFailure: async ({ error, step, event }) => {
      const { fiche_id, audit_config_id } = getAuditRunFailureMeta(event);
      let auditTrackingId: string | null = null;
      let auditDbId: string | null = null;
      const failureEventIdRaw = isRecord(event)
        ? (event as Record<string, unknown>).id
        : null;
      const failureEventId =
        typeof failureEventIdRaw === "string" && failureEventIdRaw.trim()
          ? failureEventIdRaw.trim()
          : null;

      // Try to mark audit as failed in database
      try {
        const { prisma } = await import("../../shared/prisma.js");

        const baseWhere = {
          ficheCache: { ficheId: fiche_id },
          auditConfigId: BigInt(audit_config_id),
          status: "running",
        } as const;

        // Prefer a precise match using the tracking `audit_id` stored in resultData.
        // This avoids marking the wrong audit as failed if per-fiche concurrency is > 1.
        const runningAuditByTrackingId = failureEventId
          ? await prisma.audit.findFirst({
              where: {
                ...baseWhere,
                resultData: {
                  path: ["audit_id"],
                  equals: failureEventId,
                },
              },
              orderBy: { createdAt: "desc" },
              select: { id: true, resultData: true },
            })
          : null;

        // Fallback: most recent running audit for fiche+config.
        const runningAudit =
          runningAuditByTrackingId ??
          (await prisma.audit.findFirst({
            where: baseWhere,
            orderBy: { createdAt: "desc" },
            select: { id: true, resultData: true },
          }));

        if (runningAudit) {
          auditDbId = runningAudit.id.toString();
          // Best-effort: extract the tracking audit id used by realtime/webhooks.
          // Stored by `createPendingAudit` under `resultData.audit_id`.
          if (isRecord(runningAudit.resultData)) {
            const raw = runningAudit.resultData.audit_id;
            if (typeof raw === "string" && raw.trim()) {
              auditTrackingId = raw.trim();
            }
          }

          const { markAuditAsFailed } = await import("./audits.repository.js");
          await markAuditAsFailed(runningAudit.id, error.message);
          appLogger.info("Marked audit as failed in database", {
            audit_id: auditDbId,
            audit_tracking_id: auditTrackingId ?? undefined,
            fiche_id,
            audit_config_id,
          });
        }
      } catch (dbError) {
        appLogger.error(
          "Failed to mark audit as failed in database",
          dbError instanceof Error ? dbError : { error: String(dbError) }
        );
      }

      // Send webhook notification (don't use step.run in onFailure - causes serialization errors)
      try {
        const useRlm =
          typeof (event?.data as { use_rlm?: unknown } | undefined)?.use_rlm === "boolean"
            ? (event.data as { use_rlm?: boolean }).use_rlm!
            : false;
        // Prefer using the tracking audit id (used by progress events).
        // If we don't have one from DB yet, fall back to the original Inngest event id (route-generated).
        // As a last resort, use DB id or a best-effort synthetic id.
        const fallbackId =
          auditTrackingId ??
          failureEventId ??
          auditDbId ??
          `audit-${fiche_id}-${audit_config_id}-${Date.now()}`;
        await auditWebhooks.failed(
          fallbackId,
          fiche_id,
          error.message,
          undefined,
          undefined,
          {
            ...(auditDbId ? { audit_db_id: auditDbId } : {}),
            ...(failureEventId ? { event_id: failureEventId } : {}),
            approach: {
              use_rlm: useRlm,
              transcript_mode: useRlm ? "tools" : "prompt",
            },
          }
        );
      } catch (webhookError) {
        appLogger.error(
          "Failed to send failure webhook",
          webhookError instanceof Error ? webhookError : { error: String(webhookError) }
        );
      }

      // Send internal event
      await step.sendEvent("emit-failure", {
        name: "audit/failed",
        data: {
          fiche_id,
          audit_config_id,
          error: error.message,
          retry_count: 0,
          ...(auditDbId ? { audit_db_id: auditDbId } : {}),
          ...(auditTrackingId
            ? { audit_tracking_id: auditTrackingId }
            : failureEventId
              ? { audit_tracking_id: failureEventId }
              : {}),
        },
      });
    },
  },
  { event: "audit/run" },
  async ({ event, step, logger }): Promise<AuditFunctionResult> => {
    const {
      fiche_id,
      audit_config_id,
      user_id,
      use_rlm,
      automation_schedule_id,
      automation_run_id,
      trigger_source,
    } = event.data as typeof event.data & {
      automation_schedule_id?: unknown;
      automation_run_id?: unknown;
      trigger_source?: unknown;
      use_rlm?: unknown;
    };

    const useRlm = typeof use_rlm === "boolean" ? use_rlm : false;

    const parseOptionalBigInt = (value: unknown): bigint | undefined => {
      if (typeof value === "bigint") {return value;}
      const str = typeof value === "string" ? value.trim() : String(value ?? "").trim();
      if (!str) {return undefined;}
      if (!/^\d+$/.test(str)) {return undefined;}
      try {
        return BigInt(str);
      } catch {
        return undefined;
      }
    };

    const automationScheduleId = parseOptionalBigInt(automation_schedule_id);
    const automationRunId = parseOptionalBigInt(automation_run_id);
    const triggerSource =
      typeof trigger_source === "string" && trigger_source.trim()
        ? trigger_source.trim()
        : undefined;
    const triggerUserId =
      typeof user_id === "string" && user_id.trim() ? user_id.trim() : undefined;
    const auditIdFromEventRaw = typeof event.id === "string" ? event.id.trim() : "";
    const auditIdFromEvent =
      auditIdFromEventRaw.length > 0 ? auditIdFromEventRaw : undefined;

    // Capture start time in a step to persist it across Inngest checkpoints
    const { startTime } = await step.run(
      "capture-start-time",
      async (): Promise<{ startTime: number }> => {
        const now = Date.now();
        return { startTime: now };
      }
    );

    const startedAtMs =
      typeof startTime === "number" && Number.isFinite(startTime) ? startTime : Date.now();

    const auditId =
      auditIdFromEvent ?? `audit-${fiche_id}-${audit_config_id}-${startedAtMs}`;

    const tracer = createWorkflowTracer({
      workflow: "audit",
      entity: { type: "fiche", id: fiche_id },
      traceId: auditId,
      inngestEventId: typeof event.id === "string" ? event.id : undefined,
    });
    const wlog = createWorkflowLogger("audit", `${fiche_id}/${audit_config_id}`, { tracer });
    wlog.start("run-audit", {
      audit_id: auditId,
      fiche_id,
      audit_config_id,
      use_rlm: useRlm,
      trigger_source: triggerSource,
      automation_run_id: automationRunId?.toString(),
    });

    await step.run("log-audit-start", async () => {
      logger.info("Starting audit", {
        audit_id: auditId,
        event_id: auditIdFromEvent ?? undefined,
        fiche_id,
        audit_config_id,
        ...(triggerUserId ? { user_id: triggerUserId } : {}),
        use_rlm: useRlm,
        ...(automationScheduleId ? { automation_schedule_id: automationScheduleId.toString() } : {}),
        ...(automationRunId ? { automation_run_id: automationRunId.toString() } : {}),
        ...(triggerSource ? { trigger_source: triggerSource } : {}),
      });
      return { logged: true };
    });

    const approach = {
      use_rlm: useRlm,
      transcript_mode: useRlm ? "tools" : "prompt",
    } as const;
    const runEventId = auditIdFromEvent ?? "";

    const emitTerminalAuditFailure = async (params: {
      error: string;
      auditDbId?: string | null;
      stage: string;
    }) => {
      const auditDbId = params.auditDbId ?? null;

      // Best-effort webhook; never fail the workflow due to webhook delivery.
      await step.run(`send-terminal-failed-webhook-${params.stage}`, async () => {
        try {
          await auditWebhooks.failed(
            auditId,
            fiche_id,
            params.error,
            undefined,
            undefined,
            {
              ...(auditDbId ? { audit_db_id: auditDbId } : {}),
              ...(runEventId ? { event_id: runEventId } : {}),
              approach,
            }
          );
        } catch {
          // ignore (best-effort)
        }
        return { notified: true };
      });

      // Internal domain event (used by batch progress + automation consumers)
      await step.sendEvent(`emit-audit-failed-terminal-${params.stage}`, {
        name: "audit/failed",
        data: {
          fiche_id,
          audit_config_id,
          error: params.error,
          retry_count: 0,
          ...(auditDbId ? { audit_db_id: auditDbId } : {}),
          audit_tracking_id: auditId,
          stage: params.stage,
        },
        id: `audit-failed-${params.stage}-${auditId}`,
      });
    };

    // Step 1: Always force-refresh fiche details/recordings (audit must use latest recordings)
    wlog.step("force-refresh-fiche");
    const ficheCacheBefore = await step.run(
      "snapshot-fiche-before-force-refresh",
      async () => {
        const cached = await getCachedFiche(fiche_id);
        const recordings =
          cached && Array.isArray(cached.recordings) ? cached.recordings : [];
        const blankRecordingUrlCount = recordings.reduce((acc, r) => {
          const url = typeof r.recordingUrl === "string" ? r.recordingUrl : "";
          return url.trim().length === 0 ? acc + 1 : acc;
        }, 0);

        const rawData: unknown = cached?.rawData;
        const isSalesListOnly =
          Boolean(cached) && isRecord(rawData) && rawData._salesListOnly === true;
        const snapshot = {
          found: Boolean(cached),
          cache_id: cached ? String(cached.id) : null,
          fetched_at: cached ? cached.fetchedAt.toISOString() : null,
          expires_at: cached ? cached.expiresAt.toISOString() : null,
          recordings_count:
            typeof cached?.recordingsCount === "number" ? cached.recordingsCount : null,
          recording_rows_count: recordings.length,
          blank_recording_url_count: blankRecordingUrlCount,
          sales_list_only: isSalesListOnly,
        } as const;

        logger.info("Fiche cache snapshot (before force refresh)", {
          audit_id: auditId,
          fiche_id,
          audit_config_id,
          ...snapshot,
        });

        return snapshot;
      }
    );

    // Realtime: fiche fetch phase started (best-effort)
    await step.run("send-fiche-fetch-started", async () => {
      try {
        // We are force-refreshing, so we are not using cache for this run.
        await auditWebhooks.ficheFetchStarted(auditId, fiche_id, false, {
          event_id: runEventId,
          approach,
        });
      } catch {
        // ignore (best-effort)
      }
      return { notified: true };
    });

    const { startedAt: forceRefreshStartedAt } = await step.run(
      "log-force-refresh-start",
      async () => {
        const startedAt = Date.now();
        logger.info("Force-refreshing fiche details/recordings", {
          audit_id: auditId,
          event_id: runEventId || undefined,
          fiche_id,
          force_refresh: true,
          had_cache_before_refresh: ficheCacheBefore.found,
          cache_id_before: ficheCacheBefore.cache_id ?? undefined,
          recordings_count_before: ficheCacheBefore.recordings_count ?? undefined,
          recording_rows_count_before: ficheCacheBefore.recording_rows_count,
          blank_recording_url_count_before: ficheCacheBefore.blank_recording_url_count,
          sales_list_only_before: ficheCacheBefore.sales_list_only,
        });
        return { startedAt };
      }
    );

    let ficheFetchResult: unknown;
    try {
      ficheFetchResult = await step.invoke("fetch-fiche", {
        function: fetchFicheFunction,
        data: {
          fiche_id,
          force_refresh: true,
        },
      });
    } catch (err) {
      // Terminal prereq: upstream fiche 404 / NOT_FOUND.
      // We want this to be deterministic: mark audit failed (if we can create one) and exit.
      if (isNotFoundLikeError(err)) {
        const terminalError = `Fiche ${fiche_id} not found (404)`;

        const auditDbId = await step.run("create-and-fail-audit-on-fiche-not-found", async () => {
          try {
            const cacheIdRaw =
              typeof ficheCacheBefore.cache_id === "string" && ficheCacheBefore.cache_id.trim()
                ? ficheCacheBefore.cache_id.trim()
                : null;
            if (!cacheIdRaw) {return null;}

            const ficheCacheId = BigInt(cacheIdRaw);
            const { createPendingAudit, markAuditAsFailed } = await import("./audits.repository.js");

            const created = await createPendingAudit(
              ficheCacheId,
              BigInt(audit_config_id),
              auditId,
              {
                automationScheduleId,
                automationRunId,
                triggerSource: triggerSource ?? "api",
                triggerUserId,
                useRlm,
              }
            );
            await markAuditAsFailed(created.id, terminalError);
            return created.id.toString();
          } catch {
            return null;
          }
        });

        await emitTerminalAuditFailure({
          error: terminalError,
          auditDbId,
          stage: "fiche_not_found",
        });

        return {
          success: false,
          fiche_id,
          audit_id: auditDbId ?? "unknown",
          audit_config_id,
          score: 0,
          niveau: "FAILED",
          duration_ms: Math.max(0, Date.now() - startedAtMs),
        };
      }

      throw err;
    }

    // Terminal prereq: upstream fiche 404 / NOT_FOUND (returned as a result, not thrown).
    // Mark audit as failed (create row if possible) and exit deterministically.
    if (isRecord(ficheFetchResult) && (ficheFetchResult as { not_found?: unknown }).not_found === true) {
      const terminalError = `Fiche ${fiche_id} not found (404)`;

      const auditDbId = await step.run(
        "create-and-fail-audit-on-fiche-not-found-result",
        async () => {
          try {
            const cacheIdRaw =
              isRecord(ficheFetchResult) &&
              typeof (ficheFetchResult as { cache_id?: unknown }).cache_id === "string" &&
              (ficheFetchResult as { cache_id: string }).cache_id.trim()
                ? (ficheFetchResult as { cache_id: string }).cache_id.trim()
                : typeof ficheCacheBefore.cache_id === "string" &&
                    ficheCacheBefore.cache_id.trim()
                  ? ficheCacheBefore.cache_id.trim()
                  : null;
            if (!cacheIdRaw) {return null;}
            if (!/^\d+$/.test(cacheIdRaw)) {return null;}

            const ficheCacheId = BigInt(cacheIdRaw);
            const { createPendingAudit, markAuditAsFailed } = await import(
              "./audits.repository.js"
            );

            const created = await createPendingAudit(
              ficheCacheId,
              BigInt(audit_config_id),
              auditId,
              {
                automationScheduleId,
                automationRunId,
                triggerSource: triggerSource ?? "api",
                triggerUserId,
                useRlm,
              }
            );
            await markAuditAsFailed(created.id, terminalError);
            return created.id.toString();
          } catch {
            return null;
          }
        }
      );

      await emitTerminalAuditFailure({
        error: terminalError,
        auditDbId,
        stage: "fiche_not_found",
      });

      return {
        success: false,
        fiche_id,
        audit_id: auditDbId ?? "unknown",
        audit_config_id,
        score: 0,
        niveau: "FAILED",
        duration_ms: Math.max(0, Date.now() - startedAtMs),
      };
    }

    await step.run("log-force-refresh-done", async () => {
      logger.info("Fiche force-refresh completed", {
        audit_id: auditId,
        event_id: runEventId || undefined,
        fiche_id,
        force_refresh: true,
        fetch_result: {
          success:
            isRecord(ficheFetchResult) && typeof ficheFetchResult.success === "boolean"
              ? ficheFetchResult.success
              : undefined,
          cached:
            isRecord(ficheFetchResult) && typeof ficheFetchResult.cached === "boolean"
              ? ficheFetchResult.cached
              : undefined,
          cache_id:
            isRecord(ficheFetchResult) && typeof ficheFetchResult.cache_id === "string"
              ? ficheFetchResult.cache_id
              : undefined,
          recordings_count:
            isRecord(ficheFetchResult) && typeof ficheFetchResult.recordings_count === "number"
              ? ficheFetchResult.recordings_count
              : undefined,
          cache_check:
            isRecord(ficheFetchResult) && (ficheFetchResult as { cache_check?: unknown }).cache_check !== undefined
              ? (ficheFetchResult as { cache_check?: unknown }).cache_check
              : undefined,
        },
        elapsed_ms:
          typeof forceRefreshStartedAt === "number"
            ? Math.max(0, Date.now() - forceRefreshStartedAt)
            : undefined,
      });
      return { logged: true };
    });

    const ficheCacheAfter = await step.run(
      "snapshot-fiche-after-force-refresh",
      async () => {
        const cached = await getCachedFiche(fiche_id);
        const recordings =
          cached && Array.isArray(cached.recordings) ? cached.recordings : [];
        const blankRecordingUrlCount = recordings.reduce((acc, r) => {
          const url = typeof r.recordingUrl === "string" ? r.recordingUrl : "";
          return url.trim().length === 0 ? acc + 1 : acc;
        }, 0);

        const rawData: unknown = cached?.rawData;
        const isSalesListOnly =
          Boolean(cached) && isRecord(rawData) && rawData._salesListOnly === true;
        const prospectName = `${cached?.prospectPrenom || ""} ${cached?.prospectNom || ""}`.trim();
        const snapshot = {
          found: Boolean(cached),
          cache_id: cached ? String(cached.id) : null,
          fetched_at: cached ? cached.fetchedAt.toISOString() : null,
          expires_at: cached ? cached.expiresAt.toISOString() : null,
          recordings_count:
            typeof cached?.recordingsCount === "number" ? cached.recordingsCount : null,
          recording_rows_count: recordings.length,
          blank_recording_url_count: blankRecordingUrlCount,
          sales_list_only: isSalesListOnly,
          prospect_name: prospectName,
        } as const;

        logger.info("Fiche cache snapshot (after force refresh)", {
          audit_id: auditId,
          fiche_id,
          audit_config_id,
          ...snapshot,
        });

        return snapshot;
      }
    );

    // Realtime: fiche fetch phase completed (best-effort)
    await step.run("send-fiche-fetch-completed", async () => {
      try {
        const recordingsCount =
          typeof ficheCacheAfter.recordings_count === "number"
            ? ficheCacheAfter.recordings_count
            : typeof ficheCacheAfter.recording_rows_count === "number"
              ? ficheCacheAfter.recording_rows_count
              : 0;

        await auditWebhooks.ficheFetchCompleted(
          auditId,
          fiche_id,
          recordingsCount,
          ficheCacheAfter.prospect_name,
          false,
          { event_id: runEventId, approach }
        );
      } catch {
        // ignore (best-effort)
      }
      return { notified: true };
    });

    wlog.stepDone("force-refresh-fiche");

    // Step 2: Ensure transcriptions
    wlog.step("check-transcription-status");
    const transcriptionStatus = await step.run(
      "check-transcription-status",
      async () => {
        return await getFicheTranscriptionStatus(fiche_id);
      }
    );

    // Realtime: transcription status check (best-effort)
    await step.run("send-transcription-check", async () => {
      try {
        const total = Number(transcriptionStatus.total || 0);
        const transcribed = Number(transcriptionStatus.transcribed || 0);
        const needs = Math.max(0, total - transcribed);
        await auditWebhooks.transcriptionCheck(auditId, fiche_id, total, transcribed, needs, {
          event_id: runEventId,
          approach,
        });
      } catch {
        // ignore (best-effort)
      }
      return { notified: true };
    });

    // Check if transcription is complete
    const totalRecordings =
      transcriptionStatus.total !== null && typeof transcriptionStatus.total === "number"
        ? transcriptionStatus.total
        : null;
    const transcribedCount =
      typeof transcriptionStatus.transcribed === "number"
        ? transcriptionStatus.transcribed
        : 0;
    const isComplete =
      totalRecordings !== null &&
      totalRecordings >= 0 &&
      (totalRecordings === 0 || transcribedCount === totalRecordings);

    if (!isComplete) {
      wlog.step("invoke-transcription", { total: transcriptionStatus.total, transcribed: transcriptionStatus.transcribed, pending: (transcriptionStatus.total || 0) - transcribedCount });
      logger.info("Transcriptions incomplete, triggering transcription", {
        fiche_id,
        total: transcriptionStatus.total,
        transcribed: transcriptionStatus.transcribed,
      });

      await step.invoke("transcribe-fiche", {
        function: transcribeFicheFunction,
        data: {
          fiche_id,
          priority: "high",
        },
      });

      wlog.stepDone("invoke-transcription");
      logger.info("Transcription completed", { fiche_id });
    } else {
      wlog.info("All recordings already transcribed", { count: transcriptionStatus.total });
      logger.info("All recordings already transcribed", {
        fiche_id,
        count: transcriptionStatus.total,
      });
    }

    // Re-check after transcription invocation/wait to avoid proceeding with missing transcripts.
    // (transcribeFicheFunction waits by default, but we validate the DB state here.)
    const transcriptionCounts = await step.run("check-transcription-status-after", async () => {
      const status = await getFicheTranscriptionStatus(fiche_id);
      return {
        total: typeof status.total === "number" ? status.total : 0,
        transcribed: typeof status.transcribed === "number" ? status.transcribed : 0,
        pending: typeof status.pending === "number" ? status.pending : 0,
        percentage: typeof status.percentage === "number" ? status.percentage : 0,
      };
    });

    wlog.stepDone("check-transcription-status", { total: transcriptionCounts.total, transcribed: transcriptionCounts.transcribed, pending: transcriptionCounts.pending });

    // Step 3: Load audit configuration
    wlog.step("load-audit-config", { audit_config_id });
    const auditConfigRaw = await step.run(
      "load-audit-config",
      async (): Promise<AuditConfigForAnalysis> => {
      logger.info("Loading audit configuration", { audit_config_id });
      const { getAuditConfigById } = await import(
        "../audit-configs/audit-configs.repository.js"
      );
      const config = await getAuditConfigById(BigInt(audit_config_id));

      if (!config) {
        throw new NonRetriableError(
          `Audit config ${audit_config_id} not found`
        );
      }

      return {
        id: config.id.toString(),
        name: config.name,
        description: config.description,
        systemPrompt: config.systemPrompt,
        auditSteps: config.steps,
      };
    });

    const auditConfigValue: unknown = auditConfigRaw;
    if (!isAuditConfigForAnalysis(auditConfigValue)) {
      throw new Error(`Invalid audit config payload for ${audit_config_id}`);
    }
    const auditConfig = auditConfigValue;

    wlog.stepDone("load-audit-config", { config_name: auditConfig.name, total_steps: auditConfig.auditSteps.length });
    logger.info("Audit config loaded", {
      config_name: auditConfig.name,
      total_steps: auditConfig.auditSteps.length,
    });

    // Realtime: config loaded (best-effort)
    await step.run("send-config-loaded", async () => {
      try {
        await auditWebhooks.configLoaded(
          auditId,
          fiche_id,
          String(audit_config_id),
          auditConfig.name,
          auditConfig.auditSteps.length,
          { event_id: runEventId, approach }
        );
      } catch {
        // ignore (best-effort)
      }
      return { notified: true };
    });

    // Step 3.5 + 4 can run in parallel:
    // - link product (optional)
    // - create audit record
    // - generate timeline from DB transcriptions
    const productInfoPromise = step.run(
      "link-to-product",
      async (): Promise<ProductLinkResult | null> => {
        const needsProductInfo = auditConfig.auditSteps.some(
          (s) => s.verifyProductInfo === true
        );

        if (!needsProductInfo) {
          logger.info("Product verification not needed for this audit");
          return null;
        }

        logger.info(
          "Product verification required - linking fiche to product database"
        );

        try {
          const { linkFicheToProduct } = await import(
            "../products/products.service.js"
          );

          const linkResult: ProductLinkResult = await linkFicheToProduct(fiche_id);

          if (linkResult.matched && linkResult.formule) {
            logger.info("Product matched successfully", {
              groupe: linkResult.formule.gamme.groupe.libelle,
              gamme: linkResult.formule.gamme.libelle,
              formule: linkResult.formule.libelle,
              guarantees: linkResult.formule._counts?.garanties,
            });
            return linkResult;
          }

          logger.warn("No matching product found in database", {
            searched: linkResult.searchCriteria,
          });
          return null;
        } catch (error: unknown) {
          logger.warn("Failed to link fiche to product", {
            error: errorMessage(error),
          });
          return null;
        }
      }
    );

    const auditDbIdPromise = step.run("create-audit-record", async () => {
      logger.info("Creating audit record in database", {
        fiche_id,
        audit_config_id,
      });

      const { createPendingAudit } = await import("./audits.repository.js");

      const cached = await getCachedFiche(fiche_id);
      if (!cached) {
        throw new NonRetriableError(
          `Fiche ${fiche_id} not cached - cannot create audit`
        );
      }

      const createdAudit = await createPendingAudit(
        cached.id,
        BigInt(audit_config_id),
        auditId,
        {
          automationScheduleId,
          automationRunId,
          triggerSource: triggerSource ?? "api",
          triggerUserId,
          useRlm,
        }
      );

      logger.info("Audit record created", {
        audit_db_id: String(createdAudit.id),
        status: "running",
      });

      // Return as string to avoid BigInt serialization issues with Inngest
      return String(createdAudit.id);
    });

    const auditDbId = await auditDbIdPromise;

    // Send audit started webhook
    await step.run("send-started-webhook", async () => {
      await auditWebhooks.started(
        auditId,
        fiche_id,
        String(audit_config_id),
        auditConfig.name,
        auditConfig.auditSteps.length,
        { audit_db_id: auditDbId, event_id: runEventId, approach }
      );
      return { notified: true };
    });

    const productInfo = await productInfoPromise;
    wlog.step("generate-timeline");
    const timelineMeta = await step.run("generate-timeline-and-cache-context", async () => {
      logger.info("Building timeline from database", { fiche_id });
      const timeline = normalizeTimelineRecordings(await rebuildTimelineFromDatabase(fiche_id));
      const recordingsCount = timeline.length;
      const totalChunks = timeline.reduce((sum, r) => sum + (r.total_chunks || 0), 0);

      const redis = await getRedisClient();
      if (!redis) {
        logger.warn("Redis not configured; step fan-out will fall back to DB rebuilds", {
          fiche_id,
          audit_db_id: auditDbId,
        });
        return { recordingsCount, totalChunks, cached: false as const };
      }

      const ttlSeconds = Math.max(
        60,
        Number(process.env.AUDIT_CONTEXT_TTL_SECONDS || 6 * 60 * 60)
      );
      const base = `audit:${auditDbId}`;

      // Build timelineText only when we can persist it for workers (otherwise it's redundant).
      const { buildTimelineText, buildTimelineExcerptText } = await import("./audits.prompts.js");
      const timelineText = buildTimelineText(timeline);

      // Log payload sizes for monitoring (Pusher has size limits; Inngest step outputs are now small here).
      const timelineSize = getPayloadSize(timeline);
      const timelineTextSize = getPayloadSize(timelineText);
      logger.info("Timeline data sizes", {
        timeline: formatBytes(timelineSize),
        timelineText: formatBytes(timelineTextSize),
      });

      const multi = redis.multi();
      multi.setEx(`${base}:config`, ttlSeconds, JSON.stringify(auditConfig));
      multi.setEx(`${base}:timeline`, ttlSeconds, JSON.stringify(timeline));
      multi.setEx(`${base}:timelineText`, ttlSeconds, timelineText);
      if (productInfo) {
        multi.setEx(`${base}:productInfo`, ttlSeconds, JSON.stringify(productInfo));
      }

      // Optionally precompute per-step timeline excerpts (token/cost optimization)
      const excerptEnabled = process.env.AUDIT_STEP_TIMELINE_EXCERPT !== "0";
      const maxChunks = Math.max(
        10,
        Number(process.env.AUDIT_STEP_TIMELINE_MAX_CHUNKS || 40)
      );
      for (const auditStep of auditConfig.auditSteps || []) {
        if (!excerptEnabled || auditStep.verifyProductInfo !== true) {continue;}
        const perStepTimelineText = buildTimelineExcerptText(timeline, {
          queryTerms: [
            auditStep.name,
            ...(auditStep.keywords || []),
            ...(auditStep.controlPoints || []),
          ],
          maxChunks,
          neighborChunks: 1,
        });
        multi.setEx(
          `${base}:step:${auditStep.position}:timelineText`,
          ttlSeconds,
          perStepTimelineText
        );
      }

      await multi.exec();
      return { recordingsCount, totalChunks, cached: true as const, ttlSeconds };
    });

    // Inngest JSONifies step outputs; be defensive (some runtimes widen to number|null).
    const recordingsCount =
      isRecord(timelineMeta) && typeof timelineMeta.recordingsCount === "number"
        ? timelineMeta.recordingsCount
        : 0;
    const totalChunks =
      isRecord(timelineMeta) && typeof timelineMeta.totalChunks === "number"
        ? timelineMeta.totalChunks
        : 0;
    const timelineCached =
      isRecord(timelineMeta) && typeof timelineMeta.cached === "boolean"
        ? timelineMeta.cached
        : false;

    wlog.stepDone("generate-timeline", { recordings: recordingsCount, chunks: totalChunks, cached: timelineCached });
    logger.info("Timeline generated", {
      recordings: recordingsCount,
      chunks: totalChunks,
      cached: timelineCached,
    });

    // Terminal prereq: no usable transcribed recordings in DB timeline.
    // This avoids fan-out + "running" audits that never produce meaningful results.
    if (recordingsCount === 0) {
      const total = isRecord(transcriptionCounts) ? Number(transcriptionCounts.total || 0) : 0;
      const transcribed = isRecord(transcriptionCounts) ? Number(transcriptionCounts.transcribed || 0) : 0;
      const reason =
        total <= 0
          ? `No recordings found for fiche ${fiche_id} (cannot run audit)`
          : transcribed <= 0
            ? `No transcriptions available for fiche ${fiche_id} (${transcribed}/${total})`
            : `No usable transcribed recordings available for fiche ${fiche_id} (timeline empty)`;

      await step.run("mark-audit-failed-terminal-prereq", async () => {
        try {
          const { markAuditAsFailed } = await import("./audits.repository.js");
          await markAuditAsFailed(BigInt(auditDbId), reason);
        } catch {
          // ignore (best-effort)
        }
        return { marked: true };
      });

      // Best-effort: cleanup Redis context early (otherwise TTL will eventually expire it).
      await step.run("cleanup-audit-redis-context-terminal-prereq", async () => {
        try {
          const redis = await getRedisClient();
          if (!redis) {return { cleaned: false as const };}
          const base = `audit:${auditDbId}`;
          const keys: string[] = [
            `${base}:config`,
            `${base}:timeline`,
            `${base}:timelineText`,
            `${base}:productInfo`,
          ];
          for (const s of auditConfig.auditSteps || []) {
            keys.push(`${base}:step:${s.position}:timelineText`);
          }
          await redis.del(keys);
          return { cleaned: true as const, keys: keys.length };
        } catch {
          return { cleaned: false as const };
        }
      });

      await emitTerminalAuditFailure({
        error: reason,
        auditDbId,
        stage: "missing_transcription",
      });

      return {
        success: false,
        fiche_id,
        audit_id: String(auditDbId),
        audit_config_id,
        score: 0,
        niveau: "FAILED",
        duration_ms: Math.max(0, Date.now() - startedAtMs),
      };
    }

    // Realtime: timeline generated (best-effort)
    await step.run("send-timeline-generated", async () => {
      try {
        await auditWebhooks.timelineGenerated(
          auditId,
          fiche_id,
          recordingsCount,
          totalChunks,
          { audit_db_id: auditDbId, event_id: runEventId, approach }
        );
      } catch {
        // ignore (best-effort)
      }
      return { notified: true };
    });

    // Send progress: Timeline ready
    await step.run("send-progress-timeline", async () => {
      await auditWebhooks.progress(
        auditId,
        fiche_id,
        0, // No steps completed yet
        auditConfig.auditSteps.length,
        0, // No failures yet
        "timeline",
        { audit_db_id: auditDbId, event_id: runEventId, approach }
      );
      return { notified: true };
    });

    // Realtime: analysis started (best-effort)
    await step.run("send-analysis-started", async () => {
      try {
        await auditWebhooks.analysisStarted(
          auditId,
          fiche_id,
          auditConfig.auditSteps.length,
          process.env.OPENAI_MODEL_AUDIT || "gpt-5.2",
          { audit_db_id: auditDbId, event_id: runEventId, approach }
        );
      } catch {
        // ignore (best-effort)
      }
      return { notified: true };
    });

    // Step 6: Fan-out one event per step so work can be spread across replicas
    wlog.fanOut("audit/step.analyze", auditConfig.auditSteps.length, {
      audit_db_id: auditDbId,
      step_positions: auditConfig.auditSteps.map((s) => s.position),
    });
    const stepEvents = auditConfig.auditSteps.map((s) => ({
      name: "audit/step.analyze" as const,
      data: {
        audit_db_id: String(auditDbId),
        audit_id: auditId,
        fiche_id,
        audit_config_id,
        step_position: s.position,
        use_rlm: useRlm,
      },
      // Idempotent per audit+step
      id: `audit-step-${auditDbId}-${s.position}`,
    }));

    const fanOutResult = await step.sendEvent("fan-out-audit-steps", stepEvents);

    await step.run("log-audit-step-fan-out", async () => {
      const ids =
        isRecord(fanOutResult) && Array.isArray(fanOutResult.ids)
          ? (fanOutResult.ids as unknown[]).filter((v): v is string => typeof v === "string")
          : [];
      logger.info("Audit step fan-out dispatched", {
        audit_id: auditId,
        event_id: runEventId || undefined,
        fiche_id,
        audit_db_id: auditDbId,
        steps: auditConfig.auditSteps.length,
        ids_count: ids.length,
        ids_sample: ids.slice(0, 5),
      });
      return { logged: true, idsCount: ids.length };
    });

    // The audit is finalized asynchronously by the `audit/step.analyzed` aggregator.
    return {
      success: true,
      fiche_id,
      audit_id: String(auditDbId), // DB id (available immediately)
      audit_config_id,
      score: 0,
      niveau: "PENDING",
      duration_ms: 0,
    };
  }
);

/**
 * Audit Step Worker (Distributed)
 * ===============================
 * Runs a SINGLE audit step so it can be executed on any replica.
 *
 * Key idea: split "one heavy audit request" into N independent step jobs.
 */
export const auditStepAnalyzeFunction = inngest.createFunction(
  {
    id: "audit-step-analyze",
    name: "Analyze Audit Step (Distributed)",
    retries: 2,
    timeouts: {
      finish: "20m",
    },
    concurrency: [
      // Global cap (protects OpenAI spend + rate limits)
      {
        limit: Math.max(
          1,
          Number(process.env.AUDIT_STEP_WORKER_CONCURRENCY || DEFAULT_GLOBAL_CONCURRENCY)
        ),
      },
      // Per-audit cap (keeps within your previous AUDIT_STEP_CONCURRENCY behavior)
      {
        key: "event.data.audit_db_id",
        limit: Math.max(
          1,
          Number(
            process.env.AUDIT_STEP_PER_AUDIT_CONCURRENCY ||
              DEFAULT_PER_ENTITY_CONCURRENCY
          )
        ),
      },
    ],
  },
  { event: "audit/step.analyze" },
  async ({ event, step, logger }) => {
    const {
      audit_db_id,
      audit_id,
      fiche_id,
      audit_config_id,
      step_position,
      use_rlm,
    } =
      event.data;

    const auditDbId = BigInt(audit_db_id);
    const stepPosition = Number(step_position);

    const tracer = createWorkflowTracer({
      workflow: "audit",
      entity: { type: "audit-step", id: `${fiche_id}/step-${stepPosition}` },
      traceId: typeof audit_id === "string" ? audit_id : String(audit_db_id),
      inngestEventId: typeof event.id === "string" ? event.id : undefined,
    });
    const wlog = createWorkflowLogger("audit-step", `${fiche_id}/step-${stepPosition}`, { tracer });
    wlog.start("analyze-step", { audit_db_id, step_position: stepPosition, use_rlm });

    // Idempotency: skip if already analyzed (prevents duplicate webhooks + spend)
    const { prisma: db } = await import("../../shared/prisma.js");
    const existing = await db.auditStepResult.findUnique({
      where: {
        auditId_stepPosition: {
          auditId: auditDbId,
          stepPosition,
        },
      },
      select: {
        rawResult: true,
      },
    });

    if (existing?.rawResult) {
      logger.info("Step already analyzed - skipping", {
        audit_db_id,
        step_position: stepPosition,
      });

      await step.sendEvent("emit-step-analyzed", {
        name: "audit/step.analyzed",
        data: {
          audit_db_id,
          audit_id,
          fiche_id,
          audit_config_id,
          step_position: stepPosition,
          ok: true,
          ...(typeof use_rlm === "boolean" ? { use_rlm } : {}),
        },
      });

      return { skipped: true, audit_db_id, step_position: stepPosition };
    }

    // Load cached context (Redis) if available
    const redis = await getRedisClient();
    const base = `audit:${audit_db_id}`;

    let auditConfig: AuditConfigForAnalysis | null = null;
    let productInfo: ProductLinkResult | null = null;
    let timelineText: string | null = null;
    let timeline: TimelineRecording[] | null = null;
    let auditStep: AuditStepDefinition | null = null;

    const wantsTranscriptTools = typeof use_rlm === "boolean" ? use_rlm : false;

    if (redis) {
      try {
        const keys = [
          `${base}:config`,
          `${base}:productInfo`,
          `${base}:step:${stepPosition}:timelineText`,
          `${base}:timelineText`,
          ...(wantsTranscriptTools ? [`${base}:timeline`] : []),
        ];

        const values = await redis.mGet(keys);
        const cfg = values[0];
        const prod = values[1];
        const perStepText = values[2];
        const fullText = values[3];
        const tl = wantsTranscriptTools ? values[4] : null;

        if (cfg) {
          const parsed = safeJsonParse(cfg);
          if (isAuditConfigForAnalysis(parsed)) {auditConfig = parsed;}
        }
        if (prod) {
          const parsed = safeJsonParse(prod);
          productInfo = isProductLinkResult(parsed) ? parsed : null;
        }
        timelineText = perStepText || fullText || null;

        if (wantsTranscriptTools && tl) {
          const parsed = safeJsonParse(tl);
          if (Array.isArray(parsed)) {
            timeline = normalizeTimelineRecordings(parsed);
          }
        }

        if (auditConfig?.auditSteps?.length) {
          auditStep =
            auditConfig.auditSteps.find((s) => s.position === stepPosition) || null;
        }
      } catch (err) {
        logger.warn("Failed to load audit context from Redis; falling back to DB", {
          audit_db_id,
          step_position: stepPosition,
          error: (err as Error).message,
        });
      }
    }

    // Fallback: load audit config/step from DB if needed
    if (!auditConfig || !auditStep) {
      const { getAuditConfigById } = await import(
        "../audit-configs/audit-configs.repository.js"
      );
      const config = await getAuditConfigById(BigInt(audit_config_id));
      if (!config) {
        throw new NonRetriableError(
          `Audit config ${audit_config_id} not found`
        );
      }
      auditConfig = {
        id: config.id.toString(),
        name: config.name,
        description: config.description,
        systemPrompt: config.systemPrompt,
        auditSteps: config.steps,
      };
      auditStep =
        auditConfig.auditSteps.find((s) => s.position === stepPosition) || null;
    }

    if (!auditStep) {
      throw new NonRetriableError(
        `Audit step ${stepPosition} not found for config ${audit_config_id}`
      );
    }
    if (!auditConfig) {
      throw new NonRetriableError(
        `Audit config ${audit_config_id} missing for step ${stepPosition}`
      );
    }
    const stepDef = auditStep;

    // Fallback timeline text (expensive): rebuild from DB only if Redis is missing.
    if (!timelineText || (wantsTranscriptTools && (!timeline || timeline.length === 0))) {
      logger.warn("Timeline text missing from Redis; rebuilding from DB", {
        audit_db_id,
        fiche_id,
      });

      const { buildTimelineText } = await import("./audits.prompts.js");
      const rebuiltTimeline = await rebuildTimelineFromDatabase(fiche_id);
      if (!timelineText) {
        timelineText = buildTimelineText(rebuiltTimeline);
      }
      if (wantsTranscriptTools && (!timeline || timeline.length === 0)) {
        timeline = rebuiltTimeline;
      }
    }

    // Freeze narrowed values for use inside the async `step.run` callback.
    // TS can't guarantee captured variables won't change before the callback runs.
    const auditConfigForStep = auditConfig;
    const timelineTextForStep = timelineText;
    const timelineForTools = wantsTranscriptTools ? timeline : null;
    if (!timelineTextForStep) {
      throw new NonRetriableError(`Timeline text missing for fiche ${fiche_id}`);
    }

    // Analyze step (LLM) with graceful failure fallback.
    // IMPORTANT: keep the expensive LLM call inside `step.run` so retries don't re-call OpenAI.
    const analysis = await step.run(`analyze-step-${stepPosition}`, async () => {
      const t0 = Date.now();
      logger.info("Audit step analysis started", {
        audit_db_id,
        event_id: typeof event.id === "string" ? event.id : String(event.id ?? ""),
        audit_id: audit_id,
        fiche_id,
        step_position: stepPosition,
        step_name: stepDef.name || `Step ${stepPosition}`,
        transcript_mode: wantsTranscriptTools ? "tools" : "prompt",
      });

      try {
        const { analyzeStep } = await import("./audits.analyzer.js");
        const analyzed = await analyzeStep(
          stepDef,
          auditConfigForStep,
          timelineTextForStep,
          audit_id,
          fiche_id,
          productInfo,
          {
            auditDbId: audit_db_id,
            transcriptMode: wantsTranscriptTools ? "tools" : "prompt",
            ...(timelineForTools && timelineForTools.length > 0
              ? { timeline: timelineForTools }
              : {}),
          }
        );

        const analyzedUnknown: unknown = analyzed;
        const totalTokens = isAnalyzeStepResult(analyzedUnknown)
          ? Number((analyzedUnknown.usage as { total_tokens?: unknown } | undefined)?.total_tokens || 0)
          : undefined;
        const controlPoints = isAnalyzeStepResult(analyzedUnknown)
          ? analyzedUnknown.points_controle.length
          : undefined;
        const citations = isAnalyzeStepResult(analyzedUnknown)
          ? countCitations(analyzedUnknown.points_controle)
          : undefined;

        logger.info("Audit step analysis finished", {
          audit_db_id,
          audit_id: audit_id,
          fiche_id,
          step_position: stepPosition,
          ok: true,
          elapsed_ms: Math.max(0, Date.now() - t0),
          control_points: controlPoints,
          citations,
          total_tokens: totalTokens,
        });

        return { ok: true, analyzed, errorMessage: undefined as string | undefined };
      } catch (err) {
        const stepErrorMessage = (err as Error).message || String(err);

        logger.warn("Audit step analysis failed; using fallback result", {
          audit_db_id,
          audit_id: audit_id,
          fiche_id,
          step_position: stepPosition,
          ok: false,
          elapsed_ms: Math.max(0, Date.now() - t0),
          error: stepErrorMessage,
        });

        // Best-effort webhook; never fail the step due to webhook delivery issues.
        try {
          await auditWebhooks.stepFailed(
            audit_id,
            fiche_id,
            stepPosition,
            stepDef.name || `Step ${stepPosition}`,
            stepErrorMessage,
            {
              audit_db_id,
              event_id: typeof event.id === "string" ? event.id : String(event.id ?? ""),
              approach: {
                use_rlm: wantsTranscriptTools,
                transcript_mode: wantsTranscriptTools ? "tools" : "prompt",
              },
            }
          );
        } catch (webhookErr) {
          logger.warn("Failed to send audit.step_failed webhook (non-fatal)", {
            audit_id,
            fiche_id,
            step_position: stepPosition,
            error: (webhookErr as Error).message,
          });
        }

        // Build a schema-compatible failure result so the audit can still finalize deterministically.
        const analyzed = fallbackAnalyzeStepResult({
          stepPosition,
          stepName: stepDef.name || "",
          severity: stepDef.severityLevel || "MEDIUM",
          isCritical: Boolean(stepDef.isCritical),
          weight: Number(stepDef.weight || 5),
          controlPoints: Array.isArray(stepDef.controlPoints)
            ? stepDef.controlPoints
            : [],
          message: `Step failed: ${stepErrorMessage}`,
        });

        return { ok: false, analyzed, errorMessage: stepErrorMessage };
      }
    });

    let ok = analysis.ok;
    let stepErrorMessage = analysis.errorMessage;

    // `step.run` returns a JSON-serializable value; validate + normalize to our schema type.
    const analyzedUnknown: unknown = analysis.analyzed;
    const analyzed: AnalyzeStepResult = isAnalyzeStepResult(analyzedUnknown)
      ? analyzedUnknown
      : (() => {
          ok = false;
          stepErrorMessage =
            stepErrorMessage || "Analyze step returned invalid result payload";
          return fallbackAnalyzeStepResult({
            stepPosition,
            stepName: stepDef.name || "",
            severity: stepDef.severityLevel || "MEDIUM",
            isCritical: Boolean(stepDef.isCritical),
            weight: Number(stepDef.weight || 5),
            controlPoints: Array.isArray(stepDef.controlPoints)
              ? stepDef.controlPoints
              : [],
            message: `Step failed: ${stepErrorMessage}`,
          });
        })();

    // Sanitize before DB writes to avoid Postgres null-byte failures in TEXT fields.
    const analyzedSanitizedUnknown: unknown = sanitizeNullBytes(analyzed);
    const analyzedSanitized: AnalyzeStepResult = isAnalyzeStepResult(analyzedSanitizedUnknown)
      ? analyzedSanitizedUnknown
      : analyzed;

    const totalCitations = countCitations(analyzedSanitized.points_controle);

    // Persist step output for finalization
    await step.run("upsert-step-result", async () => {
      const t0 = Date.now();
      const { prisma } = await import("../../shared/prisma.js");

      const points = Array.isArray(analyzedSanitized.points_controle)
        ? analyzedSanitized.points_controle
        : [];

      const controlPointsData = points.map((cp, idx) => ({
        auditId: auditDbId,
        stepPosition,
        controlPointIndex: idx + 1,
        point: cp.point,
        statut: cp.statut,
        commentaire: cp.commentaire,
        minutages: Array.isArray(cp.minutages) ? cp.minutages : [],
        erreurTranscriptionNotee: Boolean(cp.erreur_transcription_notee),
        variationPhonetiqueUtilisee: cp.variation_phonetique_utilisee ?? null,
      }));

      const citationsData = points.flatMap((cp, idx) => {
        const controlPointIndex = idx + 1;
        const citations = Array.isArray(cp.citations) ? cp.citations : [];
        return citations.map((c, cIdx) => ({
          auditId: auditDbId,
          stepPosition,
          controlPointIndex,
          citationIndex: cIdx + 1,
          texte: c.texte,
          minutage: c.minutage,
          minutageSecondes: c.minutage_secondes,
          speaker: c.speaker,
          recordingIndex: c.recording_index,
          chunkIndex: c.chunk_index,
          recordingDate: c.recording_date,
          recordingTime: c.recording_time,
          recordingUrl: c.recording_url,
        }));
      });

      const rawResultMinimal = {
        step_metadata: analyzedSanitized.step_metadata,
        usage: analyzedSanitized.usage,
      };

      const upsert = prisma.auditStepResult.upsert({
        where: {
          auditId_stepPosition: {
            auditId: auditDbId,
            stepPosition,
          },
        },
        create: {
          auditId: auditDbId,
          stepPosition,
          stepName: stepDef.name || "",
          severityLevel: stepDef.severityLevel || "MEDIUM",
          isCritical: Boolean(stepDef.isCritical),
          weight: Number(stepDef.weight || 5),
          traite: Boolean(analyzedSanitized.traite),
          conforme: analyzedSanitized.conforme,
          score: Number(analyzedSanitized.score || 0),
          niveauConformite: analyzedSanitized.niveau_conformite,
          commentaireGlobal: analyzedSanitized.commentaire_global || "",
          motsClesTrouves: analyzedSanitized.mots_cles_trouves || [],
          minutages: analyzedSanitized.minutages || [],
          erreursTranscriptionTolerees: analyzedSanitized.erreurs_transcription_tolerees || 0,
          totalCitations,
          totalTokens: analyzedSanitized.usage?.total_tokens || 0,
          // Reduce raw JSON storage: persist points/citations in tables.
          rawResult: toPrismaJsonValue(rawResultMinimal),
        },
        update: {
          traite: Boolean(analyzedSanitized.traite),
          conforme: analyzedSanitized.conforme,
          score: Number(analyzedSanitized.score || 0),
          niveauConformite: analyzedSanitized.niveau_conformite,
          commentaireGlobal: analyzedSanitized.commentaire_global || "",
          motsClesTrouves: analyzedSanitized.mots_cles_trouves || [],
          minutages: analyzedSanitized.minutages || [],
          erreursTranscriptionTolerees: analyzedSanitized.erreurs_transcription_tolerees || 0,
          totalCitations,
          totalTokens: analyzedSanitized.usage?.total_tokens || 0,
          rawResult: toPrismaJsonValue(rawResultMinimal),
        },
      });

      const deleteControlPoints = prisma.auditStepResultControlPoint.deleteMany({
        where: { auditId: auditDbId, stepPosition },
      });

      await prisma.$transaction([
        upsert,
        deleteControlPoints,
        ...(controlPointsData.length > 0
          ? [
              prisma.auditStepResultControlPoint.createMany({
                data: controlPointsData,
                skipDuplicates: true,
              }),
            ]
          : []),
        ...(citationsData.length > 0
          ? [
              prisma.auditStepResultCitation.createMany({
                data: citationsData,
                skipDuplicates: true,
              }),
            ]
          : []),
      ]);

      logger.info("Audit step result persisted", {
        audit_db_id,
        audit_id,
        fiche_id,
        step_position: stepPosition,
        ok,
        elapsed_ms: Math.max(0, Date.now() - t0),
        control_points: points.length,
        citations: totalCitations,
        total_tokens: Number(analyzedSanitized.usage?.total_tokens || 0),
      });

      return { saved: true };
    });

    // Notify the finalizer/progress aggregator
    await step.sendEvent("emit-step-analyzed", {
      name: "audit/step.analyzed",
      data: {
        audit_db_id,
        audit_id,
        fiche_id,
        audit_config_id,
        step_position: stepPosition,
        ok,
        ...(ok ? {} : { error: stepErrorMessage || "Unknown error" }),
        ...(typeof use_rlm === "boolean" ? { use_rlm } : {}),
      },
    });

    return { ok, audit_db_id, step_position: stepPosition };
  }
);

/**
 * Audit Finalizer (Distributed)
 * =============================
 * Runs after each step completes; when all steps are present, it finalizes:
 * - citation enrichment
 * - evidence gating
 * - compliance calculation
 * - DB write + completion webhooks/events
 */
export const finalizeAuditFromStepsFunction = inngest.createFunction(
  {
    id: "audit-finalize-from-steps",
    name: "Finalize Audit from Step Results",
    retries: 2,
    timeouts: {
      finish: "30m",
    },
    concurrency: {
      // Prevent multiple finalizers racing for the same audit
      key: "event.data.audit_db_id",
      limit: 1,
    },
    onFailure: async ({ error, event }) => {
      // Best-effort: mark audit failed to avoid it being stuck in "running".
      try {
        const { prisma } = await import("../../shared/prisma.js");
        const auditDbId = getAuditDbIdFromEvent(event);
        if (auditDbId === null) {return;}
        await prisma.audit.update({
          where: { id: auditDbId },
          data: { status: "failed", errorMessage: error.message, completedAt: new Date() },
        });
      } catch {
        // ignore
      }
    },
  },
  { event: "audit/step.analyzed" },
  async ({ event, step, logger }) => {
    // NOTE: the Inngest event typing for this event may not include the optional
    // debugging fields we attach (step_position/ok/error). Cast to a local shape
    // so we can safely parse them without `never` narrowing issues.
    const eventData = event.data as unknown as {
      audit_db_id: string;
      audit_id: string;
      fiche_id: string;
      audit_config_id: string;
      use_rlm?: unknown;
      step_position?: unknown;
      ok?: unknown;
      error?: unknown;
    };

    const {
      audit_db_id,
      audit_id,
      fiche_id,
      audit_config_id,
      use_rlm,
      step_position,
      ok,
      error,
    } = eventData;
    const auditDbId = BigInt(audit_db_id);
    const useRlm = typeof use_rlm === "boolean" ? use_rlm : false;
    const transcriptMode = useRlm ? "tools" : "prompt";
    const approach = { use_rlm: useRlm, transcript_mode: transcriptMode } as const;
    const finalizerEventId = typeof event.id === "string" ? event.id : String(event.id ?? "");

    const tracer = createWorkflowTracer({
      workflow: "audit",
      entity: { type: "audit-finalizer", id: `${fiche_id}/db-${audit_db_id}` },
      traceId: typeof audit_id === "string" ? audit_id : String(audit_db_id),
      inngestEventId: finalizerEventId || undefined,
    });
    const wlog = createWorkflowLogger("audit-finalizer", `${fiche_id}/db-${audit_db_id}`, { tracer });
    wlog.start("finalize-audit", { audit_db_id, step_position, ok, error: error ?? undefined });

    const triggeringStepPosition =
      typeof step_position === "number" && Number.isFinite(step_position)
        ? Math.trunc(step_position)
        : typeof step_position === "string" && step_position.trim()
          ? Number.parseInt(step_position.trim(), 10)
          : null;
    const triggeringOk = typeof ok === "boolean" ? ok : null;
    const triggeringError =
      typeof error === "string" && error.trim() ? error.trim().slice(0, 500) : null;

    await step.run("log-finalizer-trigger", async () => {
      logger.info("Audit finalizer triggered", {
        audit_db_id,
        audit_id,
        fiche_id,
        audit_config_id,
        event_id: finalizerEventId,
        transcript_mode: transcriptMode,
        ...(triggeringStepPosition !== null ? { step_position: triggeringStepPosition } : {}),
        ...(triggeringOk !== null ? { ok: triggeringOk } : {}),
        ...(triggeringError ? { error: triggeringError } : {}),
      });
      return { logged: true };
    });

    // Load audit meta (JSON safe)
    const auditMeta = await step.run("load-audit-meta", async () => {
      const { prisma } = await import("../../shared/prisma.js");
      const a = await prisma.audit.findUnique({
        where: { id: auditDbId },
        select: {
          status: true,
          startedAt: true,
          completedAt: true,
        },
      });
      return a
        ? {
            status: a.status,
            startedAt: a.startedAt?.toISOString() || null,
            completedAt: a.completedAt?.toISOString() || null,
          }
        : null;
    });

    if (!auditMeta || auditMeta.status !== "running") {
      return { skipped: true, reason: "not-running" };
    }

    // Resolve audit config (prefer Redis cache)
    const redis = await getRedisClient();
    const base = `audit:${audit_db_id}`;
    let auditConfig: AuditConfigForAnalysis | null = null;
    let timeline: TimelineRecording[] | null = null;

    if (redis) {
      try {
        const [cfg, tl] = await redis.mGet([`${base}:config`, `${base}:timeline`]);
        if (cfg) {
          const parsed = safeJsonParse(cfg);
          if (isAuditConfigForAnalysis(parsed)) {auditConfig = parsed;}
        }
        if (tl) {
          const parsed = safeJsonParse(tl);
          if (Array.isArray(parsed)) {
            timeline = parsed as TimelineRecording[];
          }
        }
      } catch (err) {
        logger.warn("Failed to load finalizer context from Redis; will fall back to DB", {
          audit_db_id,
          error: (err as Error).message,
        });
      }
    }

    if (!auditConfig) {
      const { getAuditConfigById } = await import(
        "../audit-configs/audit-configs.repository.js"
      );
      const config = await getAuditConfigById(BigInt(audit_config_id));
      if (!config) {
        throw new NonRetriableError(`Audit config ${audit_config_id} not found`);
      }
      auditConfig = {
        id: config.id.toString(),
        name: config.name,
        description: config.description,
        systemPrompt: config.systemPrompt,
        auditSteps: config.steps,
      };
    }

    const totalSteps = auditConfig.auditSteps.length;

    // Count step results stored so far
    const counts = await step.run("count-step-results", async () => {
      const { prisma } = await import("../../shared/prisma.js");
      const rows = await prisma.auditStepResult.findMany({
        where: { auditId: auditDbId },
        select: { stepPosition: true, traite: true },
      });
      const completed = rows.length;
      const failed = rows.filter((r) => r.traite === false).length;
      const positions = rows.map((r) => r.stepPosition);
      return { completed, failed, positions };
    });

    // Inngest JSONifies step outputs; be defensive (some runtimes widen to number|null).
    const completedSteps =
      isRecord(counts) && typeof counts.completed === "number" ? counts.completed : 0;
    const failedStepsSoFar =
      isRecord(counts) && typeof counts.failed === "number" ? counts.failed : 0;
    const positionsRaw =
      isRecord(counts) && Array.isArray((counts as Record<string, unknown>).positions)
        ? ((counts as Record<string, unknown>).positions as unknown[])
        : [];
    const completedPositions = positionsRaw
      .filter((v): v is number => typeof v === "number" && Number.isFinite(v))
      .map((n) => Math.trunc(n));
    const completedSet = new Set(completedPositions);
    const expectedPositions = auditConfig.auditSteps
      .map((s) => s.position)
      .filter((n): n is number => typeof n === "number" && Number.isFinite(n))
      .map((n) => Math.trunc(n))
      .sort((a, b) => a - b);
    const missingPositions = expectedPositions.filter((p) => !completedSet.has(p));

    // Progress webhook (best-effort)
    await step.run("send-progress-update", async () => {
      try {
        await auditWebhooks.progress(
          audit_id,
          fiche_id,
          Math.min(completedSteps, totalSteps),
          totalSteps,
          failedStepsSoFar,
          "analysis",
          { audit_db_id, event_id: finalizerEventId, approach }
        );
      } catch {
        // ignore
      }
      return { notified: true };
    });

    if (completedSteps < totalSteps) {
      await step.run("log-finalizer-waiting", async () => {
        logger.info("Audit finalizer waiting for steps", {
          audit_db_id,
          audit_id,
          fiche_id,
          completed: completedSteps,
          total: totalSteps,
          failed: failedStepsSoFar,
          missing: Math.max(0, missingPositions.length),
          missing_sample: missingPositions.slice(0, 10),
        });
        return { logged: true };
      });
      return { waiting: true, completed: completedSteps, totalSteps };
    }

    // Load step raw results (do NOT return BigInt ids)
    const stepRows = await step.run("load-step-rows", async () => {
      const { prisma } = await import("../../shared/prisma.js");
      const rows = await prisma.auditStepResult.findMany({
        where: { auditId: auditDbId },
        orderBy: { stepPosition: "asc" },
        select: {
          stepPosition: true,
          stepName: true,
          severityLevel: true,
          isCritical: true,
          weight: true,                                                                                                                                                                                           
          traite: true,
          conforme: true,
          score: true,
          niveauConformite: true,
          commentaireGlobal: true,
          motsClesTrouves: true,
          minutages: true,
          erreursTranscriptionTolerees: true,
          totalTokens: true,
          rawResult: true,
          controlPoints: {
            orderBy: { controlPointIndex: "asc" },
            select: {
              controlPointIndex: true,
              point: true,
              statut: true,
              commentaire: true,
              minutages: true,
              erreurTranscriptionNotee: true,
              variationPhonetiqueUtilisee: true,
              citations: {
                orderBy: { citationIndex: "asc" },
                select: {
                  citationIndex: true,
                  texte: true,
                  minutage: true,
                  minutageSecondes: true,
                  speaker: true,
                  recordingIndex: true,
                  chunkIndex: true,
                  recordingDate: true,
                  recordingTime: true,
                  recordingUrl: true,
                },
              },
            },
          },
        },
      });
      return rows;
    });

    const stepResults: AnalyzeStepResult[] = stepRows.map((r) => {
      const raw = r.rawResult as unknown;
      // Back-compat: old rows still have the full step JSON in rawResult.
      if (raw && isAnalyzeStepResult(raw)) {return raw;}

      const stepPosition = toIntOr(r.stepPosition, 0) > 0 ? toIntOr(r.stepPosition, 0) : 1;
      const weight = toIntOr(r.weight, 5);

      const usageRaw =
        isRecord(raw) && isRecord(raw.usage)
          ? (raw.usage as Record<string, unknown>)
          : ({} as Record<string, unknown>);
      const totalTokensFallback = Number(r.totalTokens ?? 0);
      const usage = {
        prompt_tokens: toIntOr(usageRaw.prompt_tokens, 0),
        completion_tokens: toIntOr(usageRaw.completion_tokens, 0),
        total_tokens: toIntOr(usageRaw.total_tokens, totalTokensFallback),
      };

      const points = Array.isArray(r.controlPoints)
        ? r.controlPoints.map((cp) => ({
            point: cp.point,
            statut: cp.statut as ControlPoint["statut"],
            commentaire: cp.commentaire,
            citations: cp.citations.map((c) => ({
              texte: typeof c.texte === "string" ? c.texte : String(c.texte ?? ""),
              speaker: typeof c.speaker === "string" ? c.speaker : String(c.speaker ?? ""),
              minutage: typeof c.minutage === "string" ? c.minutage : String(c.minutage ?? ""),
              chunk_index:
                typeof c.chunkIndex === "number" && Number.isFinite(c.chunkIndex)
                  ? Math.trunc(c.chunkIndex)
                  : 0,
              recording_url:
                typeof c.recordingUrl === "string" ? c.recordingUrl : String(c.recordingUrl ?? "N/A"),
              recording_date:
                typeof c.recordingDate === "string" ? c.recordingDate : String(c.recordingDate ?? "N/A"),
              recording_time:
                typeof c.recordingTime === "string" ? c.recordingTime : String(c.recordingTime ?? "N/A"),
              recording_index:
                typeof c.recordingIndex === "number" && Number.isFinite(c.recordingIndex)
                  ? Math.trunc(c.recordingIndex)
                  : 0,
              minutage_secondes:
                typeof c.minutageSecondes === "number" && Number.isFinite(c.minutageSecondes)
                  ? c.minutageSecondes
                  : 0,
            })),
            minutages: cp.minutages,
            erreur_transcription_notee: cp.erreurTranscriptionNotee,
            variation_phonetique_utilisee: cp.variationPhonetiqueUtilisee ?? null,
          }))
        : [];

      // If we still couldn't load points (shouldn't happen for new audits), fall back to a safe placeholder.
      if (points.length === 0) {
        return fallbackAnalyzeStepResult({
          stepPosition,
          stepName: typeof r.stepName === "string" ? r.stepName : "",
          severity: toAuditSeverityLevel(r.severityLevel),
          isCritical: Boolean(r.isCritical),
          weight,
          controlPoints: [],
          message: "Missing step control points",
        });
      }

      return {
        traite: Boolean(r.traite),
        conforme: String(r.conforme),
        minutages: Array.isArray(r.minutages) ? r.minutages : [],
        score: Number(r.score ?? 0),
        points_controle: points,
        mots_cles_trouves: Array.isArray(r.motsClesTrouves) ? r.motsClesTrouves : [],
        commentaire_global: String(r.commentaireGlobal ?? ""),
        niveau_conformite: String(r.niveauConformite ?? "INSUFFISANT"),
        erreurs_transcription_tolerees: Number(r.erreursTranscriptionTolerees ?? 0),
        step_metadata: {
          position: stepPosition,
          name: typeof r.stepName === "string" ? r.stepName : "",
          severity: toAuditSeverityLevel(r.severityLevel),
          is_critical: Boolean(r.isCritical),
          weight,
        },
        usage,
      } as AnalyzeStepResult;
    });

    // Ensure we have a timeline for evidence gating + citation enrichment
    if (!timeline) {
      timeline = await rebuildTimelineFromDatabase(fiche_id);
    }

    // Enrich citations with recording metadata (date/time/url)
    const timelineMap = new Map<
      number,
      { recording_date: string; recording_time: string; recording_url: string }
    >(
      timeline.map((rec) => [
        rec.recording_index,
        {
          recording_date: rec.recording_date || "N/A",
          recording_time: rec.recording_time || "N/A",
          recording_url: rec.recording_url || "N/A",
        },
      ])
    );

    for (const stepResult of stepResults) {
      for (const controlPoint of stepResult.points_controle) {
        for (const citation of controlPoint.citations) {
          const meta = timelineMap.get(citation.recording_index);
          if (meta) {
            citation.recording_date = meta.recording_date;
            citation.recording_time = meta.recording_time;
            citation.recording_url = meta.recording_url;
          } else {
            citation.recording_date = "N/A";
            citation.recording_time = "N/A";
            citation.recording_url = "N/A";
          }
        }
      }
    }

    // Evidence gating (deterministic)
    const enabled = process.env.AUDIT_EVIDENCE_GATING !== "0";
    let gatedStepResults: AnalyzedAuditStepResult[] = stepResults;
    if (enabled) {
      const { validateAndGateAuditStepResults } = await import("./audits.evidence.js");
      const { stepResults: gated } = validateAndGateAuditStepResults({
        stepResults,
        timeline,
        enabled: true,
      });
      gatedStepResults = gated;
    }

    // Compliance calculation
    const { COMPLIANCE_THRESHOLDS } = await import("../../shared/constants.js");
    const totalWeight = auditConfig.auditSteps.reduce((sum, s) => sum + s.weight, 0);
    const earnedWeight = gatedStepResults.reduce((sum, s) => {
      const maxWeight = Math.max(0, Number(s.step_metadata?.weight ?? s.score ?? 0));
      const cappedScore = Math.min(Number(s.score ?? 0), maxWeight);
      return sum + cappedScore;
    }, 0);
    const score = totalWeight > 0 ? (earnedWeight / totalWeight) * 100 : 0;
    const criticalTotal = auditConfig.auditSteps.filter((s) => s.isCritical).length;
    const criticalPassed = gatedStepResults.filter(
      (s) => Boolean(s.step_metadata?.is_critical) && s.conforme === "CONFORME"
    ).length;
    let niveau = "INSUFFISANT";
    if (criticalPassed < criticalTotal) {
      niveau = "REJET";
    } else if (score >= COMPLIANCE_THRESHOLDS.EXCELLENT) {
      niveau = "EXCELLENT";
    } else if (score >= COMPLIANCE_THRESHOLDS.BON) {
      niveau = "BON";
    } else if (score >= COMPLIANCE_THRESHOLDS.ACCEPTABLE) {
      niveau = "ACCEPTABLE";
    }
    const compliance = {
      score: Number(score.toFixed(2)),
      niveau,
      points_critiques: `${criticalPassed}/${criticalTotal}`,
      poids_obtenu: earnedWeight,
      poids_total: totalWeight,
    };

    // Save audit result (DB) — idempotent because it updates same audit row
    const startedAtIso = auditMeta.startedAt || new Date().toISOString();
    const startedAtMs = auditMeta.startedAt ? Date.parse(auditMeta.startedAt) : Date.now();
    const durationMs = Math.max(0, Date.now() - startedAtMs);

    const cached = await getCachedFiche(fiche_id);
    if (!cached) {
      throw new Error("Fiche not cached - cannot finalize audit");
    }

    const timelineChunks = timeline.reduce((sum, r) => sum + (r.total_chunks || 0), 0);

    const totalTokens = gatedStepResults.reduce(
      (sum, r) => sum + Number(r.usage?.total_tokens || 0),
      0
    );

    const failedStepsFinal = gatedStepResults.filter((s) => s.traite === false).length;

    const auditData = {
      // Keep both IDs in the persisted JSON for easier correlation/debugging.
      audit_db_id,
      audit_tracking_id: audit_id,
      audit: {
        config: {
          id: auditConfig.id,
          name: auditConfig.name,
          description: auditConfig.description,
        },
        fiche: {
          fiche_id,
          prospect_name: (() => {
            const data = cached.rawData as { prospect?: { prenom?: string; nom?: string } };
            return `${data.prospect?.prenom || ""} ${data.prospect?.nom || ""}`.trim();
          })(),
          groupe: (() => {
            const data = cached.rawData as { information?: { groupe?: string } };
            return data.information?.groupe || "";
          })(),
        },
        results: {
          steps: gatedStepResults,
          compliance,
          approach: {
            use_rlm: useRlm,
            transcript_mode: transcriptMode,
          },
        },
        compliance,
        approach: {
          use_rlm: useRlm,
          transcript_mode: transcriptMode,
        },
      },
      statistics: {
        recordings_count: timeline.length,
        transcriptions_count: timeline.length,
        timeline_chunks: timelineChunks,
        successful_steps: gatedStepResults.length - failedStepsFinal,
        failed_steps: failedStepsFinal,
        total_time_seconds: 0,
        total_tokens: totalTokens,
      },
      metadata: {
        started_at: startedAtIso,
        completed_at: new Date().toISOString(),
        duration_ms: durationMs,
        approach: {
          use_rlm: useRlm,
          transcript_mode: transcriptMode,
        },
      },
    };

    // Persist audit + step summaries (rawResult is overwritten with final gated step)
    const { updateAuditWithResults } = await import("./audits.repository.js");
    await step.run("persist-audit-results", async () => {
      const t0 = Date.now();
      await updateAuditWithResults(auditDbId, auditData);
      const elapsedMs = Date.now() - t0;
      logger.info("Persisted audit results", {
        audit_db_id,
        fiche_id,
        steps: totalSteps,
        total_tokens: totalTokens,
        persist_elapsed_ms: elapsedMs,
      });
      return { ok: true, elapsedMs };
    });

    // Completion webhooks + event (best-effort; do not fail the finalizer)
    await step.run("notify-completion", async () => {
      try {
        await auditWebhooks.complianceCalculated(
          audit_id,
          fiche_id,
          `${compliance.poids_obtenu}/${compliance.poids_total}`,
          `${(compliance.score ?? 0).toFixed(2)}%`,
          compliance.niveau,
          compliance.niveau !== "REJET",
          compliance.points_critiques,
          { audit_db_id, event_id: finalizerEventId, approach }
        );

        await auditWebhooks.completed(
          audit_id,
          fiche_id,
          `${compliance.poids_obtenu}/${compliance.poids_total}`,
          `${(compliance.score ?? 0).toFixed(2)}%`,
          compliance.niveau,
          compliance.niveau !== "REJET",
          auditData.statistics.successful_steps,
          auditData.statistics.failed_steps,
          totalTokens,
          Math.round(durationMs / 1000),
          { audit_db_id, event_id: finalizerEventId, approach }
        );
      } catch {
        // ignore
      }
      return { notified: true };
    });

    await step.sendEvent("emit-audit-completed", {
      name: "audit/completed",
      data: {
        fiche_id,
        audit_id: audit_db_id,
        audit_db_id,
        audit_tracking_id: audit_id,
        audit_config_id: Number.parseInt(String(audit_config_id), 10),
        score: compliance.score || 0,
        niveau: compliance.niveau,
        duration_ms: durationMs,
        use_rlm: useRlm,
      },
    });

    // Cleanup Redis context (best-effort)
    if (redis) {
      try {
        const keys: string[] = [
          `${base}:config`,
          `${base}:timeline`,
          `${base}:timelineText`,
          `${base}:productInfo`,
        ];
        for (const s of auditConfig.auditSteps || []) {
          keys.push(`${base}:step:${s.position}:timelineText`);
        }
        await redis.del(keys);
      } catch {
        // ignore
      }
    }

    logger.info("Audit finalized from step results", {
      fiche_id,
      audit_db_id,
      totalSteps,
      score: compliance.score,
      niveau: compliance.niveau,
      durationMs,
    });

    return { finalized: true, audit_db_id };
  }
);

/**
 * Batch Audit Function
 * ====================
 * Fan-out pattern: dispatches individual audits and waits for completion
 */
export const batchAuditFunction = inngest.createFunction(
  {
    id: "batch-audit",
    name: "Batch Process Audits",
    retries: 1,
    timeouts: {
      finish: TIMEOUTS.BATCH_AUDIT,
    },
  },
  { event: "audit/batch" },
  async ({ event, step, logger }): Promise<BatchAuditResult> => {
    const {
      fiche_ids,
      audit_config_id,
      user_id,
      use_rlm,
      batch_id,
    } = event.data as typeof event.data & {
      use_rlm?: unknown;
      batch_id?: unknown;
    };
    const useRlm = typeof use_rlm === "boolean" ? use_rlm : false;
    const defaultAuditConfigId = audit_config_id || DEFAULT_AUDIT_CONFIG_ID;

    // Capture start time in a step to persist it across Inngest checkpoints
    const { startTime } = await step.run(
      "capture-batch-start-time",
      async (): Promise<{ startTime: number }> => {
        const now = Date.now();
        return {
          startTime: now,
        };
      }
    );

    const batchId =
      typeof batch_id === "string" && batch_id.trim().length > 0
        ? batch_id.trim()
        : typeof event.id === "string" && event.id.trim().length > 0
          ? event.id.trim()
          : `batch-${startTime}`;

    logger.info("Starting batch audit", {
      total: fiche_ids.length,
      audit_config_id: defaultAuditConfigId,
      user_id,
    });

    // Send batch started webhook
    await step.run("send-batch-started", async () => {
      await batchWebhooks.progress(batchId, "audit", fiche_ids.length, 0, 0);
      return { notified: true };
    });

    // Fan-out: Send events in parallel
    // Setup Redis-backed batch tracking (optional but recommended for correct progress/completion).
    // The per-audit finalizer emits `audit/completed`; we use that to advance the batch.
    let redis = null as Awaited<ReturnType<typeof getRedisClient>>;
    try {
      redis = await getRedisClient();
    } catch {
      redis = null;
    }

    if (redis) {
      const ttlSeconds = Math.max(
        60,
        Number(process.env.AUDIT_BATCH_STATE_TTL_SECONDS || 6 * 60 * 60)
      );
      const metaKey = `audit:batch:${batchId}:meta`;
      const pendingKey = `audit:batch:${batchId}:pending`;

      await step.run("init-batch-state", async () => {
        const multi = redis!.multi();
        multi.hSet(metaKey, {
          batch_id: batchId,
          operation_type: "audit",
          total: String(fiche_ids.length),
          succeeded: "0",
          failed: "0",
          audit_config_id: String(defaultAuditConfigId),
          started_at_ms: String(startTime),
        });

        if (fiche_ids.length > 0) {
          multi.sAdd(pendingKey, fiche_ids);
        }

        multi.expire(metaKey, ttlSeconds);
        multi.expire(pendingKey, ttlSeconds);

        // Index: (config, fiche) -> batchId (helps lookup on audit/completed|failed)
        for (const ficheId of fiche_ids) {
          multi.setEx(
            `audit:batch:index:${defaultAuditConfigId}:${ficheId}`,
            ttlSeconds,
            batchId
          );
        }

        await multi.exec();
        return { ok: true };
      });
    } else {
      logger.warn("Redis not configured; batch audit completion webhooks may be unavailable", {
        batchId,
      });
    }

    const batchEvents = fiche_ids.map((fiche_id) => ({
      name: "audit/run" as const,
      data: {
        fiche_id,
        audit_config_id: defaultAuditConfigId,
        ...(typeof user_id === "string" && user_id ? { user_id } : {}),
        trigger_source: "batch",
        use_rlm: useRlm,
      },
      id: `batch-${batchId}-audit-${fiche_id}-${defaultAuditConfigId}`,
    }));

    const sendResult = await step.sendEvent("fan-out-audits", batchEvents);

    await step.run("log-batch-audit-fan-out", async () => {
      const ids =
        isRecord(sendResult) && Array.isArray(sendResult.ids)
          ? (sendResult.ids as unknown[]).filter((v): v is string => typeof v === "string")
          : [];
      logger.info("Dispatched all audit events", {
        batch_id: batchId,
        count: fiche_ids.length,
        ids_count: ids.length,
        ids_sample: ids.slice(0, 5),
      });
      return { logged: true, idsCount: ids.length };
    });

    // Wait for all audits to complete
    return {
      success: true,
      total_fiches: fiche_ids.length,
      audit_config_id: defaultAuditConfigId,
      total: fiche_ids.length,
      succeeded: 0,
      failed: 0,
    };
  }
);

/**
 * Batch Audit Progress Updater (on audit/completed)
 * ================================================
 * Updates Redis-backed batch counters and emits batch webhooks/events when done.
 */
export const batchAuditProgressOnCompletedFunction = inngest.createFunction(
  {
    id: "batch-audit-progress-completed",
    name: "Batch Audit Progress (Completed)",
    retries: 2,
    timeouts: {
      finish: "30m",
    },
    concurrency: [
      {
        limit: Math.max(
          1,
          Number(
            process.env.BATCH_AUDIT_PROGRESS_CONCURRENCY || DEFAULT_GLOBAL_CONCURRENCY
          )
        ),
      },
      { key: "event.data.fiche_id", limit: 1 },
    ],
  },
  { event: "audit/completed" },
  async ({ event, step, logger }) => {
    const { fiche_id, audit_config_id } = event.data;

    const redis = await getRedisClient();
    if (!redis) {return { skipped: true, reason: "redis_not_configured" };}

    const indexKey = `audit:batch:index:${audit_config_id}:${fiche_id}`;
    const batchId = await step.run(`lookup-batch-${fiche_id}`, async () => {
      return await redis.get(indexKey);
    });
    if (!batchId) {return { skipped: true, reason: "not_in_batch" };}

    const metaKey = `audit:batch:${batchId}:meta`;
    const pendingKey = `audit:batch:${batchId}:pending`;
    const finalizedKey = `audit:batch:${batchId}:finalized`;

    const removed = await step.run(`pending-remove-${batchId}-${fiche_id}`, async () => {
      return await redis.sRem(pendingKey, fiche_id);
    });
    if (!removed) {return { duplicate: true, batchId, fiche_id };}

    const snapshot = await step.run(`update-and-snapshot-${batchId}-${fiche_id}`, async () => {
      const multi = redis.multi();
      multi.hIncrBy(metaKey, "succeeded", 1);
      multi.sCard(pendingKey);
      await multi.exec();

      const [meta, remaining] = await Promise.all([
        redis.hGetAll(metaKey),
        redis.sCard(pendingKey),
      ]);
      return { meta: meta as Record<string, string>, remaining };
    });

    const total = Number(snapshot.meta.total || 0);
    const succeeded = Number(snapshot.meta.succeeded || 0);
    const failed = Number(snapshot.meta.failed || 0);
    const remaining = typeof snapshot.remaining === "number" ? snapshot.remaining : Number(snapshot.remaining || 0);

    await step.run(`send-batch-progress-${batchId}-${succeeded + failed}`, async () => {
      try {
        await batchWebhooks.progress(batchId, "audit", total, succeeded + failed, failed);
      } catch {
        // ignore
      }
      return { notified: true };
    });

    if (remaining > 0) {
      return { ok: true, batchId, total, succeeded, failed, remaining };
    }

    const finalized = await step.run(`finalize-once-${batchId}`, async () => {
      const r = await redis.set(finalizedKey, "1", { NX: true, EX: 6 * 60 * 60 });
      return r === "OK";
    });
    if (!finalized) {return { already_finalized: true, batchId };}

    const startedAtMs = Number(snapshot.meta.started_at_ms || Date.now());
    const durationMs = Math.max(0, Date.now() - startedAtMs);

    await step.run(`send-batch-completed-${batchId}`, async () => {
      try {
        await batchWebhooks.completed(batchId, "audit", total, succeeded + failed, failed, durationMs);
      } catch {
        // ignore
      }
      return { notified: true };
    });
    await step.sendEvent(`emit-batch-completed-${batchId}`, {
      name: "audit/batch.completed",
      data: {
        batch_id: batchId,
        total,
        succeeded,
        failed,
        audit_config_id,
      },
      id: `audit-batch-completed-${batchId}`,
    });
    // Send batch completion webhook
    logger.info("Batch audit finalized", { batchId, total, succeeded, failed, durationMs });
    return { finalized: true, batchId };
  }
);

/**
 * Batch Audit Progress Updater (on audit/failed)
 * ================================================
 */
export const batchAuditProgressOnFailedFunction = inngest.createFunction(
  {
    id: "batch-audit-progress-failed",
    name: "Batch Audit Progress (Failed)",
    retries: 2,
    timeouts: {
      finish: "30m",
    },
    concurrency: [
      {
        limit: Math.max(
          1,
          Number(
            process.env.BATCH_AUDIT_PROGRESS_CONCURRENCY || DEFAULT_GLOBAL_CONCURRENCY
          )
        ),
      },
      { key: "event.data.fiche_id", limit: 1 },
    ],
  },
  { event: "audit/failed" },
  async ({ event, step, logger }) => {
    const { fiche_id, audit_config_id } = event.data;

    const redis = await getRedisClient();
    if (!redis) {return { skipped: true, reason: "redis_not_configured" };}

    const indexKey = `audit:batch:index:${audit_config_id}:${fiche_id}`;
    const batchId = await step.run(`lookup-batch-failed-${fiche_id}`, async () => {
      return await redis.get(indexKey);
    });
    if (!batchId) {return { skipped: true, reason: "not_in_batch" };}

    const metaKey = `audit:batch:${batchId}:meta`;
    const pendingKey = `audit:batch:${batchId}:pending`;
    const finalizedKey = `audit:batch:${batchId}:finalized`;

    const removed = await step.run(`pending-remove-failed-${batchId}-${fiche_id}`, async () => {
      return await redis.sRem(pendingKey, fiche_id);
    });
    if (!removed) {return { duplicate: true, batchId, fiche_id };}

    const snapshot = await step.run(`update-and-snapshot-failed-${batchId}-${fiche_id}`, async () => {
      const multi = redis.multi();
      multi.hIncrBy(metaKey, "failed", 1);
      multi.sCard(pendingKey);
      await multi.exec();

      const [meta, remaining] = await Promise.all([
        redis.hGetAll(metaKey),
        redis.sCard(pendingKey),
      ]);
      return { meta: meta as Record<string, string>, remaining };
    });

    const total = Number(snapshot.meta.total || 0);
    const succeeded = Number(snapshot.meta.succeeded || 0);
    const failed = Number(snapshot.meta.failed || 0);
    const remaining = typeof snapshot.remaining === "number" ? snapshot.remaining : Number(snapshot.remaining || 0);

    await step.run(`send-batch-progress-failed-${batchId}-${succeeded + failed}`, async () => {
      try {
        await batchWebhooks.progress(batchId, "audit", total, succeeded + failed, failed);
      } catch {
        // ignore
      }
      return { notified: true };
    });

    if (remaining > 0) {
      return { ok: false, batchId, total, succeeded, failed, remaining };
    }

    const finalized = await step.run(`finalize-once-failed-${batchId}`, async () => {
      const r = await redis.set(finalizedKey, "1", { NX: true, EX: 6 * 60 * 60 });
      return r === "OK";
    });
    if (!finalized) {return { already_finalized: true, batchId };}

    const startedAtMs = Number(snapshot.meta.started_at_ms || Date.now());
    const durationMs = Math.max(0, Date.now() - startedAtMs);

    await step.run(`send-batch-completed-failed-${batchId}`, async () => {
      try {
        await batchWebhooks.completed(batchId, "audit", total, succeeded + failed, failed, durationMs);
      } catch {
        // ignore
      }
      return { notified: true };
    });

    // Send batch completion event
    await step.sendEvent(`emit-batch-completed-failed-${batchId}`, {
      name: "audit/batch.completed",
      data: {
        batch_id: batchId,
        total,
        succeeded,
        failed,
        audit_config_id,
      },
      id: `audit-batch-completed-${batchId}`,
    });

    logger.info("Batch audit finalized (with failures)", { batchId, total, succeeded, failed, durationMs });
    return { finalized: true, batchId };
  }
);

export const functions = [
  runAuditFunction,
  auditStepAnalyzeFunction,
  finalizeAuditFromStepsFunction,
  batchAuditFunction,
  batchAuditProgressOnCompletedFunction,
  batchAuditProgressOnFailedFunction,
];