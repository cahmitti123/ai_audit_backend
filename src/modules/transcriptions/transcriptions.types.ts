/**
 * Transcriptions Types
 * ====================
 * Type definitions for transcription operations
 */

/**
 * Transcription Status
 */
export interface TranscriptionStatus {
  ficheId: string;
  total: number;
  transcribed: number;
  pending: number;
  percentage: number;
  recordings: Array<{
    callId: string;
    hasTranscription: boolean;
    transcriptionId: string | null;
    transcribedAt: Date | null;
    recordingDate: string | null;
    recordingTime: string | null;
    durationSeconds: number | null;
  }>;
}

/**
 * Check if all recordings are transcribed
 */
export function isFullyTranscribed(status: TranscriptionStatus): boolean {
  return status.total > 0 && status.transcribed === status.total;
}

/**
 * Transcription Result
 */
export interface TranscriptionResult {
  total: number;
  transcribed: number;
  newTranscriptions: number;
  failed?: number;
  results?: Array<{
    callId: string;
    transcriptionId?: string;
  }>;
  error?: string;
}

/**
 * Extended Transcription Result for workflow functions
 */
export interface ExtendedTranscriptionResult extends TranscriptionResult {
  success: boolean;
  fiche_id: string;
  cached: boolean;
  failed?: number;
}

/**
 * Batch Transcription Result
 */
export interface BatchTranscriptionResult {
  success: boolean;
  batch_size: number;
  results: ExtendedTranscriptionResult[];
}
