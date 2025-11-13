/**
 * Fiches Repository
 * =================
 * Database operations for fiche caching
 */

import { prisma } from "../../shared/prisma.js";
import { enrichRecording } from "../../utils/recording-parser.js";
import { CACHE_EXPIRATION_HOURS } from "../../shared/constants.js";
import { logger } from "../../shared/logger.js";

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
  const rawData = cached.rawData as Record<string, unknown>;
  (rawData as { recordings?: unknown[] }).recordings = cached.recordings;

  logger.debug("Fiche retrieved from cache", {
    fiche_id: ficheId,
    cache_id: String(cached.id),
    recordings_count: cached.recordings.length,
    cached_count: cached.recordingsCount,
  });

  return {
    ...cached,
    rawData,
  };
}

/**
 * Cache fiche data in database
 * @param ficheData - Full fiche details from API
 * @param expirationHours - Cache expiration time in hours (default: 24)
 */
export async function cacheFiche(
  ficheData: import("./fiches.schemas.js").FicheDetailsResponse,
  expirationHours: number = CACHE_EXPIRATION_HOURS
) {
  // Validate that required information exists
  if (!ficheData.information) {
    throw new Error("Cannot cache fiche: missing information object");
  }

  const expiresAt = new Date();
  expiresAt.setHours(expiresAt.getHours() + expirationHours);

  // Enrich recordings with parsed metadata
  if (ficheData.recordings) {
    ficheData.recordings = ficheData.recordings.map(enrichRecording);
  }

  const ficheCache = await prisma.ficheCache.upsert({
    where: { ficheId: ficheData.information.fiche_id },
    create: {
      ficheId: ficheData.information.fiche_id,
      groupe: ficheData.information.groupe,
      agenceNom: ficheData.information.agence_nom,
      prospectNom: ficheData.prospect?.nom,
      prospectPrenom: ficheData.prospect?.prenom,
      prospectEmail: ficheData.prospect?.mail,
      prospectTel: ficheData.prospect?.telephone || ficheData.prospect?.mobile,
      rawData: ficheData,
      hasRecordings: ficheData.recordings?.length > 0,
      recordingsCount: ficheData.recordings?.length || 0,
      expiresAt,
    },
    update: {
      groupe: ficheData.information.groupe,
      agenceNom: ficheData.information.agence_nom,
      prospectNom: ficheData.prospect?.nom,
      prospectPrenom: ficheData.prospect?.prenom,
      prospectEmail: ficheData.prospect?.mail,
      prospectTel: ficheData.prospect?.telephone || ficheData.prospect?.mobile,
      rawData: ficheData,
      hasRecordings: ficheData.recordings?.length > 0,
      recordingsCount: ficheData.recordings?.length || 0,
      fetchedAt: new Date(),
      expiresAt,
    },
  });

  // Store recordings
  if (ficheData.recordings?.length > 0) {
    await storeRecordings(ficheCache.id, ficheData.recordings);
  }

  return ficheCache;
}

/**
 * Store recordings in database
 */
async function storeRecordings(ficheCacheId: bigint, recordings: unknown[]) {
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

/**
 * Delete expired cache entries (only those without associated audits)
 * Only deletes caches that have been expired for over 1 week
 */
export async function deleteExpiredCaches() {
  logger.info("Cleaning up expired caches");

  // Calculate date 1 week ago
  const oneWeekAgo = new Date();
  oneWeekAgo.setDate(oneWeekAgo.getDate() - 7);

  // Find expired caches that have NO audits (expired over 1 week ago)
  const expiredCaches = await prisma.ficheCache.findMany({
    where: {
      expiresAt: {
        lt: oneWeekAgo,
      },
    },
    include: {
      _count: {
        select: {
          audits: true,
        },
      },
    },
  });

  logger.info("Found expired caches", {
    total: expiredCaches.length,
    with_audits: expiredCaches.filter((c) => c._count.audits > 0).length,
    without_audits: expiredCaches.filter((c) => c._count.audits === 0).length,
  });

  // Only delete caches that have no audits
  const cacheIdsToDelete = expiredCaches
    .filter((cache) => cache._count.audits === 0)
    .map((cache) => cache.id);

  if (cacheIdsToDelete.length === 0) {
    logger.info("No expired caches to delete (all have audit records)");
    return 0;
  }

  const result = await prisma.ficheCache.deleteMany({
    where: {
      id: {
        in: cacheIdsToDelete,
      },
    },
  });

  logger.info("Expired caches deleted", {
    count: result.count,
    skipped: expiredCaches.length - result.count,
  });

  return result.count;
}
