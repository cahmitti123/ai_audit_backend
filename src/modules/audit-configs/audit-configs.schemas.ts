/**
 * Audit Configs Schemas
 * =====================
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

export const auditSeveritySchema = z.enum(["LOW", "MEDIUM", "HIGH", "CRITICAL"]);

export const auditStatusSchema = z.enum([
  "pending",
  "running",
  "completed",
  "failed",
]);

// ═══════════════════════════════════════════════════════════════════════════
// AUDIT STEP SCHEMA (Base schema for audit steps)
// ═══════════════════════════════════════════════════════════════════════════

export const auditStepSchema = z.object({
  id: z.string(),
  auditConfigId: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  prompt: z.string(),
  controlPoints: z.array(z.string()),
  keywords: z.array(z.string()),
  severityLevel: auditSeveritySchema,
  isCritical: z.boolean(),
  position: z.number(),
  weight: z.number(),
  chronologicalImportant: z.boolean(),
  verifyProductInfo: z.boolean(),
  createdAt: z.date(),
  updatedAt: z.date(),
});

export const auditStepSummarySchema = z.object({
  id: z.string(),
  name: z.string(),
  position: z.number(),
  severityLevel: auditSeveritySchema,
  isCritical: z.boolean(),
  weight: z.number(),
  chronologicalImportant: z.boolean(),
  verifyProductInfo: z.boolean(),
  controlPoints: z.array(z.string()),
  keywords: z.array(z.string()),
});

// ═══════════════════════════════════════════════════════════════════════════
// AUDIT CONFIG SCHEMA (Base schema for audit configurations)
// ═══════════════════════════════════════════════════════════════════════════

export const auditConfigSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  systemPrompt: z.string().nullable(),
  isActive: z.boolean(),
  runAutomatically: z.boolean(),
  createdBy: z.string().nullable(),
  createdAt: z.date(),
  updatedAt: z.date(),
});

export const auditConfigSummarySchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  systemPrompt: z.string().nullable(),
  isActive: z.boolean(),
  runAutomatically: z.boolean(),
  stepsCount: z.number(),
  createdAt: z.date(),
  updatedAt: z.date(),
  createdBy: z.string().nullable(),
});

export const auditConfigWithStepsSchema = auditConfigSchema.extend({
  steps: z.array(auditStepSchema),
});

export const auditConfigDetailSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  systemPrompt: z.string().nullable(),
  isActive: z.boolean(),
  runAutomatically: z.boolean(),
  createdBy: z.string().nullable(),
  createdAt: z.date(),
  updatedAt: z.date(),
  steps: z.array(auditStepSchema),
});

// ═══════════════════════════════════════════════════════════════════════════
// CREATE / UPDATE SCHEMAS (Input validation)
// ═══════════════════════════════════════════════════════════════════════════

export const createAuditStepInputSchema = z.object({
  name: z.string().min(1, "Step name is required"),
  description: z.string().optional(),
  prompt: z.string().min(1, "Prompt is required"),
  controlPoints: z.array(z.string()).min(1, "At least one control point required"),
  keywords: z.array(z.string()).default([]),
  severityLevel: auditSeveritySchema,
  isCritical: z.boolean().default(false),
  position: z.number().int().min(0),
  weight: z.number().int().min(1).max(10).default(5),
  chronologicalImportant: z.boolean().default(false),
  verifyProductInfo: z.boolean().default(false),
});

export const updateAuditStepInputSchema = z.object({
  name: z.string().min(1).optional(),
  description: z.string().optional().nullable(),
  prompt: z.string().min(1).optional(),
  controlPoints: z.array(z.string()).min(1).optional(),
  keywords: z.array(z.string()).optional(),
  severityLevel: auditSeveritySchema.optional(),
  isCritical: z.boolean().optional(),
  weight: z.number().int().min(1).max(10).optional(),
  chronologicalImportant: z.boolean().optional(),
  verifyProductInfo: z.boolean().optional(),
  position: z.number().int().optional(), // For reordering
});

export const createAuditConfigInputSchema = z.object({
  name: z.string().min(1, "Config name is required"),
  description: z.string().optional(),
  systemPrompt: z.string().optional(),
  isActive: z.boolean().default(true),
  runAutomatically: z.boolean().default(false),
  createdBy: z.string().optional(),
  steps: z.array(createAuditStepInputSchema).optional().default([]),
});

export const updateAuditConfigInputSchema = z.object({
  name: z.string().min(1).optional(),
  description: z.string().optional().nullable(),
  systemPrompt: z.string().optional().nullable(),
  isActive: z.boolean().optional(),
  runAutomatically: z.boolean().optional(),
});

// ═══════════════════════════════════════════════════════════════════════════
// API RESPONSE SCHEMAS
// ═══════════════════════════════════════════════════════════════════════════

export const auditConfigListResponseSchema = z.object({
  success: z.boolean(),
  data: z.array(auditConfigSummarySchema),
  count: z.number(),
});

export const auditConfigDetailResponseSchema = z.object({
  success: z.boolean(),
  data: auditConfigDetailSchema,
});

export const auditStepResponseSchema = z.object({
  success: z.boolean(),
  data: auditStepSchema,
});

export const auditConfigCreateResponseSchema = z.object({
  success: z.boolean(),
  data: z.object({
    id: z.string(),
    name: z.string(),
  }),
});

export const auditConfigUpdateResponseSchema = z.object({
  success: z.boolean(),
  data: z.object({
    id: z.string(),
    name: z.string(),
    stepsCount: z.number(),
  }),
});

export const auditStepCreateResponseSchema = z.object({
  success: z.boolean(),
  data: z.object({
    id: z.string(),
    name: z.string(),
  }),
});

export const deleteResponseSchema = z.object({
  success: z.boolean(),
  message: z.string(),
});

export const errorResponseSchema = z.object({
  success: z.boolean(),
  error: z.string(),
  message: z.string().optional(),
});

// ═══════════════════════════════════════════════════════════════════════════
// DATABASE RECORD TYPES (for internal operations)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Audit config with step count from database query
 * Used for listing audit configs with statistics
 */
