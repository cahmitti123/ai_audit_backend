/**
 * Audits Service
 * ==============
 * RESPONSIBILITY: Business logic and orchestration
 * - Audit execution orchestration
 * - Data transformations and enrichment
 * - Statistics calculations
 * - Coordinates between repository, analyzer, timeline, etc.
 *
 * LAYER: Business Logic / Orchestration
 */

import type { Prisma } from "@prisma/client";

import { COMPLIANCE_THRESHOLDS } from "../../shared/constants.js";
import { NotFoundError } from "../../shared/errors.js";
import { logger } from "../../shared/logger.js";
import { prisma } from "../../shared/prisma.js";
import * as auditsRepository from "./audits.repository.js";
import {
  type Audit,
  type AuditDetail,
  type AuditNiveau,
  auditNiveauEnum,
  type AuditStatus,
  auditStatusEnum,
  type AuditSummary,
  type AuditWithConfig,
  type AuditWithFiche,
  type FicheWithAudits,
  type ListAuditsFilters,
  type ReviewAuditControlPointInput,
  type ReviewAuditStepResultInput,
  type StepConforme,
  stepConformeEnum,
  type StepNiveauConformite,
  stepNiveauConformiteEnum,
  type UpdateAuditInput,
} from "./audits.schemas.js";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function buildLatestStepPayloadFromDb(step: Record<string, unknown>): Record<string, unknown> | null {
  const raw = step.rawResult as unknown;

  // Back-compat: old rows still store full step JSON (including points_controle) in rawResult.
  if (isRecord(raw) && Array.isArray(raw.points_controle)) {
    return raw as Record<string, unknown>;
  }

  const cpsRaw = step.controlPoints;
  const cps = Array.isArray(cpsRaw) ? cpsRaw : [];
  if (cps.length === 0) {
    return null;
  }

  const stepPosition = Number(step.stepPosition) || 0;
  const weight = Number(step.weight) || 0;

  const usage =
    isRecord(raw) && isRecord(raw.usage)
      ? raw.usage
      : { total_tokens: Number(step.totalTokens ?? 0) };

  const step_metadata =
    isRecord(raw) && isRecord(raw.step_metadata)
      ? raw.step_metadata
      : {
          position: stepPosition,
          name: typeof step.stepName === "string" ? step.stepName : "",
          severity: typeof step.severityLevel === "string" ? step.severityLevel : "MEDIUM",
          is_critical: Boolean(step.isCritical),
          weight,
        };

  const points_controle = cps.map((cp: unknown) => {
    const rec = isRecord(cp) ? cp : {};
    const citationsRaw = rec.citations;
    const citations = Array.isArray(citationsRaw) ? citationsRaw : [];

    return {
      point: typeof rec.point === "string" ? rec.point : "",
      statut: typeof rec.statut === "string" ? rec.statut : "ABSENT",
      commentaire: typeof rec.commentaire === "string" ? rec.commentaire : "",
      citations: citations.map((c: unknown) => {
        const cit = isRecord(c) ? c : {};
        return {
          texte: typeof cit.texte === "string" ? cit.texte : "",
          speaker: typeof cit.speaker === "string" ? cit.speaker : "",
          minutage: typeof cit.minutage === "string" ? cit.minutage : "",
          chunk_index: Number(cit.chunkIndex ?? cit.chunk_index ?? 0) || 0,
          recording_url:
            typeof cit.recordingUrl === "string"
              ? cit.recordingUrl
              : typeof cit.recording_url === "string"
                ? cit.recording_url
                : "N/A",
          recording_date:
            typeof cit.recordingDate === "string"
              ? cit.recordingDate
              : typeof cit.recording_date === "string"
                ? cit.recording_date
                : "N/A",
          recording_time:
            typeof cit.recordingTime === "string"
              ? cit.recordingTime
              : typeof cit.recording_time === "string"
                ? cit.recording_time
                : "N/A",
          recording_index: Number(cit.recordingIndex ?? cit.recording_index ?? 0) || 0,
          minutage_secondes:
            typeof cit.minutageSecondes === "number"
              ? cit.minutageSecondes
              : typeof cit.minutage_secondes === "number"
                ? cit.minutage_secondes
                : 0,
        };
      }),
      minutages: Array.isArray(rec.minutages) ? rec.minutages : [],
      erreur_transcription_notee: Boolean(rec.erreurTranscriptionNotee),
      variation_phonetique_utilisee:
        rec.variationPhonetiqueUtilisee === null ||
        typeof rec.variationPhonetiqueUtilisee === "string"
          ? rec.variationPhonetiqueUtilisee
          : null,
    };
  });

  const out: Record<string, unknown> = {
    traite: Boolean(step.traite),
    conforme: String(step.conforme ?? "NON_CONFORME"),
    minutages: Array.isArray(step.minutages) ? step.minutages : [],
    score: Number(step.score ?? 0),
    points_controle,
    mots_cles_trouves: Array.isArray(step.motsClesTrouves) ? step.motsClesTrouves : [],
    commentaire_global: String(step.commentaireGlobal ?? ""),
    niveau_conformite: String(step.niveauConformite ?? "INSUFFISANT"),
    erreurs_transcription_tolerees: Number(step.erreursTranscriptionTolerees ?? 0),
    step_metadata,
    usage,
  };

  // Prefer normalized audit trail tables; fallback to legacy rawResult fields.
  const humanReviews = Array.isArray(step.humanReviews)
    ? (step.humanReviews as Array<Record<string, unknown>>)
    : [];
  if (humanReviews.length > 0) {
    out.human_review = humanReviews.map((r) => {
      const kind = typeof r.kind === "string" ? r.kind : "step";
      const at =
        r.reviewedAt instanceof Date && Number.isFinite(r.reviewedAt.getTime())
          ? r.reviewedAt.toISOString()
          : new Date().toISOString();
      const by = typeof r.reviewer === "string" ? r.reviewer : null;
      const reason = typeof r.reason === "string" ? r.reason : null;

      if (kind === "control_point") {
        return {
          at,
          by,
          reason,
          kind: "control_point",
          control_point_index:
            typeof r.controlPointIndex === "number" ? r.controlPointIndex : null,
          point: typeof r.point === "string" ? r.point : null,
          previous: {
            statut: typeof r.previousStatut === "string" ? r.previousStatut : null,
            commentaire:
              typeof r.previousCommentaire === "string" ? r.previousCommentaire : null,
          },
          override: {
            statut: typeof r.overrideStatut === "string" ? r.overrideStatut : null,
            commentaire:
              typeof r.overrideCommentaire === "string" ? r.overrideCommentaire : null,
          },
        };
      }

      return {
        at,
        by,
        reason,
        previous: {
          traite: typeof r.previousTraite === "boolean" ? r.previousTraite : null,
          conforme: typeof r.previousConforme === "string" ? r.previousConforme : null,
          score: typeof r.previousScore === "number" ? r.previousScore : null,
          niveau_conformite:
            typeof r.previousNiveauConformite === "string"
              ? r.previousNiveauConformite
              : null,
        },
        override: {
          traite: typeof r.overrideTraite === "boolean" ? r.overrideTraite : null,
          conforme: typeof r.overrideConforme === "string" ? r.overrideConforme : null,
          score: typeof r.overrideScore === "number" ? r.overrideScore : null,
          niveau_conformite:
            typeof r.overrideNiveauConformite === "string"
              ? r.overrideNiveauConformite
              : null,
        },
      };
    });
  } else if (isRecord(raw) && raw.human_review !== undefined) {
    out.human_review = raw.human_review;
  }

  const rerunEvents = Array.isArray(step.rerunEvents)
    ? (step.rerunEvents as Array<Record<string, unknown>>)
    : [];
  if (rerunEvents.length > 0) {
    out.rerun_history = rerunEvents.map((e) => {
      const kind = typeof e.kind === "string" ? e.kind : "unknown";
      const at =
        e.occurredAt instanceof Date && Number.isFinite(e.occurredAt.getTime())
          ? e.occurredAt.toISOString()
          : new Date().toISOString();
      const rerun_id = typeof e.rerunId === "string" ? e.rerunId : null;
      const event_id = typeof e.eventId === "string" ? e.eventId : null;

      if (kind === "control_point_rerun") {
        return {
          at,
          kind,
          rerun_id,
          event_id,
          step_position: Number.isFinite(stepPosition) ? stepPosition : null,
          control_point_index:
            typeof e.controlPointIndex === "number" ? e.controlPointIndex : null,
          point: typeof e.point === "string" ? e.point : null,
          previous: {
            statut: typeof e.previousStatut === "string" ? e.previousStatut : null,
            commentaire:
              typeof e.previousCommentaire === "string" ? e.previousCommentaire : null,
            citations: typeof e.previousCitations === "number" ? e.previousCitations : null,
            step_score: typeof e.previousStepScore === "number" ? e.previousStepScore : null,
            step_conforme:
              typeof e.previousStepConforme === "string" ? e.previousStepConforme : null,
          },
          next: {
            statut: typeof e.nextStatut === "string" ? e.nextStatut : null,
            commentaire:
              typeof e.nextCommentaire === "string" ? e.nextCommentaire : null,
            citations: typeof e.nextCitations === "number" ? e.nextCitations : null,
            step_score: typeof e.nextStepScore === "number" ? e.nextStepScore : null,
            step_conforme:
              typeof e.nextStepConforme === "string" ? e.nextStepConforme : null,
          },
        };
      }

      return {
        at,
        kind,
        rerun_id,
        event_id,
        step_position: Number.isFinite(stepPosition) ? stepPosition : null,
        custom_prompt: typeof e.customPrompt === "string" ? e.customPrompt : null,
        previous: {
          score: typeof e.previousScore === "number" ? e.previousScore : null,
          conforme: typeof e.previousConforme === "string" ? e.previousConforme : null,
          total_citations:
            typeof e.previousTotalCitations === "number" ? e.previousTotalCitations : null,
        },
        next: {
          score: typeof e.nextScore === "number" ? e.nextScore : null,
          conforme: typeof e.nextConforme === "string" ? e.nextConforme : null,
          total_citations:
            typeof e.nextTotalCitations === "number" ? e.nextTotalCitations : null,
        },
      };
    });
  } else if (isRecord(raw) && raw.rerun_history !== undefined) {
    out.rerun_history = raw.rerun_history;
  }

  return out;
}

