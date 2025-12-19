/**
 * Fiches Repository
 * =================
 * RESPONSIBILITY: Database operations only (CRUD)
 * - Read/write/delete fiches cache entries
 * - Read/write recordings
 * - Query helpers for database lookups
 * - No business logic or enrichment
 *
 * LAYER: Data Access (Database)
 */

import { prisma } from "../../shared/prisma.js";
import { logger } from "../../shared/logger.js";

// ═══════════════════════════════════════════════════════════════════════════
// READ OPERATIONS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Get cached fiche by ID
 */
export async function getCachedFiche(ficheId: string) {
  logger.debug("Looking up fiche in cache", { fiche_id: ficheId });

  const cached = await prisma.ficheCache.findUnique({
    where: { ficheId },
    include: {
      recordings: {
        orderBy: { startTime: "desc" },
      },
    },
  });

  if (!cached) {
    logger.debug("Fiche not found in cache", { fiche_id: ficheId });
    return null;
  }

  // Attach recordings to rawData for compatibility
  // Transform database format (camelCase) to API format (snake_case)
  const rawData = cached.rawData as Record<string, unknown>;
  (rawData as { recordings?: unknown[] }).recordings = cached.recordings.map(
    (rec) => ({
      call_id: rec.callId,
      recording_url: rec.recordingUrl,
      direction: rec.direction,
      answered: rec.answered,
      start_time: rec.startTime?.toISOString(),
      duration_seconds: rec.durationSeconds,
      from_number: rec.fromNumber,
      to_number: rec.toNumber,
      transcription: rec.hasTranscription
        ? { conversation: rec.transcriptionText || "" }
        : null,
    })
  );

  logger.debug("Fiche retrieved from cache", {
    fiche_id: ficheId,
    cache_id: String(cached.id),
    recordings_count: cached.recordings.length,
  });

  return {
    ...cached,
    rawData,
  };
}

/**
 * Get fiche with status information (transcription + audit)
 */
export async function getFicheWithStatus(ficheId: string) {
  const ficheCache = await prisma.ficheCache.findUnique({
    where: { ficheId },
    include: {
      recordings: {
        select: {
          id: true,
          hasTranscription: true,
          transcribedAt: true,
        },
      },
      audits: {
        where: { isLatest: true },
        select: {
          id: true,
          overallScore: true,
          scorePercentage: true,
          niveau: true,
          isCompliant: true,
          status: true,
          completedAt: true,
          auditConfig: {
            select: {
              id: true,
              name: true,
            },
          },
        },
        orderBy: { createdAt: "desc" },
      },
    },
  });

  return ficheCache;
}

/**
 * Get multiple fiches with status information
 */
export async function getFichesWithStatus(ficheIds: string[]) {
  const fichesCache = await prisma.ficheCache.findMany({
    where: { ficheId: { in: ficheIds } },
    include: {
      recordings: {
        select: {
          id: true,
          hasTranscription: true,
          transcribedAt: true,
        },
      },
      audits: {
        where: { isLatest: true },
        select: {
          id: true,
          overallScore: true,
          scorePercentage: true,
          niveau: true,
          isCompliant: true,
          status: true,
          completedAt: true,
          auditConfig: {
            select: {
              id: true,
              name: true,
            },
          },
        },
        orderBy: { createdAt: "desc" },
      },
    },
  });

  return fichesCache;
}

/**
 * Get fiches by sales date range
 * Uses salesDate field to filter by which CRM sales date the fiches belong to
 */
export async function getFichesByDateRange(startDate: Date, endDate: Date) {
  // Convert Date objects to YYYY-MM-DD strings for salesDate comparison
  const startDateStr = startDate.toISOString().split("T")[0];
  const endDateStr = endDate.toISOString().split("T")[0];

  const fichesCache = await prisma.ficheCache.findMany({
    where: {
      salesDate: {
        gte: startDateStr,
        lte: endDateStr,
      },
    },
    include: {
      recordings: {
        select: {
          id: true,
          hasTranscription: true,
          transcribedAt: true,
          callId: true,
          startTime: true,
          durationSeconds: true,
        },
        orderBy: { startTime: "desc" },
      },
      audits: {
        where: { isLatest: true },
        select: {
          id: true,
          overallScore: true,
          scorePercentage: true,
          niveau: true,
          isCompliant: true,
          status: true,
          completedAt: true,
          createdAt: true,
          auditConfig: {
            select: {
              id: true,
              name: true,
            },
          },
        },
        orderBy: { createdAt: "desc" },
      },
    },
    orderBy: { createdAt: "desc" },
  });

  return fichesCache;
}

