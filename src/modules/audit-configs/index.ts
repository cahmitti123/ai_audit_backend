/**
 * Audit Configs Module
 * ====================
 * Centralized exports for all audit config-related functionality
 * Following the same layered architecture as fiches module
 */

// ═══════════════════════════════════════════════════════════════════════════
// PRESENTATION LAYER
// ═══════════════════════════════════════════════════════════════════════════

// Routes (HTTP endpoints)
export { auditConfigsRouter } from "./audit-configs.routes.js";

// ═══════════════════════════════════════════════════════════════════════════
// ORCHESTRATION LAYER
// ═══════════════════════════════════════════════════════════════════════════

// Service (Business logic)
export * as auditConfigsService from "./audit-configs.service.js";

// ═══════════════════════════════════════════════════════════════════════════
// DATA LAYER
// ═══════════════════════════════════════════════════════════════════════════

// Repository (Database operations)
export * as auditConfigsRepository from "./audit-configs.repository.js";

// ═══════════════════════════════════════════════════════════════════════════
// FOUNDATION LAYER
// ═══════════════════════════════════════════════════════════════════════════

// Types & Schemas (All types inferred from Zod schemas)
export type * from "./audit-configs.schemas.js";
export {
  // Enums
  auditSeveritySchema,
  auditStatusSchema,
  // Core Schemas
  auditStepSchema,
  auditStepSummarySchema,
  auditConfigSchema,
  auditConfigSummarySchema,
  auditConfigWithStepsSchema,
  auditConfigDetailSchema,
  // Input Schemas
  createAuditStepInputSchema,
  updateAuditStepInputSchema,
  createAuditConfigInputSchema,
  updateAuditConfigInputSchema,
  // Response Schemas
  auditConfigListResponseSchema,
  auditConfigDetailResponseSchema,
  auditStepResponseSchema,
  auditConfigCreateResponseSchema,
  auditConfigUpdateResponseSchema,
  auditStepCreateResponseSchema,
  deleteResponseSchema,
  errorResponseSchema,
  // Validators
  validateCreateAuditConfigInput,
  validateUpdateAuditConfigInput,
  validateCreateAuditStepInput,
  validateUpdateAuditStepInput,
  validateAuditConfigDetail,
  validateAuditStep,
} from "./audit-configs.schemas.js";

// Events
export type { AuditConfigsEvents } from "./audit-configs.events.js";