/**
 * Produce a "latest view" of an audit's stored `resultData` by overlaying the latest
 * step payload (built from normalized tables + rawResult audit trails) onto
 * `resultData.audit.results.steps`.
 *
 * Why: reruns / human overrides update step-level storage, while `audits.resultData`
 * is a workflow snapshot.
 */
function mergeResultDataWithLatestStepRawResults(params: {
  resultData: unknown;
  stepResults: Array<Record<string, unknown>>;
}): unknown {
  const { resultData, stepResults } = params;

  if (!isRecord(resultData)) {return resultData;}
  const audit = resultData.audit;
  if (!isRecord(audit)) {return resultData;}
  const results = audit.results;
  if (!isRecord(results)) {return resultData;}

  const steps = results.steps;
  const hasStoredSteps = Array.isArray(steps) && steps.length > 0;
  const nextSteps = hasStoredSteps ? [...steps] : [];

  const findStepIndex = (stepPosition: number): number => {
    const idxByMetadata = nextSteps.findIndex((s) => {
      if (!isRecord(s)) {return false;}
      const meta = s.step_metadata;
      if (!isRecord(meta)) {return false;}
      return Number(meta.position) === stepPosition;
    });
    if (idxByMetadata >= 0) {return idxByMetadata;}

    // Fallback: assume steps are ordered by position (1-based)
    return stepPosition - 1;
  };

  if (!hasStoredSteps) {
    // Stored `resultData` has no `results.steps` (we intentionally strip them for storage).
    // Rebuild steps in order from DB step results.
    const rebuilt: unknown[] = [];
    for (const step of stepResults) {
      const payload = buildLatestStepPayloadFromDb(step);
      if (payload) {
        rebuilt.push(payload);
      }
    }
    if (rebuilt.length === 0) {return resultData;}

    return {
      ...(resultData as Record<string, unknown>),
      audit: {
        ...(audit as Record<string, unknown>),
        results: {
          ...(results as Record<string, unknown>),
          steps: rebuilt,
        },
      },
    };
  }

  for (const step of stepResults) {
    const stepPos = Number(step.stepPosition);
    if (!Number.isFinite(stepPos) || stepPos <= 0) {continue;}
    const payload = buildLatestStepPayloadFromDb(step);
    if (!isRecord(payload)) {continue;}

    const idx = findStepIndex(stepPos);
    if (idx < 0 || idx >= nextSteps.length) {continue;}

    nextSteps[idx] = payload;
  }

  return {
    ...(resultData as Record<string, unknown>),
    audit: {
      ...(audit as Record<string, unknown>),
      results: {
        ...(results as Record<string, unknown>),
        steps: nextSteps,
      },
    },
  };
}

