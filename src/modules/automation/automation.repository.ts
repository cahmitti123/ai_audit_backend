/**
 * Automation Repository
 * =====================
 * RESPONSIBILITY: Database operations only
 * - Direct Prisma calls
 * - CRUD operations
 * - Database transactions
 * - No business logic
 * - No external API calls
 * - Returns raw Prisma types (BigInt)
 *
 * LAYER: Data (Database operations)
 */

import type { Prisma } from "@prisma/client";

import { serializeBigInt } from "../../shared/bigint-serializer.js";
import { prisma } from "../../shared/prisma.js";
import type {
  CreateAutomationScheduleInput,
  UpdateAutomationScheduleInput,
} from "./automation.schemas.js";

function toPrismaJsonValue(value: unknown): Prisma.InputJsonValue {
  const sanitized = serializeBigInt(value);
  // JSON.parse returns `any` in lib types; narrow to `unknown` then assert Prisma JSON type.
  const json: unknown = JSON.parse(JSON.stringify(sanitized));
  return json as Prisma.InputJsonValue;
}

// ═══════════════════════════════════════════════════════════════════════════
// AUTOMATION SCHEDULE CRUD
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Create automation schedule
 */
export async function createAutomationSchedule(
  data: CreateAutomationScheduleInput & { cronExpression?: string | null }
) {
  return await prisma.automationSchedule.create({
    data: {
      name: data.name,
      description: data.description,
      isActive: data.isActive ?? true,
      createdBy: data.createdBy,
      scheduleType: data.scheduleType,
      cronExpression: data.cronExpression,
      timezone: data.timezone,
      timeOfDay: data.timeOfDay,
      dayOfWeek: data.dayOfWeek,
      dayOfMonth: data.dayOfMonth,
      ficheSelection: toPrismaJsonValue(data.ficheSelection),
      runTranscription: data.runTranscription,
      skipIfTranscribed: data.skipIfTranscribed,
      transcriptionPriority: data.transcriptionPriority,
      runAudits: data.runAudits,
      useAutomaticAudits: data.useAutomaticAudits,
      specificAuditConfigs: data.specificAuditConfigs || [],
      continueOnError: data.continueOnError,
      retryFailed: data.retryFailed,
      maxRetries: data.maxRetries,
      notifyOnComplete: data.notifyOnComplete,
      notifyOnError: data.notifyOnError,
      webhookUrl: data.webhookUrl,
      notifyEmails: data.notifyEmails || [],
      externalApiKey: data.externalApiKey,
    },
  });
}

/**
 * Get all automation schedules
 */
export async function getAllAutomationSchedules(includeInactive = false) {
  return await prisma.automationSchedule.findMany({
    where: includeInactive ? {} : { isActive: true },
    orderBy: { createdAt: "desc" },
  });
}

/**
 * Get automation schedule by ID
 */
export async function getAutomationScheduleById(id: bigint) {
  return await prisma.automationSchedule.findUnique({
    where: { id },
    include: {
      runs: {
        orderBy: { startedAt: "desc" },
        take: 10, // Last 10 runs
      },
    },
  });
}

/**
 * Update automation schedule
 */
