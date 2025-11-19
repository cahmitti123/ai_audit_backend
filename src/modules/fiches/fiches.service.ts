/**
 * Fiches Service
 * ==============
 * RESPONSIBILITY: Business logic and orchestration
 * - Status calculations (transcription/audit)
 * - Data enrichment (adding status to fiches)
 * - High-level workflows (get fiche, get sales)
 * - Coordinates between cache, API, and repository
 *
 * LAYER: Business Logic / Orchestration
 */

import type {
  FicheStatus,
  RecordingStatus,
  AuditStatusRecord,
  SalesFiche,
  SalesWithCallsResponse,
  SalesResponseWithStatus,
  DateRangeStatusResponse,
  ProgressiveDateRangeResponse,
} from "./fiches.schemas.js";
import * as fichesRepository from "./fiches.repository.js";
import * as fichesApi from "./fiches.api.js";
import * as fichesCache from "./fiches.cache.js";
import * as fichesRevalidation from "./fiches.revalidation.js";
import { logger } from "../../shared/logger.js";
import { prisma } from "../../shared/prisma.js";

// ═══════════════════════════════════════════════════════════════════════════
// UTILITY HELPERS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Generate array of dates between start and end (inclusive)
 */
function generateDateRange(startDate: string, endDate: string): string[] {
  const dates: string[] = [];
  const current = new Date(startDate);
  const end = new Date(endDate);

  while (current <= end) {
    dates.push(current.toISOString().split("T")[0]);
    current.setDate(current.getDate() + 1);
  }

  return dates;
}

// ═══════════════════════════════════════════════════════════════════════════
// STATUS CALCULATION HELPERS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Calculate transcription status from recordings
 */
function calculateTranscriptionStatus(recordings: RecordingStatus[]) {
  const totalRecordings = recordings.length;
  const transcribedRecordings = recordings.filter(
    (r) => r.hasTranscription
  ).length;

  return {
    total: totalRecordings,
    transcribed: transcribedRecordings,
    pending: totalRecordings - transcribedRecordings,
    percentage:
      totalRecordings > 0 ? (transcribedRecordings / totalRecordings) * 100 : 0,
    isComplete:
      totalRecordings > 0 && transcribedRecordings === totalRecordings,
    lastTranscribedAt:
      recordings
        .filter((r) => r.transcribedAt)
        .sort(
          (a, b) => b.transcribedAt!.getTime() - a.transcribedAt!.getTime()
        )[0]?.transcribedAt || null,
  };
}

/**
 * Calculate audit status from audits
 */
function calculateAuditStatus(audits: AuditStatusRecord[]) {
  const completedAudits = audits.filter((a) => a.status === "completed");
  const compliantAudits = completedAudits.filter((a) => a.isCompliant);

  return {
    total: audits.length,
    completed: completedAudits.length,
    pending: audits.filter((a) => a.status === "pending").length,
    running: audits.filter((a) => a.status === "running").length,
    compliant: compliantAudits.length,
    nonCompliant: completedAudits.length - compliantAudits.length,
    averageScore:
      completedAudits.length > 0
        ? completedAudits.reduce(
            (sum, a) => sum + Number(a.scorePercentage),
            0
          ) / completedAudits.length
        : null,
    latestAudit: audits[0]
      ? {
          id: audits[0].id.toString(),
          status: audits[0].status,
          overallScore: audits[0].overallScore.toString(),
          scorePercentage: audits[0].scorePercentage.toString(),
          niveau: audits[0].niveau,
          isCompliant: audits[0].isCompliant,
          completedAt: audits[0].completedAt,
          auditConfig: {
            id: audits[0].auditConfig.id.toString(),
            name: audits[0].auditConfig.name,
          },
        }
      : null,
  };
}

/**
 * Create default empty status
 */
