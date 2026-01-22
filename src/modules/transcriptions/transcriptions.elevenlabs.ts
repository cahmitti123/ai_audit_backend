/**
 * Service de Transcription
 * =========================
 * Transcrit les audios avec ElevenLabs et cache les résultats
 */

import axios from "axios";

import type { Transcription } from "../../schemas.js";
import { logger } from "../../shared/logger.js";
import { mapWithConcurrency } from "../../utils/concurrency.js";

type RecordingInput = {
  recording_url?: string | null;
  recordingUrl?: string | null;
  call_id?: string;
  callId?: string;
  [key: string]: unknown;
};

function stripSurroundingQuotes(value: string): string {
  if (value.length < 2) {return value;}
  const first = value[0];
  const last = value[value.length - 1];
  if ((first === `"` && last === `"`) || (first === `'` && last === `'`)) {
    return value.slice(1, -1);
  }
  return value;
}

export function normalizeElevenLabsApiKey(value: unknown): string | null {
  if (typeof value !== "string") {return null;}
  const trimmed = value.trim();
  if (!trimmed) {return null;}
  const unquoted = stripSurroundingQuotes(trimmed).trim();
  return unquoted.length > 0 ? unquoted : null;
}

function extractProviderErrorMessage(data: unknown): string | undefined {
  if (!data) {return undefined;}
  if (typeof data === "string") {
    const msg = data.trim();
    return msg.length > 0 ? msg.slice(0, 500) : undefined;
  }
  if (typeof data !== "object") {return undefined;}

  const record = data as Record<string, unknown>;
  const candidates = [
    record.detail,
    record.message,
    record.error,
    record.error_message,
    record.reason,
  ];
  for (const c of candidates) {
    if (typeof c === "string" && c.trim().length > 0) {return c.trim().slice(0, 500);}
  }

  return undefined;
}

function toSafeAxiosFailureMessage(params: {
  provider: "elevenlabs" | "audio-download";
  operation: string;
  error: unknown;
}): string {
  const prefix =
    params.provider === "elevenlabs"
      ? `ElevenLabs ${params.operation} failed`
      : `Audio ${params.operation} failed`;

  if (!axios.isAxiosError(params.error)) {
    const msg =
      params.error instanceof Error ? params.error.message : String(params.error);
    return `${prefix}: ${msg}`;
  }

  const status =
    typeof params.error.response?.status === "number"
      ? params.error.response.status
      : undefined;
  const code = typeof params.error.code === "string" ? params.error.code : undefined;
  const providerMessage = extractProviderErrorMessage(params.error.response?.data);

  const parts: string[] = [prefix];
  if (typeof status === "number") {parts.push(`status=${status}`);}
  if (code) {parts.push(`code=${code}`);}
  if (providerMessage) {parts.push(`provider_message=${providerMessage}`);}

  if (status === 401 && params.provider === "elevenlabs") {
    parts.push("(Unauthorized — check ELEVENLABS_API_KEY)");
  }

  return parts.join(" ");
}

export class TranscriptionService {
  private elevenLabsApiKey: string;
  private cache: Map<string, Transcription>;

  constructor(apiKey: string) {
    const normalized = normalizeElevenLabsApiKey(apiKey);
    if (!normalized) {
      throw new Error("ElevenLabs API key not configured (ELEVENLABS_API_KEY)");
    }
    this.elevenLabsApiKey = normalized;
    // In-memory cache only. Persistent caching is handled by the database layer.
    this.cache = new Map();
  }