export async function updateAutomationSchedule(
  id: bigint,
  data: UpdateAutomationScheduleInput
) {
  // Get current schedule to determine if we need to regenerate cron
  const current = await prisma.automationSchedule.findUnique({
    where: { id },
  });

  if (!current) {
    throw new Error(`Schedule ${id} not found`);
  }

  // Determine if we should regenerate cron expression
  const scheduleType = data.scheduleType || current.scheduleType;
  const timeOfDay =
    data.timeOfDay !== undefined ? data.timeOfDay : current.timeOfDay;
  const dayOfWeek =
    data.dayOfWeek !== undefined ? data.dayOfWeek : current.dayOfWeek;
  const dayOfMonth =
    data.dayOfMonth !== undefined ? data.dayOfMonth : current.dayOfMonth;

  // Import service function for cron generation if schedule parameters changed
  let cronExpression = data.cronExpression;
  if (cronExpression === undefined) {
    const relevantFieldsChanged =
      data.scheduleType !== undefined ||
      data.timeOfDay !== undefined ||
      data.dayOfWeek !== undefined ||
      data.dayOfMonth !== undefined;

    if (relevantFieldsChanged) {
      // Import dynamically to avoid circular dependency
      const { generateCronExpression } = await import(
        "./automation.service.js"
      );
      const generated = generateCronExpression(
        scheduleType,
        timeOfDay,
        dayOfWeek,
        dayOfMonth,
        current.cronExpression
      );
      cronExpression = generated || undefined;
    }
  }

  return await prisma.automationSchedule.update({
    where: { id },
    data: {
      ...(data.name && { name: data.name }),
      ...(data.description !== undefined && { description: data.description }),
      ...(data.isActive !== undefined && { isActive: data.isActive }),
      ...(data.scheduleType && { scheduleType: data.scheduleType }),
      ...(cronExpression !== undefined && { cronExpression }),
      ...(data.timezone && { timezone: data.timezone }),
      ...(data.timeOfDay !== undefined && { timeOfDay: data.timeOfDay }),
      ...(data.dayOfWeek !== undefined && { dayOfWeek: data.dayOfWeek }),
      ...(data.dayOfMonth !== undefined && { dayOfMonth: data.dayOfMonth }),
      ...(data.ficheSelection && {
        ficheSelection: toPrismaJsonValue(data.ficheSelection),
      }),
      ...(data.runTranscription !== undefined && {
        runTranscription: data.runTranscription,
      }),
      ...(data.skipIfTranscribed !== undefined && {
        skipIfTranscribed: data.skipIfTranscribed,
      }),
      ...(data.transcriptionPriority && {
        transcriptionPriority: data.transcriptionPriority,
      }),
      ...(data.runAudits !== undefined && { runAudits: data.runAudits }),
      ...(data.useAutomaticAudits !== undefined && {
        useAutomaticAudits: data.useAutomaticAudits,
      }),
      ...(data.specificAuditConfigs !== undefined && {
        specificAuditConfigs: data.specificAuditConfigs,
      }),
      ...(data.continueOnError !== undefined && {
        continueOnError: data.continueOnError,
      }),
      ...(data.retryFailed !== undefined && { retryFailed: data.retryFailed }),
      ...(data.maxRetries !== undefined && { maxRetries: data.maxRetries }),
      ...(data.notifyOnComplete !== undefined && {
        notifyOnComplete: data.notifyOnComplete,
      }),
      ...(data.notifyOnError !== undefined && {
        notifyOnError: data.notifyOnError,
      }),
      ...(data.webhookUrl !== undefined && { webhookUrl: data.webhookUrl }),
      ...(data.notifyEmails && { notifyEmails: data.notifyEmails }),
      ...(data.externalApiKey !== undefined && {
        externalApiKey: data.externalApiKey,
      }),
    },
  });
}

/**
 * Delete automation schedule
 */
export async function deleteAutomationSchedule(id: bigint) {
  return await prisma.automationSchedule.delete({
    where: { id },
  });
}

/**
 * Get active automation schedules
 */
export async function getActiveAutomationSchedules() {
  return await prisma.automationSchedule.findMany({
    where: { isActive: true },
    orderBy: { createdAt: "desc" },
  });
}

/**
 * Mark schedule as triggered (used by scheduler to avoid duplicate dispatches).
 * Does NOT increment counters (those are updated on completion).
 */
