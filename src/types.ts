/**
 * Types TypeScript pour tout le système
 */

import { z } from "zod";

// ═══════════════════════════════════════════════════════════════════════════════
// API RESPONSES (Input)
// ═══════════════════════════════════════════════════════════════════════════════

export interface RecordingInfo {
  call_id: string;
  start_time: string;
  duration_seconds: number;
  direction: "in" | "out";
  from_number: string;
  to_number: string;
  answered: boolean;
  recording_url: string;
}

export interface APIResponse {
  success: boolean;
  message: string;
  recordings: RecordingInfo[];
}

// ═══════════════════════════════════════════════════════════════════════════════
// TRANSCRIPTION
// ═══════════════════════════════════════════════════════════════════════════════

export interface TranscriptionWord {
  text: string;
  start: number;
  end: number;
  type: string;
  speaker_id?: string;
  logprob?: number;
}

export interface Transcription {
  recording_url: string;
  transcription_id?: string;
  call_id?: string;
  uuid?: string;
  date?: string;
  time?: string;
  phone_number_1?: string;
  phone_number_2?: string;
  recording: any; // Recording object from API
  transcription: {
    text: string;
    language_code?: string;
    language_probability?: number;
    words: TranscriptionWord[];
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// TIMELINE
// ═══════════════════════════════════════════════════════════════════════════════

export interface ConversationChunk {
  chunk_index: number;
  start_timestamp: number;
  end_timestamp: number;
  message_count: number;
  speakers: string[];
  full_text: string;
}

export interface TimelineRecording {
  recording_index: number;
  call_id?: string;
  start_time?: string;
  duration_seconds?: number;
  recording_url: string;
  recording_date?: string;
  recording_time?: string;
  from_number?: string;
  to_number?: string;
  total_chunks: number;
  chunks: ConversationChunk[];
}

// ═══════════════════════════════════════════════════════════════════════════════
// AUDIT CONFIG
// ═══════════════════════════════════════════════════════════════════════════════

export interface AuditStep {
  position: number;
  name: string;
  description: string;
  prompt: string;
  controlPoints: string[];
  keywords: string[];
  severityLevel: "CRITICAL" | "HIGH" | "MEDIUM" | "LOW";
  isCritical: boolean;
  chronologicalImportant: boolean;
  weight: number;
}

export interface AuditConfig {
  name: string;
  description: string;
  systemPrompt: string;
  version: string;
  totalSteps: number;
  isActive: boolean;
  auditSteps: AuditStep[];
  automaticRejectionCriteria: Array<{
    criterion: string;
    severity: string;
    reason: string;
  }>;
}

// ═══════════════════════════════════════════════════════════════════════════════
// EVIDENCE & AUDIT RESULTS (Zod Schemas)
// ═══════════════════════════════════════════════════════════════════════════════

export const EvidenceCitationSchema = z.object({
  texte: z.string(),
  minutage: z.string(),
  minutage_secondes: z.number(),
  speaker: z.string(),
  recording_index: z.number().int(),
  chunk_index: z.number().int(),
  recording_date: z.string(),
  recording_time: z.string(),
});

export const ControlPointResultSchema = z.object({
  point: z.string(),
  statut: z.enum(["PRESENT", "ABSENT", "PARTIEL", "NON_APPLICABLE"]),
  commentaire: z.string(),
  citations: z.array(EvidenceCitationSchema),
  minutages: z.array(z.string()),
  erreur_transcription_notee: z.boolean(),
  variation_phonetique_utilisee: z.string().nullable(),
});

export const CheckpointAuditResultSchema = z.object({
  checkpoint_name: z.string(),
  checkpoint_index: z.number().int(),
  step_position: z.number().int(),
  result: ControlPointResultSchema,
  query_used: z.string(),
  enhanced_query: z.string().optional(),
  analysis_tokens: z.number().int(),
});

export const StepAuditResultSchema = z.object({
  traite: z.boolean(),
  conforme: z.enum(["CONFORME", "NON_CONFORME", "PARTIEL"]),
  minutages: z.array(z.string()),
  score: z.number().int().min(0).max(10),
  points_controle: z.array(ControlPointResultSchema),
  mots_cles_trouves: z.array(z.string()),
  commentaire_global: z.string(),
  niveau_conformite: z.enum([
    "EXCELLENT",
    "BON",
    "ACCEPTABLE",
    "INSUFFISANT",
    "REJET",
  ]),
  erreurs_transcription_tolerees: z.number().int(),
});

// ═══════════════════════════════════════════════════════════════════════════════
// AGENT MESSAGES
// ═══════════════════════════════════════════════════════════════════════════════

export interface QueryEnhancementRequest {
  checkpoint_name: string;
  checkpoint_index: number;
  step: AuditStep;
  timeline: TimelineRecording[];
}

export interface QueryEnhancementResult {
  original_query: string;
  enhanced_query: string;
  search_keywords: string[];
  phonetic_variations: string[];
  context_hints: string[];
  probable_speakers: string[];
}

export interface CheckpointAnalysisRequest {
  checkpoint_name: string;
  checkpoint_index: number;
  step: AuditStep;
  enhanced_query: QueryEnhancementResult;
  timeline_text: string;
}

export interface CheckpointAnalysisResult {
  checkpoint_name: string;
  result: z.infer<typeof ControlPointResultSchema>;
  query_used: string;
  tokens_used: number;
}

// Types inférés
export type EvidenceCitation = z.infer<typeof EvidenceCitationSchema>;
export type ControlPointResult = z.infer<typeof ControlPointResultSchema>;
export type CheckpointAuditResult = z.infer<typeof CheckpointAuditResultSchema>;
export type StepAuditResult = z.infer<typeof StepAuditResultSchema>;
