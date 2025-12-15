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

    // Parse fiche_ids
    if (query.fiche_ids) {
      filters.ficheIds = query.fiche_ids.split(",").map((id) => id.trim());
    }

    // Parse status
    if (query.status) {
      const statuses = query.status.split(",").map((s) => s.trim());
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
      filters.auditConfigIds = query.audit_config_ids
        .split(",")
        .map((id) => id.trim());
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
    throw new Error("Invalid query parameters");
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
