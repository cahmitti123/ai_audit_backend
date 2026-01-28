/**
 * Conversation chunk builder
 * ==========================
 * Shared utility to build `ConversationChunk[]` from word-level transcripts.
 *
 * IMPORTANT: Keep logic in sync with `src/modules/audits/audits.timeline.ts`
 * so `chunk_index` remains stable for citation validation.
 */

import type { ConversationChunk, TranscriptionWord } from "../schemas.js";
import { TIMELINE_CHUNK_SIZE } from "../shared/constants.js";

type TimelineMessage = {
  speaker: string;
  text: string;
  start: number;
  end: number;
};

export function buildConversationChunksFromWords(
  words: ReadonlyArray<TranscriptionWord>,
  chunkSize: number = TIMELINE_CHUNK_SIZE
): ConversationChunk[] {
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
          text: currentText.join(" "),
          start: currentStart,
          end: currentEnd,
        });
      }

      currentSpeaker = speaker;
      currentText = [word.text];
      currentStart = word.start;
      currentEnd = word.end;
      continue;
    }

    currentText.push(word.text);
    currentEnd = word.end;
  }

  if (currentText.length > 0) {
    messages.push({
      speaker: currentSpeaker,
      text: currentText.join(" "),
      start: currentStart,
      end: currentEnd,
    });
  }

  const chunks: ConversationChunk[] = [];
  const size = Math.max(1, Math.floor(chunkSize));
  for (let i = 0; i < messages.length; i += size) {
    const chunkMessages = messages.slice(i, i + size);
    if (chunkMessages.length === 0) {continue;}

    chunks.push({
      chunk_index: chunks.length,
      start_timestamp: chunkMessages[0].start,
      end_timestamp: chunkMessages[chunkMessages.length - 1].end,
      message_count: chunkMessages.length,
      speakers: [...new Set(chunkMessages.map((m) => m.speaker))],
      full_text: chunkMessages.map((m) => `${m.speaker}: ${m.text}`).join("\n"),
    });
  }

  return chunks;
}

