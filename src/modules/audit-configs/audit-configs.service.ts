/**
 * Audit Configs Service
 * =====================
 * RESPONSIBILITY: Business logic and orchestration
 * - Validation and business rules
 * - Statistics and analytics
 * - Data enrichment
 * - Coordinates between repository and other services
 *
 * LAYER: Business Logic / Orchestration
 */

import type {
  AuditConfig,
  AuditConfigDetail,
  AuditConfigSummary,
  AuditConfigStats,
  AuditStep,
  CreateAuditConfigInput,
  UpdateAuditConfigInput,
  CreateAuditStepInput,
  UpdateAuditStepInput,
} from "./audit-configs.schemas.js";
import * as auditConfigsRepository from "./audit-configs.repository.js";
import { logger } from "../../shared/logger.js";

// ═══════════════════════════════════════════════════════════════════════════
// AUDIT CONFIG OPERATIONS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Get all audit configurations with optional filtering
 */
export async function getAllAuditConfigs(options: {
  includeInactive?: boolean;
  includeSteps?: boolean;
}): Promise<AuditConfigSummary[] | AuditConfigDetail[]> {
  const configs = await auditConfigsRepository.getAllAuditConfigs(
    options.includeInactive
  );

  return configs.map((config) => ({
    id: config.id.toString(),
    name: config.name,
    description: config.description,
    systemPrompt: config.systemPrompt,
    isActive: config.isActive,
    runAutomatically: config.runAutomatically,
    createdBy: config.createdBy,
    createdAt: config.createdAt,
    updatedAt: config.updatedAt,
    ...(options.includeSteps
      ? {
          steps: config.steps.map((step) => ({
            id: step.id.toString(),
            auditConfigId: step.auditConfigId.toString(),
            name: step.name,
            description: step.description,
            prompt: step.prompt,
            controlPoints: step.controlPoints,
            keywords: step.keywords,
            severityLevel: step.severityLevel as any,
            isCritical: step.isCritical,
            position: step.position,
            weight: step.weight,
            chronologicalImportant: step.chronologicalImportant,
            verifyProductInfo: step.verifyProductInfo,
            createdAt: step.createdAt,
            updatedAt: step.updatedAt,
          })),
        }
      : { stepsCount: config.steps.length }),
  })) as any;
}

/**
 * Get audit configuration by ID
 */
export async function getAuditConfigById(
  id: string | bigint
): Promise<AuditConfigDetail | null> {
  const configId = typeof id === "string" ? BigInt(id) : id;
  const config = await auditConfigsRepository.getAuditConfigById(configId);

  if (!config) {
    return null;
  }

  return {
    id: config.id.toString(),
    name: config.name,
    description: config.description,
    systemPrompt: config.systemPrompt,
    isActive: config.isActive,
    runAutomatically: config.runAutomatically,
    createdBy: config.createdBy,
    createdAt: config.createdAt,
    updatedAt: config.updatedAt,
    steps: config.steps.map((step) => ({
      id: step.id.toString(),
      auditConfigId: step.auditConfigId.toString(),
      name: step.name,
      description: step.description,
      prompt: step.prompt,
      controlPoints: step.controlPoints,
      keywords: step.keywords,
      severityLevel: step.severityLevel as any,
      isCritical: step.isCritical,
      position: step.position,
      weight: step.weight,
      chronologicalImportant: step.chronologicalImportant,
      verifyProductInfo: step.verifyProductInfo,
      createdAt: step.createdAt,
      updatedAt: step.updatedAt,
    })),
  };
}

/**
 * Create new audit configuration
 * Uses transaction to ensure all-or-nothing creation
 */