type DbAuditStepResult = {
  id: bigint;
  auditId: bigint;
  stepPosition: number;
  stepName: string;
  severityLevel: string;
  isCritical: boolean;
  weight: number;
  traite: boolean;
  conforme: string;
  score: number;
  niveauConformite: string;
  commentaireGlobal: string;
  motsClesTrouves: string[];
  minutages: string[];
  erreursTranscriptionTolerees: number;
  totalCitations: number;
  totalTokens: number;
  createdAt: Date;
};

function toAuditStepResult(step: DbAuditStepResult) {
  return {
    id: step.id.toString(),
    auditId: step.auditId.toString(),
    stepPosition: step.stepPosition,
    stepName: step.stepName,
    severityLevel: step.severityLevel,
    isCritical: step.isCritical,
    weight: step.weight,
    traite: step.traite,
    conforme: toStepConforme(step.conforme),
    score: step.score,
    niveauConformite: toStepNiveauConformite(step.niveauConformite),
    commentaireGlobal: step.commentaireGlobal,
    motsClesTrouves: step.motsClesTrouves,
    minutages: step.minutages,
    erreursTranscriptionTolerees: step.erreursTranscriptionTolerees,
    totalCitations: step.totalCitations,
    totalTokens: step.totalTokens,
    createdAt: step.createdAt,
  };
}

function toAuditNiveau(value: string): AuditNiveau {
  const parsed = auditNiveauEnum.safeParse(value);
  if (parsed.success) {return parsed.data;}
  logger.warn("Unknown audit niveau value from DB", { value });
  return "INSUFFISANT";
}

function toAuditStatus(value: string): AuditStatus {
  const parsed = auditStatusEnum.safeParse(value);
  if (parsed.success) {return parsed.data;}
  logger.warn("Unknown audit status value from DB", { value });
  return "failed";
}

function toStepConforme(value: string): StepConforme {
  const parsed = stepConformeEnum.safeParse(value);
  if (parsed.success) {return parsed.data;}
  logger.warn("Unknown step conforme value from DB", { value });
  return "NON_CONFORME";
}

function toStepNiveauConformite(value: string): StepNiveauConformite {
  const parsed = stepNiveauConformiteEnum.safeParse(value);
  if (parsed.success) {return parsed.data;}
  logger.warn("Unknown step niveauConformite value from DB", { value });
  return "INSUFFISANT";
}

// ═══════════════════════════════════════════════════════════════════════════
// AUDIT RETRIEVAL OPERATIONS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Get audit by ID with full details
 */
