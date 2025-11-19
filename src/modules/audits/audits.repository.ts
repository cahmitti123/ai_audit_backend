/**
 * Audits Repository
 * =================
 * RESPONSIBILITY: Direct database operations
 * - CRUD operations for audits and step results
 * - Database queries and mutations
 * - No business logic
 * - No data transformations (except simple mapping)
 *
 * LAYER: Data Access
 */

import { prisma } from "../../shared/prisma.js";

// ═══════════════════════════════════════════════════════════════════════════
// UTILITIES
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Sanitize data by removing null bytes (\u0000) which PostgreSQL cannot store in text fields
 * This is common with LLM outputs that may contain null characters
 */
function sanitizeNullBytes(data: any): any {
  if (data === null || data === undefined) {
    return data;
  }

  if (typeof data === "string") {
    // Remove null bytes from strings
    return data.replace(/\u0000/g, "");
  }

  if (Array.isArray(data)) {
    // Recursively sanitize array elements
    return data.map((item) => sanitizeNullBytes(item));
  }

  if (typeof data === "object") {
    // Recursively sanitize object properties
    const sanitized: any = {};
    for (const [key, value] of Object.entries(data)) {
      sanitized[key] = sanitizeNullBytes(value);
    }
    return sanitized;
  }

  // Return primitives as-is (numbers, booleans, etc.)
  return data;
}

// ═══════════════════════════════════════════════════════════════════════════
// TYPES (moved from export to internal use)
// ═══════════════════════════════════════════════════════════════════════════

export interface ListAuditsFilters {
  ficheIds?: string[];
  status?: string[];
  isCompliant?: boolean;
  dateFrom?: Date;
  dateTo?: Date;
  auditConfigIds?: bigint[];
  sortBy?: "created_at" | "completed_at" | "score_percentage" | "duration_ms";
  sortOrder?: "asc" | "desc";
  limit?: number;
  offset?: number;
}

/**
 * Create audit record when workflow starts
 */
export async function createPendingAudit(
  ficheCacheId: bigint,
  auditConfigId: bigint,
  auditId?: string
) {
  return await prisma.audit.create({
    data: {
      ficheCacheId,
      auditConfigId,
      overallScore: 0,
      scorePercentage: 0,
      niveau: "PENDING",
      isCompliant: false,
      criticalPassed: 0,
      criticalTotal: 0,
      status: "running",
      startedAt: new Date(),
      resultData: {
        audit_id: auditId,
        status: "running",
        started_at: new Date().toISOString(),
      },
    },
  });
}

/**
 * Update audit with results when workflow completes
 */
export async function updateAuditWithResults(
  auditDbId: bigint,
  auditResult: any
) {
  // Sanitize the audit result to remove null bytes that PostgreSQL cannot handle
  const sanitizedResult = sanitizeNullBytes(auditResult);

  return await prisma.audit.update({
    where: { id: auditDbId },
    data: {
      overallScore: sanitizedResult.audit.compliance.score,
      scorePercentage: sanitizedResult.audit.compliance.score,
      niveau: sanitizedResult.audit.compliance.niveau,
      isCompliant: sanitizedResult.audit.compliance.niveau !== "REJET",
      criticalPassed: parseInt(
        sanitizedResult.audit.compliance.points_critiques.split("/")[0]
      ),
      criticalTotal: parseInt(
        sanitizedResult.audit.compliance.points_critiques.split("/")[1]
      ),
      status: "completed",
      completedAt: new Date(sanitizedResult.metadata.completed_at),
      durationMs: sanitizedResult.metadata.duration_ms,
      totalTokens: sanitizedResult.statistics.total_tokens,
      successfulSteps: sanitizedResult.statistics.successful_steps,
      failedSteps: sanitizedResult.statistics.failed_steps,
      recordingsCount: sanitizedResult.statistics.recordings_count,
      timelineChunks: sanitizedResult.statistics.timeline_chunks,
      resultData: sanitizedResult,
      stepResults: {
        create: sanitizedResult.audit.results.steps.map(
          (step: any, index: number) => ({
            stepPosition: step.step_metadata?.position || index + 1,
            stepName: step.step_metadata?.name || "",
            severityLevel: step.step_metadata?.severity || "MEDIUM",
            isCritical: step.step_metadata?.is_critical || false,
            weight: step.step_metadata?.weight || 5,
            traite: step.traite,
            conforme: step.conforme,
            score: step.score,
            niveauConformite: step.niveau_conformite,
            commentaireGlobal: step.commentaire_global,
            motsClesTrouves: step.mots_cles_trouves || [],
            minutages: step.minutages || [],
            erreursTranscriptionTolerees:
              step.erreurs_transcription_tolerees || 0,
            totalCitations:
              step.points_controle?.reduce(
                (sum: number, pc: any) => sum + (pc.citations?.length || 0),
                0
              ) || 0,
            totalTokens: step.usage?.total_tokens || 0,
          })
        ),
      },
    },
    include: {
      stepResults: true,
    },
  });
}

