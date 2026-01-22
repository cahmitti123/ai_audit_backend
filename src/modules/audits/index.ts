/**
 * Audits Module
 * =============
 * Centralized exports for all audit-related functionality
 * Following the same layered architecture as fiches and audit-configs modules
 */

// ═══════════════════════════════════════════════════════════════════════════
// PRESENTATION LAYER
// ═══════════════════════════════════════════════════════════════════════════

// Routes (HTTP endpoints)
// Workflows (Background jobs)
import { functions as rerunFunctions } from "./audits.rerun.workflows.js";
import { functions as workflowFunctions } from "./audits.workflows.js";

export { auditRerunRouter } from "./audits.rerun.routes.js";
export { auditsRouter } from "./audits.routes.js";
export const auditsFunctions = [...workflowFunctions, ...rerunFunctions];

// ═══════════════════════════════════════════════════════════════════════════
// ORCHESTRATION LAYER
// ═══════════════════════════════════════════════════════════════════════════

// Service (Business logic)
export * as auditsService from "./audits.service.js";

// Helpers (Specialized utilities)
export * as auditsAnalyzer from "./audits.analyzer.js";
export * as auditsPrompts from "./audits.prompts.js";
export * as auditsTimeline from "./audits.timeline.js";

// ═══════════════════════════════════════════════════════════════════════════
// DATA LAYER
// ═══════════════════════════════════════════════════════════════════════════

// Repository (Database operations)
export * as auditsRepository from "./audits.repository.js";

// External APIs
export * as auditsVectorStore from "./audits.vector-store.js";

// ═══════════════════════════════════════════════════════════════════════════
// FOUNDATION LAYER
// ═══════════════════════════════════════════════════════════════════════════

// Types & Schemas (All types inferred from Zod schemas)
export type * from "./audits.schemas.js";
export {
  auditDetailResponseSchema,
  auditDetailSchema,
  // Workflow Schemas
  auditFunctionResultSchema,
  // Response Schemas
  auditListResponseSchema,
  auditNiveauEnum,
  // Core Schemas
  auditSchema,
  // Enums
  auditStatusEnum,
  auditStepResultSchema,
  auditSummarySchema,
  auditWithConfigSchema,
  auditWithFicheSchema,
  batchAuditInputSchema,
  batchAuditResponseSchema,
  batchAuditResultSchema,
  ficheAuditsResponseSchema,
  ficheWithAuditsSchema,
  groupedAuditsResponseSchema,
  listAuditsFiltersSchema,
  listAuditsQuerySchema,
  parseListAuditsQuery,
  // Input Schemas
  runAuditInputSchema,
  runAuditResponseSchema,
  sortByEnum,
  sortOrderEnum,
  stepConformeEnum,
  stepNiveauConformiteEnum,
  validateAudit,
  validateAuditDetail,
  validateBatchAuditInput,
  validateListAuditsFilters,
  // Validators
  validateRunAuditInput,
} from "./audits.schemas.js";

// Events
export type { AuditsEvents } from "./audits.events.js";

// Legacy exports (for backwards compatibility - can be removed later)
export { runAudit } from "./audits.runner.js";
