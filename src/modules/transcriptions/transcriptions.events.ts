/**
 * Transcriptions Events
 * ======================
 * Event type definitions for the transcriptions domain
 */

/**
 * Transcription Events
 */
export type TranscriptionsEvents = {
  "fiche/transcribe": {
    fiche_id: string;
    priority?: "high" | "normal" | "low";
    user_id?: string;
  };
  "fiche/transcribed": {
    fiche_id: string;
    transcribed_count: number;
    cached_count: number;
    failed_count: number;
    duration_ms?: number;
  };
};
