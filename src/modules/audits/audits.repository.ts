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
import type { Prisma } from "@prisma/client";
import type { ListAuditsFilters } from "./audits.schemas.js";

// ═══════════════════════════════════════════════════════════════════════════
// UTILITIES
// ═══════════════════════════════════════════════════════════════════════════

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Sanitize data by removing null bytes (\u0000) which PostgreSQL cannot store in text fields
 * This is common with LLM outputs that may contain null characters
 */
function sanitizeNullBytes(data: unknown): unknown {
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
    const sanitized: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(data as Record<string, unknown>)) {
      sanitized[key] = sanitizeNullBytes(value);
    }
    return sanitized;
  }

  // Return primitives as-is (numbers, booleans, etc.)
  return data;
}

function toPrismaJsonValue(value: unknown): Prisma.InputJsonValue {
  // Ensure we only write JSON-safe values to Prisma Json columns.
  const json: unknown = JSON.parse(JSON.stringify(value));
  return json as Prisma.InputJsonValue;
}

type AuditWorkflowControlPoint = {
  citations?: unknown[] | null;
} & Record<string, unknown>;

type AuditWorkflowStep = {
  step_metadata?: {
    position?: number;
    name?: string;
    severity?: string;
    is_critical?: boolean;
    weight?: number;
  } | null;
  traite: boolean;
  conforme: string;
  score: number;
  niveau_conformite: string;
  commentaire_global: string;
  mots_cles_trouves?: string[] | null;
  minutages?: string[] | null;
  erreurs_transcription_tolerees?: number | null;
  points_controle?: AuditWorkflowControlPoint[] | null;
  usage?: { total_tokens?: number | null } | null;
} & Record<string, unknown>;