// ═══════════════════════════════════════════════════════════════════════════
// WRITE OPERATIONS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Upsert fiche cache entry
 */
export async function upsertFicheCache(data: {
  ficheId: string;
  groupe?: string | null;
  agenceNom?: string | null;
  prospectNom?: string;
  prospectPrenom?: string;
  prospectEmail?: string;
  prospectTel?: string;
  salesDate?: string; // YYYY-MM-DD - CRM sales date this fiche belongs to
  rawData: unknown;
  hasRecordings: boolean;
  recordingsCount: number;
  expiresAt: Date;
  lastRevalidatedAt?: Date;
}) {
  const ficheCache = await prisma.ficheCache.upsert({
    where: { ficheId: data.ficheId },
    create: {
      ficheId: data.ficheId,
      ...(data.groupe !== undefined ? { groupe: data.groupe } : {}),
      ...(data.agenceNom !== undefined ? { agenceNom: data.agenceNom } : {}),
      prospectNom: data.prospectNom,
      prospectPrenom: data.prospectPrenom,
      prospectEmail: data.prospectEmail,
      prospectTel: data.prospectTel,
      salesDate: data.salesDate,
      rawData: data.rawData as import("@prisma/client").Prisma.InputJsonValue,
      hasRecordings: data.hasRecordings,
      recordingsCount: data.recordingsCount,
      expiresAt: data.expiresAt,
      lastRevalidatedAt: data.lastRevalidatedAt,
    },
    update: {
      ...(data.groupe !== undefined ? { groupe: data.groupe } : {}),
      ...(data.agenceNom !== undefined ? { agenceNom: data.agenceNom } : {}),
      prospectNom: data.prospectNom,
      prospectPrenom: data.prospectPrenom,
      prospectEmail: data.prospectEmail,
      prospectTel: data.prospectTel,
      salesDate: data.salesDate,
      rawData: data.rawData as import("@prisma/client").Prisma.InputJsonValue,
      hasRecordings: data.hasRecordings,
      recordingsCount: data.recordingsCount,
      fetchedAt: new Date(),
      expiresAt: data.expiresAt,
      ...(data.lastRevalidatedAt && {
        lastRevalidatedAt: data.lastRevalidatedAt,
      }),
    },
  });

  logger.debug("Fiche cache upserted", {
    fiche_id: data.ficheId,
    cache_id: String(ficheCache.id),
    recordings_count: data.recordingsCount,
    last_revalidated_at: data.lastRevalidatedAt?.toISOString(),
  });

  return ficheCache;
}

/**
 * Upsert recordings for a fiche
 * Also updates rawData.recordings to keep in sync
 */
