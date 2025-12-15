/**
 * Service de Transcription
 * =========================
 * Transcrit les audios avec ElevenLabs et cache les résultats
 */

import axios from "axios";
import { Transcription } from "../../schemas.js";
import { mapWithConcurrency } from "../../utils/concurrency.js";
import { logger } from "../../shared/logger.js";

type RecordingInput = {
  recording_url?: string | null;
  recordingUrl?: string | null;
  call_id?: string;
  callId?: string;
  [key: string]: unknown;
};

export class TranscriptionService {
  private elevenLabsApiKey: string;
  private cache: Map<string, Transcription>;

  constructor(apiKey: string) {
    this.elevenLabsApiKey = apiKey;
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
    const audioResponse = await axios.get(url, { responseType: "arraybuffer" });

    logger.info("Calling ElevenLabs speech-to-text");

    const formData = new FormData();
    const blob = new Blob([audioResponse.data], { type: "audio/mpeg" });
    formData.append("file", blob, "audio.mp3");
    formData.append("model_id", "scribe_v1");
    formData.append("language_code", "fra");
    formData.append("timestamps_granularity", "word");
    formData.append("diarize", "true");

    const response = await axios.post(
      "https://api.elevenlabs.io/v1/speech-to-text",
      formData,
      {
        headers: {
          "xi-api-key": this.elevenLabsApiKey,
        },
      }
    );

    const transcription: Transcription = {
      recording_url: url,
      transcription_id: response.data.transcription_id,
      call_id: "",
      recording: null,
      transcription: {
        text: response.data.text,
        language_code: response.data.language_code,
        language_probability: response.data.language_probability,
        words: response.data.words || [],
      },
    };

    // Cache
    this.cache.set(url, transcription);

    logger.info("ElevenLabs transcription complete", {
      words: response.data.words?.length || 0,
      transcription_id: response.data.transcription_id,
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
