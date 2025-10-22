/**
 * Générateur de Timeline
 */

import {
  Transcription,
  TimelineRecording,
  ConversationChunk,
} from "../types.js";

export function generateTimeline(
  transcriptions: Transcription[]
): TimelineRecording[] {
  const timeline: TimelineRecording[] = [];

  for (let i = 0; i < transcriptions.length; i++) {
    const t = transcriptions[i];

    // Extract parsed recording info if available
    const parsed = (t.recording as any)?.parsed || null;
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
            text: currentText.join(""),
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
        text: currentText.join(""),
        start: currentStart,
        end: currentEnd,
      });
    }

    // Créer chunks
    const chunks: ConversationChunk[] = [];
    for (let j = 0; j < messages.length; j += 10) {
      const chunkMessages = messages.slice(j, j + 10);
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

    timeline.push({
      recording_index: i,
      call_id: t.recording?.call_id || "",
      start_time: t.recording?.start_time || "",
      duration_seconds: t.recording?.duration_seconds || 0,
      recording_url: t.recording?.recording_url || t.recording_url,
      recording_date: parsed?.date || "",
      recording_time: parsed?.time || "",
      from_number: parsed?.from_number || "",
      to_number: parsed?.to_number || "",
      total_chunks: chunks.length,
      chunks,
    });
  }

  return timeline;
}