export async function createAuditConfig(
  input: CreateAuditConfigInput
): Promise<{ id: string; name: string }> {
  // Validate ALL steps BEFORE starting transaction
  if (input.steps && input.steps.length > 0) {
    // Validate each step individually to get detailed errors
    const stepErrors: string[] = [];
    
    input.steps.forEach((step, index) => {
      // Check required fields
      if (!step.name || step.name.trim() === "") {
        stepErrors.push(`Step ${index + 1}: name is required`);
      }
      if (!step.prompt || step.prompt.trim() === "") {
        stepErrors.push(`Step ${index + 1}: prompt is required`);
      }
      if (!step.controlPoints || step.controlPoints.length === 0) {
        stepErrors.push(`Step ${index + 1}: at least one control point is required`);
      }
      if (typeof step.position !== "number" || step.position < 0) {
        stepErrors.push(`Step ${index + 1}: position must be a non-negative number`);
      }
      if (step.weight !== undefined && (step.weight < 1 || step.weight > 10)) {
        stepErrors.push(`Step ${index + 1}: weight must be between 1 and 10`);
      }
    });

    if (stepErrors.length > 0) {
      const error = new Error(
        `Validation failed for ${stepErrors.length} step(s):\n- ${stepErrors.join('\n- ')}`
      );
      logger.error("Step validation failed before creation", { 
        errors: stepErrors,
        stepCount: input.steps.length 
      });
      throw error;
    }

    // Validate positions are unique and sequential
    const positions = input.steps.map((s) => s.position);
    const uniquePositions = new Set(positions);
    if (uniquePositions.size !== positions.length) {
      throw new Error("Step positions must be unique");
    }
  }

  // Delegate to repository for database transaction
  const config = await auditConfigsRepository.createAuditConfig({
    name: input.name,
    description: input.description,
    systemPrompt: input.systemPrompt,
    isActive: input.isActive,
    runAutomatically: input.runAutomatically,
    createdBy: input.createdBy,
    steps: input.steps?.map((step) => ({
      name: step.name,
      description: step.description,
      prompt: step.prompt,
      controlPoints: step.controlPoints,
      keywords: step.keywords || [],
      severityLevel: step.severityLevel,
      isCritical: step.isCritical ?? false,
      position: step.position,
      weight: step.weight ?? 5,
      chronologicalImportant: step.chronologicalImportant ?? false,
      verifyProductInfo: step.verifyProductInfo ?? false,
    })),
  });

  if (!config) {
    throw new Error("Failed to create audit config");
  }

  logger.info("Audit config created", {
    id: config.id.toString(),
    name: config.name,
    stepsCount: config.steps.length,
  });

  return {
    id: config.id.toString(),
    name: config.name,
  };
}

/**
 * Update audit configuration
 */
export async function updateAuditConfig(
  id: string | bigint,
  input: UpdateAuditConfigInput
): Promise<{ id: string; name: string; stepsCount: number }> {
  const configId = typeof id === "string" ? BigInt(id) : id;

  // Check if config exists
  const existing = await auditConfigsRepository.getAuditConfigById(configId);
  if (!existing) {
    throw new Error("Audit config not found");
  }

  // Filter out null values (convert to undefined for repository)
  const cleanedInput = {
    ...input,
    description: input.description === null ? undefined : input.description,
    systemPrompt: input.systemPrompt === null ? undefined : input.systemPrompt,
  };

  const updated = await auditConfigsRepository.updateAuditConfig(
    configId,
    cleanedInput
  );

  logger.info("Audit config updated", {
    id: updated.id.toString(),
    name: updated.name,
  });

  return {
    id: updated.id.toString(),
    name: updated.name,
    stepsCount: updated.steps.length,
  };
}

/**
 * Delete audit configuration
 */
