/**
 * Audits Schemas
 * ==============
 * RESPONSIBILITY: Type definitions and validation
 * - Zod schemas for API responses
 * - Type exports (inferred from Zod)
 * - Runtime validators
 * - No business logic
 *
 * LAYER: Foundation (Types & Validation)
 */

import { z } from "zod";
import { logger } from "../../shared/logger.js";
import { ValidationError } from "../../shared/errors.js";

// ═══════════════════════════════════════════════════════════════════════════
// ENUMS
// ═══════════════════════════════════════════════════════════════════════════

export const auditStatusEnum = z.enum([
  "pending",
  "running", // Active audit in progress
  "completed",
  "failed",
]);

export const auditNiveauEnum = z.enum([
  "PENDING",
  "EXCELLENT",
  "BON",
  "ACCEPTABLE",
  "INSUFFISANT",
  "REJET",
]);

export const stepConformeEnum = z.enum(["CONFORME", "NON_CONFORME", "PARTIEL"]);

export const stepNiveauConformiteEnum = z.enum([
  "EXCELLENT",
  "BON",
  "ACCEPTABLE",
  "INSUFFISANT",
  "REJET",
]);

export const sortByEnum = z.enum([
  "created_at",
  "completed_at",
  "score_percentage",
  "duration_ms",
]);

export const sortOrderEnum = z.enum(["asc", "desc"]);

// ═══════════════════════════════════════════════════════════════════════════
// AUDIT STEP RESULT SCHEMA
// ═══════════════════════════════════════════════════════════════════════════

export const auditStepResultSchema = z.object({
  id: z.string(),
  auditId: z.string(),
  stepPosition: z.number(),
  stepName: z.string(),
  severityLevel: z.string(),
  isCritical: z.boolean(),
  weight: z.number(),
  traite: z.boolean(),
  conforme: stepConformeEnum,
  score: z.number(),
  niveauConformite: stepNiveauConformiteEnum,
  commentaireGlobal: z.string(),
  motsClesTrouves: z.array(z.string()),
  minutages: z.array(z.string()),
  erreursTranscriptionTolerees: z.number(),
  totalCitations: z.number(),
  totalTokens: z.number(),
  createdAt: z.date(),
});

export const auditStepResultSummarySchema = z.object({
  id: z.string(),
  stepPosition: z.number(),
  stepName: z.string(),
  conforme: stepConformeEnum,
  score: z.number(),
  niveauConformite: stepNiveauConformiteEnum,
});

// ═══════════════════════════════════════════════════════════════════════════
// AUDIT SCHEMA
// ═══════════════════════════════════════════════════════════════════════════

export const auditSchema = z.object({
  id: z.string(),
  ficheCacheId: z.string(),
  auditConfigId: z.string(),
  automationScheduleId: z.string().nullable().optional(),
  automationRunId: z.string().nullable().optional(),
  triggerSource: z.string().nullable().optional(),
  triggerUserId: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
  deletedAt: z.date().nullable().optional(),
  overallScore: z.string(), // Decimal as string
  scorePercentage: z.string(), // Decimal as string
  niveau: auditNiveauEnum,
  isCompliant: z.boolean(),
  criticalPassed: z.number(),
  criticalTotal: z.number(),
  status: auditStatusEnum,
  startedAt: z.date().nullable(),
  completedAt: z.date().nullable(),
  durationMs: z.number().nullable(),
  errorMessage: z.string().nullable(),
  totalTokens: z.number().nullable(),
  successfulSteps: z.number().nullable(),
  failedSteps: z.number().nullable(),
  recordingsCount: z.number().nullable(),
  timelineChunks: z.number().nullable(),
  resultData: z.unknown().nullable(), // JSON data
  version: z.number(),
  isLatest: z.boolean(),
  createdAt: z.date(),
  updatedAt: z.date(),
});

export const auditSummarySchema = z.object({
  id: z.string(),
  ficheId: z.string(),
  auditConfigId: z.string(),
  auditConfigName: z.string(),
  status: auditStatusEnum,
  scorePercentage: z.string(),
  niveau: auditNiveauEnum,
  isCompliant: z.boolean(),
  completedAt: z.date().nullable(),
  durationMs: z.number().nullable(),
  createdAt: z.date(),
});

