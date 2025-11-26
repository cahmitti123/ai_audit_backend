/**
 * Recordings Repository
 * =====================
 * Database operations for recordings
 */

import { prisma } from "../../shared/prisma.js";

/**
 * Get all recordings for a fiche
 */
export async function getRecordingsByFiche(ficheId: string) {
  const fiche = await prisma.ficheCache.findUnique({
    where: { ficheId },
    include: {
      recordings: {
        orderBy: { startTime: "asc" }, // Chronological order (oldest first)
      },
    },
  });

  if (!fiche) {
    throw new Error(`Fiche ${ficheId} not found in cache`);
  }

  return fiche.recordings;
}

/**
 * Get recording by call ID
 */
export async function getRecordingByCallId(
  ficheCacheId: bigint,
  callId: string
) {
  return await prisma.recording.findUnique({
    where: {
      ficheCacheId_callId: {
        ficheCacheId,
        callId,
      },
    },
  });
}

/**
 * Update recording with transcription data
 */
export async function updateRecordingTranscription(
  ficheCacheId: bigint,
  callId: string,
  transcriptionId: string,
  transcriptionText?: string
) {
  return await prisma.recording.update({
    where: {
      ficheCacheId_callId: {
        ficheCacheId,
        callId,
      },
    },
    data: {
      transcriptionId,
      transcriptionText: transcriptionText || null,
      hasTranscription: true,
      transcribedAt: new Date(),
    },
  });
}

/**
 * Get recordings that need transcription
 */
export async function getUntranscribedRecordings(ficheId: string) {
  const fiche = await prisma.ficheCache.findUnique({
    where: { ficheId },
    include: {
      recordings: {
        where: { hasTranscription: false },
      },
    },
  });

  return fiche?.recordings || [];
}
