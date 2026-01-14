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

import { generateTimeline } from "./audits.timeline.js";
import { buildTimelineText } from "./audits.prompts.js";
import { analyzeStep } from "./audits.analyzer.js";
import { validateAndGateAuditStepResults } from "./audits.evidence.js";
import { getAuditById } from "./audits.repository.js";
import { getRecordingsByFiche } from "../recordings/recordings.repository.js";
import { getCachedFiche } from "../fiches/fiches.repository.js";
import { enrichRecording } from "../../utils/recording-parser.js";
import { getAuditConfigById } from "../audit-configs/audit-configs.repository.js";
import { logger } from "../../shared/logger.js";
import type { FicheDetailsResponse } from "../fiches/fiches.schemas.js";
import type {
  ControlPoint,
  TimelineRecording,
  Transcription,
  TranscriptionWord,
} from "../../schemas.js";
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
    if (!dbRec.hasTranscription || !dbRec.transcriptionId) continue;

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
    if (!rawRec) continue;

    const enrichedRec = enrichRecording(rawRec);
    const url = enrichedRec.recording_url;
    if (!url) continue;

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

    if (!transcriptionData) continue;

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
  if (!isRecord(rawResult)) return null;

  const points = rawResult.points_controle;
  if (!Array.isArray(points) || points.length === 0) return null;

  const wantedNorm = normalizeForMatch(controlPointText);

  const byIndex = points[controlPointIndex - 1];
  const candidates = [
    ...(byIndex ? [byIndex] : []),
    ...points,
  ];

  const match = candidates.find((cp) => {
    if (!isRecord(cp)) return false;
    const point = typeof cp.point === "string" ? cp.point : "";
    return normalizeForMatch(point) === wantedNorm;
  });

  const cp = isRecord(match) ? match : isRecord(byIndex) ? byIndex : null;
  if (!cp) return null;

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

  if (points.length === 1) return points[0];

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
  if (!audit) throw new Error(`Audit ${options.auditId.toString()} not found`);

  const ficheId = audit.ficheCache.ficheId;
  const originalStepResult = audit.stepResults.find((s) => s.stepPosition === options.stepPosition);
  if (!originalStepResult) {
    throw new Error(
      `Step ${options.stepPosition} not found in audit ${options.auditId.toString()}`
    );
  }

  const auditConfig = await getAuditConfigById(audit.auditConfigId);
  if (!auditConfig) throw new Error(`Audit config ${audit.auditConfigId.toString()} not found`);

  const auditConfigData: AuditConfigForAnalysis = {
    id: auditConfig.id.toString(),
    name: auditConfig.name,
    description: auditConfig.description,
    systemPrompt: auditConfig.systemPrompt,
    auditSteps: auditConfig.steps,
  };

  const stepDef = auditConfigData.auditSteps.find((s) => s.position === options.stepPosition);
  if (!stepDef) throw new Error(`Step definition not found for position ${options.stepPosition}`);

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
    productInfo
  );

  // Evidence gating (deterministic) to avoid hallucinated citations.
  const gatingEnabled = process.env.AUDIT_EVIDENCE_GATING !== "0";
  const gated = gatingEnabled
    ? validateAndGateAuditStepResults({
        stepResults: [rerunRaw as unknown as any],
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
      tokensUsed: (gated as any)?.usage?.total_tokens || 0,
    },
    rerunStep: gated as AnalyzeStepResult,
  };
}





