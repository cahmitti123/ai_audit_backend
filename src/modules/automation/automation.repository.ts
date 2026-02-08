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

function toFicheSelectionColumns(
  selection: CreateAutomationScheduleInput["ficheSelection"]
): {
  ficheSelectionMode: string;
  ficheSelectionDateRange: string | null;
  ficheSelectionCustomStartDate: string | null;
  ficheSelectionCustomEndDate: string | null;
  ficheSelectionGroupes: string[];
  ficheSelectionOnlyWithRecordings: boolean;
  ficheSelectionOnlyUnaudited: boolean;
  ficheSelectionUseRlm: boolean;
  ficheSelectionMaxFiches: number | null;
  ficheSelectionMaxRecordingsPerFiche: number | null;
  ficheSelectionFicheIds: string[];
} {
  return {
    ficheSelectionMode: selection.mode,
    ficheSelectionDateRange: selection.dateRange ?? null,
    ficheSelectionCustomStartDate: selection.customStartDate ?? null,
    ficheSelectionCustomEndDate: selection.customEndDate ?? null,
    ficheSelectionGroupes: Array.isArray(selection.groupes) ? selection.groupes : [],
    ficheSelectionOnlyWithRecordings: Boolean(selection.onlyWithRecordings),
    ficheSelectionOnlyUnaudited: Boolean(selection.onlyUnaudited),
    ficheSelectionUseRlm: Boolean(selection.useRlm),
    ficheSelectionMaxFiches:
      typeof selection.maxFiches === "number" ? selection.maxFiches : null,
    ficheSelectionMaxRecordingsPerFiche:
      typeof selection.maxRecordingsPerFiche === "number"
        ? selection.maxRecordingsPerFiche
        : null,
    ficheSelectionFicheIds: Array.isArray(selection.ficheIds) ? selection.ficheIds : [],
  };
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
  const selectionCols = toFicheSelectionColumns(data.ficheSelection);
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
      ...selectionCols,
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
      ...(data.ficheSelection ? toFicheSelectionColumns(data.ficheSelection) : {}),
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

/**
 * Mark schedule last-run status WITHOUT incrementing counters.
 * Intended for reconciliation (e.g., stale-running schedules).
 */
export async function markAutomationScheduleLastRunStatus(
  scheduleId: bigint,
  status: string,
  lastRunAt?: Date
) {
  return await prisma.automationSchedule.update({
    where: { id: scheduleId },
    data: {
      lastRunStatus: status,
      ...(lastRunAt ? { lastRunAt } : {}),
    },
  });
}

/**
 * Mark stale automation runs as failed (reconciliation).
 * This is used when a run was marked "running" but never finalized due to crashes/timeouts.
 */
export async function markStaleAutomationRunsForSchedule(
  scheduleId: bigint,
  options: { staleBefore: Date; markedAt?: Date; reason: string }
) {
  const markedAt = options.markedAt ?? new Date();
  const staleRuns = await prisma.automationRun.findMany({
    where: {
      scheduleId,
      status: "running",
      startedAt: { lt: options.staleBefore },
    },
    select: { id: true, startedAt: true },
    orderBy: { startedAt: "asc" },
  });

  for (const run of staleRuns) {
    const durationMs = Math.max(0, markedAt.getTime() - run.startedAt.getTime());
    await prisma.automationRun.update({
      where: { id: run.id },
      data: {
        status: "failed",
        completedAt: markedAt,
        durationMs,
        errorMessage: options.reason,
        errorDetails: toPrismaJsonValue({
          marked_stale: true,
          reason: options.reason,
          stale_before: options.staleBefore.toISOString(),
          marked_at: markedAt.toISOString(),
        }),
      },
    });

    await prisma.automationLog.create({
      data: {
        runId: run.id,
        level: "error",
        message: "Automation run marked stale by scheduler",
        metadata: toPrismaJsonValue({
          marked_stale: true,
          reason: options.reason,
          stale_before: options.staleBefore.toISOString(),
          marked_at: markedAt.toISOString(),
        }),
      },
    });
  }

  return { marked: staleRuns.length };
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

export type AutomationRunFicheResultsInput = {
  successful: string[];
  failed: Array<{ ficheId: string; error: string }>;
  ignored: Array<{ ficheId: string; reason: string; recordingsCount?: number }>;
};

/**
 * Finalize an automation run while storing per-fiche results in a normalized table.
 *
 * This keeps `automation_runs.result_summary` minimal (avoid large arrays).
 * The API can reconstruct the legacy shape from `automation_run_fiche_results`.
 */
export async function finalizeAutomationRunWithFicheResults(
  id: bigint,
  data: {
    status: string;
    completedAt: Date;
    durationMs: number;
    totalFiches: number;
    successfulFiches: number;
    failedFiches: number;
    transcriptionsRun: number;
    auditsRun: number;
  },
  results: AutomationRunFicheResultsInput
) {
  const rows: Prisma.AutomationRunFicheResultCreateManyInput[] = [
    ...results.successful
      .filter((ficheId) => typeof ficheId === "string" && ficheId.trim().length > 0)
      .map((ficheId) => ({
        runId: id,
        ficheId,
        status: "successful",
      })),
    ...results.failed
      .filter((f) => f && typeof f.ficheId === "string" && f.ficheId.trim().length > 0)
      .map((f) => ({
        runId: id,
        ficheId: f.ficheId,
        status: "failed",
        error: typeof f.error === "string" ? f.error : "Unknown error",
      })),
    ...results.ignored
      .filter((f) => f && typeof f.ficheId === "string" && f.ficheId.trim().length > 0)
      .map((f) => ({
        runId: id,
        ficheId: f.ficheId,
        status: "ignored",
        ignoreReason: typeof f.reason === "string" ? f.reason : "Ignored",
        recordingsCount:
          typeof f.recordingsCount === "number" && Number.isFinite(f.recordingsCount)
            ? Math.trunc(f.recordingsCount)
            : null,
      })),
  ];

  const updateData: Prisma.AutomationRunUpdateInput = {
    status: data.status,
    completedAt: data.completedAt,
    durationMs: data.durationMs,
    totalFiches: data.totalFiches,
    successfulFiches: data.successfulFiches,
    failedFiches: data.failedFiches,
    transcriptionsRun: data.transcriptionsRun,
    auditsRun: data.auditsRun,
    // Keep JSON minimal: arrays live in `automation_run_fiche_results`.
    resultSummary: toPrismaJsonValue({}),
  };

  const resultsTx = await prisma.$transaction([
    prisma.automationRunFicheResult.deleteMany({ where: { runId: id } }),
    ...(rows.length > 0
      ? [
          prisma.automationRunFicheResult.createMany({
            data: rows,
            skipDuplicates: true,
          }),
        ]
      : []),
    prisma.automationRun.update({ where: { id }, data: updateData }),
  ]);

  return resultsTx[resultsTx.length - 1];
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
      ficheResults: {
        orderBy: { ficheId: "asc" },
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
