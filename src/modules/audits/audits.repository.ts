/**
 * Audits Repository
 * =================
 * Database operations for audit results
 */

import { prisma } from "../../shared/prisma.js";

/**
 * Save audit result to database
 */
export async function saveAuditResult(auditResult: any, ficheCacheId: bigint) {
  return await prisma.audit.create({
    data: {
      ficheCacheId,
      auditConfigId: BigInt(auditResult.audit.config.id),
      overallScore: auditResult.audit.compliance.poids_obtenu,
      scorePercentage: auditResult.audit.compliance.score,
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
      stepResults: includeDetails
        ? {
            include: {
              controlPoints: {
                include: {
                  citations: true,
                },
              },
            },
          }
        : true,
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
        include: {
          controlPoints: {
            include: {
              citations: true,
            },
          },
          citations: true,
        },
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
export interface ListAuditsFilters {
  ficheIds?: string[];
  status?: string[];
  isCompliant?: boolean;
  dateFrom?: Date;
  dateTo?: Date;
  auditConfigIds?: string[];
  sortBy?: "created_at" | "completed_at" | "score_percentage" | "duration_ms";
  sortOrder?: "asc" | "desc";
  limit?: number;
  offset?: number;
}

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
