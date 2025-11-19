/**
 * Fiches Schemas
 * ==============
 * RESPONSIBILITY: Type definitions and validation
 * - Zod schemas for API responses
 * - Type exports (inferred from Zod)
 * - Runtime validators
 * - No business logic
 *
 * LAYER: Foundation (Types & Validation)
 */

import { z } from "zod";
import { logger } from "../../shared/logger.js";

// ═══════════════════════════════════════════════════════════════════════════
// SALES FICHE SCHEMA (Base schema for sales items)
// ═══════════════════════════════════════════════════════════════════════════

export const salesFicheSchema = z.object({
  id: z.string(),
  cle: z.string().nullable(),
  nom: z.string(),
  prenom: z.string(),
  telephone: z.string(),
  telephone_2: z.string().nullable(),
  email: z.string(),
  statut: z.string(),
  date_insertion: z.string(),
  date_modification: z.string().nullable(),
});

// ═══════════════════════════════════════════════════════════════════════════
// FICHE DETAILS SCHEMAS (GET /fiches/by-id/{ficheId})
// ═══════════════════════════════════════════════════════════════════════════

export const informationSchema = z.object({
  fiche_id: z.string(),
  cle: z.string(),
  date_insertion: z.string(),
  createur: z.string().nullable(),
  fiches_associees: z.string().nullable(),
  nombre_acces: z.number(),
  dernier_acces: z.string(),
  groupe: z.string(),
  groupe_responsable: z.string().nullable(),
  groupe_gestion: z.string().nullable(),
  groupe_reclamation: z.string().nullable(),
  agence_id: z.string(),
  agence_nom: z.string(),
  attribution_user_id: z.string(),
  attribution_user_nom: z.string(),
  provenance_id: z.string(),
  provenance_nom: z.string(),
  provenance_numero: z.string().nullable(),
  provenance_periode_rappel: z.string().nullable(),
  origine_id: z.string().nullable(),
  origine_nom: z.string().nullable(),
  attribution_bis_user_id: z.string().nullable(),
  attribution_bis_user_nom: z.string().nullable(),
  refus_demarchage: z.boolean(),
  exception_demarchage: z.boolean(),
  exception_demarchage_commentaire: z.string().nullable(),
  niveau_interet: z.number().nullable(),
  nombre_ouverture_mails: z.number(),
  derniere_ouverture_mail: z.string().nullable(),
  nombre_visualisation_pages: z.number(),
  derniere_visualisation_page: z.string().nullable(),
  espace_prospect_url: z.string().nullable(),
  ferme_espace_prospect: z.boolean(),
  desinscription_mail: z.boolean(),
  corbeille: z.boolean(),
  archive: z.boolean(),
  modules: z.array(z.string()),
  etiquettes: z.array(
    z.object({
      nom: z.string(),
      date: z.string(),
      style: z.string(),
    })
  ),
});

export const prospectSchema = z.object({
  prospect_id: z.string(),
  civilite: z.number(),
  civilite_text: z.string(),
  nom: z.string(),
  prenom: z.string(),
  date_naissance: z.string(),
  regime: z.string(),
  regime_text: z.string(),
  telephone: z.string().nullable(),
  mobile: z.string().nullable(),
  telephone_2: z.string().nullable(),
  mail: z.string().nullable(),
  mail_2: z.string().nullable(),
  adresse: z.string().nullable(),
  code_postal: z.string().nullable(),
  ville: z.string().nullable(),
  num_secu: z.string().nullable(),
  num_affiliation: z.string().nullable(),
  situation_familiale: z.number().nullable(),
  situation_familiale_text: z.string().nullable(),
  madelin: z.boolean(),
  profession: z.string().nullable(),
  csp: z.number().nullable(),
  csp_text: z.string().nullable(),
  fax: z.string().nullable(),
});

export const conjointSchema = z.object({
  conjoint_id: z.string(),
  civilite: z.number(),
  civilite_text: z.string(),
  nom: z.string(),
  prenom: z.string(),
  date_naissance: z.string(),
  regime: z.string().nullable(),
  regime_text: z.string().nullable(),
  telephone: z.string().nullable(),
  mobile: z.string().nullable(),
  mail: z.string().nullable(),
  profession: z.string().nullable(),
  csp: z.number().nullable(),
  csp_text: z.string().nullable(),
});