export async function deleteAuditConfig(id: string | bigint): Promise<void> {
  const configId = typeof id === "string" ? BigInt(id) : id;

  // Check if config exists
  const existing = await auditConfigsRepository.getAuditConfigById(configId);
  if (!existing) {
    throw new Error("Audit config not found");
  }

  // Check if config is in use
  const auditCount = await auditConfigsRepository.countAuditsByConfigId(
    configId
  );

  if (auditCount > 0) {
    logger.warn("Deleting audit config that has been used", {
      configId: configId.toString(),
      auditCount,
    });
  }

  await auditConfigsRepository.deleteAuditConfig(configId);

  logger.info("Audit config deleted", {
    id: configId.toString(),
    name: existing.name,
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// AUDIT STEP OPERATIONS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Add step to audit configuration
 */
export async function addAuditStep(
  auditConfigId: string | bigint,
  input: CreateAuditStepInput
): Promise<{ id: string; name: string }> {
  const configId =
    typeof auditConfigId === "string" ? BigInt(auditConfigId) : auditConfigId;

  // Check if config exists
  const config = await auditConfigsRepository.getAuditConfigById(configId);
  if (!config) {
    throw new Error("Audit config not found");
  }

  // Validate position doesn't conflict
  const existingPositions = config.steps.map((s) => s.position);
  if (existingPositions.includes(input.position)) {
    throw new Error(
      `Position ${input.position} is already taken. Available positions: ${
        Math.max(...existingPositions, -1) + 1
      }`
    );
  }

  const step = await auditConfigsRepository.addAuditStep(configId, input);

  logger.info("Audit step added", {
    configId: configId.toString(),
    stepId: step.id.toString(),
    stepName: step.name,
    position: step.position,
  });

  return {
    id: step.id.toString(),
    name: step.name,
  };
}

/**
 * Update audit step
 */
export async function updateAuditStep(
  stepId: string | bigint,
  input: UpdateAuditStepInput
): Promise<AuditStep> {
  const id = typeof stepId === "string" ? BigInt(stepId) : stepId;

  // Filter out null values (convert to undefined for repository)
  const cleanedInput = {
    ...input,
    description: input.description === null ? undefined : input.description,
  };

  const updated = await auditConfigsRepository.updateAuditStep(id, cleanedInput);

  logger.info("Audit step updated", {
    id: updated.id.toString(),
    name: updated.name,
  });

  return {
    id: updated.id.toString(),
    auditConfigId: updated.auditConfigId.toString(),
    name: updated.name,
    description: updated.description,
    prompt: updated.prompt,
    controlPoints: updated.controlPoints,
    keywords: updated.keywords,
    severityLevel: updated.severityLevel as any,
    isCritical: updated.isCritical,
    position: updated.position,
    weight: updated.weight,
    chronologicalImportant: updated.chronologicalImportant,
    verifyProductInfo: updated.verifyProductInfo,
    createdAt: updated.createdAt,
    updatedAt: updated.updatedAt,
  };
}

/**
 * Delete audit step
 */
export async function deleteAuditStep(stepId: string | bigint): Promise<void> {
  const id = typeof stepId === "string" ? BigInt(stepId) : stepId;

  await auditConfigsRepository.deleteAuditStep(id);

  logger.info("Audit step deleted", {
    id: id.toString(),
  });
}

/**
 * Reorder steps in an audit configuration
 */
export async function reorderSteps(
  auditConfigId: string | bigint,
  stepIdsInOrder: string[]
): Promise<void> {
  const configId =
    typeof auditConfigId === "string" ? BigInt(auditConfigId) : auditConfigId;

  const config = await auditConfigsRepository.getAuditConfigById(configId);
  if (!config) {
    throw new Error("Audit config not found");
  }

  // Validate all step IDs belong to this config
  const configStepIds = config.steps.map((s) => s.id.toString());
  const invalidIds = stepIdsInOrder.filter((id) => !configStepIds.includes(id));

  if (invalidIds.length > 0) {
    throw new Error(`Invalid step IDs: ${invalidIds.join(", ")}`);
  }

  if (stepIdsInOrder.length !== config.steps.length) {
    throw new Error(
      "Step IDs count doesn't match existing steps count"
    );
  }

  // Update positions
  await Promise.all(
    stepIdsInOrder.map((stepId, index) =>
      auditConfigsRepository.updateAuditStep(BigInt(stepId), {
        position: index,
      })
    )
  );

  logger.info("Audit steps reordered", {
    configId: configId.toString(),
    stepCount: stepIdsInOrder.length,
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// STATISTICS & ANALYTICS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Get usage statistics for an audit configuration
 */
export async function getAuditConfigStats(
  auditConfigId: string | bigint
): Promise<AuditConfigStats> {
  const configId =
    typeof auditConfigId === "string" ? BigInt(auditConfigId) : auditConfigId;

  const config = await auditConfigsRepository.getAuditConfigById(configId);
  if (!config) {
    throw new Error("Audit config not found");
  }

  // Get all audits for this config
  const audits = await auditConfigsRepository.getAuditStatsByConfigId(configId);

  const completedAudits = audits.filter((a) => a.status === "completed");
  const failedAudits = audits.filter((a) => a.status === "failed");
  const compliantAudits = completedAudits.filter((a) => a.isCompliant);

  const averageScore =
    completedAudits.length > 0
      ? completedAudits.reduce(
          (sum, a) => sum + Number(a.scorePercentage),
          0
        ) / completedAudits.length
      : null;

  const averageDurationMs =
    completedAudits.length > 0
      ? completedAudits.reduce(
          (sum, a) => sum + (a.durationMs || 0),
          0
        ) / completedAudits.length
      : null;

  const lastUsedAt =
    audits.length > 0
      ? audits
          .filter((a) => a.completedAt)
          .sort(
            (a, b) => b.completedAt!.getTime() - a.completedAt!.getTime()
          )[0]?.completedAt || null
      : null;

  const complianceRate =
    completedAudits.length > 0
      ? (compliantAudits.length / completedAudits.length) * 100
      : 0;

  return {
    id: configId.toString(),
    name: config.name,
    totalAudits: audits.length,
    completedAudits: completedAudits.length,
    failedAudits: failedAudits.length,
    averageScore,
    averageDurationMs,
    lastUsedAt,
    complianceRate,
  };
}

/**
 * Get all audit configs with their usage statistics
 */
export async function getAllAuditConfigsWithStats(): Promise<
  AuditConfigStats[]
> {
  const configs = await auditConfigsRepository.getAllAuditConfigs(true);

  const stats = await Promise.all(
    configs.map((config) => getAuditConfigStats(config.id))
  );

  return stats;
}

/**
 * Get active audit configurations (helper)
 */
export async function getActiveAuditConfigs(): Promise<AuditConfigSummary[]> {
  return getAllAuditConfigs({ includeInactive: false }) as Promise<
    AuditConfigSummary[]
  >;
}

/**
 * Get automatic audit configurations (for scheduled runs)
 */
export async function getAutomaticAuditConfigs(): Promise<
  AuditConfigDetail[]
> {
  const configs = await auditConfigsRepository.getAllAuditConfigs(false);

  const automaticConfigs = configs.filter((c) => c.runAutomatically);

  return automaticConfigs.map((config) => ({
    id: config.id.toString(),
    name: config.name,
    description: config.description,
    systemPrompt: config.systemPrompt,
    isActive: config.isActive,
    runAutomatically: config.runAutomatically,
    createdBy: config.createdBy,
    createdAt: config.createdAt,
    updatedAt: config.updatedAt,
    steps: config.steps.map((step) => ({
      id: step.id.toString(),
      auditConfigId: step.auditConfigId.toString(),
      name: step.name,
      description: step.description,
      prompt: step.prompt,
      controlPoints: step.controlPoints,
      keywords: step.keywords,
      severityLevel: step.severityLevel as any,
      isCritical: step.isCritical,
      position: step.position,
      weight: step.weight,
      chronologicalImportant: step.chronologicalImportant,
      verifyProductInfo: step.verifyProductInfo,
      createdAt: step.createdAt,
      updatedAt: step.updatedAt,
    })),
  }));
}

/**
 * Get latest active audit configuration
 */
export async function getLatestActiveConfig(): Promise<AuditConfigDetail | null> {
  const config = await auditConfigsRepository.getLatestActiveConfig();

  if (!config) {
    return null;
  }

  return getAuditConfigById(config.id);
}

// ═══════════════════════════════════════════════════════════════════════════
// VALIDATION HELPERS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Validate audit config for running an audit
 * Ensures all required fields are present and valid
 */
export async function validateAuditConfigForRun(
  auditConfigId: string | bigint
): Promise<{ valid: boolean; errors: string[] }> {
  const configId =
    typeof auditConfigId === "string" ? BigInt(auditConfigId) : auditConfigId;

  const config = await auditConfigsRepository.getAuditConfigById(configId);

  if (!config) {
    return { valid: false, errors: ["Audit config not found"] };
  }

  const errors: string[] = [];

  if (!config.isActive) {
    errors.push("Audit config is not active");
  }

  if (config.steps.length === 0) {
    errors.push("Audit config has no steps");
  }

  // Validate steps
  const positions = config.steps.map((s) => s.position);
  const sortedPositions = [...positions].sort((a, b) => a - b);
  
  // Check for gaps in positions
  for (let i = 0; i < sortedPositions.length; i++) {
    if (sortedPositions[i] !== i) {
      errors.push(`Step positions have gaps (expected ${i}, found ${sortedPositions[i]})`);
      break;
    }
  }

  // Validate each step has required fields
  config.steps.forEach((step, index) => {
    if (!step.name || step.name.trim() === "") {
      errors.push(`Step at position ${step.position} has no name`);
    }
    if (!step.prompt || step.prompt.trim() === "") {
      errors.push(`Step "${step.name}" has no prompt`);
    }
    if (step.controlPoints.length === 0) {
      errors.push(`Step "${step.name}" has no control points`);
    }
    if (step.weight < 1 || step.weight > 10) {
      errors.push(`Step "${step.name}" has invalid weight (must be 1-10)`);
    }
  });

  return { valid: errors.length === 0, errors };
}

