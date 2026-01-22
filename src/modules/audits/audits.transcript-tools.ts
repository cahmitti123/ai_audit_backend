/**
 * Transcript Tools (RLM-style)
 * ===========================
 * Exposes constrained transcript access tools for the LLM:
 * - searchTranscript: find relevant transcript chunks by keyword matching
 * - getTranscriptChunks: fetch full chunk text + metadata for quoting/citations
 *
 * Goal: keep the full timeline out of the prompt while preserving strong evidence gating.
 */

import { tool } from "ai";
import { z } from "zod";

import type { TimelineRecording } from "../../schemas.js";

export type TranscriptChunkRef = {
  recording_index: number; // 0-based
  chunk_index: number; // 0-based
};

type IndexedChunk = {
  recording_index: number;
  chunk_index: number;
  start_timestamp: number;
  end_timestamp: number;
  speakers: string[];
  full_text: string;
  full_text_normalized: string;
  recording_date: string;
  recording_time: string;
  recording_url: string;
};

function normalizeForMatch(s: string): string {
  return String(s || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function toMMSS(seconds: number): string {
  const s = Number.isFinite(seconds) ? Math.max(0, Math.floor(seconds)) : 0;
  const mm = Math.floor(s / 60);
  const ss = s % 60;
  return `${String(mm).padStart(2, "0")}:${String(ss).padStart(2, "0")}`;
}

function clampInt(n: number, min: number, max: number): number {
  if (!Number.isFinite(n)) {return min;}
  return Math.max(min, Math.min(max, Math.trunc(n)));
}

function uniqueRefs(refs: TranscriptChunkRef[]): TranscriptChunkRef[] {
  const seen = new Set<string>();
  const out: TranscriptChunkRef[] = [];
  for (const r of refs) {
    const k = `${r.recording_index}:${r.chunk_index}`;
    if (seen.has(k)) {continue;}
    seen.add(k);
    out.push(r);
  }
  return out;
}

export function createTranscriptTools(params: {
  timeline: ReadonlyArray<TimelineRecording>;
  limits?: {
    maxSearchResults?: number;
    maxChunkFetch?: number;
    maxChunkChars?: number;
    maxPreviewChars?: number;
  };
}) {
  const maxSearchResults = clampInt(params.limits?.maxSearchResults ?? 25, 1, 50);
  const maxChunkFetch = clampInt(params.limits?.maxChunkFetch ?? 20, 1, 40);
  const maxChunkChars = clampInt(params.limits?.maxChunkChars ?? 20_000, 1_000, 80_000);
  const maxPreviewChars = clampInt(params.limits?.maxPreviewChars ?? 450, 80, 2_000);

  const timeline = params.timeline || [];

  const indexed: IndexedChunk[] = [];
  let totalChunks = 0;

  for (const rec of timeline) {
    const recIdx = Number(rec.recording_index);
    const date = rec.recording_date || "N/A";
    const time = rec.recording_time || "N/A";
    const url = rec.recording_url || "N/A";

    for (const ch of rec.chunks || []) {
      totalChunks += 1;
      indexed.push({
        recording_index: recIdx,
        chunk_index: Number(ch.chunk_index),
        start_timestamp: Number(ch.start_timestamp),
        end_timestamp: Number(ch.end_timestamp),
        speakers: Array.isArray(ch.speakers) ? ch.speakers : [],
        full_text: String(ch.full_text || ""),
        full_text_normalized: normalizeForMatch(String(ch.full_text || "")),
        recording_date: date,
        recording_time: time,
        recording_url: url,
      });
    }
  }

  const byRef = new Map<string, IndexedChunk>();
  for (const c of indexed) {
    byRef.set(`${c.recording_index}:${c.chunk_index}`, c);
  }

  const recordingsMap = new Map<number, TimelineRecording>();
  for (const rec of timeline) {
    recordingsMap.set(Number(rec.recording_index), rec);
  }

  return {
    searchTranscript: tool({
      description:
        "Search transcript chunks for keywords/phrases and return the best matching chunk references + previews (for evidence discovery).",
      parameters: z.object({
        query: z
          .string()
          .describe(
            "Search query. Include key phrases/keywords (French OK). Prefer batching multiple terms in one query."
          ),
        maxResults: z
          .number()
          .int()
          .min(1)
          .max(50)
          .nullable()
          .describe(
            "Maximum number of results to return. Use null to use the server default."
          ),
        minTermLength: z
          .number()
          .int()
          .min(2)
          .max(8)
          .nullable()
          .describe("Minimum term length for tokenization. Use null to use default."),
      }),
      execute: async ({ query, maxResults: maxResArg, minTermLength }) => {
        const maxRes = clampInt(maxResArg ?? maxSearchResults, 1, 50);
        const minLen = clampInt(minTermLength ?? 3, 2, 8);

        const normalizedQuery = normalizeForMatch(query || "");
        const rawTerms = normalizedQuery.split(" ").filter(Boolean);
        const terms = Array.from(new Set(rawTerms.filter((t) => t.length >= minLen))).slice(
          0,
          40
        );

        const scored: Array<IndexedChunk & { score: number }> = [];
        if (terms.length === 0) {
          return {
            query,
            totalRecordings: timeline.length,
            totalChunks,
            matches: [],
            note:
              "No usable terms extracted from query. Provide more specific keywords/phrases.",
          };
        }

        for (const ch of indexed) {
          const text = ch.full_text_normalized;
          if (!text) {continue;}

          let score = 0;
          for (const term of terms) {
            if (text.includes(term)) {score += 1;}
          }
          if (score > 0) {
            scored.push({ ...ch, score });
          }
        }

        scored.sort((a, b) => {
          if (b.score !== a.score) {return b.score - a.score;}
          if (a.recording_index !== b.recording_index) {return a.recording_index - b.recording_index;}
          return a.chunk_index - b.chunk_index;
        });

        const matches = scored.slice(0, maxRes).map((m) => ({
          recording_index: m.recording_index,
          chunk_index: m.chunk_index,
          score: m.score,
          minutage_secondes: m.start_timestamp,
          minutage: toMMSS(m.start_timestamp),
          start_timestamp: m.start_timestamp,
          end_timestamp: m.end_timestamp,
          speakers: m.speakers,
          recording_date: m.recording_date,
          recording_time: m.recording_time,
          recording_url: m.recording_url,
          preview_text:
            m.full_text.length > maxPreviewChars
              ? `${m.full_text.slice(0, maxPreviewChars)}…`
              : m.full_text,
        }));

        return {
          query,
          normalizedQuery,
          terms,
          totalRecordings: timeline.length,
          totalChunks,
          matches,
          note:
            "Indices are 0-based. Use getTranscriptChunks to fetch full_text for quoting and citations.",
        };
      },
    }),

    getTranscriptChunks: tool({
      description:
        "Fetch full transcript chunk text + metadata for exact quoting and citations. Use after you identified relevant chunk references.",
      parameters: z.object({
        chunks: z
          .array(
            z.object({
              recording_index: z.number().int().min(0),
              chunk_index: z.number().int().min(0),
            })
          )
          .min(1)
          .max(60)
          .describe("Chunk references to fetch (0-based indices)."),
        includeNeighbors: z
          .number()
          .int()
          .min(0)
          .max(2)
          .nullable()
          .describe("Also include N neighbor chunks around each reference. Use null for default."),
        maxChars: z
          .number()
          .int()
          .min(1_000)
          .max(80_000)
          .nullable()
          .describe(
            "Max total characters across all returned full_text. Use null for server default."
          ),
      }),
      execute: async ({ chunks, includeNeighbors, maxChars }) => {
        const neighbor = clampInt(includeNeighbors ?? 0, 0, 2);
        const budget = clampInt(maxChars ?? maxChunkChars, 1_000, 80_000);

        const requested = uniqueRefs(
          (chunks || []).map((c) => ({
            recording_index: Number(c.recording_index),
            chunk_index: Number(c.chunk_index),
          }))
        ).slice(0, maxChunkFetch);

        const expanded: TranscriptChunkRef[] = [];
        for (const r of requested) {
          expanded.push(r);
          for (let d = 1; d <= neighbor; d++) {
            expanded.push({ recording_index: r.recording_index, chunk_index: r.chunk_index - d });
            expanded.push({ recording_index: r.recording_index, chunk_index: r.chunk_index + d });
          }
        }

        const deduped = uniqueRefs(
          expanded.filter((r) => Number.isInteger(r.chunk_index) && r.chunk_index >= 0)
        );

        // Filter invalid refs (out of bounds)
        const valid: TranscriptChunkRef[] = [];
        for (const r of deduped) {
          const rec = recordingsMap.get(r.recording_index);
          if (!rec) {continue;}
          if (!Array.isArray(rec.chunks) || rec.chunks.length === 0) {continue;}
          if (r.chunk_index < 0 || r.chunk_index >= rec.chunks.length) {continue;}
          valid.push(r);
        }

        valid.sort((a, b) => {
          if (a.recording_index !== b.recording_index) {return a.recording_index - b.recording_index;}
          return a.chunk_index - b.chunk_index;
        });

        let remaining = budget;
        let truncated = false;

        const outChunks: Array<{
          recording_index: number;
          chunk_index: number;
          minutage_secondes: number;
          minutage: string;
          start_timestamp: number;
          end_timestamp: number;
          speakers: string[];
          recording_date: string;
          recording_time: string;
          recording_url: string;
          full_text: string;
        }> = [];

        for (const r of valid) {
          const entry = byRef.get(`${r.recording_index}:${r.chunk_index}`);
          if (!entry) {continue;}

          if (remaining <= 0) {
            truncated = true;
            break;
          }

          const text = entry.full_text || "";
          let included = text;
          if (text.length > remaining) {
            included = `${text.slice(0, Math.max(0, remaining))}…`;
            truncated = true;
          }

          remaining -= included.length;

          outChunks.push({
            recording_index: entry.recording_index,
            chunk_index: entry.chunk_index,
            minutage_secondes: entry.start_timestamp,
            minutage: toMMSS(entry.start_timestamp),
            start_timestamp: entry.start_timestamp,
            end_timestamp: entry.end_timestamp,
            speakers: entry.speakers,
            recording_date: entry.recording_date,
            recording_time: entry.recording_time,
            recording_url: entry.recording_url,
            full_text: included,
          });
        }

        return {
          requested: requested.length,
          returned: outChunks.length,
          maxChars: budget,
          truncated,
          chunks: outChunks,
          note:
            "Use the returned full_text to quote exact texte in citations. Copy minutage/minutage_secondes/recording_* fields from this tool output.",
        };
      },
    }),
  } as const;
}