export const enfantSchema = z.object({
  enfant_id: z.string(),
  civilite: z.number(),
  civilite_text: z.string(),
  nom: z.string(),
  prenom: z.string(),
  date_naissance: z.string(),
  regime: z.string().nullable(),
  regime_text: z.string().nullable(),
});

export const mailSchema = z.object({
  date_envoi: z.string(),
  type_mail: z.string(),
  utilisateur: z.string(),
  visualisation_url: z.string().nullable(),
});

export const rendezVousSchema = z.object({
  rdv_id: z.string(),
  etiquette: z.string().nullable(),
  etiquette_color: z.string().nullable(),
  utilisateur: z.string(),
  date_debut: z.string(),
  date_fin: z.string().nullable(),
  commentaire: z.string().nullable(),
  statut: z.string().nullable(),
});

export const commentaireSchema = z.object({
  commentaire_id: z.string(),
  date: z.string(),
  utilisateur: z.string(),
  texte: z.string(),
});

export const ancienContratSchema = z.object({
  deja_assure: z.boolean(),
  plus_12_mois: z.boolean(),
  ria_requested: z.boolean(),
  assureur: z.string().nullable(),
  code_assureur: z.string().nullable(),
  adresse: z.string().nullable(),
  code_postal: z.string().nullable(),
  ville: z.string().nullable(),
  date_souscription: z.string().nullable(),
  date_echeance: z.string().nullable(),
  num_contrat: z.string().nullable(),
  formule: z.string().nullable(),
  cotisation: z.string().nullable(),
});

export const produitSchema = z.object({
  date_effet: z.string().nullable(),
  date_effet_modifiable: z.string().nullable(),
  formule: z.string().nullable(),
  groupe_nom: z.string().nullable(),
  gamme_nom: z.string().nullable(),
  formule_nom: z.string().nullable(),
  cotisation: z.string().nullable(),
  type_contrat: z.string().nullable(),
  type_client: z.string().nullable(),
  logo_url: z.string().nullable(),
  garanties_url: z.string().nullable(),
  dipa_url: z.string().nullable(),
  conditions_generales_url: z.string().nullable(),
  bulletin_adhesion_url: z.string().nullable(),
  devoir_conseil_url: z.string().nullable(),
});

export const compteTitulaireSchema = z.object({
  account_id: z.string().nullable(),
  titulaire_nom: z.string().nullable(),
  titulaire_prenom: z.string().nullable(),
  titulaire_adresse: z.string().nullable(),
  titulaire_cp: z.string().nullable(),
  titulaire_ville: z.string().nullable(),
});

export const paiementSchema = z.object({
  mode_paiement: z.string().nullable(),
  prelevement_le: z.string().nullable(),
  periodicite: z.string().nullable(),
  pas_coord_bancaires: z.boolean(),
  compte_prelevement: compteTitulaireSchema.nullable(),
  compte_virement: compteTitulaireSchema.nullable(),
});

export const elementsSouscriptionSchema = z.object({
  souscription_id: z.string().nullable(),
  date_souscription: z.string().nullable(),
  date_signature: z.string().nullable(),
  date_validation: z.string().nullable(),
  num_contrat: z.string().nullable(),
  annulation_contrat: z.boolean(),
  type_vente: z.string().nullable(),
  vente_a_froid: z.string().nullable(),
  vf_accept: z.string().nullable(),
  ancien_contrat: ancienContratSchema.nullable(),
  produit: produitSchema.nullable(),
  paiement: paiementSchema.nullable(),
  questions_complementaires: z.object({}).passthrough(),
  questions_conseil: z.object({}).passthrough(),
  raw_data: z.object({}).passthrough(),
});

export const formuleSchema = z.object({
  formule_id: z.string(),
  nom: z.string(),
  prix: z.string(),
  details: z.record(z.string(), z.string()),
});

export const gammeSchema = z.object({
  nom: z.string(),
  logo_url: z.string().nullable(),
  garanties_url: z.string().nullable(),
  conditions_generales_url: z.string().nullable(),
  bulletin_adhesion_url: z.string().nullable(),
  formules: z.array(formuleSchema),
});