type AuditWorkflowResult = {
  audit: {
    config: { id: string | number };
    compliance: { score: number; niveau: string; points_critiques: string };
    results: { steps: AuditWorkflowStep[] };
  };
  metadata: { started_at?: string; completed_at: string; duration_ms: number };
  statistics: {
    total_tokens: number;
    successful_steps: number;
    failed_steps: number;
    recordings_count: number;
    timeline_chunks: number;
  };
} & Record<string, unknown>;

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
  auditResult: unknown
) {
  // Sanitize the audit result to remove null bytes that PostgreSQL cannot handle
  const sanitizedResult = sanitizeNullBytes(auditResult) as AuditWorkflowResult;

  const steps: AuditWorkflowStep[] = sanitizedResult.audit.results.steps || [];

  /**
   * IMPORTANT:
   * Avoid interactive transactions here.
   *
   * We run behind Supabase/pgbouncer pooler in some envs, and under load we've observed
   * Prisma P2028 ("Transaction not found") which cascades into replica crashes and nginx 502s.
   * Batch transactions are more robust for this "many quick queries" pattern.
   */
  const ops: Prisma.PrismaPromise<unknown>[] = [];

  ops.push(
    prisma.audit.update({
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
        resultData: toPrismaJsonValue(sanitizedResult),
      },
    })
  );

  // Upsert step results (idempotent and safe for distributed workers).
  for (const [index, step] of steps.entries()) {
    const stepPosition = step?.step_metadata?.position || index + 1;

    ops.push(
      prisma.auditStepResult.upsert({
        where: {
          auditId_stepPosition: {
            auditId: auditDbId,
            stepPosition,
          },
        },
        create: {
          auditId: auditDbId,
          stepPosition,
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
          erreursTranscriptionTolerees: step.erreurs_transcription_tolerees || 0,
          totalCitations:
            step.points_controle?.reduce((sum, pc) => {
              const count = Array.isArray(pc.citations) ? pc.citations.length : 0;
              return sum + count;
            }, 0) || 0,
          totalTokens: step.usage?.total_tokens || 0,
          rawResult: toPrismaJsonValue(step),
        },
        update: {
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
          erreursTranscriptionTolerees: step.erreurs_transcription_tolerees || 0,
          totalCitations:
            step.points_controle?.reduce((sum, pc) => {
              const count = Array.isArray(pc.citations) ? pc.citations.length : 0;
              return sum + count;
            }, 0) || 0,
          totalTokens: step.usage?.total_tokens || 0,
          rawResult: toPrismaJsonValue(step),
        },
      })
    );
  }

  ops.push(
    prisma.audit.findUnique({
      where: { id: auditDbId },
      include: { stepResults: true },
    })
  );

  const results = await prisma.$transaction(ops);
  const saved = results[results.length - 1] as unknown as
    | (Awaited<ReturnType<typeof prisma.audit.findUnique>> & {
        stepResults: unknown[];
      })
    | null;

  if (!saved) {
    throw new Error(`Audit ${auditDbId.toString()} not found after update`);
  }

  return saved;
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
export async function saveAuditResult(auditResult: unknown, ficheCacheId: bigint) {
  const sanitizedResult = sanitizeNullBytes(auditResult) as AuditWorkflowResult;
  const steps: AuditWorkflowStep[] = sanitizedResult.audit.results.steps || [];

  return await prisma.$transaction(async (tx) => {
    const completedAt = new Date(sanitizedResult.metadata.completed_at);
    const startedAt = sanitizedResult.metadata.started_at
      ? new Date(sanitizedResult.metadata.started_at)
      : new Date(completedAt.getTime() - sanitizedResult.metadata.duration_ms);

    const created = await tx.audit.create({
      data: {
        ficheCacheId,
        auditConfigId: BigInt(sanitizedResult.audit.config.id),
        overallScore: sanitizedResult.audit.compliance.score, // PERCENTAGE (0-100)
        scorePercentage: sanitizedResult.audit.compliance.score, // PERCENTAGE (0-100) - same value for compatibility
        niveau: sanitizedResult.audit.compliance.niveau,
        isCompliant: sanitizedResult.audit.compliance.niveau !== "REJET",
        criticalPassed: parseInt(
          sanitizedResult.audit.compliance.points_critiques.split("/")[0]
        ),
        criticalTotal: parseInt(
          sanitizedResult.audit.compliance.points_critiques.split("/")[1]
        ),
        status: "completed",
        startedAt,
        completedAt,
        durationMs: sanitizedResult.metadata.duration_ms,
        totalTokens: sanitizedResult.statistics.total_tokens,
        successfulSteps: sanitizedResult.statistics.successful_steps,
        failedSteps: sanitizedResult.statistics.failed_steps,
        recordingsCount: sanitizedResult.statistics.recordings_count,
        timelineChunks: sanitizedResult.statistics.timeline_chunks,
        resultData: toPrismaJsonValue(sanitizedResult),
      },
    });

    for (const [index, step] of steps.entries()) {
      const stepPosition = step?.step_metadata?.position || index + 1;

      await tx.auditStepResult.upsert({
        where: {
          auditId_stepPosition: {
            auditId: created.id,
            stepPosition,
          },
        },
        create: {
          auditId: created.id,
          stepPosition,
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
          erreursTranscriptionTolerees: step.erreurs_transcription_tolerees || 0,
          totalCitations:
            step.points_controle?.reduce((sum, pc) => {
              const count = Array.isArray(pc.citations) ? pc.citations.length : 0;
              return sum + count;
            }, 0) || 0,
          totalTokens: step.usage?.total_tokens || 0,
          rawResult: step as unknown as Prisma.InputJsonValue,
        },
        update: {
          // Should never happen for a freshly created audit, but keep it safe.
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
          erreursTranscriptionTolerees: step.erreurs_transcription_tolerees || 0,
          totalCitations:
            step.points_controle?.reduce((sum, pc) => {
              const count = Array.isArray(pc.citations) ? pc.citations.length : 0;
              return sum + count;
            }, 0) || 0,
          totalTokens: step.usage?.total_tokens || 0,
          rawResult: step as unknown as Prisma.InputJsonValue,
        },
      });
    }

    const saved = await tx.audit.findUnique({
      where: { id: created.id },
      include: { stepResults: true },
    });

    if (!saved) {
      throw new Error(`Audit ${created.id.toString()} not found after create`);
    }

    return saved;
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
export async function listAudits(filters: Partial<ListAuditsFilters> = {}) {
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
  const where: Prisma.AuditWhereInput = {
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
    where.createdAt = {
      ...(dateFrom ? { gte: dateFrom } : {}),
      ...(dateTo ? { lte: dateTo } : {}),
    };
  }

  // Filter by audit config IDs
  if (auditConfigIds && auditConfigIds.length > 0) {
    where.auditConfigId = {
      in: auditConfigIds.map((id) => BigInt(id)),
    };
  }

  // Build orderBy
  const orderBy: Prisma.AuditOrderByWithRelationInput = {};
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
  filters: Partial<ListAuditsFilters> = {}
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
  const auditWhere: Prisma.AuditWhereInput = {
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
    auditWhere.createdAt = {
      ...(dateFrom ? { gte: dateFrom } : {}),
      ...(dateTo ? { lte: dateTo } : {}),
    };
  }

  // Filter by audit config IDs
  if (auditConfigIds && auditConfigIds.length > 0) {
    auditWhere.auditConfigId = {
      in: auditConfigIds.map((id) => BigInt(id)),
    };
  }

  // Build where clause for fiches
  const ficheWhere: Prisma.FicheCacheWhereInput = {};

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
  const auditOrderBy: Prisma.AuditOrderByWithRelationInput = {};
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

// ═══════════════════════════════════════════════════════════════════════════
// HUMAN REVIEW / OVERRIDES
// ═══════════════════════════════════════════════════════════════════════════

export type AuditStepReviewOverride = {
  conforme: string;
  traite?: boolean;
  score?: number;
  niveauConformite?: string;
  reviewer?: string;
  reason?: string;
};

/**
 * Update a single audit step result after human review.
 *
 * - Updates the step summary fields (conforme/score/etc) so existing endpoints reflect the override.
 * - Preserves the original AI output by appending an audit trail entry into `rawResult.human_review`.
 *
 * Returns the updated row, or null if not found.
 */
export async function applyHumanReviewToAuditStepResult(
  auditId: bigint,
  stepPosition: number,
  override: AuditStepReviewOverride
) {
  const existing = await prisma.auditStepResult.findUnique({
    where: {
      auditId_stepPosition: {
        auditId,
        stepPosition,
      },
    },
  });

  if (!existing) return null;

  const nowIso = new Date().toISOString();

  const reviewEntry = {
    at: nowIso,
    by: override.reviewer ?? null,
    reason: override.reason ?? null,
    previous: {
      traite: existing.traite,
      conforme: existing.conforme,
      score: existing.score,
      niveau_conformite: existing.niveauConformite,
    },
    override: {
      traite: override.traite ?? existing.traite,
      conforme: override.conforme,
      score: override.score ?? existing.score,
      niveau_conformite: override.niveauConformite ?? existing.niveauConformite,
    },
  };

  let nextRawResult: unknown = existing.rawResult;
  if (isRecord(existing.rawResult)) {
    const raw = { ...(existing.rawResult as Record<string, unknown>) };
    const existingReview = raw.human_review;
    const history: unknown[] = Array.isArray(existingReview)
      ? [...existingReview]
      : existingReview
        ? [existingReview]
        : [];
    history.push(reviewEntry);
    raw.human_review = history;
    nextRawResult = raw;
  } else if (existing.rawResult == null) {
    // Keep it minimal if rawResult is missing.
    nextRawResult = { human_review: [reviewEntry] };
  } else {
    // rawResult exists but isn't an object (unlikely) — don't lose it, wrap it.
    nextRawResult = { raw: existing.rawResult, human_review: [reviewEntry] };
  }

  return await prisma.auditStepResult.update({
    where: {
      auditId_stepPosition: {
        auditId,
        stepPosition,
      },
    },
    data: {
      conforme: override.conforme,
      ...(override.traite !== undefined ? { traite: override.traite } : {}),
      ...(override.score !== undefined ? { score: override.score } : {}),
      ...(override.niveauConformite !== undefined
        ? { niveauConformite: override.niveauConformite }
        : {}),
      rawResult: toPrismaJsonValue(nextRawResult),
    },
  });
}

export type AuditComplianceInputs = {
  auditId: bigint;
  status: string;
  stepResults: Array<{
    isCritical: boolean;
    weight: number;
    score: number;
    conforme: string;
  }>;
};

export async function getAuditComplianceInputs(
  auditId: bigint
): Promise<AuditComplianceInputs | null> {
  const audit = await prisma.audit.findUnique({
    where: { id: auditId },
    select: {
      id: true,
      status: true,
      stepResults: {
        select: {
          isCritical: true,
          weight: true,
          score: true,
          conforme: true,
        },
      },
    },
  });

  if (!audit) return null;

  return {
    auditId: audit.id,
    status: audit.status,
    stepResults: audit.stepResults,
  };
}

export async function updateAuditComplianceSummary(
  auditId: bigint,
  params: {
    scorePercentage: number;
    niveau: string;
    isCompliant: boolean;
    criticalPassed: number;
    criticalTotal: number;
  }
) {
  return await prisma.audit.update({
    where: { id: auditId },
    data: {
      overallScore: params.scorePercentage,
      scorePercentage: params.scorePercentage,
      niveau: params.niveau,
      isCompliant: params.isCompliant,
      criticalPassed: params.criticalPassed,
      criticalTotal: params.criticalTotal,
    },
  });
}
