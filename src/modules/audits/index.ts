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
export { auditsRouter } from "./audits.routes.js";
export { auditRerunRouter } from "./audits.rerun.routes.js";

// Workflows (Background jobs)
import { functions as workflowFunctions } from "./audits.workflows.js";
import { functions as rerunFunctions } from "./audits.rerun.workflows.js";
export const auditsFunctions = [...workflowFunctions, ...rerunFunctions];

// ═══════════════════════════════════════════════════════════════════════════
// ORCHESTRATION LAYER
// ═══════════════════════════════════════════════════════════════════════════

// Service (Business logic)
export * as auditsService from "./audits.service.js";

// Helpers (Specialized utilities)
export * as auditsAnalyzer from "./audits.analyzer.js";
export * as auditsTimeline from "./audits.timeline.js";
export * as auditsPrompts from "./audits.prompts.js";

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
  // Enums
  auditStatusEnum,
  auditNiveauEnum,
  stepConformeEnum,
  stepNiveauConformiteEnum,
  sortByEnum,
  sortOrderEnum,
  // Core Schemas
  auditSchema,
  auditSummarySchema,
  auditDetailSchema,
  auditStepResultSchema,
  auditWithConfigSchema,
  auditWithFicheSchema,
  ficheWithAuditsSchema,
  // Input Schemas
  runAuditInputSchema,
  batchAuditInputSchema,
  listAuditsFiltersSchema,
  listAuditsQuerySchema,
  // Response Schemas
  auditListResponseSchema,
  auditDetailResponseSchema,
  ficheAuditsResponseSchema,
  groupedAuditsResponseSchema,
  runAuditResponseSchema,
  batchAuditResponseSchema,
  // Workflow Schemas
  auditFunctionResultSchema,
  batchAuditResultSchema,
  // Validators
  validateRunAuditInput,
  validateBatchAuditInput,
  validateListAuditsFilters,
  parseListAuditsQuery,
  validateAuditDetail,
  validateAudit,
} from "./audits.schemas.js";

// Events
export type { AuditsEvents } from "./audits.events.js";

// Legacy exports (for backwards compatibility - can be removed later)
export { runAudit } from "./audits.runner.js";