export async function upsertRecordings(
  ficheCacheId: bigint,
  recordings: unknown[]
) {
  logger.debug("Storing recordings", {
    fiche_cache_id: String(ficheCacheId),
    count: recordings.length,
  });

  // Store all recordings in parallel for better performance
  const upsertPromises = recordings.map((rec) => {
    const recording = rec as {
      call_id: string;
      recording_url?: string;
      direction?: string;
      answered?: boolean;
      start_time?: string;
      duration_seconds?: number;
      parsed?: {
        date?: string;
        time?: string;
        from_number?: string;
        to_number?: string;
        uuid?: string;
      };
    };

    const parsed = recording.parsed;

    return prisma.recording.upsert({
      where: {
        ficheCacheId_callId: {
          ficheCacheId,
          callId: recording.call_id,
        },
      },
      create: {
        ficheCacheId,
        callId: recording.call_id,
        recordingUrl: recording.recording_url || "",
        recordingDate: parsed?.date || null,
        recordingTime: parsed?.time || null,
        fromNumber: parsed?.from_number || null,
        toNumber: parsed?.to_number || null,
        uuid: parsed?.uuid || null,
        direction: recording.direction || null,
        answered: recording.answered || null,
        startTime: recording.start_time ? new Date(recording.start_time) : null,
        durationSeconds: recording.duration_seconds || null,
        hasTranscription: false,
      },
      update: {
        recordingUrl: recording.recording_url || "",
        recordingDate: parsed?.date || null,
        recordingTime: parsed?.time || null,
        fromNumber: parsed?.from_number || null,
        toNumber: parsed?.to_number || null,
        uuid: parsed?.uuid || null,
        direction: recording.direction || null,
        answered: recording.answered || null,
        startTime: recording.start_time ? new Date(recording.start_time) : null,
        durationSeconds: recording.duration_seconds || null,
      },
    });
  });

  await Promise.all(upsertPromises);

  logger.debug("Recordings stored in parallel", {
    fiche_cache_id: String(ficheCacheId),
    count: recordings.length,
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// NOTE: DELETE OPERATIONS REMOVED
// All sales data is permanently stored in the database
// No automatic deletion of cache entries
// ═══════════════════════════════════════════════════════════════════════════

// ═══════════════════════════════════════════════════════════════════════════
// QUERY HELPERS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Get the oldest revalidation timestamp in a date range
 * Returns null if no fiches found or none have been revalidated
 */
export async function getOldestRevalidationInRange(
  startDate: Date,
  endDate: Date
): Promise<Date | null> {
  const result = await prisma.ficheCache.findFirst({
    where: {
      createdAt: {
        gte: startDate,
        lte: endDate,
      },
    },
    orderBy: {
      lastRevalidatedAt: "asc",
    },
    select: {
      lastRevalidatedAt: true,
    },
  });

  return result?.lastRevalidatedAt || null;
}

/**
 * Check which dates in a range have cached data
 * Returns object with dates that have data vs dates missing
 *
 * IMPORTANT: Uses salesDate field to determine which CRM sales date the fiche belongs to
 * IMPORTANT: Takes Date parameters but works with YYYY-MM-DD strings to avoid timezone issues
 */
export async function getDateRangeCoverage(
  startDate: Date | string,
  endDate: Date | string
): Promise<{
  datesWithData: string[];
  datesMissing: string[];
}> {
  // Convert to YYYY-MM-DD strings (handle both Date objects and strings)
  const startDateStr =
    typeof startDate === "string"
      ? startDate
      : startDate.toISOString().split("T")[0];
  const endDateStr =
    typeof endDate === "string" ? endDate : endDate.toISOString().split("T")[0];

  // Generate all dates in the requested range using string manipulation
  const allRequestedDates: string[] = [];
  const current = new Date(startDateStr + "T00:00:00.000Z");
  const end = new Date(endDateStr + "T00:00:00.000Z");

  while (current <= end) {
    allRequestedDates.push(current.toISOString().split("T")[0]);
    current.setUTCDate(current.getUTCDate() + 1);
  }

  // Get all fiches that have a salesDate in the requested range

  const fiches = await prisma.ficheCache.findMany({
    where: {
      salesDate: {
        gte: startDateStr,
        lte: endDateStr,
      },
    },
    select: {
      salesDate: true,
    },
  });

  // Extract unique sales dates that have data
  const datesWithDataSet = new Set<string>();
  fiches.forEach((fiche) => {
    if (fiche.salesDate) {
      datesWithDataSet.add(fiche.salesDate);
    }
  });

  // Separate into with data vs missing (using allRequestedDates generated above)
  const datesWithData = allRequestedDates.filter((date) =>
    datesWithDataSet.has(date)
  );
  const datesMissing = allRequestedDates.filter(
    (date) => !datesWithDataSet.has(date)
  );

  return {
    datesWithData,
    datesMissing,
  };
}

/**
 * Check if we have cached data for a specific sales date
 * Uses salesDate field to determine which CRM date the fiches belong to
 */
export async function hasDataForDate(date: string): Promise<boolean> {
  const count = await prisma.ficheCache.count({
    where: {
      salesDate: date, // YYYY-MM-DD format
    },
  });

  return count > 0;
}