export const tarificationSchema = z.object({
  nom: z.string(),
  gammes: z.array(gammeSchema),
});

export const reclamationSchema = z.object({
  reclamation_id: z.string(),
  date_creation: z.string(),
  assureur: z.string().nullable(),
  type_reclamation: z.string().nullable(),
  description: z.string().nullable(),
  statut: z.string().nullable(),
  date_traitement: z.string().nullable(),
  utilisateur_creation: z.string().nullable(),
  utilisateur_traitement: z.string().nullable(),
});

export const autreContratSchema = z.object({
  contrat_id: z.string(),
  type_contrat: z.string(),
  assureur: z.string().nullable(),
  numero_contrat: z.string().nullable(),
  date_souscription: z.string().nullable(),
  montant: z.string().nullable(),
  commentaire: z.string().nullable(),
});

export const documentSchema = z.object({
  document_id: z.string(),
  type: z.string(),
  nom: z.string(),
  taille: z.string(),
  date_creation: z.string(),
  selection_mail: z.boolean(),
  partage_prospect: z.boolean(),
  signer: z.boolean(),
  download_url: z.string().nullable(),
});

export const alerteSchema = z.object({
  alerte_id: z.string(),
  etat: z.string(),
  date: z.string(),
  etiquette: z.string().nullable(),
  libelle: z.string(),
  deposee_le: z.string(),
  deposee_par: z.string(),
  commentaire: z.string().nullable(),
  attribuee_a: z.string().nullable(),
  traitee_le: z.string().nullable(),
  traitee_par: z.string().nullable(),
  commentaire_traitement: z.string().nullable(),
});

export const conversationEntrySchema = z.object({
  time: z.string(),
  speaker: z.string(),
  text: z.string(),
});

export const transcriptionSchema = z.object({
  duration_formatted: z.string(),
  speakers: z.array(z.string()),
  conversation: z.union([z.string(), z.array(conversationEntrySchema)]),
});

export const recordingSchema = z.object({
  call_id: z.string(),
  start_time: z.string(),
  duration_seconds: z.number(),
  direction: z.string(),
  from_number: z.string(),
  to_number: z.string(),
  answered: z.boolean(),
  recording_url: z.string().nullable(),
  transcription: transcriptionSchema.nullable().optional(),
});

// ═══════════════════════════════════════════════════════════════════════════
// SALES WITH CALLS SCHEMAS (GET /fiches/sales-with-calls)
// Recordings array can be empty if includeRecordings=false
// ═══════════════════════════════════════════════════════════════════════════

export const salesFicheWithRecordingsSchema = salesFicheSchema.extend({
  recordings: z.array(recordingSchema).default([]),
});

export const salesWithCallsResponseSchema = z.object({
  fiches: z.array(salesFicheWithRecordingsSchema),
  total: z.number(),
});

// ═══════════════════════════════════════════════════════════════════════════
// FICHE DETAILS RESPONSE SCHEMA
// ═══════════════════════════════════════════════════════════════════════════

export const saleDetailsResponseSchema = z.object({
  success: z.boolean(),
  message: z.string(),
  information: informationSchema.nullable(),
  prospect: prospectSchema.nullable(),
  conjoint: conjointSchema.nullable(),
  enfants: z.array(enfantSchema),
  mails: z.array(mailSchema),
  rendez_vous: z.array(rendezVousSchema),
  commentaires: z.array(commentaireSchema),
  elements_souscription: elementsSouscriptionSchema.nullable(),
  tarification: z.array(tarificationSchema),
  reclamations: z.array(reclamationSchema),
  autres_contrats: z.array(autreContratSchema),
  documents: z.array(documentSchema),
  alertes: z.array(alerteSchema),
  recordings: z.array(recordingSchema),
  raw_sections: z.record(z.string(), z.string()),
});

// ═══════════════════════════════════════════════════════════════════════════
// DATABASE RECORD TYPES (for internal operations)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Recording status from database query
 * Used for calculating transcription statistics
 */
