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

import type {
  Audit,
  AuditDetail,
  AuditSummary,
  AuditWithConfig,
  AuditWithFiche,
  FicheWithAudits,
  ListAuditsFilters,
  RunAuditInput,
  AuditFunctionResult,
  ReviewAuditStepResultInput,
  ReviewAuditControlPointInput,
  UpdateAuditInput,
} from "./audits.schemas.js";
import {
  auditNiveauEnum,
  auditStatusEnum,
  stepConformeEnum,
  stepNiveauConformiteEnum,
  type AuditNiveau,
  type AuditStatus,
  type StepConforme,
  type StepNiveauConformite,
} from "./audits.schemas.js";
import * as auditsRepository from "./audits.repository.js";
import { logger } from "../../shared/logger.js";
import { NotFoundError } from "../../shared/errors.js";
import { COMPLIANCE_THRESHOLDS } from "../../shared/constants.js";

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
  if (parsed.success) return parsed.data;
  logger.warn("Unknown audit niveau value from DB", { value });
  return "INSUFFISANT";
}

function toAuditStatus(value: string): AuditStatus {
  const parsed = auditStatusEnum.safeParse(value);
  if (parsed.success) return parsed.data;
  logger.warn("Unknown audit status value from DB", { value });
  return "failed";
}

function toStepConforme(value: string): StepConforme {
  const parsed = stepConformeEnum.safeParse(value);
  if (parsed.success) return parsed.data;
  logger.warn("Unknown step conforme value from DB", { value });
  return "NON_CONFORME";
}

function toStepNiveauConformite(value: string): StepNiveauConformite {
  const parsed = stepNiveauConformiteEnum.safeParse(value);
  if (parsed.success) return parsed.data;
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
    if (value === undefined) return undefined;
    if (value === null) return null;
    const trimmed = value.trim();
    if (!trimmed) return null;
    if (!/^\d+$/.test(trimmed)) return null;
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
      automationSchedule: (audit as any).automationSchedule
        ? {
            id: String((audit as any).automationSchedule.id),
            name: String((audit as any).automationSchedule.name),
          }
        : null,
      automationRun: (audit as any).automationRun
        ? {
            id: String((audit as any).automationRun.id),
            status: String((audit as any).automationRun.status),
            startedAt: (audit as any).automationRun.startedAt as Date,
            completedAt: ((audit as any).automationRun.completedAt as Date | null) ?? null,
            scheduleId: String((audit as any).automationRun.scheduleId),
          }
        : null,
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
    if (aTime === 0 && bTime === 0) return 0;
    if (aTime === 0) return 1;
    if (bTime === 0) return -1;

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
export { analyzeStep, analyzeAllSteps } from "./audits.analyzer.js";

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
  const { audits } = await listAudits({
    dateFrom: filters?.dateFrom,
    dateTo: filters?.dateTo,
    auditConfigIds: filters?.auditConfigIds,
    latestOnly: true,
    includeDeleted: false,
    limit: 10000, // Get all for stats
    sortBy: "created_at",
    sortOrder: "desc",
    offset: 0,
  });

  const completedAudits = audits.filter((a) => a.status === "completed");
  const failedAudits = audits.filter((a) => a.status === "failed");
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

  const complianceRate =
    completedAudits.length > 0
      ? (compliantAudits.length / completedAudits.length) * 100
      : 0;

  return {
    totalAudits: audits.length,
    completedAudits: completedAudits.length,
    failedAudits: failedAudits.length,
    compliantAudits: compliantAudits.length,
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

