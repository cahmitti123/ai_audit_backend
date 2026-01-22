/**
 * Audit Control Point (Sub-step) Re-Run Service
 * =============================================
 * Re-runs a SINGLE control point ("point de contrôle") inside an existing audit step.
 *
 * Key requirement: contextualisation
 * - Use the same audit config step definition
 * - Rebuild timeline from DB (authoritative transcript)
 * - Include product context when relevant
 * - Include the previous control point result as context
 * - Append user-provided instructions (custom prompt)
 */

import type { Prisma } from "@prisma/client";

import type {
  ControlPoint,
  TimelineRecording,
  Transcription,
  TranscriptionWord,
} from "../../schemas.js";
import { COMPLIANCE_THRESHOLDS } from "../../shared/constants.js";
import { logger } from "../../shared/logger.js";
import { prisma } from "../../shared/prisma.js";
import { enrichRecording } from "../../utils/recording-parser.js";
import { getAuditConfigById } from "../audit-configs/audit-configs.repository.js";
import { getCachedFiche } from "../fiches/fiches.repository.js";
import type { FicheDetailsResponse } from "../fiches/fiches.schemas.js";
import { getRecordingsByFiche } from "../recordings/recordings.repository.js";
import { analyzeStep } from "./audits.analyzer.js";
import type { AnalyzedAuditStepResult } from "./audits.evidence.js";
import { validateAndGateAuditStepResults } from "./audits.evidence.js";
import { buildTimelineText } from "./audits.prompts.js";
import {
  getAuditById,
  getAuditComplianceInputs,
  updateAuditComplianceSummary,
} from "./audits.repository.js";
import { generateTimeline } from "./audits.timeline.js";
import type { AuditConfigForAnalysis, AuditStepDefinition, ProductLinkResult } from "./audits.types.js";

export interface RerunControlPointOptions {
  auditId: bigint;
  stepPosition: number;
  /**
   * 1-based index into the step's configured `controlPoints` array.
   */
  controlPointIndex: number;
  customPrompt?: string;
  customInstructions?: string;
}

type AnalyzeStepResult = Awaited<ReturnType<typeof analyzeStep>>;