export const recordingStatusSchema = z.object({
  id: z.bigint(),
  hasTranscription: z.boolean(),
  transcribedAt: z.date().nullable(),
});

/**
 * Audit status from database query
 * Used for calculating audit statistics
 */
export const auditStatusRecordSchema = z.object({
  id: z.bigint(),
  overallScore: z.union([
    z.number(),
    z.string(),
    z.custom<import("@prisma/client").Prisma.Decimal>(),
  ]), // Prisma Decimal
  scorePercentage: z.union([
    z.number(),
    z.string(),
    z.custom<import("@prisma/client").Prisma.Decimal>(),
  ]), // Prisma Decimal
  niveau: z.string(),
  isCompliant: z.boolean(),
  status: z.string(),
  completedAt: z.date().nullable(),
  auditConfig: z.object({
    id: z.bigint(),
    name: z.string(),
  }),
});

// ═══════════════════════════════════════════════════════════════════════════
// STATUS TYPES (for enriched responses)
// ═══════════════════════════════════════════════════════════════════════════

export const transcriptionStatusSchema = z.object({
  total: z.number(),
  transcribed: z.number(),
  pending: z.number(),
  percentage: z.number(),
  isComplete: z.boolean(),
  lastTranscribedAt: z.date().nullable().optional(),
});

export const auditSummarySchema = z.object({
  id: z.string(),
  overallScore: z.string(),
  scorePercentage: z.string(),
  niveau: z.string(),
  isCompliant: z.boolean(),
  status: z.string(),
  completedAt: z.date().nullable(),
  createdAt: z.date().optional(),
  auditConfig: z
    .object({
      id: z.string(),
      name: z.string(),
    })
    .nullable(),
});

export const auditStatusSchema = z.object({
  total: z.number(),
  completed: z.number(),
  pending: z.number(),
  running: z.number(),
  compliant: z.number(),
  nonCompliant: z.number(),
  averageScore: z.number().nullable(),
  latestAudit: auditSummarySchema.nullable().optional(),
});

export const ficheStatusSchema = z.object({
  hasData: z.boolean(),
  transcription: transcriptionStatusSchema,
  audit: auditStatusSchema,
});

export const salesFicheWithStatusSchema = salesFicheSchema.extend({
  status: ficheStatusSchema,
});

export const salesResponseWithStatusSchema = z.object({
  fiches: z.array(salesFicheWithStatusSchema),
  total: z.number(),
});

export const ficheWithCompleteStatusSchema = z.object({
  ficheId: z.string(),
  groupe: z.string().nullable(),
  agenceNom: z.string().nullable(),
  prospectNom: z.string().nullable(),
  prospectPrenom: z.string().nullable(),
  prospectEmail: z.string().nullable(),
  prospectTel: z.string().nullable(),
  fetchedAt: z.date(),
  createdAt: z.date(),
  transcription: transcriptionStatusSchema,
  audit: auditStatusSchema.extend({
    audits: z.array(auditSummarySchema),
  }),
  recordings: z.array(
    z.object({
      id: z.string(),
      callId: z.string(),
      hasTranscription: z.boolean(),
      transcribedAt: z.date().nullable(),
      startTime: z.date().nullable(),
      durationSeconds: z.number().nullable(),
    })
  ),
});

export const dateRangeStatusResponseSchema = z.object({
  startDate: z.string(),
  endDate: z.string(),
  total: z.number(),
  fiches: z.array(ficheWithCompleteStatusSchema),
});

// ═══════════════════════════════════════════════════════════════════════════
// PROGRESSIVE FETCH SCHEMAS (for streaming/partial results)
// ═══════════════════════════════════════════════════════════════════════════

export const progressiveFetchMetaSchema = z.object({
  complete: z.boolean(),
  partial: z.boolean(),
  backgroundJobId: z.string().optional(),
  totalDaysRequested: z.number(),
  daysFetched: z.number(),
  daysRemaining: z.number(),
  daysCached: z.number(),
  cacheCoverage: z.object({
    datesWithData: z.array(z.string()),
    datesMissing: z.array(z.string()),
  }),
});

