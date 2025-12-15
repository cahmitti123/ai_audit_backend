/**
 * Audits Workflows
 * ================
 * Inngest workflow functions for audit operations
 */

import { inngest } from "../../inngest/client.js";
import { NonRetriableError } from "inngest";
import { getCachedFiche } from "../fiches/fiches.repository.js";
import { getFicheTranscriptionStatus } from "../transcriptions/transcriptions.service.js";
import { isFullyTranscribed } from "../transcriptions/transcriptions.types.js";
import { fetchFicheFunction } from "../fiches/fiches.workflows.js";
import { transcribeFicheFunction } from "../transcriptions/transcriptions.workflows.js";
import type {
  AuditFunctionResult,
  BatchAuditResult,
} from "./audits.schemas.js";
import {
  CONCURRENCY,
  TIMEOUTS,
  DEFAULT_AUDIT_CONFIG_ID,
} from "../../shared/constants.js";
import {
  getInngestGlobalConcurrency,
  getInngestParallelismPerServer,
} from "../../shared/inngest-concurrency.js";
import { auditWebhooks, batchWebhooks } from "../../shared/webhook.js";
import { logger as appLogger } from "../../shared/logger.js";
import {
  logPayloadSize,
  getPayloadSize,
  formatBytes,
  PAYLOAD_LIMITS,
} from "../../utils/payload-size.js";
import { getRedisClient } from "../../shared/redis.js";
import type { Prisma } from "@prisma/client";
import type { FicheDetailsResponse } from "../fiches/fiches.schemas.js";
import type {
  ControlPoint,
  TimelineRecording,
  Transcription,
  TranscriptionWord,
} from "../../schemas.js";
import type {
  AuditConfigForAnalysis,
  AuditSeverityLevel,
  AuditStepDefinition,
  ProductLinkResult,
} from "./audits.types.js";
import type { analyzeStep as analyzeStepFn } from "./audits.analyzer.js";
import type { AnalyzedAuditStepResult } from "./audits.evidence.js";

type AnalyzeStepResult = Awaited<ReturnType<typeof analyzeStepFn>>;

const DEFAULT_GLOBAL_CONCURRENCY = getInngestGlobalConcurrency();
const DEFAULT_PER_ENTITY_CONCURRENCY = getInngestParallelismPerServer();

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
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

function hasWordsArray(value: unknown): value is { words: unknown[] } {
  return (
    typeof value === "object" &&
    value !== null &&
    Array.isArray((value as { words?: unknown }).words)
  );
}

function getRawCallId(value: unknown): string | null {
  if (!isRecord(value)) return null;
  const call_id = value.call_id;
  if (typeof call_id === "string" && call_id) return call_id;
  const callId = value.callId;
  if (typeof callId === "string" && callId) return callId;
  return null;
}

