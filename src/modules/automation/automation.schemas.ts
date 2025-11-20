/**
 * Automation Schemas
 * ==================
 * RESPONSIBILITY: Type definitions and validation
 * - Zod schemas for automation types
 * - Type exports (inferred from Zod)
 * - Runtime validators
 * - No business logic
 *
 * LAYER: Foundation (Types & Validation)
 */

import { z } from "zod";
import { logger } from "../../shared/logger.js";

// ═══════════════════════════════════════════════════════════════════════════
// ENUMS
// ═══════════════════════════════════════════════════════════════════════════

export const scheduleTypeSchema = z.enum([
  "MANUAL",
  "DAILY",
  "WEEKLY",
  "MONTHLY",
  "CRON",
]);

export const automationRunStatusSchema = z.enum([
  "pending",
  "running",
  "completed",
  "partial",
  "failed",
]);

export const transcriptionPrioritySchema = z.enum(["low", "normal", "high"]);

export const dateRangePresetSchema = z.enum([
  "last_24h",
  "yesterday",
  "last_week",
  "last_month",
  "custom",
]);

export const ficheSelectionModeSchema = z.enum([
  "date_range",
  "manual",
  "filter",
]);

export const automationLogLevelSchema = z.enum([
  "debug",
  "info",
  "warning",
  "error",
]);

// ═══════════════════════════════════════════════════════════════════════════
// FICHE SELECTION SCHEMA
// ═══════════════════════════════════════════════════════════════════════════

export const ficheSelectionSchema = z.object({
  mode: ficheSelectionModeSchema,
  dateRange: dateRangePresetSchema.optional(),
  customStartDate: z.string().optional(),
  customEndDate: z.string().optional(),
  groupes: z.array(z.string()).optional(),
  onlyWithRecordings: z.boolean().optional().default(false),
  onlyUnaudited: z.boolean().optional().default(false),
  maxFiches: z.number().int().positive().optional(),
  ficheIds: z.array(z.string()).optional(),
});

// ═══════════════════════════════════════════════════════════════════════════
// AUTOMATION SCHEDULE SCHEMAS (Input/Output)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Schema for creating an automation schedule (Input)
 */
export const createAutomationScheduleInputSchema = z.object({
  name: z.string().min(1).max(255),
  description: z.string().optional(),
  isActive: z.boolean().default(true),
  createdBy: z.string().optional(),

  // Schedule Configuration
  scheduleType: scheduleTypeSchema,
  cronExpression: z.string().optional(),
  timezone: z.string().default("UTC"),
  timeOfDay: z
    .string()
    .regex(/^\d{2}:\d{2}$/)
    .optional(), // HH:MM format
  dayOfWeek: z.number().int().min(0).max(6).optional(), // 0 = Sunday, 6 = Saturday
  dayOfMonth: z.number().int().min(1).max(31).optional(),

  // Fiche Selection
  ficheSelection: ficheSelectionSchema,

  // Transcription Configuration
  runTranscription: z.boolean().default(true),
  skipIfTranscribed: z.boolean().default(true),
  transcriptionPriority: transcriptionPrioritySchema.default("normal"),

  // Audit Configuration
  runAudits: z.boolean().default(true),
  useAutomaticAudits: z.boolean().default(true),
  specificAuditConfigs: z
    .preprocess((val) => {
      if (!val || !Array.isArray(val)) return undefined;
      // Filter out null/undefined values and convert strings to numbers
      const filtered = val
        .filter((id: any) => id !== null && id !== undefined && id !== "")
        .map((id: any) => {
          if (typeof id === "string") return parseInt(id, 10);
          return id;
        });
      // Return undefined if array is empty after filtering
      return filtered.length > 0 ? filtered : undefined;
    }, z.array(z.number().int()).optional())
    .describe("Array of specific audit config IDs to run"),

  // Error Handling
  continueOnError: z.boolean().default(true),
  retryFailed: z.boolean().default(false),
  maxRetries: z.number().int().min(0).max(5).default(0),

  // Notifications
  notifyOnComplete: z.boolean().default(true),
  notifyOnError: z.boolean().default(true),
  webhookUrl: z.preprocess(
    (val) => (!val || val === "" ? undefined : val),
    z.string().url().optional()
  ),
  notifyEmails: z.preprocess((val) => {
    if (!val || !Array.isArray(val)) return [];
    return val.filter((email: any) => email && email.trim() !== "");
  }, z.array(z.string().email()).optional()),

  // External API
  externalApiKey: z.string().optional(),
});