export const progressiveDateRangeResponseSchema = z.object({
  startDate: z.string(),
  endDate: z.string(),
  total: z.number(),
  fiches: z.array(ficheWithCompleteStatusSchema),
  meta: progressiveFetchMetaSchema,
});

// ═══════════════════════════════════════════════════════════════════════════
// EXPORTED TYPES
// ═══════════════════════════════════════════════════════════════════════════

// API Response Types
export type SalesFiche = z.infer<typeof salesFicheSchema>;
export type SalesFicheWithRecordings = z.infer<
  typeof salesFicheWithRecordingsSchema
>;
export type SalesWithCallsResponse = z.infer<
  typeof salesWithCallsResponseSchema
>;
export type Information = z.infer<typeof informationSchema>;
export type Prospect = z.infer<typeof prospectSchema>;
export type Conjoint = z.infer<typeof conjointSchema>;
export type Enfant = z.infer<typeof enfantSchema>;
export type Mail = z.infer<typeof mailSchema>;
export type RendezVous = z.infer<typeof rendezVousSchema>;
export type Commentaire = z.infer<typeof commentaireSchema>;
export type AncienContrat = z.infer<typeof ancienContratSchema>;
export type Produit = z.infer<typeof produitSchema>;
export type CompteTitulaire = z.infer<typeof compteTitulaireSchema>;
export type Paiement = z.infer<typeof paiementSchema>;
export type ElementsSouscription = z.infer<typeof elementsSouscriptionSchema>;
export type Formule = z.infer<typeof formuleSchema>;
export type Gamme = z.infer<typeof gammeSchema>;
export type Tarification = z.infer<typeof tarificationSchema>;
export type Reclamation = z.infer<typeof reclamationSchema>;
export type AutreContrat = z.infer<typeof autreContratSchema>;
export type Document = z.infer<typeof documentSchema>;
export type Alerte = z.infer<typeof alerteSchema>;
export type ConversationEntry = z.infer<typeof conversationEntrySchema>;
export type Transcription = z.infer<typeof transcriptionSchema>;
export type Recording = z.infer<typeof recordingSchema>;
export type SaleDetailsResponse = z.infer<typeof saleDetailsResponseSchema>;
export type FicheDetailsResponse = SaleDetailsResponse;

// Database Record Types (for internal operations)
export type RecordingStatus = z.infer<typeof recordingStatusSchema>;
export type AuditStatusRecord = z.infer<typeof auditStatusRecordSchema>;

// Status Types (for enriched responses)
export type TranscriptionStatus = z.infer<typeof transcriptionStatusSchema>;
export type AuditSummary = z.infer<typeof auditSummarySchema>;
export type AuditStatus = z.infer<typeof auditStatusSchema>;
export type FicheStatus = z.infer<typeof ficheStatusSchema>;
export type SalesFicheWithStatus = z.infer<typeof salesFicheWithStatusSchema>;
export type SalesResponseWithStatus = z.infer<
  typeof salesResponseWithStatusSchema
>;
export type FicheWithCompleteStatus = z.infer<
  typeof ficheWithCompleteStatusSchema
>;
export type DateRangeStatusResponse = z.infer<
  typeof dateRangeStatusResponseSchema
>;
export type ProgressiveFetchMeta = z.infer<typeof progressiveFetchMetaSchema>;
export type ProgressiveDateRangeResponse = z.infer<
  typeof progressiveDateRangeResponseSchema
>;

// ═══════════════════════════════════════════════════════════════════════════
// VALIDATORS
// ═══════════════════════════════════════════════════════════════════════════

export const validateSalesWithCallsResponse = (
  data: unknown
): SalesWithCallsResponse => {
  try {
    return salesWithCallsResponseSchema.parse(data);
  } catch (error) {
    logger.error("Sales with calls response validation failed", { error });
    throw new Error("Invalid sales with calls response format");
  }
};

export const validateSaleDetailsResponse = (
  data: unknown
): SaleDetailsResponse => {
  try {
    return saleDetailsResponseSchema.parse(data);
  } catch (error) {
    logger.error("Sale details response validation failed", { error });
    throw new Error("Invalid sale details response format");
  }
};

export const validateFicheDetailsResponse = validateSaleDetailsResponse;