export async function getAuditById(
  auditId: string | bigint
): Promise<AuditDetail | null> {
  const id = typeof auditId === "string" ? BigInt(auditId) : auditId;

  const audit = await auditsRepository.getAuditById(id);

  if (!audit) {
    return null;
  }

  const resultDataLatest = mergeResultDataWithLatestStepRawResults({
    resultData: audit.resultData,
    stepResults: audit.stepResults as unknown as Array<Record<string, unknown>>,
  });

  // Transform to API-friendly format
  return {
    id: audit.id.toString(),
    ficheCacheId: audit.ficheCacheId.toString(),
    auditConfigId: audit.auditConfigId.toString(),
    automationScheduleId: audit.automationScheduleId
      ? audit.automationScheduleId.toString()
      : null,
    automationRunId: audit.automationRunId ? audit.automationRunId.toString() : null,
    triggerSource: audit.triggerSource ?? null,
    triggerUserId: audit.triggerUserId ?? null,
    notes: audit.notes ?? null,
    deletedAt: audit.deletedAt ?? null,
    overallScore: audit.overallScore.toString(),
    scorePercentage: audit.scorePercentage.toString(),
    niveau: toAuditNiveau(audit.niveau),
    isCompliant: audit.isCompliant,
    criticalPassed: audit.criticalPassed,
    criticalTotal: audit.criticalTotal,
    status: toAuditStatus(audit.status),
    startedAt: audit.startedAt,
    completedAt: audit.completedAt,
    durationMs: audit.durationMs,
    errorMessage: audit.errorMessage,
    totalTokens: audit.totalTokens,
    successfulSteps: audit.successfulSteps,
    failedSteps: audit.failedSteps,
    recordingsCount: audit.recordingsCount,
    timelineChunks: audit.timelineChunks,
    resultData: resultDataLatest,
    version: audit.version,
    isLatest: audit.isLatest,
    createdAt: audit.createdAt,
    updatedAt: audit.updatedAt,
    auditConfig: {
      id: audit.auditConfig.id.toString(),
      name: audit.auditConfig.name,
      description: audit.auditConfig.description,
    },
    ficheCache: {
      ficheId: audit.ficheCache.ficheId,
      groupe: audit.ficheCache.groupe,
      agenceNom: audit.ficheCache.agenceNom,
      prospectNom: audit.ficheCache.prospectNom,
      prospectPrenom: audit.ficheCache.prospectPrenom,
      prospectEmail: audit.ficheCache.prospectEmail,
      prospectTel: audit.ficheCache.prospectTel,
    },
    stepResults: audit.stepResults.map((step) => toAuditStepResult(step)),
    automationSchedule: audit.automationSchedule
      ? {
          id: audit.automationSchedule.id.toString(),
          name: audit.automationSchedule.name,
        }
      : null,
    automationRun: audit.automationRun
      ? {
          id: audit.automationRun.id.toString(),
          status: audit.automationRun.status,
          startedAt: audit.automationRun.startedAt,
          completedAt: audit.automationRun.completedAt,
          scheduleId: audit.automationRun.scheduleId.toString(),
        }
      : null,
  };
}

/**
 * Get all audits for a specific fiche
 */
export async function getAuditsByFiche(
  ficheId: string,
  includeDetails = false
): Promise<AuditWithConfig[]> {
  const audits = await auditsRepository.getAuditsByFiche(ficheId, includeDetails);

  return audits.map((audit) => ({
    // Keep resultData consistent with latest step rawResult overrides when available.
    resultData: mergeResultDataWithLatestStepRawResults({
      resultData: audit.resultData,
      stepResults: (() => {
        const maybe = (audit as unknown as { stepResults?: unknown }).stepResults;
        if (!Array.isArray(maybe)) {return [];}
        return maybe.filter(isRecord);
      })(),
    }),
    id: audit.id.toString(),
    ficheCacheId: audit.ficheCacheId.toString(),
    auditConfigId: audit.auditConfigId.toString(),
    automationScheduleId: audit.automationScheduleId
      ? audit.automationScheduleId.toString()
      : null,
    automationRunId: audit.automationRunId ? audit.automationRunId.toString() : null,
    triggerSource: audit.triggerSource ?? null,
    triggerUserId: audit.triggerUserId ?? null,
    notes: audit.notes ?? null,
    deletedAt: audit.deletedAt ?? null,
    overallScore: audit.overallScore.toString(),
    scorePercentage: audit.scorePercentage.toString(),
    niveau: toAuditNiveau(audit.niveau),
    isCompliant: audit.isCompliant,
    criticalPassed: audit.criticalPassed,
    criticalTotal: audit.criticalTotal,
    status: toAuditStatus(audit.status),
    startedAt: audit.startedAt,
    completedAt: audit.completedAt,
    durationMs: audit.durationMs,
    errorMessage: audit.errorMessage,
    totalTokens: audit.totalTokens,
    successfulSteps: audit.successfulSteps,
    failedSteps: audit.failedSteps,
    recordingsCount: audit.recordingsCount,
    timelineChunks: audit.timelineChunks,
    version: audit.version,
    isLatest: audit.isLatest,
    createdAt: audit.createdAt,
    updatedAt: audit.updatedAt,
    auditConfig: {
      id: audit.auditConfig.id.toString(),
      name: audit.auditConfig.name,
      description: audit.auditConfig.description,
    },
    automationSchedule: audit.automationSchedule
      ? {
          id: audit.automationSchedule.id.toString(),
          name: audit.automationSchedule.name,
        }
      : null,
    automationRun: audit.automationRun
      ? {
          id: audit.automationRun.id.toString(),
          status: audit.automationRun.status,
          startedAt: audit.automationRun.startedAt,
          completedAt: audit.automationRun.completedAt,
          scheduleId: audit.automationRun.scheduleId.toString(),
        }
      : null,
  }));
}

