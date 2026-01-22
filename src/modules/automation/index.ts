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
  automationLogLevelSchema,
  automationLogSchema,
  automationNotificationSchema,
  automationRunSchema,
  automationRunStatusSchema,
  automationRunWithLogsSchema,
  automationScheduleSchema,
  automationScheduleWithRunsSchema,
  // Input Schemas
  createAutomationScheduleInputSchema,
  dateRangePresetSchema,
  ficheSelectionModeSchema,
  // Core Schemas
  ficheSelectionSchema,
  // Utility Schemas
  processedFicheDataSchema,
  // Enums
  scheduleTypeSchema,
  transcriptionPrioritySchema,
  triggerAutomationInputSchema,
  updateAutomationScheduleInputSchema,
  validateAutomationNotification,
  // Validators
  validateCreateAutomationScheduleInput,
  validateFicheSelection,
  validateTriggerAutomationInput,
  validateUpdateAutomationScheduleInput,
} from "./automation.schemas.js";

// Events
export type { AutomationEvents } from "./automation.events.js";
