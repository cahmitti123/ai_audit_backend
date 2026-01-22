/**
 * Audit Timeline Generator
 * =========================
 * Generates chronological timeline from transcriptions
 */

import type {
  ConversationChunk,
  TimelineRecording,
  Transcription,
} from "../../schemas.js";
import { TIMELINE_CHUNK_SIZE } from "../../shared/constants.js";
import { logger } from "../../shared/logger.js";
import {
  formatBytes,
  getPayloadSize,
  logPayloadSize,
} from "../../utils/payload-size.js";

type RecordingMetadata = {
  parsed?: {
    date?: string;
    time?: string;
    from_number?: string;
    to_number?: string;
  } | null;
  recording_url?: string;
  call_id?: string;
  start_time?: string;
  duration_seconds?: number;
};

type TimelineMessage = {
  speaker: string;
  text: string;
  start: number;
  end: number;
};

export function generateTimeline(
  transcriptions: Transcription[]
): TimelineRecording[] {
  const timeline: TimelineRecording[] = [];

  for (let i = 0; i < transcriptions.length; i++) {
    const t = transcriptions[i];

    // Extract parsed recording info if available
    const recording = (t.recording ?? null) as RecordingMetadata | null;
    const parsed = recording?.parsed ?? null;

    // Debug logging for troubleshooting
    if (!parsed) {
      logger.warn("Recording has no parsed metadata", {
        recording_index: i,
        recording_url: t.recording_url,
      });
    } else if (!parsed.date || !parsed.time) {
      logger.warn("Recording has incomplete parsed metadata", {
        recording_index: i,
        date: parsed.date,
        time: parsed.time,
      });
    }
    const words = t.transcription.words;

    // Grouper par speaker
    const messages: TimelineMessage[] = [];
    let currentSpeaker = "unknown";
    let currentText: string[] = [];
    let currentStart = 0;
    let currentEnd = 0;

    for (const word of words) {
      if (word.type === "spacing") {continue;}

      const speaker = word.speaker_id ?? "unknown";

      if (speaker !== currentSpeaker) {
        if (currentText.length > 0) {
          messages.push({
            speaker: currentSpeaker,
            text: currentText.join(" "), // Add space between words
            start: currentStart,
            end: currentEnd,
          });
        }
        currentSpeaker = speaker;
        currentText = [word.text];
        currentStart = word.start;
        currentEnd = word.end;
      } else {
        currentText.push(word.text);
        currentEnd = word.end;
      }
    }

    if (currentText.length > 0) {
      messages.push({
        speaker: currentSpeaker,
        text: currentText.join(" "), // Add space between words
        start: currentStart,
        end: currentEnd,
      });
    }

    // Créer chunks
    const chunks: ConversationChunk[] = [];
    for (let j = 0; j < messages.length; j += TIMELINE_CHUNK_SIZE) {
      const chunkMessages = messages.slice(j, j + TIMELINE_CHUNK_SIZE);
      chunks.push({
        chunk_index: chunks.length,
        start_timestamp: chunkMessages[0].start,
        end_timestamp: chunkMessages[chunkMessages.length - 1].end,
        message_count: chunkMessages.length,
        speakers: [...new Set(chunkMessages.map((m) => m.speaker))],
        full_text: chunkMessages
          .map((m) => `${m.speaker}: ${m.text}`)
          .join("\n"),
      });
    }

    // Get recording URL from enriched recording or fallback to transcription object
    const recordingUrl = recording?.recording_url || t.recording_url || "";
    const callId = recording?.call_id || t.call_id || "";

    logger.debug("Timeline recording summary", {
      call_id: callId,
      recording_url_from_recording: recording?.recording_url ? "YES" : "NO",
      recording_url_from_transcription: t.recording_url ? "YES" : "NO",
      final_url: recordingUrl
        ? `${recordingUrl.substring(0, 50)}...`
        : "MISSING",
      date: parsed?.date || "N/A",
      time: parsed?.time || "N/A",
    });

    // Warn if recording URL is missing
    if (!recordingUrl) {
      logger.warn("Timeline recording missing recording URL", {
        recording_index: i,
        call_id: callId,
        recording_recording_url: recording?.recording_url ?? null,
        transcription_recording_url: t.recording_url || null,
        recording_keys: Object.keys(recording ?? {}),
      });
    }

    timeline.push({
      recording_index: i,
      call_id: callId,
      start_time: recording?.start_time || "",
      duration_seconds: recording?.duration_seconds || 0,
      recording_url: recordingUrl,
      recording_date: parsed?.date || "",
      recording_time: parsed?.time || "",
      from_number: parsed?.from_number || "",
      to_number: parsed?.to_number || "",
      total_chunks: chunks.length,
      chunks,
    });
  }

  // Log timeline size for monitoring
  const totalChunks = timeline.reduce((sum, r) => sum + r.total_chunks, 0);
  const timelineSize = getPayloadSize(timeline);
  const transcriptionsSize = getPayloadSize(transcriptions);

  logger.info("Timeline size analysis", {
    recordings: timeline.length,
    total_chunks: totalChunks,
    avg_chunks_per_recording:
      timeline.length > 0 ? Number((totalChunks / timeline.length).toFixed(1)) : 0,
    input_transcriptions: formatBytes(transcriptionsSize),
    output_timeline: formatBytes(timelineSize),
    size_ratio_pct: transcriptionsSize > 0
      ? Number(((timelineSize / transcriptionsSize) * 100).toFixed(1))
      : null,
  });

  // Log detailed size breakdown for first recording (sample)
  if (timeline.length > 0) {
    const sampleRecording = timeline[0];
    const sampleSize = getPayloadSize(sampleRecording);
    const sampleChunkSizes = sampleRecording.chunks.map((c) => ({
      chunk: c.chunk_index,
      size: formatBytes(getPayloadSize(c)),
      textLength: c.full_text.length,
    }));

    logger.debug("Timeline sample recording breakdown", {
      sample_index: 0,
      total_size: formatBytes(sampleSize),
      chunks: sampleRecording.chunks.length,
      avg_chunk_size: sampleRecording.chunks.length > 0
        ? formatBytes(sampleSize / sampleRecording.chunks.length)
        : "N/A",
    });
    if (sampleChunkSizes.length > 0) {
      logger.debug("Timeline sample first chunk", {
        size: sampleChunkSizes[0].size,
        text_length: sampleChunkSizes[0].textLength,
      });
    }
  }

  // Warning if timeline is very large
  logPayloadSize(
    "Complete Timeline",
    timeline,
    50 * 1024 * 1024 // 50MB Express limit
  );

  return timeline;
}