/**
 * List audits with advanced filtering and sorting
 */
export async function listAudits(filters: ListAuditsFilters): Promise<{
  audits: AuditWithFiche[];
  pagination: {
    total: number;
    limit: number;
    offset: number;
  };
}> {
  const result = await auditsRepository.listAudits(filters);

  // Transform to API-friendly format
  const audits: AuditWithFiche[] = result.audits.map((audit) => ({
    id: audit.id.toString(),
    ficheCacheId: audit.ficheCacheId.toString(),
    auditConfigId: audit.auditConfigId.toString(),
    automationScheduleId: audit.automationScheduleId
      ? audit.automationScheduleId.toString()
      : null,
    automationRunId: audit.automationRunId ? audit.automationRunId.toString() : null,
    triggerSource: audit.triggerSource ?? null,
    triggerUserId: audit.triggerUserId ?? null,
    notes: audit.notes ?? null,
    deletedAt: audit.deletedAt ?? null,
    overallScore: audit.overallScore.toString(),
    scorePercentage: audit.scorePercentage.toString(),
    niveau: toAuditNiveau(audit.niveau),
    isCompliant: audit.isCompliant,
    criticalPassed: audit.criticalPassed,
    criticalTotal: audit.criticalTotal,
    status: toAuditStatus(audit.status),
    startedAt: audit.startedAt,
    completedAt: audit.completedAt,
    durationMs: audit.durationMs,
    errorMessage: audit.errorMessage,
    totalTokens: audit.totalTokens,
    successfulSteps: audit.successfulSteps,
    failedSteps: audit.failedSteps,
    recordingsCount: audit.recordingsCount,
    timelineChunks: audit.timelineChunks,
    resultData: audit.resultData,
    version: audit.version,
    isLatest: audit.isLatest,
    createdAt: audit.createdAt,
    updatedAt: audit.updatedAt,
    ficheCache: {
      ficheId: audit.ficheCache.ficheId,
      groupe: audit.ficheCache.groupe,
      prospectNom: audit.ficheCache.prospectNom,
      prospectPrenom: audit.ficheCache.prospectPrenom,
    },
    auditConfig: {
      id: audit.auditConfig.id.toString(),
      name: audit.auditConfig.name,
      description: audit.auditConfig.description,
    },
    automationSchedule: audit.automationSchedule
      ? {
          id: audit.automationSchedule.id.toString(),
          name: audit.automationSchedule.name,
        }
      : null,
    automationRun: audit.automationRun
      ? {
          id: audit.automationRun.id.toString(),
          status: audit.automationRun.status,
          startedAt: audit.automationRun.startedAt,
          completedAt: audit.automationRun.completedAt,
          scheduleId: audit.automationRun.scheduleId.toString(),
        }
      : null,
  }));

  return {
    audits,
    pagination: {
      total: result.total,
      limit: result.limit,
      offset: result.offset,
    },
  };
}

/**
 * Group/aggregate audits (counts + score stats) for dashboards.
 */
export async function groupAudits(params: {
  filters: ListAuditsFilters;
  groupBy: auditsRepository.AuditGroupBy;
  bucketSize?: number;
}) {
  const result = await auditsRepository.groupAudits({
    filters: params.filters,
    groupBy: params.groupBy,
    bucketSize: params.bucketSize,
  });

  const totalPages = Math.ceil(result.totalGroups / result.limit);
  const currentPage = Math.floor(result.offset / result.limit) + 1;

  return {
    groups: result.groups,
    pagination: {
      total: result.totalGroups,
      limit: result.limit,
      offset: result.offset,
      current_page: currentPage,
      total_pages: totalPages,
      has_next_page: currentPage < totalPages,
      has_prev_page: currentPage > 1,
    },
    meta: {
      group_by: params.groupBy,
      bucket_size: result.bucketSize,
      truncated: result.truncated,
    },
  };
}

/**
 * Update audit metadata (notes / linkage / soft delete).
 */
export async function updateAuditMetadata(
  auditId: string | bigint,
  input: UpdateAuditInput
): Promise<AuditDetail | null> {
  const id = typeof auditId === "string" ? BigInt(auditId) : auditId;

  const parseNullableBigInt = (value: string | null | undefined): bigint | null | undefined => {
    if (value === undefined) {return undefined;}
    if (value === null) {return null;}
    const trimmed = value.trim();
    if (!trimmed) {return null;}
    if (!/^\d+$/.test(trimmed)) {return null;}
    try {
      return BigInt(trimmed);
    } catch {
      return null;
    }
  };

  await auditsRepository.updateAuditMetadata(id, {
    ...(Object.prototype.hasOwnProperty.call(input, "notes") ? { notes: input.notes } : {}),
    ...(typeof input.deleted === "boolean" ? { deleted: input.deleted } : {}),
    ...(Object.prototype.hasOwnProperty.call(input, "automation_schedule_id")
      ? { automationScheduleId: parseNullableBigInt(input.automation_schedule_id) ?? null }
      : {}),
    ...(Object.prototype.hasOwnProperty.call(input, "automation_run_id")
      ? { automationRunId: parseNullableBigInt(input.automation_run_id) ?? null }
      : {}),
    ...(Object.prototype.hasOwnProperty.call(input, "trigger_source")
      ? { triggerSource: input.trigger_source ?? null }
      : {}),
    ...(Object.prototype.hasOwnProperty.call(input, "trigger_user_id")
      ? { triggerUserId: input.trigger_user_id ?? null }
      : {}),
  });

  return await getAuditById(id);
}