export async function markAutomationScheduleTriggered(
  scheduleId: bigint,
  triggeredAt: Date = new Date()
) {
  return await prisma.automationSchedule.update({
    where: { id: scheduleId },
    data: {
      lastRunAt: triggeredAt,
      lastRunStatus: "running",
    },
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// AUTOMATION RUN CRUD
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Create automation run
 */
export async function createAutomationRun(
  scheduleId: bigint,
  configSnapshot: unknown
) {
  return await prisma.automationRun.create({
    data: {
      scheduleId,
      status: "running",
      configSnapshot: toPrismaJsonValue(configSnapshot),
    },
  });
}

/**
 * Update automation run
 */
export async function updateAutomationRun(
  id: bigint,
  data: {
    status?: string;
    completedAt?: Date;
    durationMs?: number;
    totalFiches?: number;
    successfulFiches?: number;
    failedFiches?: number;
    transcriptionsRun?: number;
    auditsRun?: number;
    errorMessage?: string;
    errorDetails?: unknown;
    resultSummary?: unknown;
  }
) {
  const updateData: Prisma.AutomationRunUpdateInput = {
    ...(data.status !== undefined ? { status: data.status } : {}),
    ...(data.completedAt !== undefined ? { completedAt: data.completedAt } : {}),
    ...(data.durationMs !== undefined ? { durationMs: data.durationMs } : {}),
    ...(data.totalFiches !== undefined ? { totalFiches: data.totalFiches } : {}),
    ...(data.successfulFiches !== undefined
      ? { successfulFiches: data.successfulFiches }
      : {}),
    ...(data.failedFiches !== undefined ? { failedFiches: data.failedFiches } : {}),
    ...(data.transcriptionsRun !== undefined
      ? { transcriptionsRun: data.transcriptionsRun }
      : {}),
    ...(data.auditsRun !== undefined ? { auditsRun: data.auditsRun } : {}),
    ...(data.errorMessage !== undefined ? { errorMessage: data.errorMessage } : {}),
    ...(data.errorDetails !== undefined
      ? { errorDetails: toPrismaJsonValue(data.errorDetails) }
      : {}),
    ...(data.resultSummary !== undefined
      ? { resultSummary: toPrismaJsonValue(data.resultSummary) }
      : {}),
  };

  return await prisma.automationRun.update({
    where: { id },
    data: updateData,
  });
}

/**
 * Update schedule statistics after run
 */
export async function updateScheduleStats(
  scheduleId: bigint,
  status: "success" | "partial" | "failed"
) {
  const schedule = await prisma.automationSchedule.findUnique({
    where: { id: scheduleId },
  });

  if (!schedule) {return;}

  await prisma.automationSchedule.update({
    where: { id: scheduleId },
    data: {
      lastRunAt: new Date(),
      lastRunStatus: status,
      totalRuns: schedule.totalRuns + 1,
      successfulRuns:
        status === "success"
          ? schedule.successfulRuns + 1
          : schedule.successfulRuns,
      failedRuns:
        status === "failed" ? schedule.failedRuns + 1 : schedule.failedRuns,
    },
  });
}

/**
 * Get automation runs for a schedule
 */
export async function getAutomationRuns(
  scheduleId: bigint,
  limit = 20,
  offset = 0
) {
  return await prisma.automationRun.findMany({
    where: { scheduleId },
    orderBy: { startedAt: "desc" },
    take: limit,
    skip: offset,
  });
}

/**
 * Get automation run by ID
 */
export async function getAutomationRunById(id: bigint) {
  return await prisma.automationRun.findUnique({
    where: { id },
    include: {
      logs: {
        orderBy: { timestamp: "asc" },
      },
    },
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// AUTOMATION LOGS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Add automation log
 */
export async function addAutomationLog(
  runId: bigint,
  level: string,
  message: string,
  metadata?: unknown
) {
  return await prisma.automationLog.create({
    data: {
      runId,
      level,
      message,
      metadata: toPrismaJsonValue(metadata ?? {}),
    },
  });
}

/**
 * Get automation logs for a run
 */
export async function getAutomationLogs(
  runId: bigint,
  level?: string,
  limit = 100
) {
  return await prisma.automationLog.findMany({
    where: {
      runId,
      ...(level && { level }),
    },
    orderBy: { timestamp: "asc" },
    take: limit,
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// UTILITY QUERIES
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Get audit configs marked for automatic execution
 */
export async function getAutomaticAuditConfigs() {
  return await prisma.auditConfig.findMany({
    where: {
      isActive: true,
      runAutomatically: true,
    },
    include: {
      steps: {
        orderBy: { position: "asc" },
      },
    },
  });
}
