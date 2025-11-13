/**
 * Audit Timeline Generator
 * =========================
 * Generates chronological timeline from transcriptions
 */

import {
  Transcription,
  TimelineRecording,
  ConversationChunk,
} from "../../schemas.js";
import { TIMELINE_CHUNK_SIZE } from "../../shared/constants.js";
import {
  logPayloadSize,
  formatBytes,
  getPayloadSize,
} from "../../utils/payload-size.js";

export function generateTimeline(
  transcriptions: Transcription[]
): TimelineRecording[] {
  const timeline: TimelineRecording[] = [];

  for (let i = 0; i < transcriptions.length; i++) {
    const t = transcriptions[i];

    // Extract parsed recording info if available
    const recording = t.recording as {
      parsed?: {
        date?: string;
        time?: string;
        from_number?: string;
        to_number?: string;
      } | null;
    };
    const parsed = recording?.parsed || null;

    // Debug logging for troubleshooting
    if (!parsed) {
      console.warn(`⚠️  Recording ${i} has no parsed metadata`);
      console.warn(`   URL: ${t.recording_url}`);
    } else if (!parsed.date || !parsed.time) {
      console.warn(`⚠️  Recording ${i} has incomplete parsed metadata`);
      console.warn(`   Date: ${parsed.date}, Time: ${parsed.time}`);
    }
    const words = t.transcription.words;

    // Grouper par speaker
    const messages: any[] = [];
    let currentSpeaker = null;
    let currentText: string[] = [];
    let currentStart = 0;
    let currentEnd = 0;

    for (const word of words) {
      if (word.type === "spacing") continue;

      if (word.speaker_id !== currentSpeaker) {
        if (currentText.length > 0) {
          messages.push({
            speaker: currentSpeaker,
            text: currentText.join(" "), // Add space between words
            start: currentStart,
            end: currentEnd,
          });
        }
        currentSpeaker = word.speaker_id;
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
    const recordingUrl = t.recording?.recording_url || t.recording_url || "";
    const callId = t.recording?.call_id || t.call_id || "";

    console.log(`📍 [Timeline] Recording ${i}:`, {
      call_id: callId,
      recording_url_from_recording: t.recording?.recording_url ? "YES" : "NO",
      recording_url_from_transcription: t.recording_url ? "YES" : "NO",
      final_url: recordingUrl
        ? `${recordingUrl.substring(0, 50)}...`
        : "MISSING",
      date: parsed?.date || "N/A",
      time: parsed?.time || "N/A",
    });

    // Warn if recording URL is missing
    if (!recordingUrl) {
      console.warn(
        `⚠️  [Timeline] Recording ${i} (call_id: ${callId}) has no recording URL!`
      );
      console.warn(`   t.recording.recording_url:`, t.recording?.recording_url);
      console.warn(`   t.recording_url:`, t.recording_url);
      console.warn(`   t.recording keys:`, Object.keys(t.recording || {}));
    }

    timeline.push({
      recording_index: i,
      call_id: callId,
      start_time: t.recording?.start_time || "",
      duration_seconds: t.recording?.duration_seconds || 0,
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

  console.log("\n📊 [Timeline Size Analysis]");
  console.log(`   Recordings: ${timeline.length}`);
  console.log(`   Total chunks: ${totalChunks}`);
  console.log(
    `   Average chunks per recording: ${(totalChunks / timeline.length).toFixed(
      1
    )}`
  );
  console.log(`   Input (transcriptions): ${formatBytes(transcriptionsSize)}`);
  console.log(`   Output (timeline): ${formatBytes(timelineSize)}`);
  console.log(
    `   Size ratio: ${((timelineSize / transcriptionsSize) * 100).toFixed(1)}%`
  );

  // Log detailed size breakdown for first recording (sample)
  if (timeline.length > 0) {
    const sampleRecording = timeline[0];
    const sampleSize = getPayloadSize(sampleRecording);
    const sampleChunkSizes = sampleRecording.chunks.map((c) => ({
      chunk: c.chunk_index,
      size: formatBytes(getPayloadSize(c)),
      textLength: c.full_text.length,
    }));

    console.log(`\n   Sample recording #0 breakdown:`);
    console.log(`     Total size: ${formatBytes(sampleSize)}`);
    console.log(`     Chunks: ${sampleRecording.chunks.length}`);
    console.log(
      `     Avg chunk size: ${formatBytes(
        sampleSize / sampleRecording.chunks.length
      )}`
    );
    if (sampleChunkSizes.length > 0) {
      console.log(
        `     First chunk: ${sampleChunkSizes[0].size} (${sampleChunkSizes[0].textLength} chars)`
      );
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