/**
 * Update audit status to failed
 */
export async function markAuditAsFailed(
  auditDbId: bigint,
  errorMessage: string
) {
  return await prisma.audit.update({
    where: { id: auditDbId },
    data: {
      status: "failed",
      errorMessage,
      completedAt: new Date(),
    },
  });
}

/**
 * Save audit result to database (LEGACY - for backwards compatibility)
 * This creates a completed audit directly. New code should use createPendingAudit + updateAuditWithResults
 */
export async function saveAuditResult(auditResult: any, ficheCacheId: bigint) {
  return await prisma.audit.create({
    data: {
      ficheCacheId,
      auditConfigId: BigInt(auditResult.audit.config.id),
      overallScore: auditResult.audit.compliance.score, // PERCENTAGE (0-100)
      scorePercentage: auditResult.audit.compliance.score, // PERCENTAGE (0-100) - same value for compatibility
      niveau: auditResult.audit.compliance.niveau,
      isCompliant: auditResult.audit.compliance.niveau !== "REJET",
      criticalPassed: parseInt(
        auditResult.audit.compliance.points_critiques.split("/")[0]
      ),
      criticalTotal: parseInt(
        auditResult.audit.compliance.points_critiques.split("/")[1]
      ),
      status: "completed",
      startedAt: new Date(auditResult.metadata.started_at),
      completedAt: new Date(auditResult.metadata.completed_at),
      durationMs: auditResult.metadata.duration_ms,
      totalTokens: auditResult.statistics.total_tokens,
      successfulSteps: auditResult.statistics.successful_steps,
      failedSteps: auditResult.statistics.failed_steps,
      recordingsCount: auditResult.statistics.recordings_count,
      timelineChunks: auditResult.statistics.timeline_chunks,
      resultData: auditResult,
      stepResults: {
        create: auditResult.audit.results.steps.map(
          (step: any, index: number) => ({
            stepPosition: step.step_metadata?.position || index + 1,
            stepName: step.step_metadata?.name || "",
            severityLevel: step.step_metadata?.severity || "MEDIUM",
            isCritical: step.step_metadata?.is_critical || false,
            weight: step.step_metadata?.weight || 5,
            traite: step.traite,
            conforme: step.conforme,
            score: step.score,
            niveauConformite: step.niveau_conformite,
            commentaireGlobal: step.commentaire_global,
            motsClesTrouves: step.mots_cles_trouves || [],
            minutages: step.minutages || [],
            erreursTranscriptionTolerees:
              step.erreurs_transcription_tolerees || 0,
            totalCitations:
              step.points_controle?.reduce(
                (sum: number, pc: any) => sum + (pc.citations?.length || 0),
                0
              ) || 0,
            totalTokens: step.usage?.total_tokens || 0,
          })
        ),
      },
    },
    include: {
      stepResults: true,
    },
  });
}

/**
 * Get all audits for a fiche
 */
export async function getAuditsByFiche(
  ficheId: string,
  includeDetails = false
) {
  return await prisma.audit.findMany({
    where: {
      ficheCache: { ficheId },
      isLatest: true,
    },
    include: {
      auditConfig: {
        select: {
          id: true,
          name: true,
          description: true,
        },
      },
      stepResults: true,
    },
    orderBy: {
      createdAt: "desc",
    },
  });
}

/**
 * Get audit by ID
 */
export async function getAuditById(auditId: bigint) {
  return await prisma.audit.findUnique({
    where: { id: auditId },
    include: {
      ficheCache: true,
      auditConfig: {
        include: {
          steps: {
            orderBy: { position: "asc" },
          },
        },
      },
      stepResults: {
        orderBy: {
          stepPosition: "asc",
        },
      },
    },
  });
}

/**
 * List audits with advanced filtering and sorting
 */
