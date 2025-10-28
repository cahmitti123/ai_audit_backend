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
 */
export async function cacheFiche(
  ficheData: any,
  expirationHours: number = CACHE_EXPIRATION_HOURS
) {
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

  for (const rec of recordings) {
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

    await prisma.recording.upsert({
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
  }

  logger.debug("Recordings stored", {
    fiche_cache_id: String(ficheCacheId),
    count: recordings.length,
  });
}

/**
 * Delete expired cache entries
 */
export async function deleteExpiredCaches() {
  logger.info("Cleaning up expired caches");

  const result = await prisma.ficheCache.deleteMany({
    where: {
      expiresAt: {
        lt: new Date(),
      },
    },
  });

  logger.info("Expired caches deleted", { count: result.count });
  return result.count;
}
