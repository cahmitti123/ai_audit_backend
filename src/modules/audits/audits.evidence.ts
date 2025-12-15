/**
 * Audit Evidence Validation & Gating
 * =================================
 * Goal: Prevent hallucinated citations and ensure "PRESENT" claims are backed by
 * real transcript evidence.
 *
 * This is a deterministic post-processing step applied after LLM analysis.
 */

import type {
  TimelineRecording,
  AuditStepResult,
  ControlPoint,
  EvidenceCitation,
} from "../../schemas.js";

export type AnalyzedAuditStepResult = AuditStepResult & {
  step_metadata?: { weight?: number; is_critical?: boolean };
  usage?: { total_tokens?: number };
};

// Inngest serializes step outputs; optional fields may become null. We accept a looser shape.
export type TimelineLike = ReadonlyArray<{
  recording_index: number | null;
  chunks: ReadonlyArray<{ chunk_index: number | null; full_text: string | null }>;
}>;

export type EvidenceGatingStats = {
  enabled: boolean;
  total_citations: number;
  removed_citations: number;
  downgraded_control_points: number;
  steps_score_reduced: number;
  steps_conforme_adjusted: number;
};

function normalizeForMatch(s: string): string {
  return String(s || "")
    .toLowerCase()
    // Normalize accents (NFD splits base+diacritic) then drop diacritics
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    // Keep letters/numbers, collapse the rest
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function buildTimelineChunkTextIndex(timeline: TimelineLike) {
  const map = new Map<number, Map<number, string>>();
  for (const rec of timeline) {
    if (typeof rec.recording_index !== "number") continue;
    const chunkMap = new Map<number, string>();
    for (const chunk of rec.chunks) {
      if (typeof chunk.chunk_index !== "number") continue;
      chunkMap.set(chunk.chunk_index, normalizeForMatch(String(chunk.full_text || "")));
    }
    map.set(rec.recording_index, chunkMap);
  }
  return map;
}

function isCitationValid(
  citation: Partial<EvidenceCitation>,
  index: Map<number, Map<number, string>>
): boolean {
  if (typeof citation.recording_index !== "number") return false;
  if (typeof citation.chunk_index !== "number") return false;
  const recordingIndex = citation.recording_index;
  const chunkIndex = citation.chunk_index;

  const chunkMap = index.get(recordingIndex);
  if (!chunkMap) return false;

  const chunkText = chunkMap.get(chunkIndex);
  if (!chunkText) return false;

  const quoted = normalizeForMatch(String(citation.texte || ""));
  if (!quoted) return false;

  // Very short quotes are too ambiguous; require a minimum length
  if (quoted.length < 12) return false;

  return chunkText.includes(quoted);
}

function scoreFromControlPoints(points: Array<Pick<ControlPoint, "statut">>, weight: number) {
  const applicable = points.filter((p) => p.statut !== "NON_APPLICABLE");
  if (applicable.length === 0) {
    return {
      ratio: 1,
      derivedScore: Math.max(0, Math.round(weight)),
    };
  }

  const total = applicable.reduce((sum, p) => {
    if (p.statut === "PRESENT") return sum + 1;
    if (p.statut === "PARTIEL") return sum + 0.5;
    return sum + 0;
  }, 0);

  const ratio = total / applicable.length;
  const derivedScore = Math.max(0, Math.min(weight, Math.round(ratio * weight)));
  return { ratio, derivedScore };
}

function conformeFromRatio(ratio: number): "CONFORME" | "PARTIEL" | "NON_CONFORME" {
  if (ratio >= 0.85) return "CONFORME";
  if (ratio >= 0.4) return "PARTIEL";
  return "NON_CONFORME";
}

function niveauFromConforme(
  conforme: "CONFORME" | "PARTIEL" | "NON_CONFORME",
  ratio: number
): "EXCELLENT" | "BON" | "ACCEPTABLE" | "INSUFFISANT" | "REJET" {
  if (conforme === "CONFORME") return ratio >= 0.95 ? "EXCELLENT" : "BON";
  if (conforme === "PARTIEL") return "ACCEPTABLE";
  return "INSUFFISANT";
}

/**
 * Validate citations against the transcript and conservatively gate results.
 * - Removes citations whose quoted text doesn't appear in the referenced chunk.
 * - If a control point is PRESENT/PARTIEL but ends up with no valid citations, downgrade to ABSENT.
 * - Optionally reduces score/conforme based on evidence coverage (never increases).
 */
export function validateAndGateAuditStepResults(params: {
  stepResults: AnalyzedAuditStepResult[];
  timeline: TimelineLike;
  enabled?: boolean;
}): { stepResults: AnalyzedAuditStepResult[]; stats: EvidenceGatingStats } {
  const enabled = params.enabled !== false;

  const stats: EvidenceGatingStats = {
    enabled,
    total_citations: 0,
    removed_citations: 0,
    downgraded_control_points: 0,
    steps_score_reduced: 0,
    steps_conforme_adjusted: 0,
  };

  if (!enabled) {
    return { stepResults: params.stepResults, stats };
  }

  const idx = buildTimelineChunkTextIndex(params.timeline);

  const gated = params.stepResults.map((step) => {
    const points = Array.isArray(step.points_controle) ? step.points_controle : [];
    const weight = Math.max(0, Number(step.step_metadata?.weight ?? step.score ?? 0));

    for (const cp of points) {
      const original = Array.isArray(cp.citations) ? cp.citations : [];
      stats.total_citations += original.length;

      const valid = original.filter((c) => isCitationValid(c, idx));
      stats.removed_citations += original.length - valid.length;

      // Enforce citation rules by statut
      if (cp.statut === "ABSENT" || cp.statut === "NON_APPLICABLE") {
        cp.citations = [];
      } else {
        cp.citations = valid;
      }

      // If "PRESENT"/"PARTIEL" but no valid evidence, downgrade conservatively
      if ((cp.statut === "PRESENT" || cp.statut === "PARTIEL") && (cp.citations?.length || 0) === 0) {
        cp.statut = "ABSENT";
        cp.commentaire = `${cp.commentaire || ""}${
          cp.commentaire ? "\n" : ""
        }[Auto-check] Aucune citation valide trouvée dans la transcription pour confirmer ce point.`;
        stats.downgraded_control_points++;
      }

      // Keep minutages consistent with remaining citations
      if (Array.isArray(cp.citations) && cp.citations.length > 0) {
        const mins = Array.from(
          new Set(cp.citations.map((c) => String(c.minutage || "")).filter(Boolean))
        );
        cp.minutages = mins;
      } else {
        cp.minutages = [];
      }
    }

    // Evidence-based score/conforme gating (never increases)
    const { ratio, derivedScore } = scoreFromControlPoints(points, weight);
    const originalScore = Number(step.score ?? 0);
    const cappedOriginal = Math.min(originalScore, weight || originalScore);

    if (Number.isFinite(derivedScore) && derivedScore < cappedOriginal) {
      step.score = derivedScore;
      stats.steps_score_reduced++;
      step.commentaire_global = `${step.commentaire_global || ""}${
        step.commentaire_global ? "\n\n" : ""
      }[Auto-check] Score ajusté à la baisse faute de preuves/citations valides suffisantes.`;
    }

    const originalConforme = step.conforme;
    const gatedConforme = conformeFromRatio(ratio);

    if (originalConforme && gatedConforme !== originalConforme) {
      // Only adjust downward in strictness:
      // CONFORME -> PARTIEL/NON_CONFORME, PARTIEL -> NON_CONFORME
      const order = { CONFORME: 2, PARTIEL: 1, NON_CONFORME: 0 } as const;
      if (order[gatedConforme] < order[originalConforme]) {
        step.conforme = gatedConforme;
        step.niveau_conformite = niveauFromConforme(gatedConforme, ratio);
        stats.steps_conforme_adjusted++;
      }
    }

    // Recompute step minutages from remaining citations (best-effort)
    const stepMins = new Set<string>();
    for (const cp of points) {
      for (const c of cp.citations || []) {
        if (c.minutage) stepMins.add(String(c.minutage));
      }
    }
    step.minutages = Array.from(stepMins);

    return step;
  });

  return { stepResults: gated, stats };
}


