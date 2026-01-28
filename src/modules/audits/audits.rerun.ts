/**
 * Audit Step Re-Run Service
 * ===========================
 * Allows re-running a single audit step with optional custom prompt
 */

import type { Prisma } from "@prisma/client";

import type { TimelineRecording, TranscriptionWord } from "../../schemas.js";
import { COMPLIANCE_THRESHOLDS } from "../../shared/constants.js";
import { logger } from "../../shared/logger.js";
import { prisma } from "../../shared/prisma.js";
import { buildConversationChunksFromWords } from "../../utils/transcription-chunks.js";
import { getAuditConfigById } from "../audit-configs/audit-configs.repository.js";
import { getRecordingsWithTranscriptionChunksByFiche } from "../recordings/recordings.repository.js";
import { analyzeStep } from "./audits.analyzer.js";
import type { AnalyzedAuditStepResult } from "./audits.evidence.js";
import { validateAndGateAuditStepResults } from "./audits.evidence.js";
import { buildTimelineText } from "./audits.prompts.js";
import {
  getAuditById,
  getAuditComplianceInputs,
  updateAuditComplianceSummary,
} from "./audits.repository.js";
import {
  extractLegacyHumanReviewEntries,
  extractLegacyRerunHistoryEntries,
  legacyHumanReviewsToRows,
  legacyRerunHistoryToRows,
} from "./audits.trails.js";
import type { AuditConfigForAnalysis, AuditStepDefinition, ProductLinkResult } from "./audits.types.js";

export interface RerunStepOptions {
  auditId: bigint;
  stepPosition: number;
  customPrompt?: string; // User's additional instructions
  customInstructions?: string; // Alternative way to provide guidance
}

type RerunAnalyzedStep = Awaited<ReturnType<typeof analyzeStep>>;