export const auditWithConfigSchema = auditSchema.extend({
  auditConfig: z.object({
    id: z.string(),
    name: z.string(),
    description: z.string().nullable(),
  }),
});

export const auditWithFicheSchema = auditSchema.extend({
  ficheCache: z.object({
    ficheId: z.string(),
    groupe: z.string().nullable(),
    prospectNom: z.string().nullable(),
    prospectPrenom: z.string().nullable(),
  }),
});

export const auditDetailSchema = auditSchema.extend({
  auditConfig: z.object({
    id: z.string(),
    name: z.string(),
    description: z.string().nullable(),
  }),
  ficheCache: z.object({
    ficheId: z.string(),
    groupe: z.string().nullable(),
    agenceNom: z.string().nullable(),
    prospectNom: z.string().nullable(),
    prospectPrenom: z.string().nullable(),
    prospectEmail: z.string().nullable(),
    prospectTel: z.string().nullable(),
  }),
  stepResults: z.array(auditStepResultSchema),
  automationSchedule: z
    .object({
      id: z.string(),
      name: z.string(),
    })
    .nullable()
    .optional(),
  automationRun: z
    .object({
      id: z.string(),
      status: z.string(),
      startedAt: z.date(),
      completedAt: z.date().nullable(),
      scheduleId: z.string(),
    })
    .nullable()
    .optional(),
});

// ═══════════════════════════════════════════════════════════════════════════
// FILTERS & QUERY SCHEMAS
// ═══════════════════════════════════════════════════════════════════════════

export const listAuditsFiltersSchema = z.object({
  ficheIds: z.array(z.string()).optional(),
  status: z.array(auditStatusEnum).optional(),
  isCompliant: z.boolean().optional(),
  dateFrom: z.date().optional(),
  dateTo: z.date().optional(),
  auditConfigIds: z.array(z.string()).optional(),
  // Fiche-level filters
  groupes: z.array(z.string()).optional(),
  groupeQuery: z.string().optional(),
  agenceQuery: z.string().optional(),
  prospectQuery: z.string().optional(),
  salesDates: z.array(z.string()).optional(),
  salesDateFrom: z.string().optional(),
  salesDateTo: z.string().optional(),
  hasRecordings: z.boolean().optional(),
  recordingsCountMin: z.number().int().min(0).optional(),
  recordingsCountMax: z.number().int().min(0).optional(),
  fetchedAtFrom: z.date().optional(),
  fetchedAtTo: z.date().optional(),
  lastRevalidatedFrom: z.date().optional(),
  lastRevalidatedTo: z.date().optional(),
  // Audit-level filters
  niveau: z.array(auditNiveauEnum).optional(),
  scoreMin: z.number().optional(),
  scoreMax: z.number().optional(),
  durationMinMs: z.number().int().min(0).optional(),
  durationMaxMs: z.number().int().min(0).optional(),
  tokensMin: z.number().int().min(0).optional(),
  tokensMax: z.number().int().min(0).optional(),
  hasFailedSteps: z.boolean().optional(),
  // Automation linkage
  automationScheduleIds: z.array(z.string()).optional(),
  automationRunIds: z.array(z.string()).optional(),
  triggerSources: z.array(z.string()).optional(),
  // Search
  q: z.string().optional(),
  // Visibility
  latestOnly: z.boolean().optional().default(true),
  includeDeleted: z.boolean().optional().default(false),
  sortBy: sortByEnum.optional().default("created_at"),
  sortOrder: sortOrderEnum.optional().default("desc"),
  limit: z.number().int().min(1).max(500).optional().default(100),
  offset: z.number().int().min(0).optional().default(0),
});