function createDefaultStatus(): FicheStatus {
  return {
    hasData: false,
    transcription: {
      total: 0,
      transcribed: 0,
      pending: 0,
      percentage: 0,
      isComplete: false,
      lastTranscribedAt: null,
    },
    audit: {
      total: 0,
      completed: 0,
      pending: 0,
      running: 0,
      compliant: 0,
      nonCompliant: 0,
      averageScore: null,
      latestAudit: null,
    },
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// STATUS SERVICES
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Get fiche status (transcription and audit info)
 */
export async function getFicheStatus(ficheId: string) {
  const ficheCache = await fichesRepository.getFicheWithStatus(ficheId);

  if (!ficheCache) {
    return null;
  }

  const status: FicheStatus = {
    hasData: true,
    transcription: calculateTranscriptionStatus(ficheCache.recordings),
    audit: calculateAuditStatus(ficheCache.audits),
  };

  return {
    ficheId,
    ...status,
  };
}

/**
 * Get status for multiple fiches
 */
export async function getFichesStatus(ficheIds: string[]) {
  const fichesCache = await fichesRepository.getFichesWithStatus(ficheIds);

  // Create a map of ficheId to status
  const statusMap: Record<string, FicheStatus> = {};

  for (const ficheId of ficheIds) {
    const ficheCache = fichesCache.find((f) => f.ficheId === ficheId);

    if (!ficheCache) {
      statusMap[ficheId] = createDefaultStatus();
      continue;
    }

    statusMap[ficheId] = {
      hasData: true,
      transcription: calculateTranscriptionStatus(ficheCache.recordings),
      audit: calculateAuditStatus(ficheCache.audits),
    };
  }

  return statusMap;
}

/**
 * Get all fiches for a date with their statuses
 */
export async function getFichesByDateWithStatus(date: string) {
  // Use UTC to avoid timezone issues
  const startDate = new Date(date + "T00:00:00.000Z");
  const endDate = new Date(date + "T23:59:59.999Z");

  const fichesCache = await fichesRepository.getFichesByDateRange(
    startDate,
    endDate
  );

  // Transform to status-focused format
  const fichesWithStatus = fichesCache.map((ficheCache) => {
    const transcriptionStatus = calculateTranscriptionStatus(
      ficheCache.recordings
    );
    const completedAudits = ficheCache.audits.filter(
      (a) => a.status === "completed"
    );
    const compliantAudits = completedAudits.filter((a) => a.isCompliant);

    const auditStatus = {
      total: ficheCache.audits.length,
      completed: completedAudits.length,
      pending: ficheCache.audits.filter((a) => a.status === "pending").length,
      running: ficheCache.audits.filter((a) => a.status === "running").length,
      compliant: compliantAudits.length,
      nonCompliant: completedAudits.length - compliantAudits.length,
      averageScore:
        completedAudits.length > 0
          ? completedAudits.reduce(
              (sum, a) => sum + Number(a.scorePercentage),
              0
            ) / completedAudits.length
          : null,
      latestAudit: ficheCache.audits[0]
        ? {
            id: ficheCache.audits[0].id.toString(),
            overallScore: ficheCache.audits[0].overallScore.toString(),
            scorePercentage: ficheCache.audits[0].scorePercentage.toString(),
            niveau: ficheCache.audits[0].niveau,
            isCompliant: ficheCache.audits[0].isCompliant,
            status: ficheCache.audits[0].status,
            completedAt: ficheCache.audits[0].completedAt,
            auditConfig: ficheCache.audits[0].auditConfig
              ? {
                  id: ficheCache.audits[0].auditConfig.id.toString(),
                  name: ficheCache.audits[0].auditConfig.name,
                }
              : null,
          }
        : null,
      audits: ficheCache.audits.map((audit) => ({
        id: audit.id.toString(),
        overallScore: audit.overallScore.toString(),
        scorePercentage: audit.scorePercentage.toString(),
        niveau: audit.niveau,
        isCompliant: audit.isCompliant,
        status: audit.status,
        completedAt: audit.completedAt,
        createdAt: audit.createdAt,
        auditConfig: audit.auditConfig
          ? {
              id: audit.auditConfig.id.toString(),
              name: audit.auditConfig.name,
            }
          : null,
      })),
    };

    return {
      ficheId: ficheCache.ficheId,
      groupe: ficheCache.groupe,
      agenceNom: ficheCache.agenceNom,
      prospectNom: ficheCache.prospectNom,
      prospectPrenom: ficheCache.prospectPrenom,
      prospectEmail: ficheCache.prospectEmail,
      prospectTel: ficheCache.prospectTel,
      fetchedAt: ficheCache.fetchedAt,
      createdAt: ficheCache.createdAt,
      transcription: transcriptionStatus,
      audit: auditStatus,
      recordings: ficheCache.recordings.map((r) => ({
        id: r.id.toString(),
        callId: r.callId,
        hasTranscription: r.hasTranscription,
        transcribedAt: r.transcribedAt,
        startTime: r.startTime,
        durationSeconds: r.durationSeconds,
      })),
    };
  });

  return {
    date,
    total: fichesWithStatus.length,
    fiches: fichesWithStatus,
  };
}

/**
 * Get all fiches for a date range with their statuses
 */
export async function getFichesByDateRangeWithStatus(
  startDate: string,
  endDate: string
) {
  // Use UTC to avoid timezone issues - pass Date objects for backward compatibility
  const start = new Date(startDate + "T00:00:00.000Z");
  const end = new Date(endDate + "T23:59:59.999Z");

  const fichesCache = await fichesRepository.getFichesByDateRange(start, end);

  const fichesWithStatus = fichesCache.map((ficheCache) => {
    const transcriptionStatus = calculateTranscriptionStatus(
      ficheCache.recordings
    );
    const completedAudits = ficheCache.audits.filter(
      (a) => a.status === "completed"
    );
    const compliantAudits = completedAudits.filter((a) => a.isCompliant);

    const auditStatus = {
      total: ficheCache.audits.length,
      completed: completedAudits.length,
      pending: ficheCache.audits.filter((a) => a.status === "pending").length,
      running: ficheCache.audits.filter((a) => a.status === "running").length,
      compliant: compliantAudits.length,
      nonCompliant: completedAudits.length - compliantAudits.length,
      averageScore:
        completedAudits.length > 0
          ? completedAudits.reduce(
              (sum, a) => sum + Number(a.scorePercentage),
              0
            ) / completedAudits.length
          : null,
      latestAudit: ficheCache.audits[0]
        ? {
            id: ficheCache.audits[0].id.toString(),
            overallScore: ficheCache.audits[0].overallScore.toString(),
            scorePercentage: ficheCache.audits[0].scorePercentage.toString(),
            niveau: ficheCache.audits[0].niveau,
            isCompliant: ficheCache.audits[0].isCompliant,
            status: ficheCache.audits[0].status,
            completedAt: ficheCache.audits[0].completedAt,
            auditConfig: ficheCache.audits[0].auditConfig
              ? {
                  id: ficheCache.audits[0].auditConfig.id.toString(),
                  name: ficheCache.audits[0].auditConfig.name,
                }
              : null,
          }
        : null,
      audits: ficheCache.audits.map((audit) => ({
        id: audit.id.toString(),
        overallScore: audit.overallScore.toString(),
        scorePercentage: audit.scorePercentage.toString(),
        niveau: audit.niveau,
        isCompliant: audit.isCompliant,
        status: audit.status,
        completedAt: audit.completedAt,
        createdAt: audit.createdAt,
        auditConfig: audit.auditConfig
          ? {
              id: audit.auditConfig.id.toString(),
              name: audit.auditConfig.name,
            }
          : null,
      })),
    };

    return {
      ficheId: ficheCache.ficheId,
      groupe: ficheCache.groupe,
      agenceNom: ficheCache.agenceNom,
      prospectNom: ficheCache.prospectNom,
      prospectPrenom: ficheCache.prospectPrenom,
      prospectEmail: ficheCache.prospectEmail,
      prospectTel: ficheCache.prospectTel,
      fetchedAt: ficheCache.fetchedAt,
      createdAt: ficheCache.createdAt,
      transcription: transcriptionStatus,
      audit: auditStatus,
      recordings: ficheCache.recordings.map((r) => ({
        id: r.id.toString(),
        callId: r.callId,
        hasTranscription: r.hasTranscription,
        transcribedAt: r.transcribedAt,
        startTime: r.startTime,
        durationSeconds: r.durationSeconds,
      })),
    };
  });

  return {
    startDate,
    endDate,
    total: fichesWithStatus.length,
    fiches: fichesWithStatus,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// ENRICHMENT & ORCHESTRATION
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Enrich sales response with status information
 * Business logic to add transcription and audit status to sales fiches
 */
export async function enrichSalesWithStatus(
  sales: SalesWithCallsResponse
): Promise<SalesResponseWithStatus> {
  if (!sales.fiches || sales.fiches.length === 0) {
    return { ...sales, fiches: [] };
  }

  // Extract fiche IDs
  const ficheIds = sales.fiches
    .map((fiche) => fiche.id)
    .filter((id): id is string => Boolean(id));

  if (ficheIds.length === 0) {
    return {
      ...sales,
      fiches: sales.fiches.map((f) => ({
        ...f,
        status: createDefaultStatus(),
      })),
    };
  }

  // Get status for all fiches
  const statusMap = await getFichesStatus(ficheIds);

  // Enrich each fiche with its status
  const enrichedFiches = sales.fiches.map((fiche) => {
    const ficheId = fiche.id;
    const status = ficheId ? statusMap[ficheId] : null;

    return {
      ...fiche,
      status: status || createDefaultStatus(),
    };
  });

  return {
    fiches: enrichedFiches,
    total: sales.total,
  };
}

/**
 * Get fiche from cache or API
 * Orchestrates cache lookup and API fetch
 */
export async function getFiche(ficheId: string, forceRefresh = false) {
  if (forceRefresh) {
    return fichesCache.refreshFicheFromApi(ficheId);
  }

  return fichesCache.getFicheWithCache(ficheId);
}

/**
 * Fetch sales by date range with optional status enrichment
 */
export async function getSalesByDateRange(
  startDate: string,
  endDate: string,
  includeStatus = true
): Promise<SalesWithCallsResponse | SalesResponseWithStatus> {
  const sales = await fichesApi.fetchSalesWithCalls(startDate, endDate);

  if (!includeStatus) {
    return sales;
  }

  return enrichSalesWithStatus(sales);
}

/**
 * Progressive fetch: Return first available data immediately, continue in background
 * Strategy: Check cache, fetch first missing day synchronously, continue rest async
 *
 * @param startDate - Start date YYYY-MM-DD
 * @param endDate - End date YYYY-MM-DD
 * @param options - Configuration options
 * @returns Progressive response with partial data and metadata
 */
export async function getFichesByDateRangeProgressive(
  startDate: string,
  endDate: string,
  options?: {
    webhookUrl?: string;
    webhookSecret?: string;
    triggerBackgroundFetch?: (
      jobId: string,
      remainingDates: string[],
      firstFetchedDate: string | null
    ) => Promise<void>;
  }
): Promise<ProgressiveDateRangeResponse> {
  // Create Date objects for legacy compatibility (some functions still expect Date objects)
  // Use UTC to avoid timezone issues
  const start = new Date(startDate + "T00:00:00.000Z");
  const end = new Date(endDate + "T23:59:59.999Z");

  logger.info("Starting progressive fetch", { startDate, endDate });

  // STEP 0: Check for existing recent job (deduplication)
  // Check for any job (pending, processing, or recently completed) within last 5 minutes
  const allDates = generateDateRange(startDate, endDate);
  const existingJob = await prisma.progressiveFetchJob.findFirst({
    where: {
      startDate,
      endDate,
      createdAt: { gte: new Date(Date.now() - 5 * 60 * 1000) }, // Last 5 mins
    },
    orderBy: { createdAt: "desc" }, // Most recent first
  });

  if (existingJob) {
    logger.info("Found existing in-progress job, reusing", {
      jobId: existingJob.id,
      status: existingJob.status,
      progress: existingJob.progress,
    });

    // Return cached data with existing job ID
    const cachedData = await getFichesByDateRangeWithStatus(startDate, endDate);

    return {
      startDate,
      endDate,
      total: cachedData.total,
      fiches: cachedData.fiches,
      meta: {
        complete: existingJob.status === "complete",
        partial: existingJob.status !== "complete",
        backgroundJobId: existingJob.id,
        totalDaysRequested: existingJob.totalDays,
        daysFetched: existingJob.completedDays,
        daysRemaining: existingJob.datesRemaining.length,
        daysCached: existingJob.datesAlreadyFetched.length,
        cacheCoverage: {
          datesWithData: existingJob.datesAlreadyFetched,
          datesMissing: existingJob.datesRemaining,
        },
      },
    };
  }

  // STEP 1: Check cache coverage - pass strings directly to avoid timezone issues
  const coverage = await fichesRepository.getDateRangeCoverage(
    startDate,
    endDate
  );
  const { datesWithData, datesMissing } = coverage;

  logger.info("Cache coverage analyzed", {
    totalDays: datesWithData.length + datesMissing.length,
    cached: datesWithData.length,
    missing: datesMissing.length,
  });

  // STEP 2: Fetch cached data
  const cachedFichesResult = await getFichesByDateRangeWithStatus(
    startDate,
    endDate
  );
  const cachedFiches = cachedFichesResult.fiches;

  // STEP 3: Always return cached data immediately - NEVER wait for CRM
  // Trigger background fetch for ALL missing dates (no synchronous fetch)

  logger.info("Returning cached data immediately", {
    cachedFiches: cachedFiches.length,
    missingDates: datesMissing.length,
  });

  // All fiches we have right now (cached only)
  const allFiches = cachedFiches;
  const daysFetched = datesWithData.length;
  const remainingDates = datesMissing; // All missing dates go to background

  // STEP 4: Create job record if there are missing dates
  let jobId: string | undefined = undefined;

  if (remainingDates.length > 0) {
    const job = await prisma.progressiveFetchJob.create({
      data: {
        startDate,
        endDate,
        status: "processing",
        totalDays: allDates.length,
        completedDays: daysFetched,
        datesAlreadyFetched: datesWithData,
        datesRemaining: remainingDates,
        datesFailed: [],
        webhookUrl: options?.webhookUrl,
        webhookSecret: options?.webhookSecret,
        webhookEvents: options?.webhookUrl
          ? ["progress", "complete", "failed"]
          : [],
        progress: Math.round((daysFetched / allDates.length) * 100),
        totalFiches: allFiches.length,
        resultFicheIds: allFiches.map((f) => f.ficheId),
      },
    });

    jobId = job.id;

    logger.info("Background job created for missing dates", {
      jobId,
      remainingDays: remainingDates.length,
      dates: remainingDates.slice(0, 3),
    });

    // Trigger background fetch for ALL missing dates (no synchronous wait)
    if (options?.triggerBackgroundFetch) {
      await options.triggerBackgroundFetch(jobId, remainingDates, null);
    }
  }

  // STEP 5: Return cached data immediately
  return {
    startDate,
    endDate,
    total: allFiches.length,
    fiches: allFiches,
    meta: {
      complete: remainingDates.length === 0,
      partial: remainingDates.length > 0,
      backgroundJobId: jobId,
      totalDaysRequested: allDates.length,
      daysFetched,
      daysRemaining: remainingDates.length,
      daysCached: datesWithData.length,
      cacheCoverage: {
        datesWithData,
        datesMissing: remainingDates,
      },
    },
  };
}

/**
 * Get fiches by date range with smart caching and revalidation
 * Orchestrates cache lookup, API fallback, and background revalidation
 *
 * @returns Object with data and meta information about caching/revalidation
 */
export async function getFichesByDateRangeWithSmartCache(
  startDate: string,
  endDate: string,
  options?: {
    triggerRevalidation?: (startDate: string, endDate: string) => Promise<void>;
  }
): Promise<{
  data:
    | DateRangeStatusResponse
    | {
        startDate: string;
        endDate: string;
        total: number;
        fiches: unknown[];
      };
  meta: {
    cached: boolean;
    source?: string;
    revalidating?: boolean;
    revalidationReason?: string;
    message?: string;
  };
}> {
  // STEP 1: Get cached data (always query database first)
  const result = await getFichesByDateRangeWithStatus(startDate, endDate);

  // STEP 2: If NO CACHE at all - fetch from API
  if (result.total === 0) {
    logger.info("No cache found - fetching from API", {
      startDate,
      endDate,
    });

    try {
      // Fetch sales with recordings (single API call for entire range!)
      const salesWithCalls = await fichesApi.fetchSalesWithCalls(
        startDate,
        endDate
      );

      logger.info("Sales with calls fetched from API", {
        startDate,
        endDate,
        total: salesWithCalls.total,
      });

      // Transform API data to status format
      const fichesResponse = salesWithCalls.fiches.map((fiche) => ({
        ficheId: fiche.id,
        groupe: null,
        agenceNom: null,
        prospectNom: fiche.nom,
        prospectPrenom: fiche.prenom,
        prospectEmail: fiche.email,
        prospectTel: fiche.telephone,
        fetchedAt: new Date(),
        createdAt: new Date(),
        transcription: {
          total: fiche.recordings?.length || 0,
          transcribed: 0,
          pending: fiche.recordings?.length || 0,
          percentage: 0,
          isComplete: false,
          lastTranscribedAt: null,
        },
        audit: {
          total: 0,
          completed: 0,
          pending: 0,
          running: 0,
          compliant: 0,
          nonCompliant: 0,
          averageScore: null,
          latestAudit: null,
          audits: [],
        },
        recordings: (fiche.recordings || []).map((rec: unknown) => {
          const recording = rec as {
            call_id: string;
            start_time?: string;
            duration_seconds?: number;
          };
          return {
            id: "0",
            callId: recording.call_id,
            hasTranscription: false,
            transcribedAt: null,
            startTime: recording.start_time
              ? new Date(recording.start_time)
              : null,
            durationSeconds: recording.duration_seconds || 0,
          };
        }),
      }));

      // Trigger background caching if callback provided
      if (options?.triggerRevalidation) {
        await options.triggerRevalidation(startDate, endDate);
      }

      return {
        data: {
          startDate,
          endDate,
          total: salesWithCalls.total,
          fiches: fichesResponse,
        },
        meta: {
          cached: false,
          source: "api",
          revalidationReason: "initial_fetch",
        },
      };
    } catch (apiError) {
      const err = apiError as Error;
      logger.warn("API fetch failed, returning empty", {
        startDate,
        endDate,
        error: err.message,
      });

      // Trigger background revalidation if callback provided
      if (options?.triggerRevalidation) {
        await options.triggerRevalidation(startDate, endDate);
      }

      return {
        data: {
          startDate,
          endDate,
          total: 0,
          fiches: [],
        },
        meta: {
          cached: false,
          source: "api_error",
          revalidating: true,
          revalidationReason: "api_timeout",
          message: "API timeout - data will be available shortly",
        },
      };
    }
  }

  // STEP 3: Cache exists - determine if background revalidation needed
  const isQueryingToday =
    fichesRevalidation.isToday(startDate) ||
    fichesRevalidation.isToday(endDate);

  let shouldRevalidate = false;
  let revalidationReason = "not_needed";

  if (isQueryingToday) {
    shouldRevalidate = true;
    revalidationReason = "date_is_today";
  } else {
    const start = new Date(startDate);
    start.setHours(0, 0, 0, 0);
    const end = new Date(endDate);
    end.setHours(23, 59, 59, 999);

    const oldestRevalidation =
      await fichesRepository.getOldestRevalidationInRange(start, end);

    const revalidationCheck = fichesRevalidation.shouldRevalidate(
      startDate,
      oldestRevalidation
    );

    shouldRevalidate = revalidationCheck.shouldRevalidate;
    revalidationReason = revalidationCheck.reason;
  }

  // Trigger background revalidation if needed
  if (shouldRevalidate && options?.triggerRevalidation) {
    await options.triggerRevalidation(startDate, endDate);
  }

  logger.info("Returning cached data", {
    startDate,
    endDate,
    total: result.total,
    should_revalidate: shouldRevalidate,
    revalidation_reason: revalidationReason,
  });

  return {
    data: result,
    meta: {
      cached: true,
      revalidating: shouldRevalidate,
      revalidationReason,
    },
  };
}