export async function listAudits(filters: ListAuditsFilters = {}) {
  const {
    ficheIds,
    status,
    isCompliant,
    dateFrom,
    dateTo,
    auditConfigIds,
    sortBy = "created_at",
    sortOrder = "desc",
    limit = 100,
    offset = 0,
  } = filters;

  // Build where clause
  const where: any = {
    isLatest: true,
  };

  // Filter by fiche IDs
  if (ficheIds && ficheIds.length > 0) {
    where.ficheCache = {
      ficheId: { in: ficheIds },
    };
  }

  // Filter by status
  if (status && status.length > 0) {
    where.status = { in: status };
  }

  // Filter by compliance
  if (isCompliant !== undefined) {
    where.isCompliant = isCompliant;
  }

  // Filter by date range
  if (dateFrom || dateTo) {
    where.createdAt = {};
    if (dateFrom) {
      where.createdAt.gte = dateFrom;
    }
    if (dateTo) {
      where.createdAt.lte = dateTo;
    }
  }

  // Filter by audit config IDs
  if (auditConfigIds && auditConfigIds.length > 0) {
    where.auditConfigId = {
      in: auditConfigIds.map((id) => BigInt(id)),
    };
  }

  // Build orderBy
  const orderBy: any = {};
  switch (sortBy) {
    case "created_at":
      orderBy.createdAt = sortOrder;
      break;
    case "completed_at":
      orderBy.completedAt = sortOrder;
      break;
    case "score_percentage":
      orderBy.scorePercentage = sortOrder;
      break;
    case "duration_ms":
      orderBy.durationMs = sortOrder;
      break;
    default:
      orderBy.createdAt = sortOrder;
  }

  // Execute query with count
  const [audits, total] = await Promise.all([
    prisma.audit.findMany({
      where,
      include: {
        ficheCache: {
          select: {
            ficheId: true,
            groupe: true,
            prospectNom: true,
            prospectPrenom: true,
          },
        },
        auditConfig: {
          select: {
            id: true,
            name: true,
            description: true,
          },
        },
      },
      orderBy,
      take: limit,
      skip: offset,
    }),
    prisma.audit.count({ where }),
  ]);

  return { audits, total, limit, offset };
}

/**
 * Get audits grouped by fiches (raw data without business logic)
 * Returns raw Prisma data - transformations should be done in service layer
 */
export async function getAuditsGroupedByFichesRaw(
  filters: ListAuditsFilters = {}
) {
  const {
    ficheIds,
    status,
    isCompliant,
    dateFrom,
    dateTo,
    auditConfigIds,
    sortBy = "created_at",
    sortOrder = "desc",
    limit = 100,
    offset = 0,
  } = filters;

  // Build where clause for audits
  const auditWhere: any = {
    isLatest: true,
  };

  // Filter by status
  if (status && status.length > 0) {
    auditWhere.status = { in: status };
  }

  // Filter by compliance
  if (isCompliant !== undefined) {
    auditWhere.isCompliant = isCompliant;
  }

  // Filter by date range
  if (dateFrom || dateTo) {
    auditWhere.createdAt = {};
    if (dateFrom) {
      auditWhere.createdAt.gte = dateFrom;
    }
    if (dateTo) {
      auditWhere.createdAt.lte = dateTo;
    }
  }

  // Filter by audit config IDs
  if (auditConfigIds && auditConfigIds.length > 0) {
    auditWhere.auditConfigId = {
      in: auditConfigIds.map((id) => BigInt(id)),
    };
  }

  // Build where clause for fiches
  const ficheWhere: any = {};

  // Filter by fiche IDs
  if (ficheIds && ficheIds.length > 0) {
    ficheWhere.ficheId = { in: ficheIds };
  }

  // Add audit filter to fiche where clause
  if (Object.keys(auditWhere).length > 0) {
    ficheWhere.audits = {
      some: auditWhere,
    };
  }

  // Build orderBy for audits
  const auditOrderBy: any = {};
  switch (sortBy) {
    case "created_at":
      auditOrderBy.createdAt = sortOrder;
      break;
    case "completed_at":
      auditOrderBy.completedAt = sortOrder;
      break;
    case "score_percentage":
      auditOrderBy.scorePercentage = sortOrder;
      break;
    case "duration_ms":
      auditOrderBy.durationMs = sortOrder;
      break;
    default:
      auditOrderBy.createdAt = sortOrder;
  }

  // Fetch ALL fiches with their audits (we'll sort and paginate in memory)
  const [allFiches, totalFiches] = await Promise.all([
    prisma.ficheCache.findMany({
      where: ficheWhere,
      include: {
        audits: {
          where: auditWhere,
          include: {
            auditConfig: {
              select: {
                id: true,
                name: true,
                description: true,
              },
            },
            stepResults: {
              select: {
                id: true,
                stepPosition: true,
                stepName: true,
                conforme: true,
                score: true,
                niveauConformite: true,
              },
              orderBy: {
                stepPosition: "asc",
              },
            },
          },
          orderBy: auditOrderBy,
        },
      },
    }),
    prisma.ficheCache.count({ where: ficheWhere }),
  ]);

  // Return raw data - let service layer handle transformations, sorting, pagination
  return {
    fiches: allFiches,
    total: totalFiches,
  };
}