export const listAuditsQuerySchema = z.object({
  fiche_ids: z.string().optional(),
  status: z.string().optional(),
  is_compliant: z.string().optional(),
  date_from: z.string().optional(),
  date_to: z.string().optional(),
  audit_config_ids: z.string().optional(),
  groupes: z.string().optional(),
  groupe_query: z.string().optional(),
  agence_query: z.string().optional(),
  prospect_query: z.string().optional(),
  sales_dates: z.string().optional(),
  sales_date_from: z.string().optional(),
  sales_date_to: z.string().optional(),
  has_recordings: z.string().optional(),
  recordings_count_min: z.string().optional(),
  recordings_count_max: z.string().optional(),
  fetched_at_from: z.string().optional(),
  fetched_at_to: z.string().optional(),
  last_revalidated_from: z.string().optional(),
  last_revalidated_to: z.string().optional(),
  niveau: z.string().optional(),
  score_min: z.string().optional(),
  score_max: z.string().optional(),
  duration_min_ms: z.string().optional(),
  duration_max_ms: z.string().optional(),
  tokens_min: z.string().optional(),
  tokens_max: z.string().optional(),
  has_failed_steps: z.string().optional(),
  automation_schedule_ids: z.string().optional(),
  automation_run_ids: z.string().optional(),
  trigger_source: z.string().optional(),
  q: z.string().optional(),
  latest_only: z.string().optional(),
  include_deleted: z.string().optional(),
  sort_by: z.string().optional(),
  sort_order: z.string().optional(),
  limit: z.string().optional(),
  offset: z.string().optional(),
});

// ═══════════════════════════════════════════════════════════════════════════
// INPUT SCHEMAS
// ═══════════════════════════════════════════════════════════════════════════

export const runAuditInputSchema = z.object({
  fiche_id: z.string().min(1, "Fiche ID is required"),
  audit_config_id: z.number().int().positive().optional(),
  use_latest: z.boolean().optional().default(true),
  save_to_file: z.boolean().optional().default(false),
});

export const batchAuditInputSchema = z.object({
  fiche_ids: z
    .array(z.string().min(1))
    .min(1, "At least one fiche ID is required"),
  audit_config_id: z.number().int().positive().optional(),
  use_latest: z.boolean().optional().default(true),
});

/**
 * Human review override for a single audit step result.
 *
 * Notes:
 * - This is intended for post-audit QA where a human can override the AI's status.
 * - We keep the original AI output in `rawResult` (DB) and update the step summary fields.
 */
export const reviewAuditStepResultInputSchema = z.object({
  // Primary override: accept/reject/partial for this step
  conforme: stepConformeEnum,

  // Optional overrides (only set if you want to adjust these too)
  traite: z.boolean().optional(),
  score: z.number().int().min(0).optional(),
  niveauConformite: stepNiveauConformiteEnum.optional(),

  // Optional metadata (stored in rawResult human_review)
  reviewer: z.string().min(1).max(200).optional(),
  reason: z.string().min(1).max(5000).optional(),
});

/**
 * Update an audit record metadata (soft-delete, notes, and optional linkage fields).
 *
 * IMPORTANT:
 * - This is NOT intended to edit the AI results (use step review endpoint for that).
 * - `deleted=true` performs a soft-delete (sets `deletedAt`).
 */
export const updateAuditInputSchema = z.object({
  notes: z.string().max(20000).nullable().optional(),
  deleted: z.boolean().optional(),
  automation_schedule_id: z.string().trim().regex(/^\d+$/, "automation_schedule_id must be a positive integer string").nullable().optional(),
  automation_run_id: z.string().trim().regex(/^\d+$/, "automation_run_id must be a positive integer string").nullable().optional(),
  trigger_source: z.string().trim().max(50).nullable().optional(),
  trigger_user_id: z.string().trim().max(200).nullable().optional(),
});

// ═══════════════════════════════════════════════════════════════════════════
// GROUPED BY FICHE SCHEMAS
// ═══════════════════════════════════════════════════════════════════════════

export const ficheWithAuditsSchema = z.object({
  fiche: z.object({
    id: z.string(),
    ficheId: z.string(),
    groupe: z.string().nullable(),
    agenceNom: z.string().nullable(),
    prospectNom: z.string().nullable(),
    prospectPrenom: z.string().nullable(),
    prospectEmail: z.string().nullable(),
    prospectTel: z.string().nullable(),
    hasRecordings: z.boolean(),
    recordingsCount: z.number().nullable(),
    fetchedAt: z.date(),
    createdAt: z.date(),
    updatedAt: z.date(),
  }),
  audits: z.array(auditWithConfigSchema),
  summary: z.object({
    totalAudits: z.number(),
    compliantCount: z.number(),
    averageScore: z.number(),
    latestAuditDate: z.date().nullable(),
  }),
});

