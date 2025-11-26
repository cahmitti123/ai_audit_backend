/**
 * Products Schemas
 * ================
 * Validation schemas for insurance products
 */

import { z } from "zod";

// ============================================
// Groupe Schemas
// ============================================

export const groupeSchema = z.object({
  id: z.bigint(),
  code: z.string(),
  libelle: z.string(),
  createdAt: z.date(),
  updatedAt: z.date(),
});

export const createGroupeSchema = z.object({
  code: z.string().max(2),
  libelle: z.string().max(17),
});

export const updateGroupeSchema = createGroupeSchema.partial();

// ============================================
// Gamme Schemas
// ============================================

export const gammeSchema = z.object({
  id: z.bigint(),
  groupeId: z.bigint(),
  code: z.string(),
  libelle: z.string(),
  documents: z.record(z.string()).optional(),
  createdAt: z.date(),
  updatedAt: z.date(),
});

export const createGammeSchema = z.object({
  groupeId: z.bigint(),
  code: z.string().max(3),
  libelle: z.string().max(29),
  documents: z.record(z.string()).optional(),
});

export const updateGammeSchema = createGammeSchema.partial().omit({ groupeId: true });

// ============================================
// Formule Schemas
// ============================================

export const formuleSchema = z.object({
  id: z.bigint(),
  gammeId: z.bigint(),
  code: z.string(),
  libelle: z.string(),
  libelleAlternatif: z.string().nullable(),
  hospitalisation: z.string().nullable(),
  hospiNonOptam: z.string().nullable(),
  dentaire: z.string().nullable(),
  optique: z.string().nullable(),
  optiqueVc: z.string().nullable(),
  medecines: z.string().nullable(),
  soinsNonOptam: z.string().nullable(),
  chambreParticuliere: z.string().nullable(),
  medecineDouce: z.string().nullable(),
  appareilsAuditifs: z.string().nullable(),
  maternite: z.string().nullable(),
  cureThermale: z.string().nullable(),
  fraisDossier: z.string().nullable(),
  delaiAttente: z.string().nullable(),
  garantiesHtml: z.string(),
  createdAt: z.date(),
  updatedAt: z.date(),
});

export const createFormuleSchema = z.object({
  gammeId: z.bigint(),
  code: z.string().max(4),
  libelle: z.string().max(14),
  libelleAlternatif: z.string().max(13).optional(),
  hospitalisation: z.string().max(46).optional(),
  hospiNonOptam: z.string().max(4).optional(),
  dentaire: z.string().max(50).optional(),
  optique: z.string().max(50).optional(),
  optiqueVc: z.string().max(43).optional(),
  medecines: z.string().max(50).optional(),
  soinsNonOptam: z.string().max(12).optional(),
  chambreParticuliere: z.string().max(47).optional(),
  medecineDouce: z.string().max(40).optional(),
  appareilsAuditifs: z.string().max(46).optional(),
  maternite: z.string().max(48).optional(),
  cureThermale: z.string().max(42).optional(),
  fraisDossier: z.string().max(13).optional(),
  delaiAttente: z.string().max(50).optional(),
  garantiesHtml: z.string().max(87),
});

export const updateFormuleSchema = createFormuleSchema.partial().omit({ gammeId: true });

// ============================================
// Garantie Parsed Schemas
// ============================================

export const garantieParsedSchema = z.object({
  id: z.bigint(),
  gammeId: z.bigint().nullable(),
  formuleId: z.bigint().nullable(),
  title: z.string().nullable(),
  introText: z.array(z.string()),
  formuleIndicator: z.string().nullable(),
  notesAndLegal: z.string().nullable(),
  createdAt: z.date(),
});

// ============================================
// Garantie Category Schemas
// ============================================

export const garantieCategorySchema = z.object({
  id: z.bigint(),
  garantieParsedId: z.bigint(),
  sectionIndex: z.number(),
  categoryName: z.string(),
  displayOrder: z.number(),
  createdAt: z.date(),
});

// ============================================
// Garantie Item Schemas
// ============================================

export const garantieItemSchema = z.object({
  id: z.bigint(),
  categoryId: z.bigint(),
  guaranteeName: z.string(),
  guaranteeValue: z.string(),
  displayOrder: z.number(),
  createdAt: z.date(),
});

// ============================================
// Document Schemas
// ============================================

export const documentSchema = z.object({
  id: z.bigint(),
  gammeId: z.bigint().nullable(),
  formuleId: z.bigint().nullable(),
  documentType: z.string(),
  url: z.string(),
  createdAt: z.date(),
});

// ============================================
// Response Schemas (with relations)
// ============================================

export const formuleWithGarantiesSchema = formuleSchema.extend({
  garantiesParsed: z.array(
    garantieParsedSchema.extend({
      categories: z.array(
        garantieCategorySchema.extend({
          items: z.array(garantieItemSchema),
        })
      ),
    })
  ).optional(),
  documents: z.array(documentSchema).optional(),
});

export const gammeWithFormulesSchema = gammeSchema.extend({
  formules: z.array(formuleWithGarantiesSchema).optional(),
  documentsTable: z.array(documentSchema).optional(),
});

export const groupeWithGammesSchema = groupeSchema.extend({
  gammes: z.array(gammeWithFormulesSchema).optional(),
});

// ============================================
// Query Schemas
// ============================================

export const productsQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
  search: z.string().optional(),
  groupeId: z.coerce.bigint().optional(),
  gammeId: z.coerce.bigint().optional(),
});

// ============================================
// Type Exports
// ============================================

export type Groupe = z.infer<typeof groupeSchema>;
export type CreateGroupe = z.infer<typeof createGroupeSchema>;
export type UpdateGroupe = z.infer<typeof updateGroupeSchema>;

export type Gamme = z.infer<typeof gammeSchema>;
export type CreateGamme = z.infer<typeof createGammeSchema>;
export type UpdateGamme = z.infer<typeof updateGammeSchema>;

export type Formule = z.infer<typeof formuleSchema>;
export type CreateFormule = z.infer<typeof createFormuleSchema>;
export type UpdateFormule = z.infer<typeof updateFormuleSchema>;

export type GarantieParsed = z.infer<typeof garantieParsedSchema>;
export type GarantieCategory = z.infer<typeof garantieCategorySchema>;
export type GarantieItem = z.infer<typeof garantieItemSchema>;
export type Document = z.infer<typeof documentSchema>;

export type FormuleWithGaranties = z.infer<typeof formuleWithGarantiesSchema>;
export type GammeWithFormules = z.infer<typeof gammeWithFormulesSchema>;
export type GroupeWithGammes = z.infer<typeof groupeWithGammesSchema>;

export type ProductsQuery = z.infer<typeof productsQuerySchema>;

