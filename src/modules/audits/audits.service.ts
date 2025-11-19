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
} from "./audits.schemas.js";
import * as auditsRepository from "./audits.repository.js";
import { logger } from "../../shared/logger.js";

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
    overallScore: audit.overallScore.toString(),
    scorePercentage: audit.scorePercentage.toString(),
    niveau: audit.niveau as any,
    isCompliant: audit.isCompliant,
    criticalPassed: audit.criticalPassed,
    criticalTotal: audit.criticalTotal,
    status: audit.status as any,
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
    stepResults: audit.stepResults.map((step) => ({
      id: step.id.toString(),
      auditId: step.auditId.toString(),
      stepPosition: step.stepPosition,
      stepName: step.stepName,
      severityLevel: step.severityLevel,
      isCritical: step.isCritical,
      weight: step.weight,
      traite: step.traite,
      conforme: step.conforme as any,
      score: step.score,
      niveauConformite: step.niveauConformite as any,
      commentaireGlobal: step.commentaireGlobal,
      motsClesTrouves: step.motsClesTrouves,
      minutages: step.minutages,
      erreursTranscriptionTolerees: step.erreursTranscriptionTolerees,
      totalCitations: step.totalCitations,
      totalTokens: step.totalTokens,
      createdAt: step.createdAt,
    })),
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
    overallScore: audit.overallScore.toString(),
    scorePercentage: audit.scorePercentage.toString(),
    niveau: audit.niveau as any,
    isCompliant: audit.isCompliant,
    criticalPassed: audit.criticalPassed,
    criticalTotal: audit.criticalTotal,
    status: audit.status as any,
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
  // Convert string IDs to BigInt for repository
  const repositoryFilters = {
    ...filters,
    auditConfigIds: filters.auditConfigIds?.map((id) => BigInt(id)),
  };

  const result = await auditsRepository.listAudits(repositoryFilters as any);

  // Transform to API-friendly format
  const audits: AuditWithFiche[] = result.audits.map((audit) => ({
    id: audit.id.toString(),
    ficheCacheId: audit.ficheCacheId.toString(),
    auditConfigId: audit.auditConfigId.toString(),
    overallScore: audit.overallScore.toString(),
    scorePercentage: audit.scorePercentage.toString(),
    niveau: audit.niveau as any,
    isCompliant: audit.isCompliant,
    criticalPassed: audit.criticalPassed,
    criticalTotal: audit.criticalTotal,
    status: audit.status as any,
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
  // Convert string IDs to BigInt for repository
  const repositoryFilters = {
    ...filters,
    auditConfigIds: filters.auditConfigIds?.map((id) => BigInt(id)),
  };

  // Get raw data from repository
  const rawResult = await auditsRepository.getAuditsGroupedByFichesRaw(
    repositoryFilters as any
  );

  // BUSINESS LOGIC: Calculate summaries and enrich data
  const fichesWithAudits: FicheWithAudits[] = rawResult.fiches.map((ficheData) => {
    const audits = ficheData.audits.map((audit) => ({
      id: audit.id.toString(),
      ficheCacheId: audit.ficheCacheId.toString(),
      auditConfigId: audit.auditConfigId.toString(),
      overallScore: audit.overallScore.toString(),
      scorePercentage: audit.scorePercentage.toString(),
      niveau: audit.niveau as any,
      isCompliant: audit.isCompliant,
      criticalPassed: audit.criticalPassed,
      criticalTotal: audit.criticalTotal,
      status: audit.status as any,
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
 * Check if a fiche has any audits
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