export interface RerunControlPointResult {
  success: boolean;
  auditId: string;
  ficheId: string;
  stepPosition: number;
  stepName: string;
  controlPointIndex: number;
  controlPointText: string;
  originalControlPoint: {
    statut: string;
    commentaire: string;
    citations: number;
    minutages: string[];
  } | null;
  rerunControlPoint: ControlPoint;
  comparison: {
    statutChanged: boolean;
    citationsChanged: boolean;
    originalStatut: string | null;
    newStatut: string;
    originalCitations: number | null;
    newCitations: number;
  };
  metadata: {
    rerunAt: string;
    durationMs: number;
    tokensUsed: number;
  };
  /**
   * The full (single-control-point) step payload returned by the analyzer.
   * Useful for debugging and downstream consumers.
   */
  rerunStep: AnalyzeStepResult;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeForMatch(s: string): string {
  return String(s || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function toStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
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

function toPrismaJsonValue(value: unknown): Prisma.InputJsonValue {
  const json: unknown = JSON.parse(JSON.stringify(sanitizeNullBytes(value)));
  return json as Prisma.InputJsonValue;
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

function scoreFromControlPoints(
  points: Array<{ statut?: unknown }>,
  weight: number
): { ratio: number; derivedScore: number } {
  const applicable = points.filter((p) => p.statut !== "NON_APPLICABLE");
  if (applicable.length === 0) {
    return { ratio: 1, derivedScore: Math.max(0, Math.round(weight)) };
  }

  const total = applicable.reduce((sum, p) => {
    if (p.statut === "PRESENT") {return sum + 1;}
    if (p.statut === "PARTIEL") {return sum + 0.5;}
    return sum + 0;
  }, 0);

  const ratio = total / applicable.length;
  const derivedScore = Math.max(0, Math.min(weight, Math.round(ratio * weight)));
  return { ratio, derivedScore };
}

function conformeFromRatio(ratio: number): "CONFORME" | "PARTIEL" | "NON_CONFORME" {
  if (ratio >= 0.85) {return "CONFORME";}
  if (ratio >= 0.4) {return "PARTIEL";}
  return "NON_CONFORME";
}

function niveauFromConforme(
  conforme: "CONFORME" | "PARTIEL" | "NON_CONFORME",
  ratio: number
): "EXCELLENT" | "BON" | "ACCEPTABLE" | "INSUFFISANT" | "REJET" {
  if (conforme === "CONFORME") {return ratio >= 0.95 ? "EXCELLENT" : "BON";}
  if (conforme === "PARTIEL") {return "ACCEPTABLE";}
  return "INSUFFISANT";
}

function deriveStepFromControlPoints(params: {
  points: Array<{ statut?: unknown; citations?: unknown }>;
  weight: number;
}): {
  ratio: number;
  score: number;
  conforme: "CONFORME" | "PARTIEL" | "NON_CONFORME";
  niveauConformite: "EXCELLENT" | "BON" | "ACCEPTABLE" | "INSUFFISANT" | "REJET";
  totalCitations: number;
  minutages: string[];
} {
  const { ratio, derivedScore } = scoreFromControlPoints(params.points, params.weight);
  const conforme = conformeFromRatio(ratio);
  const niveauConformite = niveauFromConforme(conforme, ratio);

  const stepMins = new Set<string>();
  let totalCitations = 0;
  for (const cp of params.points) {
    const citations = Array.isArray(cp.citations) ? cp.citations : [];
    totalCitations += citations.length;
    for (const c of citations) {
      if (!isRecord(c)) {continue;}
      const minutage = c.minutage;
      if (typeof minutage === "string" && minutage.trim()) {stepMins.add(minutage.trim());}
    }
  }

  return {
    ratio,
    score: derivedScore,
    conforme,
    niveauConformite,
    totalCitations,
    minutages: Array.from(stepMins),
  };
}

/**
 * Regenerate timeline from database for a fiche (authoritative source).
 * (Mostly duplicated from `audits.rerun.ts` to keep rerun logic independent.)
 */
async function regenerateTimelineFromDatabase(ficheId: string): Promise<{
  timeline: TimelineRecording[];
  timelineText: string;
}> {
  logger.info("Regenerating timeline from DB (control point rerun)", { fiche_id: ficheId });

  const ficheCache = await getCachedFiche(ficheId);
  if (!ficheCache) {
    throw new Error(`Fiche ${ficheId} not found in cache`);
  }

  const dbRecordings = await getRecordingsByFiche(ficheId);
  logger.info("Loaded recordings from database (control point rerun)", {
    fiche_id: ficheId,
    recordings: dbRecordings.length,
  });

  const ficheData = ficheCache.rawData as unknown as FicheDetailsResponse;
  const rawRecordings = ficheData.recordings || [];

  const transcriptions: Transcription[] = [];

  const hasWordsArray = (value: unknown): value is { words: unknown[] } =>
    typeof value === "object" &&
    value !== null &&
    Array.isArray((value as { words?: unknown }).words);

  for (const dbRec of dbRecordings) {
    if (!dbRec.hasTranscription || !dbRec.transcriptionId) {continue;}

    const rawRec = rawRecordings.find((r) => {
      const maybe = r as { call_id?: unknown; callId?: unknown };
      const callId =
        typeof maybe.call_id === "string"
          ? maybe.call_id
          : typeof maybe.callId === "string"
            ? maybe.callId
            : null;
      return callId === dbRec.callId;
    });
    if (!rawRec) {continue;}

    const enrichedRec = enrichRecording(rawRec);
    const url = enrichedRec.recording_url;
    if (!url) {continue;}

    let transcriptionData: {
      text: string;
      language_code?: string;
      words: TranscriptionWord[];
    } | null = null;

    const dbPayload = dbRec.transcriptionData;
    if (
      dbPayload &&
      typeof dbPayload === "object" &&
      hasWordsArray(dbPayload) &&
      dbPayload.words.length > 0
    ) {
      transcriptionData = dbPayload as unknown as {
        text: string;
        language_code?: string;
        words: TranscriptionWord[];
      };
    } else if (dbRec.transcriptionText && dbRec.transcriptionText.trim().length > 0) {
      const textWords = dbRec.transcriptionText.split(/\s+/).filter(Boolean);
      const durationSeconds =
        typeof dbRec.durationSeconds === "number" && dbRec.durationSeconds > 0
          ? dbRec.durationSeconds
          : Math.max(1, Math.round(textWords.length * 0.5));
      const wordDur = Math.max(0.05, durationSeconds / Math.max(1, textWords.length));

      const words = textWords.map((word, idx) => ({
        text: word,
        start: idx * wordDur,
        end: (idx + 1) * wordDur,
        type: "word" as const,
        speaker_id: idx % 20 < 10 ? "speaker_0" : "speaker_1",
      }));

      transcriptionData = {
        text: dbRec.transcriptionText,
        language_code: "fr",
        words,
      };
    }

    if (!transcriptionData) {continue;}

    transcriptions.push({
      recording_url: url,
      transcription_id: dbRec.transcriptionId,
      call_id: dbRec.callId,
      recording: enrichedRec,
      transcription: transcriptionData,
    });
  }

  const timeline = generateTimeline(transcriptions);
  const timelineText = buildTimelineText(timeline);

  logger.info("Timeline regenerated (control point rerun)", {
    fiche_id: ficheId,
    recordings: timeline.length,
    chunks: timeline.reduce((sum, r) => sum + r.total_chunks, 0),
  });

  return { timeline, timelineText };
}

function extractOriginalControlPointSummary(params: {
  rawResult: unknown;
  controlPointIndex: number;
  controlPointText: string;
}): {
  statut: string;
  commentaire: string;
  citations: number;
  minutages: string[];
} | null {
  const { rawResult, controlPointIndex, controlPointText } = params;
  if (!isRecord(rawResult)) {return null;}

  const points = rawResult.points_controle;
  if (!Array.isArray(points) || points.length === 0) {return null;}

  const wantedNorm = normalizeForMatch(controlPointText);

  const byIndex = points[controlPointIndex - 1];
  const candidates = [
    ...(byIndex ? [byIndex] : []),
    ...points,
  ];

  const match = candidates.find((cp) => {
    if (!isRecord(cp)) {return false;}
    const point = typeof cp.point === "string" ? cp.point : "";
    return normalizeForMatch(point) === wantedNorm;
  });

  const cp = isRecord(match) ? match : isRecord(byIndex) ? byIndex : null;
  if (!cp) {return null;}

  const statut = typeof cp.statut === "string" ? cp.statut : "UNKNOWN";
  const commentaire = typeof cp.commentaire === "string" ? cp.commentaire : "";
  const citations = Array.isArray(cp.citations) ? cp.citations.length : 0;
  const minutages = toStringArray(cp.minutages);

  return { statut, commentaire, citations, minutages };
}

function pickRerunControlPoint(params: {
  rerunStep: AnalyzeStepResult;
  controlPointText: string;
}): ControlPoint {
  const { rerunStep, controlPointText } = params;
  const points = Array.isArray(rerunStep.points_controle) ? rerunStep.points_controle : [];
  if (points.length === 0) {
    throw new Error("Analyzer returned no points_controle");
  }

  if (points.length === 1) {return points[0];}

  const wantedNorm = normalizeForMatch(controlPointText);
  const match =
    points.find((p) => normalizeForMatch(String(p.point || "")) === wantedNorm) ?? points[0];
  return match;
}

function buildControlPointRerunInstructions(params: {
  stepDef: AuditStepDefinition;
  controlPointIndex: number;
  totalControlPoints: number;
  controlPointText: string;
  previous: ReturnType<typeof extractOriginalControlPointSummary>;
  userPrompt?: string;
}): string {
  const lines: string[] = [];

  lines.push("🧩 RERUN CIBLÉ: POINT DE CONTRÔLE (SOUS-ÉTAPE)");
  lines.push(`- Index: ${params.controlPointIndex}/${params.totalControlPoints}`);
  lines.push(`- Point: ${params.controlPointText}`);

  if (params.previous) {
    lines.push("\n📌 CONTEXTE (RÉSULTAT PRÉCÉDENT POUR CE POINT):");
    lines.push(`- Statut: ${params.previous.statut}`);
    lines.push(`- Citations: ${params.previous.citations}`);
    if (params.previous.minutages.length > 0) {
      lines.push(`- Minutages: ${params.previous.minutages.join(", ")}`);
    }
    if (params.previous.commentaire) {
      // Avoid huge blocks; keep it readable.
      const trimmed = params.previous.commentaire.trim();
      lines.push(`- Commentaire: ${trimmed.length > 1200 ? `${trimmed.slice(0, 1200)}…` : trimmed}`);
    }
  }

  if (params.userPrompt && params.userPrompt.trim()) {
    lines.push("\n📝 INSTRUCTIONS SPÉCIFIQUES DE L'UTILISATEUR (À APPLIQUER EN PRIORITÉ):");
    lines.push(params.userPrompt.trim());
  }

  // Preserve any existing config-level custom instructions.
  const base = params.stepDef.customInstructions?.trim();
  const extra = lines.join("\n");
  return [base, extra].filter(Boolean).join("\n\n");
}

/**
 * Re-run a single control point inside an audit step.
 */
export async function rerunAuditStepControlPoint(
  options: RerunControlPointOptions
): Promise<RerunControlPointResult> {
  const startTime = Date.now();

  logger.info("Re-running audit step control point", {
    audit_id: String(options.auditId),
    step_position: options.stepPosition,
    control_point_index: options.controlPointIndex,
    has_custom_prompt: Boolean(options.customPrompt || options.customInstructions),
  });

  const audit = await getAuditById(options.auditId);
  if (!audit) {throw new Error(`Audit ${options.auditId.toString()} not found`);}

  const ficheId = audit.ficheCache.ficheId;
  const originalStepResult = audit.stepResults.find((s) => s.stepPosition === options.stepPosition);
  if (!originalStepResult) {
    throw new Error(
      `Step ${options.stepPosition} not found in audit ${options.auditId.toString()}`
    );
  }

  const auditConfig = await getAuditConfigById(audit.auditConfigId);
  if (!auditConfig) {throw new Error(`Audit config ${audit.auditConfigId.toString()} not found`);}

  const auditConfigData: AuditConfigForAnalysis = {
    id: auditConfig.id.toString(),
    name: auditConfig.name,
    description: auditConfig.description,
    systemPrompt: auditConfig.systemPrompt,
    auditSteps: auditConfig.steps,
  };

  const stepDef = auditConfigData.auditSteps.find((s) => s.position === options.stepPosition);
  if (!stepDef) {throw new Error(`Step definition not found for position ${options.stepPosition}`);}

  const totalControlPoints = Array.isArray(stepDef.controlPoints) ? stepDef.controlPoints.length : 0;
  if (totalControlPoints <= 0) {
    throw new Error(`Step ${options.stepPosition} has no controlPoints configured`);
  }

  if (!Number.isFinite(options.controlPointIndex) || options.controlPointIndex <= 0) {
    throw new Error("Invalid controlPointIndex");
  }
  if (options.controlPointIndex > totalControlPoints) {
    throw new Error(
      `controlPointIndex ${options.controlPointIndex} out of range (1-${totalControlPoints})`
    );
  }

  const controlPointText = stepDef.controlPoints[options.controlPointIndex - 1];

  // Rebuild timeline (authoritative transcript context)
  const { timeline, timelineText } = await regenerateTimelineFromDatabase(ficheId);

  // Link product if needed
  let productInfo: ProductLinkResult | null = null;
  if (stepDef.verifyProductInfo) {
    logger.info("Linking fiche to product database (control point rerun)", { fiche_id: ficheId });
    try {
      const { linkFicheToProduct } = await import("../products/products.service.js");
      const linkResult = (await linkFicheToProduct(ficheId)) as ProductLinkResult;
      if (linkResult.matched && linkResult.formule) {
        productInfo = linkResult;
      }
    } catch (error: unknown) {
      logger.warn("Product linking failed (control point rerun)", {
        fiche_id: ficheId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  const previousControlPoint = extractOriginalControlPointSummary({
    rawResult: (originalStepResult as unknown as { rawResult?: unknown }).rawResult,
    controlPointIndex: options.controlPointIndex,
    controlPointText,
  });

  const userPrompt =
    (options.customPrompt && options.customPrompt.trim() ? options.customPrompt : undefined) ??
    (options.customInstructions && options.customInstructions.trim()
      ? options.customInstructions
      : undefined);

  const stepForAnalysis: AuditStepDefinition = {
    ...stepDef,
    controlPoints: [controlPointText],
    customInstructions: buildControlPointRerunInstructions({
      stepDef,
      controlPointIndex: options.controlPointIndex,
      totalControlPoints,
      controlPointText,
      previous: previousControlPoint,
      userPrompt,
    }),
  };

  // Run analyzer (LLM). Note: analyzeStep emits step_started/step_completed webhooks; keep a distinct auditId.
  const rerunRaw = await analyzeStep(
    stepForAnalysis,
    auditConfigData,
    timelineText,
    `rerun-${options.auditId.toString()}-step-${options.stepPosition}-cp-${options.controlPointIndex}`,
    ficheId,
    productInfo,
    { timeline }
  );

  // Evidence gating (deterministic) to avoid hallucinated citations.
  const gatingEnabled = process.env.AUDIT_EVIDENCE_GATING !== "0";
  const gated = gatingEnabled
    ? validateAndGateAuditStepResults({
        stepResults: [rerunRaw as unknown as AnalyzedAuditStepResult],
        timeline,
        enabled: true,
      }).stepResults[0]
    : rerunRaw;

  const rerunControlPoint = pickRerunControlPoint({
    rerunStep: gated as AnalyzeStepResult,
    controlPointText,
  });

  const durationMs = Date.now() - startTime;
  const newCitations = rerunControlPoint.citations.length;
  const originalCitations = previousControlPoint ? previousControlPoint.citations : null;
  const originalStatut = previousControlPoint ? previousControlPoint.statut : null;
  const newStatut = rerunControlPoint.statut;

  const tokensUsed = (() => {
    if (!isRecord(gated)) {return 0;}
    const usage = gated.usage;
    if (!isRecord(usage)) {return 0;}
    const total = usage.total_tokens;
    return typeof total === "number" && Number.isFinite(total) ? total : 0;
  })();

  return {
    success: true,
    auditId: options.auditId.toString(),
    ficheId,
    stepPosition: options.stepPosition,
    stepName: originalStepResult.stepName,
    controlPointIndex: options.controlPointIndex,
    controlPointText,
    originalControlPoint: previousControlPoint,
    rerunControlPoint,
    comparison: {
      statutChanged: originalStatut !== null ? originalStatut !== newStatut : true,
      citationsChanged:
        originalCitations !== null ? originalCitations !== newCitations : true,
      originalStatut,
      newStatut,
      originalCitations,
      newCitations,
    },
    metadata: {
      rerunAt: new Date().toISOString(),
      durationMs,
      tokensUsed,
    },
    rerunStep: gated as AnalyzeStepResult,
  };
}

/**
 * Persist a control-point rerun into the stored audit.
 *
 * - Updates `audit_step_results.raw_result.points_controle[i]` with the rerun control point
 * - Recomputes step score/conforme deterministically from control point statuses
 * - Recomputes audit-level compliance summary (so list/detail endpoints stay consistent)
 *
 * NOTE: This mutates the existing audit (no versioning) but keeps an audit trail in `raw_result.rerun_history`.
 */
export async function saveControlPointRerunResult(
  options: RerunControlPointOptions,
  rerunResult: RerunControlPointResult,
  updateAudit: boolean = false,
  meta?: { rerunId?: string | null; eventId?: string | null }
): Promise<{ saved: boolean; auditUpdated: boolean }> {
  const existing = await prisma.auditStepResult.findUnique({
    where: {
      auditId_stepPosition: {
        auditId: options.auditId,
        stepPosition: options.stepPosition,
      },
    },
  });

  if (!existing) {
    logger.warn("Audit step result not found for control point rerun save", {
      audit_id: options.auditId.toString(),
      step_position: options.stepPosition,
      control_point_index: options.controlPointIndex,
    });
    return { saved: false, auditUpdated: false };
  }

  if (!isRecord(existing.rawResult)) {
    logger.warn("Audit step rawResult missing; cannot apply control point rerun", {
      audit_id: options.auditId.toString(),
      step_position: options.stepPosition,
      control_point_index: options.controlPointIndex,
    });
    return { saved: false, auditUpdated: false };
  }

  const raw = { ...(existing.rawResult as Record<string, unknown>) };
  const pointsRaw = raw.points_controle;
  if (!Array.isArray(pointsRaw) || pointsRaw.length < options.controlPointIndex) {
    logger.warn("Audit step has no matching control point to update", {
      audit_id: options.auditId.toString(),
      step_position: options.stepPosition,
      control_point_index: options.controlPointIndex,
      points_len: Array.isArray(pointsRaw) ? pointsRaw.length : 0,
    });
    return { saved: false, auditUpdated: false };
  }

  const idx = options.controlPointIndex - 1;
  const previousCp = pointsRaw[idx];
  const previous = isRecord(previousCp)
    ? {
        point: typeof previousCp.point === "string" ? previousCp.point : "",
        statut: typeof previousCp.statut === "string" ? previousCp.statut : "UNKNOWN",
        commentaire: typeof previousCp.commentaire === "string" ? previousCp.commentaire : "",
        citations: Array.isArray(previousCp.citations) ? previousCp.citations.length : 0,
      }
    : {
        point: "",
        statut: "UNKNOWN",
        commentaire: "",
        citations: 0,
      };

  const rerunCp = rerunResult.rerunControlPoint as unknown as Record<string, unknown>;
  const nextCp: Record<string, unknown> = {
    ...(isRecord(previousCp) ? (previousCp as Record<string, unknown>) : {}),
    ...rerunCp,
  };
  if (typeof nextCp.point !== "string" && previous.point) {
    nextCp.point = previous.point;
  }

  const nextPoints = [...pointsRaw];
  nextPoints[idx] = nextCp;
  raw.points_controle = nextPoints;

  // Deterministically recompute step summary fields (mirrors evidence-gating scoring model).
  const derived = deriveStepFromControlPoints({
    points: nextPoints as Array<{ statut?: unknown; citations?: unknown }>,
    weight: Math.max(0, Number(existing.weight)),
  });

  raw.score = derived.score;
  raw.conforme = derived.conforme;
  raw.niveau_conformite = derived.niveauConformite;
  raw.minutages = derived.minutages;

  // Append rerun audit trail entry
  const nowIso = new Date().toISOString();
  const trailEntry = {
    at: nowIso,
    kind: "control_point_rerun",
    rerun_id: meta?.rerunId ?? null,
    event_id: meta?.eventId ?? null,
    step_position: options.stepPosition,
    control_point_index: options.controlPointIndex,
    point: typeof nextCp.point === "string" ? nextCp.point : previous.point,
    previous: {
      statut: previous.statut,
      commentaire: previous.commentaire,
      citations: previous.citations,
      step_score: existing.score,
      step_conforme: existing.conforme,
    },
    next: {
      statut: typeof nextCp.statut === "string" ? nextCp.statut : "UNKNOWN",
      commentaire: typeof nextCp.commentaire === "string" ? nextCp.commentaire : "",
      citations: Array.isArray(nextCp.citations) ? nextCp.citations.length : 0,
      step_score: derived.score,
      step_conforme: derived.conforme,
    },
  };

  const existingHistory = raw.rerun_history;
  const history: unknown[] = Array.isArray(existingHistory)
    ? [...existingHistory]
    : existingHistory
      ? [existingHistory]
      : [];
  history.push(trailEntry);
  raw.rerun_history = history;

  await prisma.auditStepResult.update({
    where: {
      auditId_stepPosition: {
        auditId: options.auditId,
        stepPosition: options.stepPosition,
      },
    },
    data: {
      score: derived.score,
      conforme: derived.conforme,
      niveauConformite: derived.niveauConformite,
      totalCitations: derived.totalCitations,
      minutages: derived.minutages,
      rawResult: toPrismaJsonValue(raw),
    },
  });

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
      const errorMessage = err instanceof Error ? err.message : String(err);
      logger.warn("Failed to update audit compliance after control point rerun", {
        audit_id: options.auditId.toString(),
        step_position: options.stepPosition,
        control_point_index: options.controlPointIndex,
        error: errorMessage,
      });
    }
  }

  return { saved: true, auditUpdated: true };
}





