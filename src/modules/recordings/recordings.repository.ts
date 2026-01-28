/**
 * Recordings Repository
 * =====================
 * Database operations for recordings
 */

import { Prisma } from "@prisma/client";

import type { TranscriptionWord } from "../../schemas.js";
import { prisma } from "../../shared/prisma.js";
import { buildConversationChunksFromWords } from "../../utils/transcription-chunks.js";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function toTranscriptionWord(value: unknown): TranscriptionWord | null {
  if (!isRecord(value)) {return null;}

  const text = value.text;
  const start = value.start;
  const end = value.end;
  const type = value.type;

  if (
    typeof text !== "string" ||
    typeof start !== "number" ||
    typeof end !== "number" ||
    typeof type !== "string"
  ) {
    return null;
  }

  const speaker_id =
    typeof value.speaker_id === "string" ? value.speaker_id : undefined;
  const logprob = typeof value.logprob === "number" ? value.logprob : undefined;

  return { text, start, end, type, speaker_id, logprob };
}

function toTranscriptionWords(payload: unknown): TranscriptionWord[] | null {
  if (!isRecord(payload)) {return null;}
  const wordsRaw = payload.words;
  if (!Array.isArray(wordsRaw) || wordsRaw.length === 0) {return null;}

  const words = wordsRaw
    .map(toTranscriptionWord)
    .filter((w): w is TranscriptionWord => w !== null);

  return words.length > 0 ? words : null;
}

function synthesizeWordsFromText(
  text: string,
  durationSeconds?: number | null
): TranscriptionWord[] {
  const words = text
    .split(/\s+/)
    .map((w) => w.trim())
    .filter(Boolean);
  if (words.length === 0) {return [];}

  const dur =
    typeof durationSeconds === "number" && durationSeconds > 0
      ? durationSeconds
      : Math.max(1, Math.round(words.length * 0.5));

  const wordDur = Math.max(0.05, dur / Math.max(1, words.length));

  return words.map((word, idx) => ({
    text: word,
    start: idx * wordDur,
    end: (idx + 1) * wordDur,
    type: "word",
    // Speaker unknown without diarization; keep expected shape.
    speaker_id: idx % 20 < 10 ? "speaker_0" : "speaker_1",
  }));
}

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
 * Get all recordings for a fiche including normalized transcription chunks.
 *
 * NOTE: Prefer this when building timelines (audits/chat) to avoid loading huge word-level JSON.
 */
export async function getRecordingsWithTranscriptionChunksByFiche(ficheId: string) {
  // IMPORTANT:
  // Avoid selecting the huge `transcriptionData` JSON for rows that already have
  // normalized `transcriptionChunks` (keeps memory + DB bandwidth sane).
  const base = await prisma.recording.findMany({
    where: { ficheCache: { ficheId } },
    orderBy: { startTime: "asc" },
    select: {
      id: true,
      ficheCacheId: true,
      callId: true,
      recordingUrl: true,
      recordingDate: true,
      recordingTime: true,
      fromNumber: true,
      toNumber: true,
      uuid: true,
      direction: true,
      answered: true,
      startTime: true,
      durationSeconds: true,
      transcriptionId: true,
      transcriptionText: true,
      transcriptionLanguageCode: true,
      transcriptionLanguageProbability: true,
      hasTranscription: true,
      transcribedAt: true,
      createdAt: true,
      updatedAt: true,
      transcriptionChunks: {
        orderBy: { chunkIndex: "asc" },
        select: {
          id: true,
          chunkIndex: true,
          startTimestamp: true,
          endTimestamp: true,
          messageCount: true,
          speakers: true,
          fullText: true,
          createdAt: true,
        },
      },
    },
  });

  const missingChunkIds = base
    .filter((r) => r.hasTranscription && r.transcriptionChunks.length === 0)
    .map((r) => r.id);

  if (missingChunkIds.length === 0) {
    return base.map((r) => ({ ...r, transcriptionData: null as unknown }));
  }

  const payloads = await prisma.recording.findMany({
    where: { id: { in: missingChunkIds } },
    select: { id: true, transcriptionData: true },
  });

  const byId = new Map(payloads.map((p) => [p.id, p.transcriptionData]));

  return base.map((r) => ({
    ...r,
    transcriptionData: (byId.get(r.id) ?? null) as unknown,
  }));
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
  transcriptionText?: string,
  transcriptionData?: Prisma.InputJsonValue
) {
  const recording = await prisma.recording.findUnique({
    where: {
      ficheCacheId_callId: {
        ficheCacheId,
        callId,
      },
    },
    select: { id: true, durationSeconds: true },
  });

  if (!recording) {
    throw new Error(
      `Recording not found for ficheCacheId=${ficheCacheId.toString()} callId=${callId}`
    );
  }

  const payload = transcriptionData as unknown;
  const payloadObj = isRecord(payload) ? payload : null;
  const languageCode =
    payloadObj && typeof payloadObj.language_code === "string"
      ? payloadObj.language_code
      : null;
  const languageProbability =
    payloadObj && typeof payloadObj.language_probability === "number"
      ? payloadObj.language_probability
      : null;

  const words =
    toTranscriptionWords(payload) ??
    (typeof transcriptionText === "string" && transcriptionText.trim()
      ? synthesizeWordsFromText(transcriptionText, recording.durationSeconds)
      : null);
  const chunks = words ? buildConversationChunksFromWords(words) : [];

  // Only rewrite chunks when we successfully derived them.
  const ops: Prisma.PrismaPromise<unknown>[] = [];
  const shouldRewriteChunks = chunks.length > 0;
  if (shouldRewriteChunks) {
    ops.push(
      prisma.recordingTranscriptionChunk.deleteMany({
        where: { recordingId: recording.id },
      })
    );
    ops.push(
      prisma.recordingTranscriptionChunk.createMany({
        data: chunks.map((c) => ({
          recordingId: recording.id,
          chunkIndex: c.chunk_index,
          startTimestamp: c.start_timestamp,
          endTimestamp: c.end_timestamp,
          messageCount: c.message_count,
          speakers: c.speakers,
          fullText: c.full_text,
        })),
        skipDuplicates: true,
      })
    );
  }

  const updateOp = prisma.recording.update({
    where: {
      ficheCacheId_callId: {
        ficheCacheId,
        callId,
      },
    },
    data: {
      transcriptionId,
      transcriptionText: transcriptionText || null,
      ...(transcriptionData !== undefined && shouldRewriteChunks
        ? {
            // Reduce raw JSON storage: store normalized chunks + columns instead of word-level JSON.
            transcriptionData: Prisma.DbNull,
            transcriptionLanguageCode: languageCode,
            transcriptionLanguageProbability: languageProbability,
          }
        : {}),
      hasTranscription: true,
      transcribedAt: new Date(),
    },
  });

  const results = await prisma.$transaction([...ops, updateOp]);
  return results[results.length - 1] as Awaited<typeof updateOp>;
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
