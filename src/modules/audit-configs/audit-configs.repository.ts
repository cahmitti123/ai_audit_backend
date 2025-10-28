/**
 * Audit Configs Repository
 * =========================
 * Database operations for audit configurations and steps
 */

import { prisma } from "../../shared/prisma.js";

/**
 * Get all audit configurations
 */
export async function getAllAuditConfigs(includeInactive = false) {
  return await prisma.auditConfig.findMany({
    where: includeInactive ? {} : { isActive: true },
    include: {
      steps: {
        orderBy: { position: "asc" },
      },
    },
    orderBy: {
      createdAt: "desc",
    },
  });
}

/**
 * Get audit configuration by ID
 */
export async function getAuditConfigById(id: bigint) {
  return await prisma.auditConfig.findUnique({
    where: { id },
    include: {
      steps: {
        orderBy: { position: "asc" },
      },
    },
  });
}

/**
 * Create new audit configuration with steps
 */
export async function createAuditConfig(data: {
  name: string;
  description?: string;
  systemPrompt?: string;
  steps: Array<{
    name: string;
    description?: string;
    prompt: string;
    controlPoints: string[];
    keywords: string[];
    severityLevel: string;
    isCritical: boolean;
    position: number;
    weight: number;
    chronologicalImportant?: boolean;
    verifyProductInfo?: boolean;
  }>;
  createdBy?: string;
}) {
  return await prisma.auditConfig.create({
    data: {
      name: data.name,
      description: data.description,
      systemPrompt: data.systemPrompt,
      createdBy: data.createdBy,
      steps: {
        create: data.steps.map((step) => ({
          name: step.name,
          description: step.description,
          prompt: step.prompt,
          controlPoints: step.controlPoints,
          keywords: step.keywords,
          severityLevel: step.severityLevel as any,
          isCritical: step.isCritical,
          position: step.position,
          weight: step.weight,
          chronologicalImportant: step.chronologicalImportant ?? false,
          verifyProductInfo: step.verifyProductInfo ?? false,
        })),
      },
    },
    include: {
      steps: {
        orderBy: { position: "asc" },
      },
    },
  });
}

/**
 * Update audit configuration
 */
export async function updateAuditConfig(
  id: bigint,
  data: Partial<{
    name: string;
    description: string;
    systemPrompt: string;
    isActive: boolean;
  }>
) {
  return await prisma.auditConfig.update({
    where: { id },
    data,
    include: {
      steps: {
        orderBy: { position: "asc" },
      },
    },
  });
}

/**
 * Delete audit configuration
 */
export async function deleteAuditConfig(id: bigint) {
  return await prisma.auditConfig.delete({
    where: { id },
  });
}

/**
 * Add step to audit configuration
 */
export async function addAuditStep(
  auditConfigId: bigint,
  stepData: {
    name: string;
    description?: string;
    prompt: string;
    controlPoints: string[];
    keywords: string[];
    severityLevel: string;
    isCritical: boolean;
    position: number;
    weight: number;
    chronologicalImportant?: boolean;
    verifyProductInfo?: boolean;
  }
) {
  return await prisma.auditStep.create({
    data: {
      auditConfigId,
      name: stepData.name,
      description: stepData.description,
      prompt: stepData.prompt,
      controlPoints: stepData.controlPoints,
      keywords: stepData.keywords,
      severityLevel: stepData.severityLevel as any,
      isCritical: stepData.isCritical,
      position: stepData.position,
      weight: stepData.weight,
      chronologicalImportant: stepData.chronologicalImportant ?? false,
      verifyProductInfo: stepData.verifyProductInfo ?? false,
    },
  });
}

/**
 * Update audit step
 */
export async function updateAuditStep(
  stepId: bigint,
  data: Partial<{
    name: string;
    description: string;
    prompt: string;
    controlPoints: string[];
    keywords: string[];
    severityLevel: string;
    isCritical: boolean;
    weight: number;
    chronologicalImportant: boolean;
    verifyProductInfo: boolean;
  }>
) {
  return await prisma.auditStep.update({
    where: { id: stepId },
    data: {
      ...data,
      severityLevel: data.severityLevel as any, // Prisma enum cast
    },
  });
}

/**
 * Delete audit step
 */
export async function deleteAuditStep(stepId: bigint) {
  return await prisma.auditStep.delete({
    where: { id: stepId },
  });
}

/**
 * Get active audit configurations (helper)
 */
export async function getActiveAuditConfigs() {
  return getAllAuditConfigs(false);
}

/**
 * Get latest active audit configuration
 */
export async function getLatestActiveConfig() {
  const configs = await getAllAuditConfigs(false);
  return configs[0] || null;
}
