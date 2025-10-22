/**
 * Inngest Function Types
 * ======================
 * Strict type definitions for Inngest workflows
 */

import type { FicheCache } from "@prisma/client";

/**
 * Transcription Status (matches getFicheTranscriptionStatus return type)
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
 * Helper to check if all recordings are transcribed
 */
export function isFullyTranscribed(status: TranscriptionStatus): boolean {
  return status.total > 0 && status.transcribed === status.total;
}

/**
 * Transcription Result (matches transcribeFicheRecordings return type)
 */
export interface TranscriptionResult {
  total: number;
  transcribed: number;
  newTranscriptions: number;
  results?: Array<{
    callId: string;
    transcriptionId?: string;
  }>;
  error?: string;
}

/**
 * Extended Transcription Result for function return
 */
export interface ExtendedTranscriptionResult extends TranscriptionResult {
  success: boolean;
  fiche_id: string;
  cached: boolean;
  failed?: number;
}

/**
 * Audit Result from audit-runner service
 */
export interface AuditResult {
  audit: {
    id: bigint;
    config: {
      id: string;
      name: string;
      description?: string;
    };
    fiche: {
      fiche_id: string;
      prospect_name: string;
      groupe: string;
    };
    results: any;
    compliance: {
      score: number;
      niveau: string;
      points_critiques: string;
      poids_obtenu: number;
      poids_total: number;
    };
  };
  statistics: {
    recordings_count: number;
    transcriptions_count: number;
    timeline_chunks: number;
    successful_steps: number;
    failed_steps: number;
    total_time_seconds: number;
    total_tokens: number;
  };
  metadata: {
    started_at: string;
    completed_at: string;
    duration_ms: number;
  };
}

/**
 * Saved audit result with ID
 */
export interface SavedAuditResult {
  id: bigint;
  audit: AuditResult["audit"];
  statistics: AuditResult["statistics"];
  metadata: AuditResult["metadata"];
}

/**
 * Fiche Fetch Result
 */
export interface FicheFetchResult {
  success: boolean;
  cached: boolean;
  fiche_id: string;
  cache_id: string;
  recordings_count: number;
  message?: string;
}

/**
 * Batch Transcription Result
 */
export interface BatchTranscriptionResult {
  success: boolean;
  batch_size: number;
  results: ExtendedTranscriptionResult[];
}

/**
 * Audit Function Result
 */
export interface AuditFunctionResult {
  success: boolean;
  fiche_id: string;
  audit_id: string;
  audit_config_id: number;
  score: number;
  niveau: string;
  duration_ms: number;
}

/**
 * Batch Audit Result
 */
export interface BatchAuditResult {
  success: boolean;
  total_fiches: number;
  audit_config_id: number;
  total: number;
  succeeded: number;
  failed: number;
}
