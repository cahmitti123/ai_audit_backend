/**
 * Zod Schemas & Type Definitions
 * ===============================
 * All schemas and types inferred from Zod (single source of truth)
 */

import { z } from "zod";

// ═══════════════════════════════════════════════════════════════════════════════
// TRANSCRIPTION TYPES
// ═══════════════════════════════════════════════════════════════════════════════

export const TranscriptionWordSchema = z.object({
  text: z.string(),
  start: z.number(),
  end: z.number(),
  type: z.string(),
  speaker_id: z.string().optional(),
  logprob: z.number().optional(),
});

export const TranscriptionSchema = z.object({
  recording_url: z.string(),
  transcription_id: z.string().optional(),
  call_id: z.string().optional(),
  recording: z.any(),
  transcription: z.object({
    text: z.string(),
    language_code: z.string().optional(),
    language_probability: z.number().optional(),
    words: z.array(TranscriptionWordSchema),
  }),
});

export const ConversationChunkSchema = z.object({
  chunk_index: z.number().int(),
  start_timestamp: z.number(),
  end_timestamp: z.number(),
  message_count: z.number().int(),
  speakers: z.array(z.string()),
  full_text: z.string(),
});

export const TimelineRecordingSchema = z.object({
  recording_index: z.number().int(),
  call_id: z.string().optional(),
  start_time: z.string().optional(),
  duration_seconds: z.number().optional(),
  recording_url: z.string(),
  recording_date: z.string().optional(),
  recording_time: z.string().optional(),
  from_number: z.string().optional(),
  to_number: z.string().optional(),
  total_chunks: z.number().int(),
  chunks: z.array(ConversationChunkSchema),
});

// ═══════════════════════════════════════════════════════════════════════════════
// AUDIT TYPES
// ═══════════════════════════════════════════════════════════════════════════════

export const AuditStepConfigSchema = z.object({
  position: z.number().int(),
  name: z.string(),
  description: z.string(),
  prompt: z.string(),
  controlPoints: z.array(z.string()),
  keywords: z.array(z.string()),
  severityLevel: z.enum(["CRITICAL", "HIGH", "MEDIUM", "LOW"]),
  isCritical: z.boolean(),
  chronologicalImportant: z.boolean(),
  weight: z.number().int(),
});

export const AuditConfigSchema = z.object({
  name: z.string(),
  description: z.string(),
  systemPrompt: z.string(),
  version: z.string(),
  totalSteps: z.number().int(),
  isActive: z.boolean(),
  auditSteps: z.array(AuditStepConfigSchema),
});

// Citation avec traçabilité complète
export const EvidenceCitationSchema = z.object({
  texte: z.string().describe("Citation exacte de la conversation"),
  minutage: z.string().describe("Format MM:SS"),
  minutage_secondes: z.number().describe("Timestamp en secondes"),
  speaker: z.string().describe("speaker_0, speaker_1, etc."),
  recording_index: z.number().int().describe("Index enregistrement (0-based)"),
  chunk_index: z.number().int().describe("Index chunk (0-based)"),
  recording_date: z
    .string()
    .describe("Date DD/MM/YYYY depuis l'en-tête de l'enregistrement"),
  recording_time: z
    .string()
    .describe("Heure HH:MM depuis l'en-tête de l'enregistrement"),
  recording_url: z
    .string()
    .describe(
      "URL complète de l'enregistrement audio (sera enrichi automatiquement). Indiquez 'N/A' si inconnue lors de l'analyse, sera mise à jour après."
    ),
});

// Point de contrôle avec preuves
export const ControlPointSchema = z.object({
  point: z.string(),
  statut: z.enum(["PRESENT", "ABSENT", "PARTIEL", "NON_APPLICABLE"]),
  commentaire: z.string(),
  citations: z.array(EvidenceCitationSchema).describe("Citations spécifiques"),
  minutages: z.array(z.string()),
  erreur_transcription_notee: z.boolean(),
  variation_phonetique_utilisee: z.string().nullable(),
});

// Résultat d'une étape d'audit
export const AuditStepSchema = z.object({
  traite: z.boolean(),
  conforme: z.enum(["CONFORME", "NON_CONFORME", "PARTIEL"]),
  minutages: z.array(z.string()),
  score: z
    .number()
    .int()
    .min(0)
    .describe("Points obtenus (peut dépasser le poids si bonus)"),
  points_controle: z.array(ControlPointSchema),
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

// Schéma pour query enhancement
export const EnhancedQuerySchema = z.object({
  original_query: z.string().describe("Query originale"),
  enhanced_query: z.string().describe("Query optimisée"),
  search_keywords: z.array(z.string()).describe("Mots-clés alternatifs"),
  phonetic_variations: z.array(z.string()).describe("Variations phonétiques"),
  context_hints: z.array(z.string()).describe("Indices contextuels"),
  probable_speakers: z.array(z.string()).describe("Speakers probables"),
});

// ═══════════════════════════════════════════════════════════════════════════════
// INFERRED TYPESCRIPT TYPES (Single Source of Truth)
// ═══════════════════════════════════════════════════════════════════════════════

export type TranscriptionWord = z.infer<typeof TranscriptionWordSchema>;
export type Transcription = z.infer<typeof TranscriptionSchema>;
export type ConversationChunk = z.infer<typeof ConversationChunkSchema>;
export type TimelineRecording = z.infer<typeof TimelineRecordingSchema>;
export type AuditStep = z.infer<typeof AuditStepConfigSchema>;
export type AuditConfig = z.infer<typeof AuditConfigSchema>;
export type EvidenceCitation = z.infer<typeof EvidenceCitationSchema>;
export type ControlPoint = z.infer<typeof ControlPointSchema>;
export type AuditStepResult = z.infer<typeof AuditStepSchema>;
export type EnhancedQuery = z.infer<typeof EnhancedQuerySchema>;
