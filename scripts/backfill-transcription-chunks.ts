import "dotenv/config";

import { Prisma, PrismaClient } from "@prisma/client";

import type { TranscriptionWord } from "../src/schemas.js";
import { buildConversationChunksFromWords } from "../src/utils/transcription-chunks.js";

const prisma = new PrismaClient();

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

async function backfillOnce(params: { take: number }) {
  const candidates = await prisma.recording.findMany({
    where: {
      hasTranscription: true,
      transcriptionChunks: { none: {} },
      OR: [
        { transcriptionData: { not: Prisma.DbNull } },
        { transcriptionText: { not: null } },
      ],
    },
    orderBy: { id: "asc" },
    take: params.take,
    select: {
      id: true,
      transcriptionData: true,
      transcriptionText: true,
      durationSeconds: true,
    },
  });

  if (candidates.length === 0) {
    return { processed: 0, chunked: 0, cleared: 0 };
  }

  let processed = 0;
  let chunked = 0;
  let cleared = 0;

  for (const rec of candidates) {
    processed += 1;

    const payload = rec.transcriptionData as unknown;
    const payloadObj = isRecord(payload) ? payload : null;

    const textFromPayload =
      payloadObj && typeof payloadObj.text === "string" && payloadObj.text.trim()
        ? payloadObj.text.trim()
        : null;
    const effectiveText =
      typeof rec.transcriptionText === "string" && rec.transcriptionText.trim()
        ? rec.transcriptionText
        : textFromPayload;

    const words =
      toTranscriptionWords(payload) ??
      (effectiveText
        ? synthesizeWordsFromText(effectiveText, rec.durationSeconds)
        : null);
    if (!words || words.length === 0) {
      // Nothing usable to chunk; keep payload as-is.
      continue;
    }

    const chunks = buildConversationChunksFromWords(words);
    if (chunks.length === 0) {continue;}

    const languageCode =
      payloadObj && typeof payloadObj.language_code === "string"
        ? payloadObj.language_code
        : null;
    const languageProbability =
      payloadObj && typeof payloadObj.language_probability === "number"
        ? payloadObj.language_probability
        : null;

    await prisma.$transaction([
      prisma.recordingTranscriptionChunk.deleteMany({
        where: { recordingId: rec.id },
      }),
      prisma.recordingTranscriptionChunk.createMany({
        data: chunks.map((c) => ({
          recordingId: rec.id,
          chunkIndex: c.chunk_index,
          startTimestamp: c.start_timestamp,
          endTimestamp: c.end_timestamp,
          messageCount: c.message_count,
          speakers: c.speakers,
          fullText: c.full_text,
        })),
        skipDuplicates: true,
      }),
      prisma.recording.update({
        where: { id: rec.id },
        data: {
          // Reduce raw JSON storage now that chunks exist.
          transcriptionData: Prisma.DbNull,
          transcriptionLanguageCode: languageCode,
          transcriptionLanguageProbability: languageProbability,
          // Keep transcriptionText (already stored); do not touch.
          transcriptionText: rec.transcriptionText ?? textFromPayload,
        },
      }),
    ]);

    chunked += 1;
    cleared += 1;
  }

  return { processed, chunked, cleared };
}

async function main() {
  const batchSize = Math.max(
    1,
    Number.parseInt(process.env.BACKFILL_BATCH_SIZE || "5", 10) || 5
  );
  const maxBatches = Math.max(
    1,
    Number.parseInt(process.env.BACKFILL_MAX_BATCHES || "1000000", 10) ||
      1000000
  );

  let totalProcessed = 0;
  let totalChunked = 0;
  let totalCleared = 0;

  for (let i = 0; i < maxBatches; i++) {
    const r = await backfillOnce({ take: batchSize });
    if (r.processed === 0) {break;}

    totalProcessed += r.processed;
    totalChunked += r.chunked;
    totalCleared += r.cleared;

    console.log(
      JSON.stringify(
        {
          batch: i + 1,
          batchSize,
          processed: r.processed,
          chunked: r.chunked,
          cleared: r.cleared,
          totals: {
            processed: totalProcessed,
            chunked: totalChunked,
            cleared: totalCleared,
          },
        },
        null,
        2
      )
    );
  }

  console.log(
    JSON.stringify(
      {
        done: true,
        totals: {
          processed: totalProcessed,
          chunked: totalChunked,
          cleared: totalCleared,
        },
      },
      null,
      2
    )
  );
}

await main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