export interface RerunStepResult {
  success: boolean;
  originalStep: {
    score: number;
    conforme: string;
    commentaire: string;
    citations: number;
  };
  rerunStep: RerunAnalyzedStep;
  comparison: {
    scoreChanged: boolean;
    conformeChanged: boolean;
    citationsChanged: boolean;
    originalScore: number;
    newScore: number;
    originalConforme: string;
    newConforme: string;
  };
  metadata: {
    rerunAt: string;
    durationMs: number;
    tokensUsed: number;
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Remove null bytes (\u0000) from strings so Postgres can store them safely.
 */
function sanitizeNullBytes(data: unknown): unknown {
  if (data === null || data === undefined) {return data;}
  // eslint-disable-next-line no-control-regex -- Intentionally remove null bytes for safe Postgres storage
  if (typeof data === "string") {return data.replace(/\u0000/g, "");}
  if (Array.isArray(data)) {return data.map((v) => sanitizeNullBytes(v));}
  if (typeof data === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(data as Record<string, unknown>)) {
      out[k] = sanitizeNullBytes(v);
    }
    return out;
  }
  return data;
}

function computeAuditComplianceFromSteps(params: {
  stepResults: Array<{ isCritical: boolean; weight: number; score: number; conforme: string }>;
}): {
  scorePercentage: number;
  niveau: string;
  isCompliant: boolean;
  criticalPassed: number;
  criticalTotal: number;
} {
  const totalWeight = params.stepResults.reduce(
    (sum, s) => sum + Math.max(0, Number(s.weight)),
    0
  );
  const earnedWeight = params.stepResults.reduce((sum, s) => {
    const maxWeight = Math.max(0, Number(s.weight));
    const rawScore = Number(s.score);
    const capped = Math.min(Math.max(0, rawScore), maxWeight);
    return sum + capped;
  }, 0);
  const score = totalWeight > 0 ? (earnedWeight / totalWeight) * 100 : 0;

  const criticalTotal = params.stepResults.filter((s) => Boolean(s.isCritical)).length;
  const criticalPassed = params.stepResults.filter(
    (s) => Boolean(s.isCritical) && s.conforme === "CONFORME"
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

  return {
    scorePercentage: Number(score.toFixed(2)),
    niveau,
    isCompliant: niveau !== "REJET",
    criticalPassed,
    criticalTotal,
  };
}

/**
 * Regenerate timeline from database for a fiche
 */
async function regenerateTimelineFromDatabase(ficheId: string) {
  logger.info("Regenerating timeline from DB", { fiche_id: ficheId });

  // Load recordings with transcriptions
  const dbRecordings = await getRecordingsWithTranscriptionChunksByFiche(ficheId);
  logger.info("Loaded recordings from database", {
    fiche_id: ficheId,
    recordings: dbRecordings.length,
  });

  const hasWordsArray = (value: unknown): value is { words: unknown[] } =>
    typeof value === "object" &&
    value !== null &&
    Array.isArray((value as { words?: unknown }).words);

  const timeline: TimelineRecording[] = [];

  for (const dbRec of dbRecordings) {
    if (!dbRec.hasTranscription) {continue;}
    if (!dbRec.recordingUrl) {continue;}

    // Prefer normalized chunks (stable + avoids huge word-level JSON).
    let chunks = dbRec.transcriptionChunks.map((c) => ({
      chunk_index: c.chunkIndex,
      start_timestamp: c.startTimestamp,
      end_timestamp: c.endTimestamp,
      message_count: c.messageCount,
      speakers: c.speakers,
      full_text: c.fullText,
    }));

    if (chunks.length === 0) {
      // Legacy fallback: derive chunks from word-level payload or from plain text.
      let words: TranscriptionWord[] | null = null;

      const dbPayload = dbRec.transcriptionData as unknown;
      if (hasWordsArray(dbPayload) && dbPayload.words.length > 0) {
        const mapped = (dbPayload.words as unknown[]).map((w) => {
          if (!isRecord(w)) {return null;}
          const text = typeof w.text === "string" ? w.text : null;
          const start = typeof w.start === "number" ? w.start : null;
          const end = typeof w.end === "number" ? w.end : null;
          const type = typeof w.type === "string" ? w.type : "word";
          const speaker_id =
            typeof w.speaker_id === "string" ? (w.speaker_id as string) : undefined;
          const logprob = typeof w.logprob === "number" ? w.logprob : undefined;
          if (text === null || start === null || end === null) {return null;}
          return {
            text,
            start,
            end,
            type,
            ...(speaker_id ? { speaker_id } : {}),
            ...(logprob !== undefined ? { logprob } : {}),
          } satisfies TranscriptionWord;
        });
        words = mapped.filter((v): v is TranscriptionWord => v !== null);
      }

      if (!words || words.length === 0) {
        const text = dbRec.transcriptionText;
        if (typeof text === "string" && text.trim().length > 0) {
          const textWords = text.split(/\s+/).filter(Boolean);
          const durationSeconds =
            typeof dbRec.durationSeconds === "number" && dbRec.durationSeconds > 0
              ? dbRec.durationSeconds
              : Math.max(1, Math.round(textWords.length * 0.5));
          const wordDur = Math.max(0.05, durationSeconds / Math.max(1, textWords.length));
          words = textWords.map((word, idx) => ({
            text: word,
            start: idx * wordDur,
            end: (idx + 1) * wordDur,
            type: "word",
            speaker_id: idx % 20 < 10 ? "speaker_0" : "speaker_1",
          }));
        }
      }

      if (!words || words.length === 0) {continue;}

      chunks = buildConversationChunksFromWords(words);
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

  const timelineText = buildTimelineText(timeline);

  logger.info("Timeline regenerated", {
    fiche_id: ficheId,
    recordings: timeline.length,
    chunks: timeline.reduce((sum, r) => sum + r.total_chunks, 0),
  });

  return { timeline, timelineText };
}

/**
 * Rerun a single audit step
 */
export async function rerunAuditStep(
  options: RerunStepOptions
): Promise<RerunStepResult> {
  const startTime = Date.now();

  logger.info("Re-running audit step", {
    audit_id: String(options.auditId),
    step_position: options.stepPosition,
  });

  // 1. Load original audit
  const audit = await getAuditById(options.auditId);
  if (!audit) {
    throw new Error(`Audit ${options.auditId} not found`);
  }

  const ficheId = audit.ficheCache.ficheId;
  logger.debug("Rerun context", { fiche_id: ficheId });

  // 2. Find original step result
  const originalStepResult = audit.stepResults.find(
    (s) => s.stepPosition === options.stepPosition
  );
  if (!originalStepResult) {
    throw new Error(
      `Step ${options.stepPosition} not found in audit ${options.auditId}`
    );
  }
  logger.debug("Original step", {
    step_position: options.stepPosition,
    step_name: originalStepResult.stepName,
  });

  // 3. Load audit configuration
  const auditConfig = await getAuditConfigById(audit.auditConfigId);
  if (!auditConfig) {
    throw new Error(`Audit config ${audit.auditConfigId} not found`);
  }

  const auditConfigData: AuditConfigForAnalysis = {
    id: auditConfig.id.toString(),
    name: auditConfig.name,
    description: auditConfig.description,
    systemPrompt: auditConfig.systemPrompt,
    auditSteps: auditConfig.steps,
  };

  // 4. Find step definition
  const stepDef = auditConfigData.auditSteps.find(
    (s) => s.position === options.stepPosition
  );
  if (!stepDef) {
    throw new Error(`Step definition not found for position ${options.stepPosition}`);
  }

  // 5. Regenerate timeline from database
  const { timeline, timelineText } = await regenerateTimelineFromDatabase(ficheId);

  // 6. Link to product if needed
  let productInfo: ProductLinkResult | null = null;
  if (stepDef.verifyProductInfo) {
    logger.info("Linking fiche to product database (rerun)", { fiche_id: ficheId });
    try {
      const { linkFicheToProduct } = await import(
        "../products/products.service.js"
      );
      const linkResult = (await linkFicheToProduct(ficheId)) as ProductLinkResult;
      if (linkResult.matched && linkResult.formule) {
        productInfo = linkResult;
        logger.info("Product matched (rerun)", {
          fiche_id: ficheId,
          formule: linkResult.formule.libelle,
        });
      }
    } catch (error: unknown) {
      logger.warn("Product linking failed (rerun)", {
        fiche_id: ficheId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  // 7. Add custom prompt if provided
  const stepForAnalysis: AuditStepDefinition =
    options.customPrompt || options.customInstructions
      ? {
          ...stepDef,
          customInstructions: `\n\n📝 INSTRUCTIONS SPÉCIFIQUES DE L'UTILISATEUR:\n${
            options.customPrompt || options.customInstructions
          }`,
        }
      : stepDef;

  if (options.customPrompt || options.customInstructions) {
    logger.info("Custom instructions added (rerun)", {
      audit_id: String(options.auditId),
      step_position: options.stepPosition,
    });
  }

  // 8. Re-analyze step
  logger.info("Re-analyzing step (rerun)", {
    audit_id: String(options.auditId),
    fiche_id: ficheId,
    step_position: options.stepPosition,
  });
  const rerunResult = await analyzeStep(
    stepForAnalysis,
    auditConfigData,
    timelineText,
    `rerun-${options.auditId}-step-${options.stepPosition}`,
    ficheId,
    productInfo,
    { timeline }
  );

  // Evidence gating (deterministic) to avoid hallucinated citations being persisted.
  const gatingEnabled = process.env.AUDIT_EVIDENCE_GATING !== "0";
  const gated = gatingEnabled
    ? validateAndGateAuditStepResults({
        stepResults: [rerunResult as unknown as AnalyzedAuditStepResult],
        timeline,
        enabled: true,
      }).stepResults[0]
    : rerunResult;

  const duration = Date.now() - startTime;

  // 9. Compare results
  const rerunCitations = (() => {
    if (!isRecord(gated)) {return 0;}
    const points = gated.points_controle;
    if (!Array.isArray(points)) {return 0;}
    return points.reduce((sum, pc) => {
      if (!isRecord(pc)) {return sum;}
      const citations = pc.citations;
      return sum + (Array.isArray(citations) ? citations.length : 0);
    }, 0);
  })();

  const newScore = (() => {
    if (!isRecord(gated)) {return 0;}
    const raw = gated.score;
    const n = typeof raw === "number" ? raw : Number(raw);
    return Number.isFinite(n) ? n : 0;
  })();

  const newConforme = (() => {
    if (!isRecord(gated)) {return "UNKNOWN";}
    const c = gated.conforme;
    return typeof c === "string" ? c : "UNKNOWN";
  })();

  const tokensUsed = (() => {
    if (!isRecord(gated)) {return 0;}
    const usage = gated.usage;
    if (!isRecord(usage)) {return 0;}
    const total = usage.total_tokens;
    return typeof total === "number" && Number.isFinite(total) ? total : 0;
  })();

  const comparison = {
    scoreChanged: originalStepResult.score !== newScore,
    conformeChanged: originalStepResult.conforme !== newConforme,
    citationsChanged: originalStepResult.totalCitations !== rerunCitations,
    originalScore: originalStepResult.score,
    newScore,
    originalConforme: originalStepResult.conforme,
    newConforme,
  };

  logger.info("Re-run complete", {
    audit_id: String(options.auditId),
    fiche_id: ficheId,
    step_position: options.stepPosition,
    original: `${comparison.originalScore}/${stepDef.weight} (${comparison.originalConforme})`,
    rerun: `${comparison.newScore}/${stepDef.weight} (${comparison.newConforme})`,
    score_changed: comparison.scoreChanged,
  });

  return {
    success: true,
    originalStep: {
      score: originalStepResult.score,
      conforme: originalStepResult.conforme,
      commentaire: originalStepResult.commentaireGlobal,
      citations: originalStepResult.totalCitations,
    },
    rerunStep: gated as RerunAnalyzedStep,
    comparison,
    metadata: {
      rerunAt: new Date().toISOString(),
      durationMs: duration,
      tokensUsed,
    },
  };
}

/**
 * Save rerun result and optionally update audit
 */
export async function saveRerunResult(
  options: RerunStepOptions,
  rerunResult: RerunStepResult,
  updateAudit: boolean = false,
  meta?: { rerunId?: string | null; eventId?: string | null }
): Promise<{ saved: boolean; auditUpdated: boolean }> {
  const toPrismaJsonValue = (value: unknown): Prisma.InputJsonValue => {
    const json: unknown = JSON.parse(JSON.stringify(sanitizeNullBytes(value)));
    return json as Prisma.InputJsonValue;
  };

  const existing = await prisma.auditStepResult.findUnique({
    where: {
      auditId_stepPosition: {
        auditId: options.auditId,
        stepPosition: options.stepPosition,
      },
    },
  });

  if (!existing) {
    logger.warn("Audit step result not found for rerun save", {
      audit_id: options.auditId.toString(),
      step_position: options.stepPosition,
    });
    return { saved: false, auditUpdated: false };
  }

  const now = new Date();
  const customPrompt =
    (options.customPrompt && options.customPrompt.trim()
      ? options.customPrompt.trim()
      : undefined) ??
    (options.customInstructions && options.customInstructions.trim()
      ? options.customInstructions.trim()
      : undefined);

  const step = rerunResult.rerunStep;
  const points = Array.isArray(step?.points_controle) ? step.points_controle : [];
  const totalCitations = points.reduce(
    (sum: number, pc: unknown) =>
      sum + (isRecord(pc) && Array.isArray(pc.citations) ? pc.citations.length : 0),
    0
  );

  const rawScore = Number(step?.score ?? 0);
  const maxWeight = Math.max(0, Number(existing.weight));
  const score = Math.min(Math.max(0, Math.round(rawScore)), maxWeight);

  // One-time migration for this step: if trails still live inside rawResult,
  // backfill them into tables before writing the new entry (to avoid losing history).
  const legacyHuman = extractLegacyHumanReviewEntries(existing.rawResult as unknown);
  const legacyRerun = extractLegacyRerunHistoryEntries(existing.rawResult as unknown);

  const existingHumanCount =
    legacyHuman.length > 0
      ? await prisma.auditStepResultHumanReview.count({
          where: { auditId: options.auditId, stepPosition: options.stepPosition },
        })
      : 0;

  const existingRerunCount =
    legacyRerun.length > 0
      ? await prisma.auditStepResultRerunEvent.count({
          where: { auditId: options.auditId, stepPosition: options.stepPosition },
        })
      : 0;

  const legacyHumanRows =
    existingHumanCount === 0 && legacyHuman.length > 0
      ? legacyHumanReviewsToRows({
          auditId: options.auditId,
          stepPosition: options.stepPosition,
          entries: legacyHuman,
          fallbackDate: now,
        })
      : [];

  const legacyRerunRows =
    existingRerunCount === 0 && legacyRerun.length > 0
      ? legacyRerunHistoryToRows({
          auditId: options.auditId,
          stepPosition: options.stepPosition,
          entries: legacyRerun,
          fallbackDate: now,
        })
      : [];

  const rerunEventRow = {
    auditId: options.auditId,
    stepPosition: options.stepPosition,
    occurredAt: now,
    kind: "step_rerun",
    rerunId: meta?.rerunId ?? null,
    eventId: meta?.eventId ?? null,
    customPrompt: customPrompt ?? null,
    previousScore: existing.score,
    previousConforme: existing.conforme,
    previousTotalCitations: existing.totalCitations,
    nextScore: score,
    nextConforme: String(step?.conforme ?? existing.conforme),
    nextTotalCitations: totalCitations,
  };

  // Reduce raw JSON storage: keep only meta (audit trails are stored in tables).
  const nextRaw: Record<string, unknown> = {
    step_metadata: isRecord(step) ? (step.step_metadata as unknown) : null,
    usage: isRecord(step) ? (step.usage as unknown) : null,
  };

  const controlPointsData = points
    .map((cp, idx) => {
      if (!isRecord(cp)) {return null;}
      return {
        auditId: options.auditId,
        stepPosition: options.stepPosition,
        controlPointIndex: idx + 1,
        point: typeof cp.point === "string" ? cp.point : "",
        statut: typeof cp.statut === "string" ? cp.statut : "ABSENT",
        commentaire: typeof cp.commentaire === "string" ? cp.commentaire : "",
        minutages: Array.isArray(cp.minutages)
          ? cp.minutages.filter((v): v is string => typeof v === "string")
          : [],
        erreurTranscriptionNotee: Boolean(cp.erreur_transcription_notee),
        variationPhonetiqueUtilisee:
          typeof cp.variation_phonetique_utilisee === "string"
            ? cp.variation_phonetique_utilisee
            : null,
      };
    })
    .filter((v): v is NonNullable<typeof v> => v !== null);

  const citationsData = points.flatMap((cp, cpIdx) => {
    if (!isRecord(cp)) {return [];}
    const controlPointIndex = cpIdx + 1;
    const citationsRaw = Array.isArray(cp.citations) ? cp.citations : [];
    return citationsRaw
      .map((c, cIdx) => {
        if (!isRecord(c)) {return null;}
        return {
          auditId: options.auditId,
          stepPosition: options.stepPosition,
          controlPointIndex,
          citationIndex: cIdx + 1,
          texte: typeof c.texte === "string" ? c.texte : "",
          minutage: typeof c.minutage === "string" ? c.minutage : "",
          minutageSecondes:
            typeof c.minutage_secondes === "number" ? c.minutage_secondes : 0,
          speaker: typeof c.speaker === "string" ? c.speaker : "",
          recordingIndex:
            typeof c.recording_index === "number" ? Math.trunc(c.recording_index) : 0,
          chunkIndex: typeof c.chunk_index === "number" ? Math.trunc(c.chunk_index) : 0,
          recordingDate:
            typeof c.recording_date === "string" ? c.recording_date : "N/A",
          recordingTime:
            typeof c.recording_time === "string" ? c.recording_time : "N/A",
          recordingUrl:
            typeof c.recording_url === "string" ? c.recording_url : "N/A",
        };
      })
      .filter((v): v is NonNullable<typeof v> => v !== null);
  });

  await prisma.$transaction([
    ...(legacyHumanRows.length > 0
      ? [prisma.auditStepResultHumanReview.createMany({ data: legacyHumanRows })]
      : []),
    ...(legacyRerunRows.length > 0
      ? [prisma.auditStepResultRerunEvent.createMany({ data: legacyRerunRows })]
      : []),
    prisma.auditStepResultRerunEvent.create({ data: rerunEventRow }),
    prisma.auditStepResult.update({
      where: {
        auditId_stepPosition: {
          auditId: options.auditId,
          stepPosition: options.stepPosition,
        },
      },
      data: {
        traite: Boolean(step?.traite),
        conforme: String(sanitizeNullBytes(String(step?.conforme ?? existing.conforme))),
        score,
        niveauConformite: String(
          sanitizeNullBytes(String(step?.niveau_conformite ?? existing.niveauConformite))
        ),
        commentaireGlobal: String(
          sanitizeNullBytes(String(step?.commentaire_global ?? existing.commentaireGlobal))
        ),
        motsClesTrouves: Array.isArray(step?.mots_cles_trouves)
          ? step.mots_cles_trouves
              .filter((v: unknown): v is string => typeof v === "string")
              .map((s: string) => String(sanitizeNullBytes(s)))
          : existing.motsClesTrouves,
        minutages: Array.isArray(step?.minutages)
          ? step.minutages
              .filter((v: unknown): v is string => typeof v === "string")
              .map((s: string) => String(sanitizeNullBytes(s)))
          : existing.minutages,
        erreursTranscriptionTolerees: Number.isFinite(step?.erreurs_transcription_tolerees)
          ? Math.max(0, Math.round(step.erreurs_transcription_tolerees))
          : existing.erreursTranscriptionTolerees,
        totalCitations,
        totalTokens: Number(step?.usage?.total_tokens ?? existing.totalTokens) || 0,
        // Reduce raw JSON storage: keep only meta (audit trails are normalized).
        rawResult: toPrismaJsonValue(nextRaw),
      },
    }),
    prisma.auditStepResultControlPoint.deleteMany({
      where: { auditId: options.auditId, stepPosition: options.stepPosition },
    }),
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

  if (!updateAudit) {
    return { saved: true, auditUpdated: false };
  }

  const complianceInputs = await getAuditComplianceInputs(options.auditId);
  if (complianceInputs) {
    const compliance = computeAuditComplianceFromSteps({
      stepResults: complianceInputs.stepResults,
    });
    try {
      await updateAuditComplianceSummary(options.auditId, compliance);
    } catch (err) {
      // Best-effort: do not block storing the rerun.
      const errorMessage = err instanceof Error ? err.message : String(err);
      logger.warn("Failed to update audit compliance after rerun", {
        audit_id: options.auditId.toString(),
        step_position: options.stepPosition,
        error: errorMessage,
      });
    }
  }

  return { saved: true, auditUpdated: true };
}



