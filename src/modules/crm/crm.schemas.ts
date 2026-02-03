/**
 * CRM Schemas
 * ===========
 * Validation for gateway CRM "utilisateurs" + "groupes" endpoints.
 */

import { z } from "zod";

import { ValidationError } from "../../shared/errors.js";
import { logger } from "../../shared/logger.js";

const crmUserSchema = z.object({
  id: z.string(),
  nom: z.string().optional().default(""),
  prenom: z.string().optional().default(""),
  telephone: z.string().optional().nullable(),
  email: z.string().optional().nullable(),
  login: z.string().optional().nullable(),
  agence: z.string().optional().nullable(),
  agence_id: z.string().optional().nullable(),
  role: z.string().optional().nullable(),
  role_id: z.string().optional().nullable(),
  etat: z.string().optional().nullable(),
  actif: z.boolean().optional().nullable(),
  tv: z.boolean().optional().nullable(),
  se: z.boolean().optional().nullable(),
});

export type CrmUser = z.infer<typeof crmUserSchema>;

export const crmUsersResponseSchema = z.object({
  success: z.boolean(),
  message: z.string().optional(),
  data: z.object({
    utilisateurs: z.array(crmUserSchema),
    total_count: z.number().optional(),
  }),
  timestamp: z.string().optional(),
});

export type CrmUsersResponse = z.infer<typeof crmUsersResponseSchema>;

export function validateCrmUsersResponse(data: unknown): CrmUsersResponse {
  try {
    return crmUsersResponseSchema.parse(data);
  } catch (err) {
    logger.warn("Invalid CRM users response", { error: err });
    throw err instanceof Error
      ? new ValidationError(err.message)
      : new ValidationError("Invalid CRM users response");
  }
}

const crmGroupSchema = z.object({
  id: z.string(),
  nom: z.string(),
  membres_count: z.number().optional().nullable(),
  responsable_1: z.string().optional().nullable(),
  responsable_2: z.string().optional().nullable(),
  responsable_3: z.string().optional().nullable(),
  user_ids: z.array(z.string()).optional(),
});

export type CrmGroup = z.infer<typeof crmGroupSchema>;

export const crmGroupsResponseSchema = z.object({
  success: z.boolean(),
  message: z.string().optional(),
  data: z.object({
    groupes: z.array(crmGroupSchema),
    total_count: z.number().optional(),
  }),
  timestamp: z.string().optional(),
});

export type CrmGroupsResponse = z.infer<typeof crmGroupsResponseSchema>;

export function validateCrmGroupsResponse(data: unknown): CrmGroupsResponse {
  try {
    return crmGroupsResponseSchema.parse(data);
  } catch (err) {
    logger.warn("Invalid CRM groups response", { error: err });
    throw err instanceof Error
      ? new ValidationError(err.message)
      : new ValidationError("Invalid CRM groups response");
  }
}

