/**
 * Schémas Zod pour l'Audit
 * =========================
 * Définitions type-safe pour toutes les structures de données
 */

import { z } from "zod";

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

// Types TypeScript inférés
export type EvidenceCitation = z.infer<typeof EvidenceCitationSchema>;
export type ControlPoint = z.infer<typeof ControlPointSchema>;
export type AuditStep = z.infer<typeof AuditStepSchema>;
export type EnhancedQuery = z.infer<typeof EnhancedQuerySchema>;
