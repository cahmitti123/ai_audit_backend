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
    /**
     * If false, the workflow will enqueue per-recording work and return quickly.
     * If true/undefined, it will wait (durably) for the fiche to finish transcribing.
     *
     * Default: true (keeps backwards-compatible behaviour for callers that need the result,
     * like the audit workflow).
     */
    wait_for_completion?: boolean;
  };
  "fiche/transcribed": {
    fiche_id: string;
    transcribed_count: number;
    cached_count: number;
    failed_count: number;
    duration_ms?: number;
  };

  /**
   * Fan-out event: transcribe a single recording (distributed across replicas).
   */
  "transcription/recording.transcribe": {
    /**
     * Transcription run identifier (used for distributed aggregation/finalization).
     */
    run_id: string;
    fiche_id: string;
    fiche_cache_id?: string; // BigInt serialized as string
    call_id: string;
    recording_url?: string;
    recording_index: number; // 1-based within "to_transcribe" list for this run
    total_to_transcribe: number;
    priority?: "high" | "normal" | "low";
  };

  /**
   * Emitted by the per-recording worker when it finishes (success, cached/skip, or failure).
   * Used to drive the per-fiche finalizer without DB polling.
   */
  "transcription/recording.transcribed": {
    run_id: string;
    fiche_id: string;
    call_id: string;
    ok: boolean;
    cached: boolean;
    error?: string;
    transcription_id?: string;
    recording_index: number;
    total_to_transcribe: number;
  };
};