// ═══════════════════════════════════════════════════════════════════════════
// RESPONSE SCHEMAS
// ═══════════════════════════════════════════════════════════════════════════

export const auditListResponseSchema = z.object({
  success: z.boolean(),
  data: z.array(auditWithFicheSchema),
  pagination: z.object({
    total: z.number(),
    limit: z.number(),
    offset: z.number(),
  }),
});

export const auditDetailResponseSchema = z.object({
  success: z.boolean(),
  data: auditDetailSchema,
});

export const ficheAuditsResponseSchema = z.object({
  success: z.boolean(),
  data: z.array(auditWithConfigSchema),
  total: z.number(),
});

export const groupedAuditsResponseSchema = z.object({
  success: z.boolean(),
  data: z.array(ficheWithAuditsSchema),
  pagination: z.object({
    total: z.number(),
    limit: z.number(),
    offset: z.number(),
  }),
});

export const runAuditResponseSchema = z.object({
  success: z.boolean(),
  data: z.object({
    audit_id: z.string(),
    fiche_id: z.string(),
    score: z.number(),
    niveau: auditNiveauEnum,
    is_compliant: z.boolean(),
    duration_ms: z.number(),
  }),
});

export const batchAuditResponseSchema = z.object({
  success: z.boolean(),
  message: z.string(),
  event_id: z.string(),
});

// ═══════════════════════════════════════════════════════════════════════════
// WORKFLOW TYPES (from audits.types.ts)
// ═══════════════════════════════════════════════════════════════════════════

export const auditFunctionResultSchema = z.object({
  success: z.boolean(),
  fiche_id: z.string(),
  audit_id: z.string(),
  audit_config_id: z.number(),
  score: z.number(),
  niveau: z.string(),
  duration_ms: z.number(),
});

export const batchAuditResultSchema = z.object({
  success: z.boolean(),
  total_fiches: z.number(),
  audit_config_id: z.number(),
  total: z.number(),
  succeeded: z.number(),
  failed: z.number(),
});

// ═══════════════════════════════════════════════════════════════════════════
// EXPORTED TYPES
// ═══════════════════════════════════════════════════════════════════════════

// Enum Types
export type AuditStatus = z.infer<typeof auditStatusEnum>;
export type AuditNiveau = z.infer<typeof auditNiveauEnum>;
export type StepConforme = z.infer<typeof stepConformeEnum>;
export type StepNiveauConformite = z.infer<typeof stepNiveauConformiteEnum>;
export type SortBy = z.infer<typeof sortByEnum>;
export type SortOrder = z.infer<typeof sortOrderEnum>;

// Core Types
export type AuditStepResult = z.infer<typeof auditStepResultSchema>;
export type AuditStepResultSummary = z.infer<
  typeof auditStepResultSummarySchema
>;
export type Audit = z.infer<typeof auditSchema>;
export type AuditSummary = z.infer<typeof auditSummarySchema>;
export type AuditWithConfig = z.infer<typeof auditWithConfigSchema>;
export type AuditWithFiche = z.infer<typeof auditWithFicheSchema>;
export type AuditDetail = z.infer<typeof auditDetailSchema>;
export type FicheWithAudits = z.infer<typeof ficheWithAuditsSchema>;

// Filter Types
export type ListAuditsFilters = z.infer<typeof listAuditsFiltersSchema>;
export type ListAuditsQuery = z.infer<typeof listAuditsQuerySchema>;

// Input Types
export type RunAuditInput = z.infer<typeof runAuditInputSchema>;
export type BatchAuditInput = z.infer<typeof batchAuditInputSchema>;
export type ReviewAuditStepResultInput = z.infer<
  typeof reviewAuditStepResultInputSchema
>;
export type UpdateAuditInput = z.infer<typeof updateAuditInputSchema>;

// Response Types
export type AuditListResponse = z.infer<typeof auditListResponseSchema>;
export type AuditDetailResponse = z.infer<typeof auditDetailResponseSchema>;
export type FicheAuditsResponse = z.infer<typeof ficheAuditsResponseSchema>;
export type GroupedAuditsResponse = z.infer<typeof groupedAuditsResponseSchema>;
export type RunAuditResponse = z.infer<typeof runAuditResponseSchema>;
export type BatchAuditResponse = z.infer<typeof batchAuditResponseSchema>;

