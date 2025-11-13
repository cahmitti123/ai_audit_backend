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
// CHAT TYPES
// ═══════════════════════════════════════════════════════════════════════════════

export const ChatCitationSchema = z.object({
  texte: z.string().describe("Quoted text from the conversation"),
  minutage: z.string().describe("Timestamp in MM:SS format"),
  minutage_secondes: z.number().describe("Timestamp in seconds"),
  speaker: z.string().describe("Speaker ID (speaker_0, speaker_1, etc.)"),
  recording_index: z.number().int().describe("Recording index (0-based)"),
  chunk_index: z.number().int().describe("Chunk index (0-based)"),
  recording_date: z.string().describe("Recording date DD/MM/YYYY"),
  recording_time: z.string().describe("Recording time HH:MM"),
  recording_url: z.string().describe("URL of the recording"),
});

export type ChatCitation = z.infer<typeof ChatCitationSchema>;

export const ChatMessageSchema = z.object({
  role: z.enum(["user", "assistant", "system"]),
  content: z.string(),
  citations: z.array(ChatCitationSchema).optional(),
});

export type ChatMessage = z.infer<typeof ChatMessageSchema>;

// ═══════════════════════════════════════════════════════════════════════════════
// AUTOMATION TYPES
// ═══════════════════════════════════════════════════════════════════════════════

export const ScheduleTypeSchema = z.enum([
  "MANUAL",
  "DAILY",
  "WEEKLY",
  "MONTHLY",
  "CRON",
]);

export const FicheSelectionSchema = z.object({
  mode: z.enum(["date_range", "manual", "filter"]),
  dateRange: z
    .enum(["last_24h", "yesterday", "last_week", "last_month", "custom"])
    .optional(),
  customStartDate: z.string().optional(),
  customEndDate: z.string().optional(),
  groupes: z.array(z.string()).optional(),
  onlyWithRecordings: z.boolean().optional().default(false),
  onlyUnaudited: z.boolean().optional().default(false),
  maxFiches: z.number().int().positive().optional(),
  ficheIds: z.array(z.string()).optional(),
});

export const AutomationScheduleCreateSchema = z.object({
  name: z.string().min(1).max(255),
  description: z.string().optional(),
  isActive: z.boolean().default(true),
  createdBy: z.string().optional(),

  // Schedule Configuration
  scheduleType: ScheduleTypeSchema,
  cronExpression: z.string().optional(),
  timezone: z.string().default("UTC"),
  timeOfDay: z
    .string()
    .regex(/^\d{2}:\d{2}$/)
    .optional(), // HH:MM
  dayOfWeek: z.number().int().min(0).max(6).optional(),
  dayOfMonth: z.number().int().min(1).max(31).optional(),

  // Fiche Selection
  ficheSelection: FicheSelectionSchema,

  // Transcription Configuration
  runTranscription: z.boolean().default(true),
  skipIfTranscribed: z.boolean().default(true),
  transcriptionPriority: z.enum(["low", "normal", "high"]).default("normal"),

  // Audit Configuration
  runAudits: z.boolean().default(true),
  useAutomaticAudits: z.boolean().default(true),
  specificAuditConfigs: z.preprocess((val) => {
    if (!val || !Array.isArray(val)) return undefined;
    // Filter out null/undefined values and convert strings to numbers
    const filtered = val
      .filter((id: any) => id !== null && id !== undefined && id !== "")
      .map((id: any) => {
        if (typeof id === "string") return parseInt(id, 10);
        return id;
      });
    // Return undefined if array is empty after filtering
    return filtered.length > 0 ? filtered : undefined;
  }, z.array(z.number().int()).optional()),

  // Error Handling
  continueOnError: z.boolean().default(true),
  retryFailed: z.boolean().default(false),
  maxRetries: z.number().int().min(0).max(5).default(0),

  // Notifications
  notifyOnComplete: z.boolean().default(true),
  notifyOnError: z.boolean().default(true),
  webhookUrl: z.preprocess(
    (val) => (!val || val === "" ? undefined : val),
    z.string().url().optional()
  ),
  notifyEmails: z.preprocess((val) => {
    if (!val || !Array.isArray(val)) return [];
    return val.filter((email: any) => email && email.trim() !== "");
  }, z.array(z.string().email()).optional()),

  // External API
  externalApiKey: z.string().optional(),
});

export const AutomationScheduleUpdateSchema =
  AutomationScheduleCreateSchema.partial();

export const AutomationScheduleResponseSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  isActive: z.boolean(),
  createdBy: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
  scheduleType: ScheduleTypeSchema,
  cronExpression: z.string().nullable(),
  timezone: z.string(),
  timeOfDay: z.string().nullable(),
  dayOfWeek: z.number().nullable(),
  dayOfMonth: z.number().nullable(),
  ficheSelection: FicheSelectionSchema,
  runTranscription: z.boolean(),
  skipIfTranscribed: z.boolean(),
  transcriptionPriority: z.string(),
  runAudits: z.boolean(),
  useAutomaticAudits: z.boolean(),
  specificAuditConfigs: z.array(z.number()),
  continueOnError: z.boolean(),
  retryFailed: z.boolean(),
  maxRetries: z.number(),
  notifyOnComplete: z.boolean(),
  notifyOnError: z.boolean(),
  webhookUrl: z.string().nullable(),
  notifyEmails: z.array(z.string()),
  externalApiKey: z.string().nullable(),
  lastRunAt: z.string().nullable(),
  lastRunStatus: z.string().nullable(),
  totalRuns: z.number(),
  successfulRuns: z.number(),
  failedRuns: z.number(),
});

export const AutomationRunResponseSchema = z.object({
  id: z.string(),
  scheduleId: z.string(),
  status: z.string(),
  startedAt: z.string(),
  completedAt: z.string().nullable(),
  durationMs: z.number().nullable(),
  totalFiches: z.number(),
  successfulFiches: z.number(),
  failedFiches: z.number(),
  transcriptionsRun: z.number(),
  auditsRun: z.number(),
  errorMessage: z.string().nullable(),
  errorDetails: z.any().nullable(),
  configSnapshot: z.any(),
  resultSummary: z.any().nullable(),
});

export const TriggerAutomationSchema = z.object({
  scheduleId: z.number().int().positive(),
  overrideFicheSelection: FicheSelectionSchema.optional(),
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
export type ScheduleType = z.infer<typeof ScheduleTypeSchema>;
export type FicheSelection = z.infer<typeof FicheSelectionSchema>;
export type AutomationScheduleCreate = z.infer<
  typeof AutomationScheduleCreateSchema
>;
export type AutomationScheduleUpdate = z.infer<
  typeof AutomationScheduleUpdateSchema
>;
export type AutomationScheduleResponse = z.infer<
  typeof AutomationScheduleResponseSchema
>;
export type AutomationRunResponse = z.infer<typeof AutomationRunResponseSchema>;
export type TriggerAutomation = z.infer<typeof TriggerAutomationSchema>;