/**
 * Schema for updating an automation schedule (Partial input)
 */
export const updateAutomationScheduleInputSchema =
  createAutomationScheduleInputSchema.partial();

/**
 * Schema for automation schedule response (Output - API friendly)
 */
export const automationScheduleSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  isActive: z.boolean(),
  createdBy: z.string().nullable(),
  createdAt: z.date(),
  updatedAt: z.date(),
  
  // Schedule Configuration
  scheduleType: scheduleTypeSchema,
  cronExpression: z.string().nullable(),
  timezone: z.string(),
  timeOfDay: z.string().nullable(),
  dayOfWeek: z.number().nullable(),
  dayOfMonth: z.number().nullable(),
  
  // Fiche Selection
  ficheSelection: ficheSelectionSchema,
  
  // Transcription Configuration
  runTranscription: z.boolean(),
  skipIfTranscribed: z.boolean(),
  transcriptionPriority: transcriptionPrioritySchema,
  
  // Audit Configuration
  runAudits: z.boolean(),
  useAutomaticAudits: z.boolean(),
  specificAuditConfigs: z.array(z.string()),
  
  // Error Handling
  continueOnError: z.boolean(),
  retryFailed: z.boolean(),
  maxRetries: z.number(),
  
  // Notifications
  notifyOnComplete: z.boolean(),
  notifyOnError: z.boolean(),
  webhookUrl: z.string().nullable(),
  notifyEmails: z.array(z.string()),
  externalApiKey: z.string().nullable(),
  
  // Stats
  lastRunAt: z.date().nullable(),
  lastRunStatus: z.string().nullable(),
  totalRuns: z.number(),
  successfulRuns: z.number(),
  failedRuns: z.number(),
});

/**
 * Schema for automation schedule with runs
 */
export const automationScheduleWithRunsSchema = automationScheduleSchema.extend({
  runs: z.array(
    z.object({
      id: z.string(),
      status: automationRunStatusSchema,
      startedAt: z.date(),
      completedAt: z.date().nullable(),
      durationMs: z.number().nullable(),
      totalFiches: z.number(),
      successfulFiches: z.number(),
      failedFiches: z.number(),
    })
  ),
});

// ═══════════════════════════════════════════════════════════════════════════
// AUTOMATION RUN SCHEMAS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Schema for automation run response (Output)
 */
export const automationRunSchema = z.object({
  id: z.string(),
  scheduleId: z.string(),
  status: automationRunStatusSchema,
  startedAt: z.date(),
  completedAt: z.date().nullable(),
  durationMs: z.number().nullable(),
  totalFiches: z.number(),
  successfulFiches: z.number(),
  failedFiches: z.number(),
  transcriptionsRun: z.number(),
  auditsRun: z.number(),
  errorMessage: z.string().nullable(),
  errorDetails: z.any().nullable(),
  configSnapshot: z.any(),
  resultSummary: z.any().nullable(),
});

/**
 * Schema for automation run with logs
 */
export const automationRunWithLogsSchema = automationRunSchema.extend({
  logs: z.array(
    z.object({
      id: z.string(),
      level: automationLogLevelSchema,
      message: z.string(),
      timestamp: z.date(),
      metadata: z.any(),
    })
  ),
});

/**
 * Schema for automation log
 */
export const automationLogSchema = z.object({
  id: z.string(),
  runId: z.string(),
  level: automationLogLevelSchema,
  message: z.string(),
  timestamp: z.date(),
  metadata: z.any(),
});

// ═══════════════════════════════════════════════════════════════════════════
// TRIGGER SCHEMAS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Schema for manually triggering automation
 */
export const triggerAutomationInputSchema = z.object({
  scheduleId: z.number().int().positive(),
  overrideFicheSelection: ficheSelectionSchema.optional(),
});

// ═══════════════════════════════════════════════════════════════════════════
// UTILITY SCHEMAS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Schema for processed fiche data
 */