// Workflow Types (for backwards compatibility)
export type AuditFunctionResult = z.infer<typeof auditFunctionResultSchema>;
export type BatchAuditResult = z.infer<typeof batchAuditResultSchema>;

// ═══════════════════════════════════════════════════════════════════════════
// VALIDATORS
// ═══════════════════════════════════════════════════════════════════════════

export const validateRunAuditInput = (data: unknown): RunAuditInput => {
  try {
    return runAuditInputSchema.parse(data);
  } catch (error) {
    logger.error("Run audit input validation failed", { error });
    throw new ValidationError("Invalid run audit input", error);
  }
};

export const validateBatchAuditInput = (data: unknown): BatchAuditInput => {
  try {
    return batchAuditInputSchema.parse(data);
  } catch (error) {
    logger.error("Batch audit input validation failed", { error });
    throw new ValidationError("Invalid batch audit input", error);
  }
};

export const validateReviewAuditStepResultInput = (
  data: unknown
): ReviewAuditStepResultInput => {
  try {
    return reviewAuditStepResultInputSchema.parse(data);
  } catch (error) {
    logger.error("Review audit step result input validation failed", { error });
    throw new ValidationError("Invalid review audit step result input", error);
  }
};

export const validateUpdateAuditInput = (data: unknown): UpdateAuditInput => {
  try {
    return updateAuditInputSchema.parse(data);
  } catch (error) {
    logger.error("Update audit input validation failed", { error });
    throw new ValidationError("Invalid update audit input", error);
  }
};

export const validateListAuditsFilters = (data: unknown): ListAuditsFilters => {
  try {
    return listAuditsFiltersSchema.parse(data);
  } catch (error) {
    logger.error("List audits filters validation failed", { error });
    throw new ValidationError("Invalid list audits filters", error);
  }
};

/**
 * Parse query string parameters into typed filters
 */
