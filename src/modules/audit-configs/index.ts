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
  auditConfigCreateResponseSchema,
  auditConfigDetailResponseSchema,
  auditConfigDetailSchema,
  // Response Schemas
  auditConfigListResponseSchema,
  auditConfigSchema,
  auditConfigSummarySchema,
  auditConfigUpdateResponseSchema,
  auditConfigWithStepsSchema,
  // Enums
  auditSeveritySchema,
  auditStatusSchema,
  auditStepCreateResponseSchema,
  auditStepResponseSchema,
  // Core Schemas
  auditStepSchema,
  auditStepSummarySchema,
  createAuditConfigInputSchema,
  // Input Schemas
  createAuditStepInputSchema,
  deleteResponseSchema,
  errorResponseSchema,
  updateAuditConfigInputSchema,
  updateAuditStepInputSchema,
  validateAuditConfigDetail,
  validateAuditStep,
  // Validators
  validateCreateAuditConfigInput,
  validateCreateAuditStepInput,
  validateUpdateAuditConfigInput,
  validateUpdateAuditStepInput,
} from "./audit-configs.schemas.js";

// Events
export type { AuditConfigsEvents } from "./audit-configs.events.js";