function getAuditDbIdFromEvent(event: unknown): bigint | null {
  const data =
    isRecord(event) && isRecord(event.data) ? (event.data as Record<string, unknown>) : null;
  const raw = data?.audit_db_id;

  if (typeof raw === "bigint") return raw;
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
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function toIntOr(value: unknown, fallback: number): number {
  const n = toNumberOr(value, fallback);
  return Number.isFinite(n) ? Math.trunc(n) : fallback;
}

function getRawRecordingsFromFicheRawData(rawData: unknown): unknown[] {
  if (!isRecord(rawData)) return [];
  const recordings = rawData.recordings;
  return Array.isArray(recordings) ? recordings : [];
}

function normalizeTimelineRecordings(value: unknown): TimelineRecording[] {
  if (!Array.isArray(value)) return [];

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
  if (!isRecord(value)) return false;
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
  if (!isRecord(value)) return false;
  if (typeof value.id !== "string") return false;
  if (typeof value.name !== "string") return false;
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
  if (!Array.isArray(value.auditSteps)) return false;
  return value.auditSteps.every(isAuditStepDefinition);
}

function isProductLinkResult(value: unknown): value is ProductLinkResult {
  if (!isRecord(value)) return false;
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
  if (!isRecord(value)) return null;
  const wordsRaw = value.words;
  if (!Array.isArray(wordsRaw) || wordsRaw.length === 0) return null;

  const words: TranscriptionWord[] = [];
  for (const w of wordsRaw) {
    if (!isRecord(w)) continue;
    const text = typeof w.text === "string" ? w.text : null;
    const start = typeof w.start === "number" ? w.start : null;
    const end = typeof w.end === "number" ? w.end : null;
    const type = typeof w.type === "string" ? w.type : "word";
    const speaker_id =
      typeof w.speaker_id === "string" ? (w.speaker_id as string) : undefined;
    const logprob = typeof w.logprob === "number" ? w.logprob : undefined;

    if (text === null || start === null || end === null) continue;

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
  if (textWords.length === 0) return [];

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
  const { getRecordingsByFiche } = await import(
    "../recordings/recordings.repository.js"
  );
  const { generateTimeline } = await import("./audits.timeline.js");
  const { enrichRecording } = await import("../../utils/recording-parser.js");

  const cached = await getCachedFiche(ficheId);
  if (!cached) throw new Error("Fiche not cached");

  const dbRecordings = await getRecordingsByFiche(ficheId);
  const rawRecordings = getRawRecordingsFromFicheRawData(cached.rawData);

  const transcriptions: Transcription[] = [];
  for (const dbRec of dbRecordings) {
    const rec: DbRecordingForTimeline = {
      callId: dbRec.callId,
      hasTranscription: dbRec.hasTranscription,
      transcriptionId: dbRec.transcriptionId,
      transcriptionText: dbRec.transcriptionText,
      transcriptionData: dbRec.transcriptionData,
      durationSeconds: dbRec.durationSeconds,
    };

    if (!rec.hasTranscription || !rec.transcriptionId) continue;

    const rawRec = rawRecordings.find((r) => getRawCallId(r) === rec.callId);
    if (!rawRec || !isRecord(rawRec)) continue;

    const enrichedRec = enrichRecording(rawRec);
    const url = enrichedRec.recording_url;
    if (!url) continue;

    const transcription = buildTranscriptionPayload(rec);
    if (!transcription) continue;

    transcriptions.push({
      recording_url: url,
      transcription_id: rec.transcriptionId,
      call_id: rec.callId,
      recording: enrichedRec,
      transcription,
    });
  }

  return generateTimeline(transcriptions);
}

function toPrismaJsonValue(value: unknown): Prisma.InputJsonValue {
  const json: unknown = JSON.parse(JSON.stringify(value));
  return json as Prisma.InputJsonValue;
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
  if (!isRecord(value)) return false;
  if (typeof value.traite !== "boolean") return false;
  if (typeof value.conforme !== "string") return false;
  if (typeof value.score !== "number") return false;
  if (!Array.isArray(value.points_controle)) return false;
  if (!isRecord(value.step_metadata)) return false;
  if (!isRecord(value.usage)) return false;
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

      // Try to mark audit as failed in database
      try {
        const { prisma } = await import("../../shared/prisma.js");

        // Find the most recent running audit for this fiche+config
        const runningAudit = await prisma.audit.findFirst({
          where: {
            ficheCache: { ficheId: fiche_id },
            auditConfigId: BigInt(audit_config_id),
            status: "running",
          },
          orderBy: { createdAt: "desc" },
        });

        if (runningAudit) {
          const { markAuditAsFailed } = await import("./audits.repository.js");
          await markAuditAsFailed(runningAudit.id, error.message);
          appLogger.info("Marked audit as failed in database", {
            audit_id: String(runningAudit.id),
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
        await auditWebhooks.failed("audit-failed", fiche_id, error.message);
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
        },
      });
    },
  },
  { event: "audit/run" },
  async ({ event, step, logger }): Promise<AuditFunctionResult> => {
    const { fiche_id, audit_config_id, user_id } = event.data;
    // Capture start time in a step to persist it across Inngest checkpoints
    const { startTime, auditId } = await step.run(
      "capture-start-time",
      async (): Promise<{ startTime: number; auditId: string }> => {
        const now = Date.now();
        return {
          startTime: now,
          auditId: `audit-${fiche_id}-${audit_config_id}-${now}`,
        };
      }
    );

    logger.info("Starting audit", {
      audit_id: auditId,
      fiche_id,
      audit_config_id,
      user_id,
    });

    // Step 1: Ensure fiche is fetched
    const ficheData = await step.run("ensure-fiche", async () => {
      const cached = await getCachedFiche(fiche_id);

      if (!cached || cached.expiresAt < new Date()) {
        logger.info("Fiche not cached, triggering fetch", { fiche_id });
        return null;
      }

      logger.info("Fiche already cached", { fiche_id });
      return cached;
    });

    // If not cached, invoke fetch function
    if (!ficheData) {
      logger.info("Invoking fiche fetch function", { fiche_id });

      await step.invoke("fetch-fiche", {
        function: fetchFicheFunction,
        data: {
          fiche_id,
        },
      });

      logger.info("Fiche fetch completed", { fiche_id });
    }

    // Step 2: Ensure transcriptions
    const transcriptionStatus = await step.run(
      "check-transcription-status",
      async () => {
        return await getFicheTranscriptionStatus(fiche_id);
      }
    );

    // Check if transcription is complete
    const isComplete =
      transcriptionStatus.total !== null &&
      transcriptionStatus.total > 0 &&
      transcriptionStatus.transcribed === transcriptionStatus.total;

    if (!isComplete) {
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

      logger.info("Transcription completed", { fiche_id });
    } else {
      logger.info("All recordings already transcribed", {
        fiche_id,
        count: transcriptionStatus.total,
      });
    }

    // Step 3: Load audit configuration
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

    logger.info("Audit config loaded", {
      config_name: auditConfig.name,
      total_steps: auditConfig.auditSteps.length,
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

      const { getCachedFiche } = await import("../fiches/fiches.repository.js");
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
        auditId
      );

      logger.info("Audit record created", {
        audit_db_id: String(createdAudit.id),
        status: "running",
      });

      // Return as string to avoid BigInt serialization issues with Inngest
      return String(createdAudit.id);
    });

    const timelinePromise = step.run(
      "generate-timeline",
      async (): Promise<{ timeline: TimelineRecording[]; timelineText: string }> => {
        logger.info("Building timeline from database", { fiche_id });
        const { buildTimelineText } = await import("./audits.prompts.js");
        const timeline = await rebuildTimelineFromDatabase(fiche_id);
        const timelineText = buildTimelineText(timeline);

        // Log payload sizes for monitoring (Inngest step data limit is 4MB)
        const timelineSize = getPayloadSize(timeline);
        const timelineTextSize = getPayloadSize(timelineText);
        const returnSize = getPayloadSize({ timeline, timelineText });

        logger.info("Timeline data sizes", {
          timeline: formatBytes(timelineSize),
          timelineText: formatBytes(timelineTextSize),
          total_return: formatBytes(returnSize),
          inngest_step_limit: formatBytes(PAYLOAD_LIMITS.INNGEST_STEP),
          percentage_of_limit: Math.round(
            (returnSize / PAYLOAD_LIMITS.INNGEST_STEP) * 100
          ),
        });

        // Warn if approaching Inngest step limit
        if (returnSize > PAYLOAD_LIMITS.INNGEST_STEP * 0.8) {
          logger.warn("⚠️  Timeline data approaching Inngest step limit!", {
            size: formatBytes(returnSize),
            limit: formatBytes(PAYLOAD_LIMITS.INNGEST_STEP),
            percentage: Math.round(
              (returnSize / PAYLOAD_LIMITS.INNGEST_STEP) * 100
            ),
          });
        }

        return { timeline, timelineText };
      }
    );

    const auditDbId = await auditDbIdPromise;

    // Send audit started webhook
    await step.run("send-started-webhook", async () => {
      await auditWebhooks.started(
        auditId,
        fiche_id,
        String(audit_config_id),
        auditConfig.name,
        auditConfig.auditSteps.length
      );
      return { notified: true };
    });

    const productInfo = await productInfoPromise;
    const { timeline: timelineRaw, timelineText } = await timelinePromise;

    const timeline = normalizeTimelineRecordings(timelineRaw);

    logger.info("Timeline generated", {
      recordings: timeline.length,
      chunks: timeline.reduce((sum, r) => sum + (r.total_chunks || 0), 0),
    });

    // Send progress: Timeline ready
    await step.run("send-progress-timeline", async () => {
      await auditWebhooks.progress(
        auditId,
        fiche_id,
        0, // No steps completed yet
        auditConfig.auditSteps.length,
        0, // No failures yet
        "timeline"
      );
      return { notified: true };
    });

    // Step 5: Cache context (timeline + config) for distributed workers
    await step.run("cache-audit-context", async () => {
      const redis = await getRedisClient();
      if (!redis) {
        logger.warn("Redis not configured; step fan-out will fall back to DB rebuilds", {
          fiche_id,
          audit_db_id: auditDbId,
        });
        return { cached: false };
      }

      const ttlSeconds = Math.max(
        60,
        Number(process.env.AUDIT_CONTEXT_TTL_SECONDS || 6 * 60 * 60)
      );
      const base = `audit:${auditDbId}`;

      const multi = redis.multi();
      multi.setEx(`${base}:config`, ttlSeconds, JSON.stringify(auditConfig));
      multi.setEx(`${base}:timeline`, ttlSeconds, JSON.stringify(timeline));
      multi.setEx(`${base}:timelineText`, ttlSeconds, timelineText);
      if (productInfo) {
        multi.setEx(`${base}:productInfo`, ttlSeconds, JSON.stringify(productInfo));
      }

      // Optionally precompute per-step timeline excerpts (token/cost optimization)
      const { buildTimelineExcerptText } = await import("./audits.prompts.js");
      const excerptEnabled = process.env.AUDIT_STEP_TIMELINE_EXCERPT !== "0";
      const maxChunks = Math.max(
        10,
        Number(process.env.AUDIT_STEP_TIMELINE_MAX_CHUNKS || 40)
      );

      for (const auditStep of auditConfig.auditSteps || []) {
        if (!excerptEnabled || auditStep.verifyProductInfo !== true) continue;
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
      return { cached: true, ttlSeconds };
    });

    // Step 6: Fan-out one event per step so work can be spread across replicas
    await step.sendEvent(
      "fan-out-audit-steps",
      auditConfig.auditSteps.map((s) => ({
        name: "audit/step.analyze",
        data: {
          audit_db_id: String(auditDbId),
          audit_id: auditId,
          fiche_id,
          audit_config_id,
          step_position: s.position,
        },
        // Idempotent per audit+step
        id: `audit-step-${auditDbId}-${s.position}`,
      }))
    );

    logger.info("Audit step fan-out dispatched", {
      fiche_id,
      audit_db_id: auditDbId,
      steps: auditConfig.auditSteps.length,
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
    const { audit_db_id, audit_id, fiche_id, audit_config_id, step_position } =
      event.data;

    const auditDbId = BigInt(audit_db_id);
    const stepPosition = Number(step_position);

    // Idempotency: skip if already analyzed (prevents duplicate webhooks + spend)
    const { prisma } = await import("../../shared/prisma.js");
    const existing = await prisma.auditStepResult.findUnique({
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
    let auditStep: AuditStepDefinition | null = null;

    if (redis) {
      try {
        const [cfg, prod, perStepText, fullText] = await redis.mGet([
          `${base}:config`,
          `${base}:productInfo`,
          `${base}:step:${stepPosition}:timelineText`,
          `${base}:timelineText`,
        ]);

        if (cfg) {
          const parsed = safeJsonParse(cfg);
          if (isAuditConfigForAnalysis(parsed)) auditConfig = parsed;
        }
        if (prod) {
          const parsed = safeJsonParse(prod);
          productInfo = isProductLinkResult(parsed) ? parsed : null;
        }
        timelineText = perStepText || fullText || null;

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
    if (!timelineText) {
      logger.warn("Timeline text missing from Redis; rebuilding from DB", {
        audit_db_id,
        fiche_id,
      });

      const { buildTimelineText } = await import("./audits.prompts.js");
      const timeline = await rebuildTimelineFromDatabase(fiche_id);
      timelineText = buildTimelineText(timeline);
    }

    // Freeze narrowed values for use inside the async `step.run` callback.
    // TS can't guarantee captured variables won't change before the callback runs.
    const auditConfigForStep = auditConfig;
    const timelineTextForStep = timelineText;
    if (!timelineTextForStep) {
      throw new NonRetriableError(`Timeline text missing for fiche ${fiche_id}`);
    }

    // Analyze step (LLM) with graceful failure fallback.
    // IMPORTANT: keep the expensive LLM call inside `step.run` so retries don't re-call OpenAI.
    const analysis = await step.run(`analyze-step-${stepPosition}`, async () => {
      try {
        const { analyzeStep } = await import("./audits.analyzer.js");
        const analyzed = await analyzeStep(
          stepDef,
          auditConfigForStep,
          timelineTextForStep,
          audit_id,
          fiche_id,
          productInfo
        );
        return { ok: true, analyzed, errorMessage: undefined as string | undefined };
      } catch (err) {
        const errorMessage = (err as Error).message || String(err);

        // Best-effort webhook; never fail the step due to webhook delivery issues.
        try {
          await auditWebhooks.stepFailed(
            audit_id,
            fiche_id,
            stepPosition,
            stepDef.name || `Step ${stepPosition}`,
            errorMessage
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
          message: `Step failed: ${errorMessage}`,
        });

        return { ok: false, analyzed, errorMessage };
      }
    });

    let ok = analysis.ok;
    let errorMessage = analysis.errorMessage;

    // `step.run` returns a JSON-serializable value; validate + normalize to our schema type.
    const analyzedUnknown: unknown = analysis.analyzed;
    const analyzed: AnalyzeStepResult = isAnalyzeStepResult(analyzedUnknown)
      ? analyzedUnknown
      : (() => {
          ok = false;
          errorMessage =
            errorMessage || "Analyze step returned invalid result payload";
          return fallbackAnalyzeStepResult({
            stepPosition,
            stepName: stepDef.name || "",
            severity: stepDef.severityLevel || "MEDIUM",
            isCritical: Boolean(stepDef.isCritical),
            weight: Number(stepDef.weight || 5),
            controlPoints: Array.isArray(stepDef.controlPoints)
              ? stepDef.controlPoints
              : [],
            message: `Step failed: ${errorMessage}`,
          });
        })();

    const totalCitations = countCitations(analyzed.points_controle);

    // Persist step output for finalization
    await step.run("upsert-step-result", async () => {
      const { prisma } = await import("../../shared/prisma.js");

      await prisma.auditStepResult.upsert({
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
          traite: Boolean(analyzed.traite),
          conforme: analyzed.conforme,
          score: Number(analyzed.score || 0),
          niveauConformite: analyzed.niveau_conformite,
          commentaireGlobal: analyzed.commentaire_global || "",
          motsClesTrouves: analyzed.mots_cles_trouves || [],
          minutages: analyzed.minutages || [],
          erreursTranscriptionTolerees: analyzed.erreurs_transcription_tolerees || 0,
          totalCitations,
          totalTokens: analyzed.usage?.total_tokens || 0,
          rawResult: toPrismaJsonValue(analyzed),
        },
        update: {
          traite: Boolean(analyzed.traite),
          conforme: analyzed.conforme,
          score: Number(analyzed.score || 0),
          niveauConformite: analyzed.niveau_conformite,
          commentaireGlobal: analyzed.commentaire_global || "",
          motsClesTrouves: analyzed.mots_cles_trouves || [],
          minutages: analyzed.minutages || [],
          erreursTranscriptionTolerees: analyzed.erreurs_transcription_tolerees || 0,
          totalCitations,
          totalTokens: analyzed.usage?.total_tokens || 0,
          rawResult: toPrismaJsonValue(analyzed),
        },
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
        ...(ok ? {} : { error: errorMessage }),
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
        if (auditDbId === null) return;
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
    const { audit_db_id, audit_id, fiche_id, audit_config_id } = event.data;
    const auditDbId = BigInt(audit_db_id);

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
          if (isAuditConfigForAnalysis(parsed)) auditConfig = parsed;
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
      const completed = await prisma.auditStepResult.count({
        where: { auditId: auditDbId },
      });
      const failed = await prisma.auditStepResult.count({
        where: { auditId: auditDbId, traite: false },
      });
      return { completed, failed };
    });

    // Inngest JSONifies step outputs; be defensive (some runtimes widen to number|null).
    const completedSteps =
      isRecord(counts) && typeof counts.completed === "number" ? counts.completed : 0;
    const failedStepsSoFar =
      isRecord(counts) && typeof counts.failed === "number" ? counts.failed : 0;

    // Progress webhook (best-effort)
    await step.run("send-progress-update", async () => {
      try {
        await auditWebhooks.progress(
          audit_id,
          fiche_id,
          Math.min(completedSteps, totalSteps),
          totalSteps,
          failedStepsSoFar,
          "analysis"
        );
      } catch {
        // ignore
      }
      return { notified: true };
    });

    if (completedSteps < totalSteps) {
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
          rawResult: true,
        },
      });
      return rows;
    });

    const stepResults: AnalyzeStepResult[] = stepRows.map((r) => {
      const raw = r.rawResult as unknown;
      if (raw && isAnalyzeStepResult(raw)) return raw;
      const stepPosition = toIntOr(r.stepPosition, 0);
      const weight = toIntOr(r.weight, 5);
      return fallbackAnalyzeStepResult({
        stepPosition: stepPosition > 0 ? stepPosition : 1,
        stepName: typeof r.stepName === "string" ? r.stepName : "",
        severity: toAuditSeverityLevel(r.severityLevel),
        isCritical: Boolean(r.isCritical),
        weight,
        controlPoints: [],
        message: "Missing step rawResult",
      });
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

    const { getCachedFiche } = await import("../fiches/fiches.repository.js");
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
        },
        compliance,
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
      },
    };

    // Persist audit + step summaries (rawResult is overwritten with final gated step)
    const { updateAuditWithResults } = await import("./audits.repository.js");
    await updateAuditWithResults(auditDbId, auditData);

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
          compliance.points_critiques
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
          Math.round(durationMs / 1000)
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
        audit_config_id,
        score: compliance.score || 0,
        niveau: compliance.niveau,
        duration_ms: durationMs,
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
    const { fiche_ids, audit_config_id, user_id } = event.data;
    const defaultAuditConfigId = audit_config_id || DEFAULT_AUDIT_CONFIG_ID;

    // Capture start time in a step to persist it across Inngest checkpoints
    const { startTime, batchId } = await step.run(
      "capture-batch-start-time",
      async (): Promise<{ startTime: number; batchId: string }> => {
        const now = Date.now();
        return {
          startTime: now,
          batchId: `batch-${now}`,
        };
      }
    );

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

    await step.sendEvent(
      "fan-out-audits",
      fiche_ids.map((fiche_id) => ({
        name: "audit/run",
        data: {
          fiche_id,
          audit_config_id: defaultAuditConfigId,
          user_id,
        },
        id: `batch-${batchId}-audit-${fiche_id}-${defaultAuditConfigId}`,
      }))
    );

    logger.info("Dispatched all audit events", {
      count: fiche_ids.length,
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
    if (!redis) return { skipped: true, reason: "redis_not_configured" };

    const indexKey = `audit:batch:index:${audit_config_id}:${fiche_id}`;
    const batchId = await step.run(`lookup-batch-${fiche_id}`, async () => {
      return await redis.get(indexKey);
    });
    if (!batchId) return { skipped: true, reason: "not_in_batch" };

    const metaKey = `audit:batch:${batchId}:meta`;
    const pendingKey = `audit:batch:${batchId}:pending`;
    const finalizedKey = `audit:batch:${batchId}:finalized`;

    const removed = await step.run(`pending-remove-${batchId}-${fiche_id}`, async () => {
      return await redis.sRem(pendingKey, fiche_id);
    });
    if (!removed) return { duplicate: true, batchId, fiche_id };

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
    if (!finalized) return { already_finalized: true, batchId };

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
    if (!redis) return { skipped: true, reason: "redis_not_configured" };

    const indexKey = `audit:batch:index:${audit_config_id}:${fiche_id}`;
    const batchId = await step.run(`lookup-batch-failed-${fiche_id}`, async () => {
      return await redis.get(indexKey);
    });
    if (!batchId) return { skipped: true, reason: "not_in_batch" };

    const metaKey = `audit:batch:${batchId}:meta`;
    const pendingKey = `audit:batch:${batchId}:pending`;
    const finalizedKey = `audit:batch:${batchId}:finalized`;

    const removed = await step.run(`pending-remove-failed-${batchId}-${fiche_id}`, async () => {
      return await redis.sRem(pendingKey, fiche_id);
    });
    if (!removed) return { duplicate: true, batchId, fiche_id };

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
    if (!finalized) return { already_finalized: true, batchId };

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