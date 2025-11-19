/**
 * Automation Module
 * =================
 * Centralized exports for all automation-related functionality
 * Following the layered architecture pattern
 */

// ═══════════════════════════════════════════════════════════════════════════
// PRESENTATION LAYER
// ═══════════════════════════════════════════════════════════════════════════

// Routes (HTTP endpoints)
export { automationRouter } from "./automation.routes.js";

// Workflows (Background jobs)
export { functions as automationFunctions } from "./automation.workflows.js";

// ═══════════════════════════════════════════════════════════════════════════
// ORCHESTRATION LAYER
// ═══════════════════════════════════════════════════════════════════════════

// Service (Business logic)
export * as automationService from "./automation.service.js";

// ═══════════════════════════════════════════════════════════════════════════
// DATA LAYER
// ═══════════════════════════════════════════════════════════════════════════

// Repository (Database operations)
export * as automationRepository from "./automation.repository.js";

// API Client (External API calls)
export * as automationApi from "./automation.api.js";

// ═══════════════════════════════════════════════════════════════════════════
// FOUNDATION LAYER
// ═══════════════════════════════════════════════════════════════════════════

// Types & Schemas (All types inferred from Zod schemas)
export type * from "./automation.schemas.js";
export {
  // Enums
  scheduleTypeSchema,
  automationRunStatusSchema,
  transcriptionPrioritySchema,
  dateRangePresetSchema,
  ficheSelectionModeSchema,
  automationLogLevelSchema,
  // Core Schemas
  ficheSelectionSchema,
  automationScheduleSchema,
  automationScheduleWithRunsSchema,
  automationRunSchema,
  automationRunWithLogsSchema,
  automationLogSchema,
  // Input Schemas
  createAutomationScheduleInputSchema,
  updateAutomationScheduleInputSchema,
  triggerAutomationInputSchema,
  // Utility Schemas
  processedFicheDataSchema,
  automationNotificationSchema,
  // Validators
  validateCreateAutomationScheduleInput,
  validateUpdateAutomationScheduleInput,
  validateTriggerAutomationInput,
  validateFicheSelection,
  validateAutomationNotification,
} from "./automation.schemas.js";

// Events
export type { AutomationEvents } from "./automation.events.js";