// ═══════════════════════════════════════════════════════════════════════════
// HUMAN REVIEW / OVERRIDES
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Apply a human review override to a single step result within an audit.
 *
 * This updates the DB step summary fields (so existing APIs reflect the override),
 * while keeping an audit trail inside `rawResult.human_review`.
 */
export async function reviewAuditStepResult(
  auditId: string | bigint,
  stepPosition: number,
  input: ReviewAuditStepResultInput
) {
  const id = typeof auditId === "string" ? BigInt(auditId) : auditId;

  const updated = await auditsRepository.applyHumanReviewToAuditStepResult(
    id,
    stepPosition,
    input
  );

  if (!updated) {
    throw new NotFoundError(
      "Audit step result",
      `${id.toString()}:${stepPosition}`
    );
  }

  // Recompute audit-level compliance summary so the audit reflects the human override too.
  // This keeps list/detail endpoints consistent with reviewed step results.
  const complianceInputs = await auditsRepository.getAuditComplianceInputs(id);
  if (complianceInputs) {
    const totalWeight = complianceInputs.stepResults.reduce(
      (sum, s) => sum + Math.max(0, Number(s.weight)),
      0
    );
    const earnedWeight = complianceInputs.stepResults.reduce((sum, s) => {
      const maxWeight = Math.max(0, Number(s.weight));
      const rawScore = Number(s.score);
      const capped = Math.min(Math.max(0, rawScore), maxWeight);
      return sum + capped;
    }, 0);
    const score = totalWeight > 0 ? (earnedWeight / totalWeight) * 100 : 0;

    const criticalTotal = complianceInputs.stepResults.filter(
      (s) => Boolean(s.isCritical)
    ).length;
    const criticalPassed = complianceInputs.stepResults.filter(
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

    try {
      await auditsRepository.updateAuditComplianceSummary(id, {
        scorePercentage: Number(score.toFixed(2)),
        niveau,
        isCompliant: niveau !== "REJET",
        criticalPassed,
        criticalTotal,
      });
    } catch (err) {
      // Best-effort: do not block the step review write.
      const errorMessage = err instanceof Error ? err.message : String(err);
      logger.warn("Failed to update audit compliance after human review", {
        audit_id: id.toString(),
        step_position: stepPosition,
        error: errorMessage,
      });
    }
  }

  return toAuditStepResult(updated);
}

// ═══════════════════════════════════════════════════════════════════════════
// CONTROL POINTS ("CHECKPOINTS") ACCESS / HUMAN REVIEW
// ═══════════════════════════════════════════════════════════════════════════

type AuditControlPointStatus = {
  auditId: string;
  stepPosition: number;
  controlPointIndex: number;
  point: string;
  statut: string;
  commentaire: string;
};

/**
 * Get the current status/comment for a single checkpoint (control point) within a step.
 *
 * Reads from `audit_step_results.raw_result.points_controle[i]`.
 */
export async function getAuditControlPointStatus(
  auditId: string | bigint,
  stepPosition: number,
  controlPointIndex: number
): Promise<AuditControlPointStatus> {
  const id = typeof auditId === "string" ? BigInt(auditId) : auditId;

  const cp = await auditsRepository.getAuditStepControlPointSummary(
    id,
    stepPosition,
    controlPointIndex
  );

  if (!cp) {
    throw new NotFoundError(
      "Audit control point",
      `${id.toString()}:${stepPosition}:${controlPointIndex}`
    );
  }

  return {
    auditId: id.toString(),
    stepPosition,
    controlPointIndex,
    point: cp.point,
    statut: cp.statut,
    commentaire: cp.commentaire,
  };
}

/**
 * Apply a human override to a single checkpoint (control point) within a step.
 *
 * Persists the update inside `rawResult.points_controle[i]` and appends an audit-trail entry to
 * `rawResult.human_review`.
 */
export async function reviewAuditControlPoint(
  auditId: string | bigint,
  stepPosition: number,
  controlPointIndex: number,
  input: ReviewAuditControlPointInput
): Promise<AuditControlPointStatus> {
  const id = typeof auditId === "string" ? BigInt(auditId) : auditId;

  const updated = await auditsRepository.applyHumanReviewToAuditControlPoint(
    id,
    stepPosition,
    controlPointIndex,
    input
  );

  if (!updated) {
    throw new NotFoundError(
      "Audit control point",
      `${id.toString()}:${stepPosition}:${controlPointIndex}`
    );
  }

  // Re-read the updated control point (cheap + avoids duplicating raw parsing logic here).
  return await getAuditControlPointStatus(id, stepPosition, controlPointIndex);
}

/**
 * Get audits grouped by fiches with summary statistics
 * This function adds business logic for calculating summaries and sorting
 */
export async function getAuditsGroupedByFiches(filters: ListAuditsFilters): Promise<{
  data: FicheWithAudits[];
  pagination: {
    total: number;
    limit: number;
    offset: number;
  };
}> {
  // Get raw data from repository
  const rawResult = await auditsRepository.getAuditsGroupedByFichesRaw(filters);

  // BUSINESS LOGIC: Calculate summaries and enrich data
  const fichesWithAudits: FicheWithAudits[] = rawResult.fiches.map((ficheData) => {
    const audits = ficheData.audits.map((audit) => ({
      id: audit.id.toString(),
      ficheCacheId: audit.ficheCacheId.toString(),
      auditConfigId: audit.auditConfigId.toString(),
      automationScheduleId: audit.automationScheduleId
        ? audit.automationScheduleId.toString()
        : null,
      automationRunId: audit.automationRunId ? audit.automationRunId.toString() : null,
      triggerSource: audit.triggerSource ?? null,
      triggerUserId: audit.triggerUserId ?? null,
      notes: audit.notes ?? null,
      deletedAt: audit.deletedAt ?? null,
      overallScore: audit.overallScore.toString(),
      scorePercentage: audit.scorePercentage.toString(),
      niveau: toAuditNiveau(audit.niveau),
      isCompliant: audit.isCompliant,
      criticalPassed: audit.criticalPassed,
      criticalTotal: audit.criticalTotal,
      status: toAuditStatus(audit.status),
      startedAt: audit.startedAt,
      completedAt: audit.completedAt,
      durationMs: audit.durationMs,
      errorMessage: audit.errorMessage,
      totalTokens: audit.totalTokens,
      successfulSteps: audit.successfulSteps,
      failedSteps: audit.failedSteps,
      recordingsCount: audit.recordingsCount,
      timelineChunks: audit.timelineChunks,
      resultData: audit.resultData,
      version: audit.version,
      isLatest: audit.isLatest,
      createdAt: audit.createdAt,
      updatedAt: audit.updatedAt,
      auditConfig: {
        id: audit.auditConfig.id.toString(),
        name: audit.auditConfig.name,
        description: audit.auditConfig.description,
      },
      automationSchedule: (() => {
        const schedule = (audit as unknown as { automationSchedule?: unknown }).automationSchedule;
        if (!isRecord(schedule)) {return null;}
        return {
          id: String(schedule.id),
          name: String(schedule.name),
        };
      })(),
      automationRun: (() => {
        const run = (audit as unknown as { automationRun?: unknown }).automationRun;
        if (!isRecord(run)) {return null;}
        return {
          id: String(run.id),
          status: String(run.status),
          startedAt: run.startedAt as Date,
          completedAt: (run.completedAt as Date | null) ?? null,
          scheduleId: String(run.scheduleId),
        };
      })(),
    }));

    // Calculate latest audit date
    const latestAuditDate =
      audits.length > 0
        ? audits.reduce((latest, audit) => {
            return audit.createdAt > latest ? audit.createdAt : latest;
          }, audits[0].createdAt)
        : null;

    // Calculate summary statistics
    const summary = {
      totalAudits: audits.length,
      compliantCount: audits.filter((a) => a.isCompliant).length,
      averageScore:
        audits.length > 0
          ? audits.reduce((sum, a) => sum + Number(a.scorePercentage), 0) /
            audits.length
          : 0,
      latestAuditDate,
    };

    return {
      fiche: {
        id: ficheData.id.toString(),
        ficheId: ficheData.ficheId,
        groupe: ficheData.groupe,
        agenceNom: ficheData.agenceNom,
        prospectNom: ficheData.prospectNom,
        prospectPrenom: ficheData.prospectPrenom,
        prospectEmail: ficheData.prospectEmail,
        prospectTel: ficheData.prospectTel,
        hasRecordings: ficheData.hasRecordings,
        recordingsCount: ficheData.recordingsCount,
        fetchedAt: ficheData.fetchedAt,
        createdAt: ficheData.createdAt,
        updatedAt: ficheData.updatedAt,
      },
      audits,
      summary,
    };
  });

  // BUSINESS LOGIC: Sort by latest audit date
  fichesWithAudits.sort((a, b) => {
    const aTime = a.summary.latestAuditDate?.getTime() || 0;
    const bTime = b.summary.latestAuditDate?.getTime() || 0;

    // Fiches with audits come first
    if (aTime === 0 && bTime === 0) {return 0;}
    if (aTime === 0) {return 1;}
    if (bTime === 0) {return -1;}

    // Sort by most recent first
    return bTime - aTime;
  });

  // BUSINESS LOGIC: Apply pagination after sorting
  const limit = filters.limit || 100;
  const offset = filters.offset || 0;
  const paginatedFiches = fichesWithAudits.slice(offset, offset + limit);

  return {
    data: paginatedFiches,
    pagination: {
      total: rawResult.total,
      limit,
      offset,
    },
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// AUDIT EXECUTION (Re-export from runner for now)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Run complete audit pipeline
 * NOTE: This currently delegates to audits.runner.ts
 * In future refactoring, move the full implementation here
 */
export { runAudit } from "./audits.runner.js";

/**
 * Analyze audit steps
 * NOTE: This currently delegates to audits.analyzer.ts
 * In future refactoring, move the full implementation here
 */
export { analyzeAllSteps,analyzeStep } from "./audits.analyzer.js";

/**
 * Generate timeline from transcriptions
 * NOTE: This currently delegates to audits.timeline.ts
 */
export { generateTimeline } from "./audits.timeline.js";

// ═══════════════════════════════════════════════════════════════════════════
// STATISTICS & ANALYTICS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Get summary statistics for an audit
 */
export async function getAuditSummary(
  auditId: string | bigint
): Promise<AuditSummary | null> {
  const audit = await getAuditById(auditId);

  if (!audit) {
    return null;
  }

  return {
    id: audit.id,
    ficheId: audit.ficheCache.ficheId,
    auditConfigId: audit.auditConfigId,
    auditConfigName: audit.auditConfig.name,
    status: audit.status,
    scorePercentage: audit.scorePercentage,
    niveau: audit.niveau,
    isCompliant: audit.isCompliant,
    completedAt: audit.completedAt,
    durationMs: audit.durationMs,
    createdAt: audit.createdAt,
  };
}

/**
 * Get aggregated statistics for audits of a specific fiche
 */
export async function getFicheAuditStatistics(ficheId: string): Promise<{
  totalAudits: number;
  completedAudits: number;
  compliantAudits: number;
  averageScore: number | null;
  averageDuration: number | null;
  latestAudit: AuditSummary | null;
}> {
  const audits = await getAuditsByFiche(ficheId, false);

  const completedAudits = audits.filter((a) => a.status === "completed");
  const compliantAudits = completedAudits.filter((a) => a.isCompliant);

  const averageScore =
    completedAudits.length > 0
      ? completedAudits.reduce((sum, a) => sum + Number(a.scorePercentage), 0) /
        completedAudits.length
      : null;

  const averageDuration =
    completedAudits.length > 0
      ? completedAudits.reduce((sum, a) => sum + (a.durationMs || 0), 0) /
        completedAudits.length
      : null;

  const latestAudit =
    audits.length > 0 ? await getAuditSummary(audits[0].id) : null;

  return {
    totalAudits: audits.length,
    completedAudits: completedAudits.length,
    compliantAudits: compliantAudits.length,
    averageScore,
    averageDuration,
    latestAudit,
  };
}

/**
 * Get global audit statistics across all fiches
 */
export async function getGlobalAuditStatistics(filters?: {
  dateFrom?: Date;
  dateTo?: Date;
  auditConfigIds?: string[];
}): Promise<{
  totalAudits: number;
  completedAudits: number;
  failedAudits: number;
  compliantAudits: number;
  complianceRate: number;
  averageScore: number | null;
  averageDuration: number | null;
}> {
  const auditConfigIds = (filters?.auditConfigIds || [])
    .map((s) => (typeof s === "string" ? s.trim() : ""))
    .filter(Boolean);
  const auditConfigBigInts: bigint[] = [];
  for (const id of auditConfigIds) {
    if (!/^\d+$/.test(id)) {continue;}
    try {
      auditConfigBigInts.push(BigInt(id));
    } catch {
      // ignore invalid
    }
  }

  const where: Prisma.AuditWhereInput = {
    ...(filters?.dateFrom ? { createdAt: { gte: filters.dateFrom } } : {}),
    ...(filters?.dateTo ? { createdAt: { lte: filters.dateTo } } : {}),
    ...(auditConfigBigInts.length > 0 ? { auditConfigId: { in: auditConfigBigInts } } : {}),
    isLatest: true,
    deletedAt: null,
  };

  const whereCompleted: Prisma.AuditWhereInput = { ...where, status: "completed" };
  const whereFailed: Prisma.AuditWhereInput = { ...where, status: "failed" };

  const [totalAudits, completedAudits, failedAudits, compliantAudits, aggregates] =
    await Promise.all([
      prisma.audit.count({ where }),
      prisma.audit.count({ where: whereCompleted }),
      prisma.audit.count({ where: whereFailed }),
      prisma.audit.count({ where: { ...whereCompleted, isCompliant: true } }),
      prisma.audit.aggregate({
        where: whereCompleted,
        _avg: { scorePercentage: true, durationMs: true },
      }),
    ]);

  const averageScore =
    aggregates._avg.scorePercentage !== null && aggregates._avg.scorePercentage !== undefined
      ? Number(aggregates._avg.scorePercentage)
      : null;
  const averageDuration =
    aggregates._avg.durationMs !== null && aggregates._avg.durationMs !== undefined
      ? Number(aggregates._avg.durationMs)
      : null;
  const complianceRate = completedAudits > 0 ? (compliantAudits / completedAudits) * 100 : 0;

  return {
    totalAudits,
    completedAudits,
    failedAudits,
    compliantAudits,
    complianceRate,
    averageScore,
    averageDuration,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// HELPER FUNCTIONS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Check if a fiche has existing audits
 */
export async function hasAudits(ficheId: string): Promise<boolean> {
  const audits = await auditsRepository.getAuditsByFiche(ficheId, false);
  return audits.length > 0;
}

/**
 * Get latest audit for a fiche
 */
export async function getLatestAudit(ficheId: string): Promise<AuditSummary | null> {
  const audits = await getAuditsByFiche(ficheId, false);

  if (audits.length === 0) {
    return null;
  }

  return getAuditSummary(audits[0].id);
}

/**
 * Check audit compliance status
 */
export function isAuditCompliant(audit: Audit | AuditDetail): boolean {
  return audit.isCompliant && audit.status === "completed";
}

/**
 * Calculate compliance rate for a set of audits
 */
export function calculateComplianceRate(audits: Audit[]): number {
  const completedAudits = audits.filter((a) => a.status === "completed");

  if (completedAudits.length === 0) {
    return 0;
  }

  const compliantCount = completedAudits.filter((a) => a.isCompliant).length;
  return (compliantCount / completedAudits.length) * 100;
}