export const auditConfigWithCountSchema = z.object({
  id: z.bigint(),
  name: z.string(),
  description: z.string().nullable(),
  systemPrompt: z.string().nullable(),
  isActive: z.boolean(),
  runAutomatically: z.boolean(),
  createdBy: z.string().nullable(),
  createdAt: z.date(),
  updatedAt: z.date(),
  _count: z.object({
    steps: z.number(),
    audits: z.number(),
  }),
});

/**
 * Audit config usage statistics
 * Used for analyzing audit config performance and usage
 */
export const auditConfigStatsSchema = z.object({
  id: z.string(),
  name: z.string(),
  totalAudits: z.number(),
  completedAudits: z.number(),
  failedAudits: z.number(),
  averageScore: z.number().nullable(),
  averageDurationMs: z.number().nullable(),
  lastUsedAt: z.date().nullable(),
  complianceRate: z.number(), // Percentage of compliant audits
});

// ═══════════════════════════════════════════════════════════════════════════
// EXPORTED TYPES
// ═══════════════════════════════════════════════════════════════════════════

// Enum Types
export type AuditSeverity = z.infer<typeof auditSeveritySchema>;
export type AuditStatus = z.infer<typeof auditStatusSchema>;

// Core Types
export type AuditStep = z.infer<typeof auditStepSchema>;
export type AuditStepSummary = z.infer<typeof auditStepSummarySchema>;
export type AuditConfig = z.infer<typeof auditConfigSchema>;
export type AuditConfigSummary = z.infer<typeof auditConfigSummarySchema>;
export type AuditConfigWithSteps = z.infer<typeof auditConfigWithStepsSchema>;
export type AuditConfigDetail = z.infer<typeof auditConfigDetailSchema>;

// Input Types
export type CreateAuditStepInput = z.infer<typeof createAuditStepInputSchema>;
export type UpdateAuditStepInput = z.infer<typeof updateAuditStepInputSchema>;
export type CreateAuditConfigInput = z.infer<typeof createAuditConfigInputSchema>;
export type UpdateAuditConfigInput = z.infer<typeof updateAuditConfigInputSchema>;

// Response Types
export type AuditConfigListResponse = z.infer<typeof auditConfigListResponseSchema>;
export type AuditConfigDetailResponse = z.infer<typeof auditConfigDetailResponseSchema>;
export type AuditStepResponse = z.infer<typeof auditStepResponseSchema>;
export type AuditConfigCreateResponse = z.infer<typeof auditConfigCreateResponseSchema>;
export type AuditConfigUpdateResponse = z.infer<typeof auditConfigUpdateResponseSchema>;
export type AuditStepCreateResponse = z.infer<typeof auditStepCreateResponseSchema>;
export type DeleteResponse = z.infer<typeof deleteResponseSchema>;
export type ErrorResponse = z.infer<typeof errorResponseSchema>;

// Database Record Types
export type AuditConfigWithCount = z.infer<typeof auditConfigWithCountSchema>;
export type AuditConfigStats = z.infer<typeof auditConfigStatsSchema>;

// ═══════════════════════════════════════════════════════════════════════════
// VALIDATORS
// ═══════════════════════════════════════════════════════════════════════════

export const validateCreateAuditConfigInput = (
  data: unknown
): CreateAuditConfigInput => {
  try {
    return createAuditConfigInputSchema.parse(data);
  } catch (error) {
    logger.error("Create audit config input validation failed", { error });
    throw new ValidationError("Invalid create audit config input", error);
  }
};

export const validateUpdateAuditConfigInput = (
  data: unknown
): UpdateAuditConfigInput => {
  try {
    return updateAuditConfigInputSchema.parse(data);
  } catch (error) {
    logger.error("Update audit config input validation failed", { error });
    throw new ValidationError("Invalid update audit config input", error);
  }
};

export const validateCreateAuditStepInput = (
  data: unknown
): CreateAuditStepInput => {
  try {
    return createAuditStepInputSchema.parse(data);
  } catch (error) {
    logger.error("Create audit step input validation failed", { error });
    throw new ValidationError("Invalid create audit step input", error);
  }
};

export const validateUpdateAuditStepInput = (
  data: unknown
): UpdateAuditStepInput => {
  try {
    return updateAuditStepInputSchema.parse(data);
  } catch (error) {
    logger.error("Update audit step input validation failed", { error });
    throw new ValidationError("Invalid update audit step input", error);
  }
};

export const validateAuditConfigDetail = (
  data: unknown
): AuditConfigDetail => {
  try {
    return auditConfigDetailSchema.parse(data);
  } catch (error) {
    logger.error("Audit config detail validation failed", { error });
    throw new Error("Invalid audit config detail format");
  }
};

export const validateAuditStep = (data: unknown): AuditStep => {
  try {
    return auditStepSchema.parse(data);
  } catch (error) {
    logger.error("Audit step validation failed", { error });
    throw new Error("Invalid audit step format");
  }
};