export const processedFicheDataSchema = z.object({
  ficheIds: z.array(z.string()),
  fichesData: z.array(z.any()),
  cles: z.record(z.string()),
});

/**
 * Schema for automation notification payload
 */
export const automationNotificationSchema = z.object({
  schedule_id: z.union([z.number(), z.string()]),
  schedule_name: z.string(),
  run_id: z.string(),
  status: automationRunStatusSchema,
  duration_seconds: z.number().optional(),
  total_fiches: z.number(),
  successful_fiches: z.number(),
  failed_fiches: z.number(),
  transcriptions_run: z.number().optional(),
  audits_run: z.number().optional(),
  failures: z
    .array(
      z.object({
        ficheId: z.string(),
        error: z.string(),
      })
    )
    .optional(),
  error: z.string().optional(),
});

// ═══════════════════════════════════════════════════════════════════════════
// INFERRED TYPESCRIPT TYPES (Single Source of Truth)
// ═══════════════════════════════════════════════════════════════════════════

// Enums
export type ScheduleType = z.infer<typeof scheduleTypeSchema>;
export type AutomationRunStatus = z.infer<typeof automationRunStatusSchema>;
export type TranscriptionPriority = z.infer<typeof transcriptionPrioritySchema>;
export type DateRangePreset = z.infer<typeof dateRangePresetSchema>;
export type FicheSelectionMode = z.infer<typeof ficheSelectionModeSchema>;
export type AutomationLogLevel = z.infer<typeof automationLogLevelSchema>;

// Core types
export type FicheSelection = z.infer<typeof ficheSelectionSchema>;

// Input types (for API requests)
export type CreateAutomationScheduleInput = z.infer<
  typeof createAutomationScheduleInputSchema
>;
export type UpdateAutomationScheduleInput = z.infer<
  typeof updateAutomationScheduleInputSchema
>;
export type TriggerAutomationInput = z.infer<
  typeof triggerAutomationInputSchema
>;

// Output types (for API responses - BigInt converted to string)
export type AutomationSchedule = z.infer<typeof automationScheduleSchema>;
export type AutomationScheduleWithRuns = z.infer<
  typeof automationScheduleWithRunsSchema
>;
export type AutomationRun = z.infer<typeof automationRunSchema>;
export type AutomationRunWithLogs = z.infer<typeof automationRunWithLogsSchema>;
export type AutomationLog = z.infer<typeof automationLogSchema>;

// Utility types
export type ProcessedFicheData = z.infer<typeof processedFicheDataSchema>;
export type AutomationNotification = z.infer<
  typeof automationNotificationSchema
>;

// ═══════════════════════════════════════════════════════════════════════════
// VALIDATORS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Validate create automation schedule input
 */
export function validateCreateAutomationScheduleInput(
  data: unknown
): CreateAutomationScheduleInput {
  try {
    return createAutomationScheduleInputSchema.parse(data);
  } catch (error) {
    logger.error("Create automation schedule validation failed", { error });
    throw new Error("Invalid automation schedule data");
  }
}

/**
 * Validate update automation schedule input
 */
export function validateUpdateAutomationScheduleInput(
  data: unknown
): UpdateAutomationScheduleInput {
  try {
    return updateAutomationScheduleInputSchema.parse(data);
  } catch (error) {
    logger.error("Update automation schedule validation failed", { error });
    throw new Error("Invalid automation schedule update data");
  }
}

/**
 * Validate trigger automation input
 */
export function validateTriggerAutomationInput(
  data: unknown
): TriggerAutomationInput {
  try {
    return triggerAutomationInputSchema.parse(data);
  } catch (error) {
    logger.error("Trigger automation validation failed", { error });
    throw new Error("Invalid trigger automation data");
  }
}

/**
 * Validate fiche selection
 */
export function validateFicheSelection(data: unknown): FicheSelection {
  try {
    return ficheSelectionSchema.parse(data);
  } catch (error) {
    logger.error("Fiche selection validation failed", { error });
    throw new Error("Invalid fiche selection data");
  }
}

/**
 * Validate automation notification
 */
export function validateAutomationNotification(
  data: unknown
): AutomationNotification {
  try {
    return automationNotificationSchema.parse(data);
  } catch (error) {
    logger.error("Automation notification validation failed", { error });
    throw new Error("Invalid notification data");
  }
}



