/**
 * Automation Repository
 * ====================
 * Database operations for automation schedules and runs
 */

import { prisma } from "../../shared/prisma.js";
import type {
  AutomationScheduleCreate,
  AutomationScheduleUpdate,
  FicheSelection,
} from "../../schemas.js";

/**
 * Generate cron expression based on schedule type and parameters
 */
function generateCronExpression(
  scheduleType: string,
  timeOfDay?: string | null,
  dayOfWeek?: number | null,
  dayOfMonth?: number | null,
  customCron?: string | null
): string | null {
  // If custom cron provided, use it
  if (scheduleType === "CRON" && customCron) {
    return customCron;
  }

  // MANUAL schedules don't need cron
  if (scheduleType === "MANUAL") {
    return null;
  }

  // All other types need timeOfDay
  if (!timeOfDay) {
    return null;
  }

  const [hours, minutes] = timeOfDay.split(":").map((n) => parseInt(n, 10));

  if (scheduleType === "DAILY") {
    // Every day at specified time: "minute hour * * *"
    return `${minutes} ${hours} * * *`;
  }

  if (scheduleType === "WEEKLY") {
    // Specific day of week at specified time: "minute hour * * day"
    if (dayOfWeek === null || dayOfWeek === undefined) {
      return null;
    }
    return `${minutes} ${hours} * * ${dayOfWeek}`;
  }

  if (scheduleType === "MONTHLY") {
    // Specific day of month at specified time: "minute hour day * *"
    if (!dayOfMonth) {
      return null;
    }
    return `${minutes} ${hours} ${dayOfMonth} * *`;
  }

  return null;
}

/**
 * Create automation schedule
 */
export async function createAutomationSchedule(data: AutomationScheduleCreate) {
  // Auto-generate cron expression if not provided
  const cronExpression =
    data.cronExpression ||
    generateCronExpression(
      data.scheduleType,
      data.timeOfDay,
      data.dayOfWeek,
      data.dayOfMonth,
      data.cronExpression
    );

  return await prisma.automationSchedule.create({
    data: {
      name: data.name,
      description: data.description,
      isActive: data.isActive ?? true,
      createdBy: data.createdBy,
      scheduleType: data.scheduleType,
      cronExpression,
      timezone: data.timezone,
      timeOfDay: data.timeOfDay,
      dayOfWeek: data.dayOfWeek,
      dayOfMonth: data.dayOfMonth,
      ficheSelection: data.ficheSelection as any,
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
  data: AutomationScheduleUpdate
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

  // Auto-generate cron if schedule parameters changed and no explicit cron provided
  let cronExpression = data.cronExpression;
  if (cronExpression === undefined) {
    // Only regenerate if relevant fields changed
    const relevantFieldsChanged =
      data.scheduleType !== undefined ||
      data.timeOfDay !== undefined ||
      data.dayOfWeek !== undefined ||
      data.dayOfMonth !== undefined;

    if (relevantFieldsChanged) {
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
        ficheSelection: data.ficheSelection as any,
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
 * Create automation run
 */
export async function createAutomationRun(
  scheduleId: bigint,
  configSnapshot: any
) {
  return await prisma.automationRun.create({
    data: {
      scheduleId,
      status: "running",
      configSnapshot,
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
    errorDetails?: any;
    resultSummary?: any;
  }
) {
  return await prisma.automationRun.update({
    where: { id },
    data,
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

  if (!schedule) return;

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

/**
 * Add automation log
 */
export async function addAutomationLog(
  runId: bigint,
  level: string,
  message: string,
  metadata?: any
) {
  return await prisma.automationLog.create({
    data: {
      runId,
      level,
      message,
      metadata: metadata || {},
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