export const parseListAuditsQuery = (
  query: ListAuditsQuery
): ListAuditsFilters => {
  try {
    const filters: Partial<ListAuditsFilters> = {};

    const splitCsv = (value: string): string[] =>
      value
        .split(",")
        .map((v) => v.trim())
        .filter(Boolean);

    // Parse fiche_ids
    if (query.fiche_ids) {
      filters.ficheIds = splitCsv(query.fiche_ids);
    }

    // Parse status
    if (query.status) {
      const statuses = splitCsv(query.status);
      filters.status = statuses.filter((s) =>
        ["pending", "running", "completed", "failed"].includes(s)
      ) as AuditStatus[];
    }

    // Parse is_compliant
    if (query.is_compliant !== undefined) {
      filters.isCompliant = query.is_compliant === "true";
    }

    // Parse dates
    if (query.date_from) {
      filters.dateFrom = new Date(query.date_from);
    }
    if (query.date_to) {
      filters.dateTo = new Date(query.date_to);
    }

    // Parse audit_config_ids
    if (query.audit_config_ids) {
      filters.auditConfigIds = splitCsv(query.audit_config_ids);
    }

    // Fiche-level filters
    if (query.groupes) {
      filters.groupes = splitCsv(query.groupes);
    }
    if (typeof query.groupe_query === "string" && query.groupe_query.trim()) {
      filters.groupeQuery = query.groupe_query.trim();
    }
    if (typeof query.agence_query === "string" && query.agence_query.trim()) {
      filters.agenceQuery = query.agence_query.trim();
    }
    if (typeof query.prospect_query === "string" && query.prospect_query.trim()) {
      filters.prospectQuery = query.prospect_query.trim();
    }
    if (query.sales_dates) {
      filters.salesDates = splitCsv(query.sales_dates);
    }
    if (typeof query.sales_date_from === "string" && query.sales_date_from.trim()) {
      filters.salesDateFrom = query.sales_date_from.trim();
    }
    if (typeof query.sales_date_to === "string" && query.sales_date_to.trim()) {
      filters.salesDateTo = query.sales_date_to.trim();
    }
    if (query.has_recordings !== undefined) {
      filters.hasRecordings = query.has_recordings === "true";
    }
    if (query.recordings_count_min) {
      const n = Number.parseInt(query.recordings_count_min, 10);
      if (Number.isFinite(n)) filters.recordingsCountMin = n;
    }
    if (query.recordings_count_max) {
      const n = Number.parseInt(query.recordings_count_max, 10);
      if (Number.isFinite(n)) filters.recordingsCountMax = n;
    }
    if (query.fetched_at_from) {
      filters.fetchedAtFrom = new Date(query.fetched_at_from);
    }
    if (query.fetched_at_to) {
      filters.fetchedAtTo = new Date(query.fetched_at_to);
    }
    if (query.last_revalidated_from) {
      filters.lastRevalidatedFrom = new Date(query.last_revalidated_from);
    }
    if (query.last_revalidated_to) {
      filters.lastRevalidatedTo = new Date(query.last_revalidated_to);
    }

    // Audit-level filters
    if (query.niveau) {
      const niveaux = splitCsv(query.niveau);
      filters.niveau = niveaux.filter((n) =>
        ["EXCELLENT", "BON", "ACCEPTABLE", "INSUFFISANT", "REJET", "PENDING"].includes(n)
      ) as AuditNiveau[];
    }
    if (query.score_min) {
      const n = Number.parseFloat(query.score_min);
      if (Number.isFinite(n)) filters.scoreMin = n;
    }
    if (query.score_max) {
      const n = Number.parseFloat(query.score_max);
      if (Number.isFinite(n)) filters.scoreMax = n;
    }
    if (query.duration_min_ms) {
      const n = Number.parseInt(query.duration_min_ms, 10);
      if (Number.isFinite(n)) filters.durationMinMs = n;
    }
    if (query.duration_max_ms) {
      const n = Number.parseInt(query.duration_max_ms, 10);
      if (Number.isFinite(n)) filters.durationMaxMs = n;
    }
    if (query.tokens_min) {
      const n = Number.parseInt(query.tokens_min, 10);
      if (Number.isFinite(n)) filters.tokensMin = n;
    }
    if (query.tokens_max) {
      const n = Number.parseInt(query.tokens_max, 10);
      if (Number.isFinite(n)) filters.tokensMax = n;
    }
    if (query.has_failed_steps !== undefined) {
      filters.hasFailedSteps = query.has_failed_steps === "true";
    }

    // Automation linkage
    if (query.automation_schedule_ids) {
      filters.automationScheduleIds = splitCsv(query.automation_schedule_ids);
    }
    if (query.automation_run_ids) {
      filters.automationRunIds = splitCsv(query.automation_run_ids);
    }
    if (query.trigger_source) {
      filters.triggerSources = splitCsv(query.trigger_source);
    }

    // Search
    if (typeof query.q === "string" && query.q.trim()) {
      filters.q = query.q.trim();
    }

    // Visibility
    if (query.latest_only !== undefined) {
      filters.latestOnly = query.latest_only === "true";
    }
    if (query.include_deleted !== undefined) {
      filters.includeDeleted = query.include_deleted === "true";
    }

    // Parse sort_by
    if (
      query.sort_by &&
      [
        "created_at",
        "completed_at",
        "score_percentage",
        "duration_ms",
      ].includes(query.sort_by)
    ) {
      filters.sortBy = query.sort_by as SortBy;
    }

    // Parse sort_order
    if (query.sort_order && ["asc", "desc"].includes(query.sort_order)) {
      filters.sortOrder = query.sort_order as SortOrder;
    }

    // Parse limit
    if (query.limit) {
      const limit = parseInt(query.limit, 10);
      filters.limit = Math.min(Math.max(limit, 1), 500);
    }

    // Parse offset
    if (query.offset) {
      const offset = parseInt(query.offset, 10);
      filters.offset = Math.max(offset, 0);
    }

    return validateListAuditsFilters(filters);
  } catch (error) {
    logger.error("Query parsing failed", { error, query });
    throw new ValidationError("Invalid query parameters", error);
  }
};

export const validateAuditDetail = (data: unknown): AuditDetail => {
  try {
    return auditDetailSchema.parse(data);
  } catch (error) {
    logger.error("Audit detail validation failed", { error });
    throw new ValidationError("Invalid audit detail format", error);
  }
};

export const validateAudit = (data: unknown): Audit => {
  try {
    return auditSchema.parse(data);
  } catch (error) {
    logger.error("Audit validation failed", { error });
    throw new ValidationError("Invalid audit format", error);
  }
};
