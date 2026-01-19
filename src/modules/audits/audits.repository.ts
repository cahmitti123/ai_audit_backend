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
  auditId?: string,
  options?: {
    automationScheduleId?: bigint;
    automationRunId?: bigint;
    triggerSource?: string;
    triggerUserId?: string;
    useRlm?: boolean;
  }
) {
  const useRlm = typeof options?.useRlm === "boolean" ? options.useRlm : false;
  return await prisma.audit.create({
    data: {
      ficheCacheId,
      auditConfigId,
      ...(options?.automationScheduleId !== undefined
        ? { automationScheduleId: options.automationScheduleId }
        : {}),
      ...(options?.automationRunId !== undefined
        ? { automationRunId: options.automationRunId }
        : {}),
      ...(options?.triggerSource ? { triggerSource: options.triggerSource } : {}),
      ...(options?.triggerUserId ? { triggerUserId: options.triggerUserId } : {}),
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
        approach: {
          use_rlm: useRlm,
          transcript_mode: useRlm ? "tools" : "prompt",
        },
        ...(options?.triggerSource ? { trigger_source: options.triggerSource } : {}),
        ...(options?.automationScheduleId !== undefined
          ? { automation_schedule_id: options.automationScheduleId.toString() }
          : {}),
        ...(options?.automationRunId !== undefined
          ? { automation_run_id: options.automationRunId.toString() }
          : {}),
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
 * Update audit metadata (notes / linkage / soft delete).
 * This is intentionally restricted to non-result fields.
 */
export async function updateAuditMetadata(
  auditId: bigint,
  input: {
    notes?: string | null;
    deleted?: boolean;
    automationScheduleId?: bigint | null;
    automationRunId?: bigint | null;
    triggerSource?: string | null;
    triggerUserId?: string | null;
  }
) {
  const data: Prisma.AuditUncheckedUpdateInput = {};

  if ("notes" in input) {
    data.notes = input.notes ?? null;
  }
  if ("automationScheduleId" in input) {
    data.automationScheduleId = input.automationScheduleId ?? null;
  }
  if ("automationRunId" in input) {
    data.automationRunId = input.automationRunId ?? null;
  }
  if ("triggerSource" in input) {
    data.triggerSource = input.triggerSource ?? null;
  }
  if ("triggerUserId" in input) {
    data.triggerUserId = input.triggerUserId ?? null;
  }
  if (typeof input.deleted === "boolean") {
    data.deletedAt = input.deleted ? new Date() : null;
  }

  return await prisma.audit.update({
    where: { id: auditId },
    data,
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
      deletedAt: null,
    },
    include: {
      auditConfig: {
        select: {
          id: true,
          name: true,
          description: true,
        },
      },
      automationSchedule: {
        select: { id: true, name: true },
      },
      automationRun: {
        select: {
          id: true,
          status: true,
          startedAt: true,
          completedAt: true,
          scheduleId: true,
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
      automationSchedule: {
        select: { id: true, name: true },
      },
      automationRun: {
        select: {
          id: true,
          status: true,
          startedAt: true,
          completedAt: true,
          scheduleId: true,
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
  const { sortBy = "created_at", sortOrder = "desc", limit = 100, offset = 0 } =
    filters;

  const where = buildAuditWhere(filters);

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
        automationSchedule: {
          select: { id: true, name: true },
        },
        automationRun: {
          select: {
            id: true,
            status: true,
            startedAt: true,
            completedAt: true,
            scheduleId: true,
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

function buildAuditWhere(filters: Partial<ListAuditsFilters>): Prisma.AuditWhereInput {
  const {
    ficheIds,
    status,
    isCompliant,
    dateFrom,
    dateTo,
    auditConfigIds,
    groupes,
    groupeQuery,
    agenceQuery,
    prospectQuery,
    salesDates,
    salesDateFrom,
    salesDateTo,
    hasRecordings,
    recordingsCountMin,
    recordingsCountMax,
    fetchedAtFrom,
    fetchedAtTo,
    lastRevalidatedFrom,
    lastRevalidatedTo,
    niveau,
    scoreMin,
    scoreMax,
    durationMinMs,
    durationMaxMs,
    tokensMin,
    tokensMax,
    hasFailedSteps,
    automationScheduleIds,
    automationRunIds,
    triggerSources,
    q,
    latestOnly = true,
    includeDeleted = false,
  } = filters;

  const and: Prisma.AuditWhereInput[] = [];

  // Visibility defaults
  if (latestOnly) and.push({ isLatest: true });
  if (!includeDeleted) and.push({ deletedAt: null });

  // Filter by status
  if (status && status.length > 0) and.push({ status: { in: status } });

  // Filter by compliance
  if (isCompliant !== undefined) and.push({ isCompliant });

  // Filter by niveau
  if (niveau && niveau.length > 0) and.push({ niveau: { in: niveau } });

  // Filter by date range (createdAt)
  if (dateFrom || dateTo) {
    and.push({
      createdAt: {
        ...(dateFrom ? { gte: dateFrom } : {}),
        ...(dateTo ? { lte: dateTo } : {}),
      },
    });
  }

  // Filter by score range (scorePercentage)
  if (scoreMin !== undefined || scoreMax !== undefined) {
    and.push({
      scorePercentage: {
        ...(scoreMin !== undefined ? { gte: scoreMin } : {}),
        ...(scoreMax !== undefined ? { lte: scoreMax } : {}),
      },
    });
  }

  // Filter by duration range
  if (durationMinMs !== undefined || durationMaxMs !== undefined) {
    and.push({
      durationMs: {
        ...(durationMinMs !== undefined ? { gte: durationMinMs } : {}),
        ...(durationMaxMs !== undefined ? { lte: durationMaxMs } : {}),
      },
    });
  }

  // Filter by token range
  if (tokensMin !== undefined || tokensMax !== undefined) {
    and.push({
      totalTokens: {
        ...(tokensMin !== undefined ? { gte: tokensMin } : {}),
        ...(tokensMax !== undefined ? { lte: tokensMax } : {}),
      },
    });
  }

  // Filter by failed steps presence
  if (hasFailedSteps !== undefined) {
    if (hasFailedSteps) and.push({ failedSteps: { gt: 0 } });
    else and.push({ OR: [{ failedSteps: { equals: 0 } }, { failedSteps: null }] });
  }

  // Filter by audit config IDs
  if (auditConfigIds && auditConfigIds.length > 0) {
    const ids = auditConfigIds
      .map((id) => String(id).trim())
      .filter((id) => /^\d+$/.test(id))
      .map((id) => BigInt(id));
    if (ids.length > 0) and.push({ auditConfigId: { in: ids } });
  }

  // Filter by automation ids
  if (automationScheduleIds && automationScheduleIds.length > 0) {
    const ids = automationScheduleIds
      .map((id) => String(id).trim())
      .filter((id) => /^\d+$/.test(id))
      .map((id) => BigInt(id));
    if (ids.length > 0) and.push({ automationScheduleId: { in: ids } });
  }
  if (automationRunIds && automationRunIds.length > 0) {
    const ids = automationRunIds
      .map((id) => String(id).trim())
      .filter((id) => /^\d+$/.test(id))
      .map((id) => BigInt(id));
    if (ids.length > 0) and.push({ automationRunId: { in: ids } });
  }

  // Filter by trigger source(s)
  if (triggerSources && triggerSources.length > 0) {
    and.push({ triggerSource: { in: triggerSources } });
  }

  // Fiche-level filters (groupe/prospect/etc)
  const ficheWhere: Prisma.FicheCacheWhereInput = {};
  const ficheAnd: Prisma.FicheCacheWhereInput[] = [];
  if (ficheIds && ficheIds.length > 0) ficheWhere.ficheId = { in: ficheIds };
  if (groupes && groupes.length > 0) ficheWhere.groupe = { in: groupes };
  if (groupeQuery) ficheWhere.groupe = { contains: groupeQuery, mode: "insensitive" };
  if (agenceQuery)
    ficheWhere.agenceNom = { contains: agenceQuery, mode: "insensitive" };
  if (prospectQuery) {
    ficheWhere.OR = [
      { prospectNom: { contains: prospectQuery, mode: "insensitive" } },
      { prospectPrenom: { contains: prospectQuery, mode: "insensitive" } },
      { prospectEmail: { contains: prospectQuery, mode: "insensitive" } },
      { prospectTel: { contains: prospectQuery, mode: "insensitive" } },
      { ficheId: { contains: prospectQuery, mode: "insensitive" } },
    ];
  }
  if (salesDates && salesDates.length > 0) {
    ficheAnd.push({ salesDate: { in: salesDates } });
  }
  if (salesDateFrom || salesDateTo) {
    ficheAnd.push({
      salesDate: {
        ...(salesDateFrom ? { gte: salesDateFrom } : {}),
        ...(salesDateTo ? { lte: salesDateTo } : {}),
      },
    });
  }
  if (hasRecordings !== undefined) ficheWhere.hasRecordings = hasRecordings;
  if (recordingsCountMin !== undefined || recordingsCountMax !== undefined) {
    ficheWhere.recordingsCount = {
      ...(recordingsCountMin !== undefined ? { gte: recordingsCountMin } : {}),
      ...(recordingsCountMax !== undefined ? { lte: recordingsCountMax } : {}),
    };
  }
  if (fetchedAtFrom || fetchedAtTo) {
    ficheWhere.fetchedAt = {
      ...(fetchedAtFrom ? { gte: fetchedAtFrom } : {}),
      ...(fetchedAtTo ? { lte: fetchedAtTo } : {}),
    };
  }
  if (lastRevalidatedFrom || lastRevalidatedTo) {
    ficheWhere.lastRevalidatedAt = {
      ...(lastRevalidatedFrom ? { gte: lastRevalidatedFrom } : {}),
      ...(lastRevalidatedTo ? { lte: lastRevalidatedTo } : {}),
    };
  }
  if (ficheAnd.length > 0) ficheWhere.AND = ficheAnd;
  if (Object.keys(ficheWhere).length > 0) and.push({ ficheCache: ficheWhere });

  // Free text search (ANDed with other filters)
  if (q) {
    const term = String(q).trim();
    const ors: Prisma.AuditWhereInput[] = [
      { ficheCache: { ficheId: { contains: term, mode: "insensitive" } } },
      { ficheCache: { prospectNom: { contains: term, mode: "insensitive" } } },
      { ficheCache: { prospectPrenom: { contains: term, mode: "insensitive" } } },
      { auditConfig: { name: { contains: term, mode: "insensitive" } } },
      { errorMessage: { contains: term, mode: "insensitive" } },
    ];

    if (/^\d+$/.test(term)) {
      try {
        ors.push({ id: BigInt(term) });
      } catch {
        // ignore
      }
    }

    and.push({ OR: ors });
  }

  return and.length > 0 ? { AND: and } : {};
}

export type AuditGroupBy =
  | "fiche"
  | "audit_config"
  | "status"
  | "niveau"
  | "automation_schedule"
  | "automation_run"
  | "groupe"
  | "created_day"
  | "score_bucket";

export async function groupAudits(params: {
  filters: Partial<ListAuditsFilters>;
  groupBy: AuditGroupBy;
  bucketSize?: number;
}) {
  const { filters, groupBy } = params;
  const where = buildAuditWhere(filters);

  const limit = Math.min(Math.max(Number(filters.limit ?? 100), 1), 500);
  const offset = Math.max(Number(filters.offset ?? 0), 0);

  const bucketSize = Math.max(1, Math.min(100, Number(params.bucketSize ?? 10)));

  // Helper maps
  const toKey = (v: bigint | string | null) => (typeof v === "bigint" ? v.toString() : v);

  // Fast-path: groupable by DB fields
  if (
    groupBy === "status" ||
    groupBy === "niveau" ||
    groupBy === "audit_config" ||
    groupBy === "automation_schedule" ||
    groupBy === "automation_run" ||
    groupBy === "fiche"
  ) {
    if (groupBy === "status") {
      const [rowsAll, rowsCompliance] = await Promise.all([
        prisma.audit.groupBy({
          by: ["status"],
          where,
          _count: { id: true },
          _avg: { scorePercentage: true },
          _min: { scorePercentage: true },
          _max: { scorePercentage: true },
          orderBy: { _count: { id: "desc" } },
          take: limit,
          skip: offset,
        }),
        prisma.audit.groupBy({
          by: ["status", "isCompliant"],
          where,
          _count: { id: true },
        }),
      ]);

      const complianceMap = new Map<string, { compliant: number; nonCompliant: number }>();
      for (const r of rowsCompliance) {
        const k = String(r.status);
        const prev = complianceMap.get(k) ?? { compliant: 0, nonCompliant: 0 };
        if (r.isCompliant) prev.compliant += r._count.id;
        else prev.nonCompliant += r._count.id;
        complianceMap.set(k, prev);
      }

      // total groups count is small; compute by distinct statuses
      const totalGroups = (await prisma.audit.groupBy({ by: ["status"], where })).length;

      const groups = rowsAll.map((r) => {
        const key = String(r.status);
        const c = complianceMap.get(key) ?? { compliant: 0, nonCompliant: 0 };
        return {
          key,
          count: r._count.id,
          compliantCount: c.compliant,
          nonCompliantCount: c.nonCompliant,
          avgScore: r._avg.scorePercentage ? Number(r._avg.scorePercentage) : null,
          minScore: r._min.scorePercentage ? Number(r._min.scorePercentage) : null,
          maxScore: r._max.scorePercentage ? Number(r._max.scorePercentage) : null,
        };
      });

      return { groups, totalGroups, limit, offset, bucketSize, truncated: false };
    }

    if (groupBy === "niveau") {
      const [rowsAll, rowsCompliance] = await Promise.all([
        prisma.audit.groupBy({
          by: ["niveau"],
          where,
          _count: { id: true },
          _avg: { scorePercentage: true },
          _min: { scorePercentage: true },
          _max: { scorePercentage: true },
          orderBy: { _count: { id: "desc" } },
          take: limit,
          skip: offset,
        }),
        prisma.audit.groupBy({
          by: ["niveau", "isCompliant"],
          where,
          _count: { id: true },
        }),
      ]);

      const complianceMap = new Map<string, { compliant: number; nonCompliant: number }>();
      for (const r of rowsCompliance) {
        const k = String(r.niveau);
        const prev = complianceMap.get(k) ?? { compliant: 0, nonCompliant: 0 };
        if (r.isCompliant) prev.compliant += r._count.id;
        else prev.nonCompliant += r._count.id;
        complianceMap.set(k, prev);
      }

      const totalGroups = (await prisma.audit.groupBy({ by: ["niveau"], where })).length;

      const groups = rowsAll.map((r) => {
        const key = String(r.niveau);
        const c = complianceMap.get(key) ?? { compliant: 0, nonCompliant: 0 };
        return {
          key,
          count: r._count.id,
          compliantCount: c.compliant,
          nonCompliantCount: c.nonCompliant,
          avgScore: r._avg.scorePercentage ? Number(r._avg.scorePercentage) : null,
          minScore: r._min.scorePercentage ? Number(r._min.scorePercentage) : null,
          maxScore: r._max.scorePercentage ? Number(r._max.scorePercentage) : null,
        };
      });

      return { groups, totalGroups, limit, offset, bucketSize, truncated: false };
    }

    // Shared helpers for ID-based groupings
    const buildIdGroups = async (field: "auditConfigId" | "automationScheduleId" | "automationRunId" | "ficheCacheId") => {
      const [rowsAll, rowsCompliance, rowsStatus] = await Promise.all([
        prisma.audit.groupBy({
          by: [field],
          where,
          _count: { id: true },
          _avg: { scorePercentage: true },
          _min: { scorePercentage: true },
          _max: { scorePercentage: true },
          orderBy: { _count: { id: "desc" } },
          take: limit,
          skip: offset,
        }) as unknown as Array<Record<string, unknown>>,
        prisma.audit.groupBy({
          by: [field, "isCompliant"],
          where,
          _count: { id: true },
        }) as unknown as Array<Record<string, unknown>>,
        prisma.audit.groupBy({
          by: [field, "status"],
          where,
          _count: { id: true },
        }) as unknown as Array<Record<string, unknown>>,
      ]);

      const totalGroups = (await prisma.audit.groupBy({ by: [field], where } as any)).length;

      const complianceMap = new Map<string | null, { compliant: number; nonCompliant: number }>();
      for (const r of rowsCompliance) {
        const key = (r as any)[field] ?? null;
        const k = toKey(key as any) as string | null;
        const prev = complianceMap.get(k) ?? { compliant: 0, nonCompliant: 0 };
        if ((r as any).isCompliant) prev.compliant += (r as any)._count.id as number;
        else prev.nonCompliant += (r as any)._count.id as number;
        complianceMap.set(k, prev);
      }

      const statusMap = new Map<string | null, Record<string, number>>();
      for (const r of rowsStatus) {
        const key = (r as any)[field] ?? null;
        const k = toKey(key as any) as string | null;
        const prev = statusMap.get(k) ?? {};
        const st = String((r as any).status);
        prev[st] = ((prev[st] ?? 0) as number) + ((r as any)._count.id as number);
        statusMap.set(k, prev);
      }

      const groups = rowsAll.map((r: any) => {
        const keyRaw = r[field] ?? null;
        const key = toKey(keyRaw as any) as string | null;
        const c = complianceMap.get(key) ?? { compliant: 0, nonCompliant: 0 };
        const st = statusMap.get(key) ?? {};
        return {
          key,
          count: r._count.id as number,
          compliantCount: c.compliant,
          nonCompliantCount: c.nonCompliant,
          avgScore: r._avg.scorePercentage ? Number(r._avg.scorePercentage) : null,
          minScore: r._min.scorePercentage ? Number(r._min.scorePercentage) : null,
          maxScore: r._max.scorePercentage ? Number(r._max.scorePercentage) : null,
          statusCounts: st,
        };
      });

      return { groups, totalGroups };
    };

    if (groupBy === "audit_config") {
      const { groups, totalGroups } = await buildIdGroups("auditConfigId");
      const ids = groups
        .map((g) => g.key)
        .filter((k): k is string => typeof k === "string" && /^\d+$/.test(k))
        .map((k) => BigInt(k));
      const configs = await prisma.auditConfig.findMany({
        where: { id: { in: ids } },
        select: { id: true, name: true, description: true },
      });
      const map = new Map<string, (typeof configs)[number]>();
      for (const c of configs) map.set(c.id.toString(), c);

      return {
        groups: groups.map((g) => ({
          ...g,
          auditConfig: g.key && map.has(g.key) ? {
            id: map.get(g.key)!.id.toString(),
            name: map.get(g.key)!.name,
            description: map.get(g.key)!.description,
          } : null,
        })),
        totalGroups,
        limit,
        offset,
        bucketSize,
        truncated: false,
      };
    }

    if (groupBy === "automation_schedule") {
      const { groups, totalGroups } = await buildIdGroups("automationScheduleId");
      const ids = groups
        .map((g) => g.key)
        .filter((k): k is string => typeof k === "string" && /^\d+$/.test(k))
        .map((k) => BigInt(k));
      const schedules = await prisma.automationSchedule.findMany({
        where: { id: { in: ids } },
        select: { id: true, name: true },
      });
      const map = new Map<string, (typeof schedules)[number]>();
      for (const s of schedules) map.set(s.id.toString(), s);

      return {
        groups: groups.map((g) => ({
          ...g,
          automationSchedule: g.key && map.has(g.key)
            ? { id: map.get(g.key)!.id.toString(), name: map.get(g.key)!.name }
            : null,
        })),
        totalGroups,
        limit,
        offset,
        bucketSize,
        truncated: false,
      };
    }

    if (groupBy === "automation_run") {
      const { groups, totalGroups } = await buildIdGroups("automationRunId");
      const ids = groups
        .map((g) => g.key)
        .filter((k): k is string => typeof k === "string" && /^\d+$/.test(k))
        .map((k) => BigInt(k));
      const runs = await prisma.automationRun.findMany({
        where: { id: { in: ids } },
        select: { id: true, status: true, startedAt: true, completedAt: true, scheduleId: true },
      });
      const map = new Map<string, (typeof runs)[number]>();
      for (const r of runs) map.set(r.id.toString(), r);

      return {
        groups: groups.map((g) => ({
          ...g,
          automationRun: g.key && map.has(g.key)
            ? {
                id: map.get(g.key)!.id.toString(),
                status: map.get(g.key)!.status,
                startedAt: map.get(g.key)!.startedAt,
                completedAt: map.get(g.key)!.completedAt,
                scheduleId: map.get(g.key)!.scheduleId.toString(),
              }
            : null,
        })),
        totalGroups,
        limit,
        offset,
        bucketSize,
        truncated: false,
      };
    }

    // groupBy === "fiche"
    const { groups, totalGroups } = await buildIdGroups("ficheCacheId");
    const ids = groups
      .map((g) => g.key)
      .filter((k): k is string => typeof k === "string" && /^\d+$/.test(k))
      .map((k) => BigInt(k));
    const fiches = await prisma.ficheCache.findMany({
      where: { id: { in: ids } },
      select: {
        id: true,
        ficheId: true,
        groupe: true,
        agenceNom: true,
        prospectNom: true,
        prospectPrenom: true,
      },
    });
    const map = new Map<string, (typeof fiches)[number]>();
    for (const f of fiches) map.set(f.id.toString(), f);

    return {
      groups: groups.map((g) => ({
        ...g,
        fiche: g.key && map.has(g.key)
          ? {
              id: map.get(g.key)!.id.toString(),
              ficheId: map.get(g.key)!.ficheId,
              groupe: map.get(g.key)!.groupe,
              agenceNom: map.get(g.key)!.agenceNom,
              prospectNom: map.get(g.key)!.prospectNom,
              prospectPrenom: map.get(g.key)!.prospectPrenom,
            }
          : null,
      })),
      totalGroups,
      limit,
      offset,
      bucketSize,
      truncated: false,
    };
  }

  // In-memory groupings (groupe / created_day / score_bucket)
  const MAX_ROWS = 20000;
  const rows = await prisma.audit.findMany({
    where,
    select: {
      createdAt: true,
      status: true,
      isCompliant: true,
      scorePercentage: true,
      ficheCache: { select: { ficheId: true, groupe: true } },
    },
    orderBy: { createdAt: "desc" },
    take: MAX_ROWS,
  });

  const truncated = rows.length >= MAX_ROWS;

  const groupsMap = new Map<string, {
    key: string;
    count: number;
    compliantCount: number;
    nonCompliantCount: number;
    scores: number[];
    statusCounts: Record<string, number>;
  }>();

  const keyForRow = (row: (typeof rows)[number]): string => {
    if (groupBy === "groupe") return row.ficheCache.groupe ?? "UNKNOWN";
    if (groupBy === "created_day") return row.createdAt.toISOString().slice(0, 10);
    // score_bucket
    const n = Number(row.scorePercentage);
    const safe = Number.isFinite(n) ? n : 0;
    const bucket = Math.floor(safe / bucketSize) * bucketSize;
    return `${bucket}-${bucket + bucketSize}`;
  };

  for (const row of rows) {
    const key = keyForRow(row);
    const prev = groupsMap.get(key) ?? {
      key,
      count: 0,
      compliantCount: 0,
      nonCompliantCount: 0,
      scores: [],
      statusCounts: {},
    };
    prev.count += 1;
    if (row.isCompliant) prev.compliantCount += 1;
    else prev.nonCompliantCount += 1;
    const score = Number(row.scorePercentage);
    if (Number.isFinite(score)) prev.scores.push(score);
    prev.statusCounts[row.status] = (prev.statusCounts[row.status] ?? 0) + 1;
    groupsMap.set(key, prev);
  }

  const groupsAll = Array.from(groupsMap.values())
    .map((g) => {
      const scores = g.scores;
      const avg =
        scores.length > 0 ? scores.reduce((s, v) => s + v, 0) / scores.length : null;
      const min = scores.length > 0 ? Math.min(...scores) : null;
      const max = scores.length > 0 ? Math.max(...scores) : null;
      return {
        key: g.key,
        count: g.count,
        compliantCount: g.compliantCount,
        nonCompliantCount: g.nonCompliantCount,
        avgScore: avg,
        minScore: min,
        maxScore: max,
        statusCounts: g.statusCounts,
      };
    })
    .sort((a, b) => b.count - a.count);

  const totalGroups = groupsAll.length;
  const groups = groupsAll.slice(offset, offset + limit);

  return { groups, totalGroups, limit, offset, bucketSize, truncated };
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
    groupes,
    groupeQuery,
    agenceQuery,
    prospectQuery,
    niveau,
    scoreMin,
    scoreMax,
    durationMinMs,
    durationMaxMs,
    tokensMin,
    tokensMax,
    hasFailedSteps,
    automationScheduleIds,
    automationRunIds,
    triggerSources,
    q,
    latestOnly = true,
    includeDeleted = false,
    sortBy = "created_at",
    sortOrder = "desc",
    limit = 100,
    offset = 0,
  } = filters;

  // Build where clause for audits
  const auditWhere: Prisma.AuditWhereInput = {};
  const auditAnd: Prisma.AuditWhereInput[] = [];

  if (latestOnly) auditAnd.push({ isLatest: true });
  if (!includeDeleted) auditAnd.push({ deletedAt: null });

  // Filter by status
  if (status && status.length > 0) {
    auditAnd.push({ status: { in: status } });
  }

  // Filter by compliance
  if (isCompliant !== undefined) {
    auditAnd.push({ isCompliant });
  }

  // Filter by niveau
  if (niveau && niveau.length > 0) {
    auditAnd.push({ niveau: { in: niveau } });
  }

  // Filter by date range
  if (dateFrom || dateTo) {
    auditAnd.push({
      createdAt: {
      ...(dateFrom ? { gte: dateFrom } : {}),
      ...(dateTo ? { lte: dateTo } : {}),
      },
    });
  }

  // Filter by score range
  if (scoreMin !== undefined || scoreMax !== undefined) {
    auditAnd.push({
      scorePercentage: {
        ...(scoreMin !== undefined ? { gte: scoreMin } : {}),
        ...(scoreMax !== undefined ? { lte: scoreMax } : {}),
      },
    });
  }

  // Filter by duration range
  if (durationMinMs !== undefined || durationMaxMs !== undefined) {
    auditAnd.push({
      durationMs: {
        ...(durationMinMs !== undefined ? { gte: durationMinMs } : {}),
        ...(durationMaxMs !== undefined ? { lte: durationMaxMs } : {}),
      },
    });
  }

  // Filter by token range
  if (tokensMin !== undefined || tokensMax !== undefined) {
    auditAnd.push({
      totalTokens: {
        ...(tokensMin !== undefined ? { gte: tokensMin } : {}),
        ...(tokensMax !== undefined ? { lte: tokensMax } : {}),
      },
    });
  }

  // Filter by failed steps presence
  if (hasFailedSteps !== undefined) {
    if (hasFailedSteps) auditAnd.push({ failedSteps: { gt: 0 } });
    else auditAnd.push({ OR: [{ failedSteps: { equals: 0 } }, { failedSteps: null }] });
  }

  // Filter by audit config IDs
  if (auditConfigIds && auditConfigIds.length > 0) {
    const ids = auditConfigIds
      .map((id) => String(id).trim())
      .filter((id) => /^\d+$/.test(id))
      .map((id) => BigInt(id));
    if (ids.length > 0) auditAnd.push({ auditConfigId: { in: ids } });
  }

  // Filter by automation ids
  if (automationScheduleIds && automationScheduleIds.length > 0) {
    const ids = automationScheduleIds
      .map((id) => String(id).trim())
      .filter((id) => /^\d+$/.test(id))
      .map((id) => BigInt(id));
    if (ids.length > 0) auditAnd.push({ automationScheduleId: { in: ids } });
  }
  if (automationRunIds && automationRunIds.length > 0) {
    const ids = automationRunIds
      .map((id) => String(id).trim())
      .filter((id) => /^\d+$/.test(id))
      .map((id) => BigInt(id));
    if (ids.length > 0) auditAnd.push({ automationRunId: { in: ids } });
  }

  if (triggerSources && triggerSources.length > 0) {
    auditAnd.push({ triggerSource: { in: triggerSources } });
  }

  if (q) {
    const term = String(q).trim();
    const ors: Prisma.AuditWhereInput[] = [
      { ficheCache: { ficheId: { contains: term, mode: "insensitive" } } },
      { auditConfig: { name: { contains: term, mode: "insensitive" } } },
      { errorMessage: { contains: term, mode: "insensitive" } },
    ];
    if (/^\d+$/.test(term)) {
      try {
        ors.push({ id: BigInt(term) });
      } catch {
        // ignore
      }
    }
    auditAnd.push({ OR: ors });
  }

  if (auditAnd.length > 0) {
    auditWhere.AND = auditAnd;
  }

  // Build where clause for fiches
  const ficheWhere: Prisma.FicheCacheWhereInput = {};

  // Filter by fiche IDs
  if (ficheIds && ficheIds.length > 0) {
    ficheWhere.ficheId = { in: ficheIds };
  }

  if (groupes && groupes.length > 0) {
    ficheWhere.groupe = { in: groupes };
  }
  if (groupeQuery) {
    ficheWhere.groupe = { contains: groupeQuery, mode: "insensitive" };
  }
  if (agenceQuery) {
    ficheWhere.agenceNom = { contains: agenceQuery, mode: "insensitive" };
  }
  if (prospectQuery) {
    ficheWhere.OR = [
      { prospectNom: { contains: prospectQuery, mode: "insensitive" } },
      { prospectPrenom: { contains: prospectQuery, mode: "insensitive" } },
      { prospectEmail: { contains: prospectQuery, mode: "insensitive" } },
      { prospectTel: { contains: prospectQuery, mode: "insensitive" } },
      { ficheId: { contains: prospectQuery, mode: "insensitive" } },
    ];
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
            automationSchedule: {
              select: { id: true, name: true },
            },
            automationRun: {
              select: {
                id: true,
                status: true,
                startedAt: true,
                completedAt: true,
                scheduleId: true,
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

export type AuditControlPointReviewOverride = {
  statut?: string;
  commentaire?: string;
  reviewer?: string;
  reason?: string;
};

type AuditControlPointSummary = {
  point: string;
  statut: string;
  commentaire: string;
};

function extractControlPointFromRawResult(
  rawResult: unknown,
  controlPointIndex: number
): AuditControlPointSummary | null {
  if (!Number.isFinite(controlPointIndex) || controlPointIndex <= 0) return null;
  if (!isRecord(rawResult)) return null;

  const points = rawResult.points_controle;
  if (!Array.isArray(points) || points.length < controlPointIndex) return null;

  const cp = points[controlPointIndex - 1];
  if (!isRecord(cp)) return null;

  const point = typeof cp.point === "string" ? cp.point : "";
  const statut = typeof cp.statut === "string" ? cp.statut : "UNKNOWN";
  const commentaire = typeof cp.commentaire === "string" ? cp.commentaire : "";

  return { point, statut, commentaire };
}

/**
 * Get a single control point ("checkpoint") summary from a step result.
 *
 * Returns null if the step result doesn't exist or if the control point isn't available
 * (e.g. missing rawResult / points_controle).
 */
export async function getAuditStepControlPointSummary(
  auditId: bigint,
  stepPosition: number,
  controlPointIndex: number
): Promise<AuditControlPointSummary | null> {
  const row = await prisma.auditStepResult.findUnique({
    where: {
      auditId_stepPosition: {
        auditId,
        stepPosition,
      },
    },
    select: {
      rawResult: true,
    },
  });

  if (!row) return null;

  return extractControlPointFromRawResult(row.rawResult as unknown, controlPointIndex);
}

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

/**
 * Update a single control point ("checkpoint") inside a step result after human review.
 *
 * - Updates `rawResult.points_controle[i].statut` and/or `.commentaire`.
 * - Preserves an audit trail by appending an entry into `rawResult.human_review`.
 *
 * Returns the updated row, or null if not found / control point unavailable.
 */
export async function applyHumanReviewToAuditControlPoint(
  auditId: bigint,
  stepPosition: number,
  controlPointIndex: number,
  override: AuditControlPointReviewOverride
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
  if (!Number.isFinite(controlPointIndex) || controlPointIndex <= 0) return null;

  // We can only edit control points when rawResult is present and object-shaped.
  if (!isRecord(existing.rawResult)) return null;

  const raw = { ...(existing.rawResult as Record<string, unknown>) };
  const pointsRaw = raw.points_controle;
  if (!Array.isArray(pointsRaw) || pointsRaw.length < controlPointIndex) return null;

  const cpRaw = pointsRaw[controlPointIndex - 1];
  if (!isRecord(cpRaw)) return null;

  const previous = {
    point: typeof cpRaw.point === "string" ? cpRaw.point : "",
    statut: typeof cpRaw.statut === "string" ? cpRaw.statut : "UNKNOWN",
    commentaire: typeof cpRaw.commentaire === "string" ? cpRaw.commentaire : "",
  };

  const next = {
    statut: override.statut ?? previous.statut,
    commentaire: override.commentaire ?? previous.commentaire,
  };

  // Update the control point in-place (immutably for JSON safety).
  const nextPoints = [...pointsRaw];
  nextPoints[controlPointIndex - 1] = {
    ...(cpRaw as Record<string, unknown>),
    statut: next.statut,
    commentaire: next.commentaire,
  };
  raw.points_controle = nextPoints;

  // Append audit trail entry
  const nowIso = new Date().toISOString();
  const reviewEntry = {
    at: nowIso,
    by: override.reviewer ?? null,
    reason: override.reason ?? null,
    kind: "control_point",
    control_point_index: controlPointIndex,
    point: previous.point,
    previous: {
      statut: previous.statut,
      commentaire: previous.commentaire,
    },
    override: {
      statut: next.statut,
      commentaire: next.commentaire,
    },
  };

  const existingReview = raw.human_review;
  const history: unknown[] = Array.isArray(existingReview)
    ? [...existingReview]
    : existingReview
      ? [existingReview]
      : [];
  history.push(reviewEntry);
  raw.human_review = history;

  return await prisma.auditStepResult.update({
    where: {
      auditId_stepPosition: {
        auditId,
        stepPosition,
      },
    },
    data: {
      rawResult: toPrismaJsonValue(raw),
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
