/**
 * Automation Service
 * ==================
 * RESPONSIBILITY: Business logic and orchestration
 * - Calculate dates and schedules
 * - Process and transform fiche data
 * - Generate cron expressions
 * - Orchestrate automation flows
 * - Transform BigInt ↔ string
 * - No direct database calls (use repository)
 * - No direct HTTP handling (use routes)
 *
 * LAYER: Orchestration (Business logic)
 */

import type {
  FicheSelection,
  ScheduleType,
  ProcessedFicheData,
  CreateAutomationScheduleInput,
  UpdateAutomationScheduleInput,
  AutomationSchedule,
  AutomationScheduleWithRuns,
  AutomationRun,
  AutomationRunWithLogs,
  AutomationLog,
} from "./automation.schemas.js";
import * as automationRepository from "./automation.repository.js";
import * as automationApi from "./automation.api.js";
import { logger } from "../../shared/logger.js";

// ═══════════════════════════════════════════════════════════════════════════
// SCHEDULE BUSINESS LOGIC
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Generate cron expression based on schedule type and parameters
 * Business rule: Convert user-friendly schedule params to cron format
 */
export function generateCronExpression(
  scheduleType: ScheduleType,
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
 * Parse cron expression to determine next run time
 * Business rule: Calculate when a schedule should run next
 */
export function getNextRunTime(
  scheduleType: ScheduleType,
  cronExpression?: string,
  timeOfDay?: string,
  dayOfWeek?: number,
  dayOfMonth?: number,
  timezone = "UTC"
): Date | null {
  // This is a simplified implementation
  // In production, you'd use a library like 'cron-parser'

  const now = new Date();

  if (scheduleType === "DAILY" && timeOfDay) {
    const [hours, minutes] = timeOfDay.split(":").map(Number);
    const nextRun = new Date(now);
    nextRun.setHours(hours, minutes, 0, 0);

    if (nextRun <= now) {
      nextRun.setDate(nextRun.getDate() + 1);
    }

    return nextRun;
  }

  if (scheduleType === "WEEKLY" && dayOfWeek !== undefined && timeOfDay) {
    const [hours, minutes] = timeOfDay.split(":").map(Number);
    const nextRun = new Date(now);
    nextRun.setHours(hours, minutes, 0, 0);

    const currentDay = nextRun.getDay();
    const daysUntilTarget = (dayOfWeek - currentDay + 7) % 7;

    if (daysUntilTarget === 0 && nextRun <= now) {
      nextRun.setDate(nextRun.getDate() + 7);
    } else {
      nextRun.setDate(nextRun.getDate() + daysUntilTarget);
    }

    return nextRun;
  }

  if (scheduleType === "MONTHLY" && dayOfMonth !== undefined && timeOfDay) {
    const [hours, minutes] = timeOfDay.split(":").map(Number);
    const nextRun = new Date(now);
    nextRun.setDate(dayOfMonth);
    nextRun.setHours(hours, minutes, 0, 0);

    if (nextRun <= now) {
      nextRun.setMonth(nextRun.getMonth() + 1);
    }

    return nextRun;
  }

  // For CRON type, you'd need to parse the cron expression
  // For now, return null
  return null;
}

// ═══════════════════════════════════════════════════════════════════════════
// DATE CALCULATION LOGIC
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Calculate dates to query based on selection criteria
 * Business rule: Convert date range selection to array of dates for API calls
 */
export function calculateDatesToQuery(selection: FicheSelection): string[] {
  const { mode, dateRange, customStartDate, customEndDate, ficheIds } =
    selection;

  // Manual mode: no dates to query
  if (mode === "manual" && ficheIds) {
    return [];
  }

  // Calculate date range
  const { startDate, endDate } = calculateDateRange(
    dateRange,
    customStartDate,
    customEndDate
  );

  // Generate array of dates to query (API only accepts single date)
  const dates: string[] = [];
  if (startDate && endDate) {
    const start = parseDateDDMMYYYY(startDate);
    const end = parseDateDDMMYYYY(endDate);
    const current = new Date(start);

    while (current <= end) {
      dates.push(formatDate(current));
      current.setDate(current.getDate() + 1);
    }
  } else if (startDate) {
    dates.push(startDate);
  }

  logger.info("Calculated dates to query", {
    mode: selection.mode,
    dateRange: selection.dateRange,
    datesCount: dates.length,
    firstDate: dates[0],
    lastDate: dates[dates.length - 1],
  });

  return dates;
}

/**
 * Calculate date range based on selection
 * Business rule: Convert preset date ranges to actual start/end dates
 */
function calculateDateRange(
  dateRange?: string,
  customStartDate?: string,
  customEndDate?: string
): { startDate: string | null; endDate: string | null } {
  if (dateRange === "custom") {
    return {
      startDate: customStartDate || null,
      endDate: customEndDate || null,
    };
  }

  const now = new Date();
  let startDate: Date | null = null;
  let endDate: Date = now;

  switch (dateRange) {
    case "last_24h":
      startDate = new Date(now.getTime() - 24 * 60 * 60 * 1000);
      break;
    case "yesterday":
      startDate = new Date(now);
      startDate.setDate(startDate.getDate() - 1);
      startDate.setHours(0, 0, 0, 0);
      endDate = new Date(startDate);
      endDate.setHours(23, 59, 59, 999);
      break;
    case "last_week":
      startDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
      break;
    case "last_month":
      startDate = new Date(now);
      startDate.setMonth(startDate.getMonth() - 1);
      break;
    default:
      return { startDate: null, endDate: null };
  }

  return {
    startDate: startDate ? formatDate(startDate) : null,
    endDate: formatDate(endDate),
  };
}

/**
 * Format date as DD/MM/YYYY
 */
function formatDate(date: Date): string {
  const day = String(date.getDate()).padStart(2, "0");
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const year = date.getFullYear();
  return `${day}/${month}/${year}`;
}

/**
 * Parse DD/MM/YYYY date string to Date object
 */
function parseDateDDMMYYYY(dateStr: string): Date {
  const [day, month, year] = dateStr.split("/").map(Number);
  return new Date(year, month - 1, day);
}

// ═══════════════════════════════════════════════════════════════════════════
// FICHE PROCESSING LOGIC
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Process and transform fiche data from /by-date endpoint
 * Business rule: Extract IDs, cles, and basic data for further processing
 * Note: /by-date returns basic data WITHOUT recordings
 */
export function processFichesData(
  fiches: any[],
  maxFiches?: number,
  onlyWithRecordings?: boolean
): ProcessedFicheData {
  // Ensure it's an array
  if (!Array.isArray(fiches)) {
    logger.warn("Fiches is not an array", { type: typeof fiches });
    return { ficheIds: [], fichesData: [], cles: {} };
  }

  logger.debug("Processing fiches data", {
    total: fiches.length,
    onlyWithRecordings,
    maxFiches,
  });

  // Extract fiche IDs and cles (needed for detailed fetch later)
  const fichesWithIds = fiches
    .filter((fiche: any) => fiche.id) // Must have an ID
    .map((fiche: any) => ({
      id: fiche.id,
      cle: fiche.cle,
      statut: fiche.statut,
      nom: fiche.nom,
      prenom: fiche.prenom,
      email: fiche.email,
      telephone: fiche.telephone,
      telephone_2: fiche.telephone_2,
    }));

  // Apply max limit
  const limitedFiches = fichesWithIds.slice(
    0,
    maxFiches || fichesWithIds.length
  );
  const ficheIds = limitedFiches.map((f) => f.id);

  // Create a map of ficheId -> cle for later detailed fetching
  const cles: Record<string, string> = {};
  limitedFiches.forEach((f) => {
    if (f.cle) {
      cles[f.id] = f.cle;
    }
  });

  // Store basic data (will be used if we can't fetch detailed later)
  const fichesData = limitedFiches.map((fiche: any) => ({
    id: fiche.id,
    cle: fiche.cle,
    statut: fiche.statut,
    nom: fiche.nom,
    prenom: fiche.prenom,
    email: fiche.email,
    telephone: fiche.telephone,
    telephone_2: fiche.telephone_2,
  }));

  logger.info("Processed fiche data", {
    originalCount: fiches.length,
    processedCount: ficheIds.length,
    hasCles: Object.keys(cles).length,
  });

  return {
    ficheIds,
    fichesData,
    cles,
  };
}

/**
 * Fetch fiches by selection (orchestrates multiple date fetches)
 * Business rule: Fetch fiches from external API based on selection criteria
 * 
 * @deprecated Use calculateDatesToQuery + fetchFichesForDate in workflows instead
 */
export async function fetchFichesBySelection(
  selection: FicheSelection,
  apiKey?: string
): Promise<ProcessedFicheData> {
  const { mode, onlyWithRecordings, maxFiches, ficheIds } = selection;

  // Manual mode: return provided fiche IDs (no full data available)
  if (mode === "manual" && ficheIds) {
    const limitedIds = ficheIds.slice(0, maxFiches || ficheIds.length);
    logger.info("Using manual fiche selection", { count: limitedIds.length });
    return { ficheIds: limitedIds, fichesData: [], cles: {} };
  }

  // Calculate dates to query
  const dates = calculateDatesToQuery(selection);

  logger.info("Fetching fiches from API", {
    totalDays: dates.length,
    onlyWithRecordings,
    maxFiches,
  });

  // Fetch from API for each date in parallel and combine results
  const fetchPromises = dates.map(async (date) => {
    try {
      const dateFiches = await automationApi.fetchFichesForDate(
        date,
        onlyWithRecordings || false,
        apiKey
      );
      logger.debug(`Fetched ${dateFiches.length} fiches for ${date}`);
      return dateFiches;
    } catch (error: any) {
      logger.error(`Failed to fetch fiches for ${date}`, {
        error: error.message,
      });
      return [];
    }
  });

  const dateResults = await Promise.all(fetchPromises);
  const allFiches = dateResults.flat();

  logger.info("Fetched fiches from all dates", {
    totalFiches: allFiches.length,
    dates: dates.length,
  });

  return processFichesData(allFiches, maxFiches, onlyWithRecordings);
}

// ═══════════════════════════════════════════════════════════════════════════
// SCHEDULE CRUD WITH TRANSFORMATIONS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Create automation schedule
 * Business rule: Validate input, generate cron if needed, delegate to repository
 */
export async function createAutomationSchedule(
  input: CreateAutomationScheduleInput
): Promise<AutomationSchedule> {
  logger.info("Creating automation schedule", { name: input.name });

  // Business validation: Check schedule type requirements
  if (input.scheduleType === "DAILY" && !input.timeOfDay) {
    throw new Error("DAILY schedule requires timeOfDay");
  }

  if (
    input.scheduleType === "WEEKLY" &&
    (!input.timeOfDay || input.dayOfWeek === undefined)
  ) {
    throw new Error("WEEKLY schedule requires timeOfDay and dayOfWeek");
  }

  if (
    input.scheduleType === "MONTHLY" &&
    (!input.timeOfDay || !input.dayOfMonth)
  ) {
    throw new Error("MONTHLY schedule requires timeOfDay and dayOfMonth");
  }

  if (input.scheduleType === "CRON" && !input.cronExpression) {
    throw new Error("CRON schedule requires cronExpression");
  }

  // Generate cron expression if not provided
  const cronExpression =
    input.cronExpression ||
    generateCronExpression(
      input.scheduleType,
      input.timeOfDay,
      input.dayOfWeek,
      input.dayOfMonth,
      input.cronExpression
    );

  // Delegate to repository
  const schedule = await automationRepository.createAutomationSchedule({
    ...input,
    cronExpression: cronExpression || undefined, // Convert null to undefined
  });

  logger.info("Automation schedule created", {
    id: schedule.id.toString(),
    name: schedule.name,
  });

  // Transform to API-friendly format (BigInt → string)
  return transformScheduleToApi(schedule);
}

/**
 * Get all automation schedules
 */
export async function getAllAutomationSchedules(
  includeInactive = false
): Promise<AutomationSchedule[]> {
  logger.debug("Fetching all automation schedules", { includeInactive });

  const schedules = await automationRepository.getAllAutomationSchedules(
    includeInactive
  );

  logger.info("Fetched automation schedules", { count: schedules.length });

  // Transform to API-friendly format
  return schedules.map(transformScheduleToApi);
}

/**
 * Get automation schedule by ID
 */
export async function getAutomationScheduleById(
  id: string | bigint
): Promise<AutomationScheduleWithRuns | null> {
  const scheduleId = typeof id === "string" ? BigInt(id) : id;

  logger.debug("Fetching automation schedule", { id: scheduleId.toString() });

  const schedule = await automationRepository.getAutomationScheduleById(
    scheduleId
  );

  if (!schedule) {
    logger.warn("Automation schedule not found", { id: scheduleId.toString() });
    return null;
  }

  logger.debug("Fetched automation schedule", {
    id: schedule.id.toString(),
    name: schedule.name,
    runsCount: schedule.runs?.length || 0,
  });

  // Transform to API-friendly format
  return transformScheduleWithRunsToApi(schedule);
}

/**
 * Update automation schedule
 */
export async function updateAutomationSchedule(
  id: string | bigint,
  input: UpdateAutomationScheduleInput
): Promise<AutomationSchedule> {
  const scheduleId = typeof id === "string" ? BigInt(id) : id;

  logger.info("Updating automation schedule", { id: scheduleId.toString() });

  // Business validation: Check schedule type requirements if being updated
  if (input.scheduleType === "DAILY" && input.timeOfDay === null) {
    throw new Error("DAILY schedule requires timeOfDay");
  }

  if (
    input.scheduleType === "WEEKLY" &&
    (input.timeOfDay === null || input.dayOfWeek === null)
  ) {
    throw new Error("WEEKLY schedule requires timeOfDay and dayOfWeek");
  }

  if (
    input.scheduleType === "MONTHLY" &&
    (input.timeOfDay === null || input.dayOfMonth === null)
  ) {
    throw new Error("MONTHLY schedule requires timeOfDay and dayOfMonth");
  }

  // Delegate to repository (it handles cron regeneration)
  const schedule = await automationRepository.updateAutomationSchedule(
    scheduleId,
    input
  );

  logger.info("Automation schedule updated", {
    id: schedule.id.toString(),
    name: schedule.name,
  });

  // Transform to API-friendly format
  return transformScheduleToApi(schedule);
}

/**
 * Delete automation schedule
 */
export async function deleteAutomationSchedule(
  id: string | bigint
): Promise<void> {
  const scheduleId = typeof id === "string" ? BigInt(id) : id;

  logger.info("Deleting automation schedule", { id: scheduleId.toString() });

  await automationRepository.deleteAutomationSchedule(scheduleId);

  logger.info("Automation schedule deleted", { id: scheduleId.toString() });
}

// ═══════════════════════════════════════════════════════════════════════════
// RUN CRUD WITH TRANSFORMATIONS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Get automation runs for a schedule
 */
export async function getAutomationRuns(
  scheduleId: string | bigint,
  limit = 20,
  offset = 0
): Promise<AutomationRun[]> {
  const id = typeof scheduleId === "string" ? BigInt(scheduleId) : scheduleId;

  logger.debug("Fetching automation runs", {
    scheduleId: id.toString(),
    limit,
    offset,
  });

  const runs = await automationRepository.getAutomationRuns(id, limit, offset);

  logger.debug("Fetched automation runs", {
    scheduleId: id.toString(),
    count: runs.length,
  });

  // Transform to API-friendly format
  return runs.map(transformRunToApi);
}

/**
 * Get automation run by ID
 */
export async function getAutomationRunById(
  id: string | bigint
): Promise<AutomationRunWithLogs | null> {
  const runId = typeof id === "string" ? BigInt(id) : id;

  logger.debug("Fetching automation run", { id: runId.toString() });

  const run = await automationRepository.getAutomationRunById(runId);

  if (!run) {
    logger.warn("Automation run not found", { id: runId.toString() });
    return null;
  }

  logger.debug("Fetched automation run", {
    id: run.id.toString(),
    status: run.status,
    logsCount: run.logs?.length || 0,
  });

  // Transform to API-friendly format
  return transformRunWithLogsToApi(run);
}

/**
 * Get automation logs for a run
 */
export async function getAutomationLogs(
  runId: string | bigint,
  level?: string,
  limit = 100
): Promise<AutomationLog[]> {
  const id = typeof runId === "string" ? BigInt(runId) : runId;

  logger.debug("Fetching automation logs", {
    runId: id.toString(),
    level,
    limit,
  });

  const logs = await automationRepository.getAutomationLogs(id, level, limit);

  logger.debug("Fetched automation logs", {
    runId: id.toString(),
    count: logs.length,
  });

  // Transform to API-friendly format
  return logs.map(transformLogToApi);
}

// ═══════════════════════════════════════════════════════════════════════════
// TRANSFORMATIONS (BigInt ↔ string)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Transform schedule from database (BigInt) to API (string)
 */
function transformScheduleToApi(schedule: any): AutomationSchedule {
  return {
    id: schedule.id.toString(),
    name: schedule.name,
    description: schedule.description,
    isActive: schedule.isActive,
    createdBy: schedule.createdBy,
    createdAt: schedule.createdAt,
    updatedAt: schedule.updatedAt,
    scheduleType: schedule.scheduleType,
    cronExpression: schedule.cronExpression,
    timezone: schedule.timezone,
    timeOfDay: schedule.timeOfDay,
    dayOfWeek: schedule.dayOfWeek,
    dayOfMonth: schedule.dayOfMonth,
    ficheSelection: schedule.ficheSelection,
    runTranscription: schedule.runTranscription,
    skipIfTranscribed: schedule.skipIfTranscribed,
    transcriptionPriority: schedule.transcriptionPriority,
    runAudits: schedule.runAudits,
    useAutomaticAudits: schedule.useAutomaticAudits,
    specificAuditConfigs: schedule.specificAuditConfigs
      ? schedule.specificAuditConfigs.map((id: any) =>
          typeof id === "bigint" ? id.toString() : String(id)
        )
      : [],
    continueOnError: schedule.continueOnError,
    retryFailed: schedule.retryFailed,
    maxRetries: schedule.maxRetries,
    notifyOnComplete: schedule.notifyOnComplete,
    notifyOnError: schedule.notifyOnError,
    webhookUrl: schedule.webhookUrl,
    notifyEmails: schedule.notifyEmails,
    externalApiKey: schedule.externalApiKey,
    lastRunAt: schedule.lastRunAt,
    lastRunStatus: schedule.lastRunStatus,
    totalRuns: schedule.totalRuns,
    successfulRuns: schedule.successfulRuns,
    failedRuns: schedule.failedRuns,
  };
}

/**
 * Transform schedule with runs from database to API
 */
function transformScheduleWithRunsToApi(
  schedule: any
): AutomationScheduleWithRuns {
  return {
    ...transformScheduleToApi(schedule),
    runs: schedule.runs
      ? schedule.runs.map((run: any) => ({
          id: run.id.toString(),
          status: run.status,
          startedAt: run.startedAt,
          completedAt: run.completedAt,
          durationMs: run.durationMs,
          totalFiches: run.totalFiches,
          successfulFiches: run.successfulFiches,
          failedFiches: run.failedFiches,
        }))
      : [],
  };
}

/**
 * Transform run from database to API
 */
function transformRunToApi(run: any): AutomationRun {
  return {
    id: run.id.toString(),
    scheduleId: run.scheduleId.toString(),
    status: run.status,
    startedAt: run.startedAt,
    completedAt: run.completedAt,
    durationMs: run.durationMs,
    totalFiches: run.totalFiches,
    successfulFiches: run.successfulFiches,
    failedFiches: run.failedFiches,
    transcriptionsRun: run.transcriptionsRun,
    auditsRun: run.auditsRun,
    errorMessage: run.errorMessage,
    errorDetails: run.errorDetails,
    configSnapshot: run.configSnapshot,
    resultSummary: run.resultSummary,
  };
}

/**
 * Transform run with logs from database to API
 */
function transformRunWithLogsToApi(run: any): AutomationRunWithLogs {
  return {
    ...transformRunToApi(run),
    logs: run.logs
      ? run.logs.map((log: any) => ({
          id: log.id.toString(),
          level: log.level,
          message: log.message,
          timestamp: log.timestamp,
          metadata: log.metadata,
        }))
      : [],
  };
}

/**
 * Transform log from database to API
 */
function transformLogToApi(log: any): AutomationLog {
  return {
    id: log.id.toString(),
    runId: log.runId.toString(),
    level: log.level,
    message: log.message,
    timestamp: log.timestamp,
    metadata: log.metadata,
  };
}