  async transcribe(url: string): Promise<Transcription> {
    // Vérifier cache
    if (this.cache.has(url)) {
      logger.debug("Using in-memory transcription cache", {
        transcription_id: this.cache.get(url)?.transcription_id,
      });
      return this.cache.get(url)!;
    }

    logger.debug("Downloading audio for transcription");
    let audioResponse: { data: ArrayBuffer };
    try {
      audioResponse = await axios.get(url, { responseType: "arraybuffer" });
    } catch (error: unknown) {
      // IMPORTANT: never rethrow raw AxiosError (may include full URL + secrets in logs)
      throw new Error(
        toSafeAxiosFailureMessage({
          provider: "audio-download",
          operation: "download",
          error,
        })
      );
    }

    logger.info("Calling ElevenLabs speech-to-text");

    const formData = new FormData();
    const blob = new Blob([audioResponse.data], { type: "audio/mpeg" });
    formData.append("file", blob, "audio.mp3");
    formData.append("model_id", "scribe_v1");
    formData.append("language_code", "fra");
    formData.append("timestamps_granularity", "word");
    formData.append("diarize", "true");

    let response: { data: unknown };
    try {
      response = await axios.post("https://api.elevenlabs.io/v1/speech-to-text", formData, {
        headers: {
          "xi-api-key": this.elevenLabsApiKey,
        },
      });
    } catch (error: unknown) {
      // IMPORTANT: never rethrow raw AxiosError (may include request headers in logs)
      throw new Error(
        toSafeAxiosFailureMessage({
          provider: "elevenlabs",
          operation: "speech-to-text",
          error,
        })
      );
    }

    if (typeof response.data !== "object" || response.data === null) {
      throw new Error("ElevenLabs response invalid (expected JSON object)");
    }

    const data = response.data as Record<string, unknown>;

    const transcriptionId =
      typeof data.transcription_id === "string" && data.transcription_id.trim().length > 0
        ? data.transcription_id
        : undefined;

    const text = typeof data.text === "string" ? data.text : "";
    const languageCode =
      typeof data.language_code === "string" && data.language_code.trim().length > 0
        ? data.language_code
        : undefined;
    const languageProbability =
      typeof data.language_probability === "number" && Number.isFinite(data.language_probability)
        ? data.language_probability
        : undefined;

    type Word = Transcription["transcription"]["words"][number];
    const parseWords = (value: unknown): Word[] => {
      if (!Array.isArray(value)) {return [];}
      const out: Word[] = [];
      for (const w of value) {
        if (typeof w !== "object" || w === null) {continue;}
        const r = w as Record<string, unknown>;
        const wText = typeof r.text === "string" ? r.text : null;
        const wStart = typeof r.start === "number" && Number.isFinite(r.start) ? r.start : null;
        const wEnd = typeof r.end === "number" && Number.isFinite(r.end) ? r.end : null;
        const wType = typeof r.type === "string" ? r.type : null;
        if (wText === null || wStart === null || wEnd === null || wType === null) {continue;}

        const word: Word = {
          text: wText,
          start: wStart,
          end: wEnd,
          type: wType,
          ...(typeof r.speaker_id === "string" ? { speaker_id: r.speaker_id } : {}),
          ...(typeof r.logprob === "number" && Number.isFinite(r.logprob) ? { logprob: r.logprob } : {}),
        };
        out.push(word);
      }
      return out;
    };

    const transcription: Transcription = {
      recording_url: url,
      transcription_id: transcriptionId,
      call_id: "",
      recording: null,
      transcription: {
        text,
        ...(languageCode ? { language_code: languageCode } : {}),
        ...(languageProbability !== undefined
          ? { language_probability: languageProbability }
          : {}),
        words: parseWords(data.words),
      },
    };

    // Cache
    this.cache.set(url, transcription);

    logger.info("ElevenLabs transcription complete", {
      words: transcription.transcription.words.length,
      transcription_id: transcriptionId ?? null,
    });

    return transcription;
  }

  async transcribeAll(recordings: RecordingInput[]): Promise<Transcription[]> {
    logger.info("Parallel transcription of recordings", {
      recordings: recordings.length,
    });

    const concurrency = Math.max(
      1,
      Number(process.env.TRANSCRIPTION_RECORDING_CONCURRENCY || 2)
    );

    const results = await mapWithConcurrency(recordings, concurrency, async (recording, i) => {
      const recordingName = recording.recording_url
        ? recording.recording_url.split("/").pop()
        : recording.call_id || "unknown";

      logger.debug("Recording transcription started", {
        index: i + 1,
        total: recordings.length,
        recording: recordingName,
      });

      try {
        // Handle both recordingUrl (DB) and recording_url (API) formats
        const url = recording.recording_url || recording.recordingUrl;

        if (!url) {
          logger.warn("No recording URL; skipping", { recording: recordingName });
          return null;
        }

        const transcription = await this.transcribe(url);
        // ALWAYS attach full recording object for metadata (even if from cache)
        // This ensures we have access to parsed date/time/phone numbers
        transcription.recording = recording;
        transcription.call_id = recording.call_id || recording.callId;

        logger.debug("Recording transcription completed", {
          index: i + 1,
          total: recordings.length,
          recording: recordingName,
        });
        return transcription;
      } catch (error) {
        logger.error("Recording transcription failed", {
          index: i + 1,
          total: recordings.length,
          recording: recordingName,
          error: error instanceof Error ? error.message : String(error),
        });
        return null;
      }
    });
    const transcriptions = results.filter((t): t is Transcription => t !== null);

    logger.info("Transcription batch complete", {
      successful: transcriptions.length,
      total: recordings.length,
    });

    return transcriptions;
  }
}
