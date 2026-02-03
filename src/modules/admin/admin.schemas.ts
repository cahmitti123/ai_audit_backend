/**
 * Admin Schemas
 * =============
 * Validation for user/role/permission management endpoints.
 */

import { z } from "zod";

import { ValidationError } from "../../shared/errors.js";
import { logger } from "../../shared/logger.js";

const emailSchema = z.string().trim().toLowerCase().email();
const passwordSchema = z.string().min(8).max(200);
const roleKeysSchema = z.array(z.string().trim().min(1)).min(1);
const permissionKeysSchema = z.array(z.string().trim().min(1));
const permissionScopeSchema = z.enum(["SELF", "GROUP", "ALL"]);
const permissionGrantSchema = z
  .object({
    key: z.string().trim().min(1),
    read: z.boolean().default(false),
    write: z.boolean().default(false),
    scope: permissionScopeSchema.default("SELF"),
  })
  .refine((v) => v.read || v.write, {
    message: "Permission grant must enable read and/or write",
  });
const permissionGrantsSchema = z.array(permissionGrantSchema);
const roleKeySchema = z
  .string()
  .trim()
  .min(1)
  .max(80)
  .regex(/^[a-z0-9._:-]+$/i, "Role key must be alphanumeric and may include . _ : -");

export const createUserInputSchema = z.object({
  email: emailSchema,
  password: passwordSchema,
  role_keys: roleKeysSchema.optional(),
});

export type CreateUserInput = z.infer<typeof createUserInputSchema>;

export function validateCreateUserInput(data: unknown): CreateUserInput {
  try {
    return createUserInputSchema.parse(data);
  } catch (err) {
    logger.warn("Invalid create user input", { error: err });
    throw err instanceof Error
      ? new ValidationError(err.message)
      : new ValidationError("Invalid create user input");
  }
}

export const updateUserInputSchema = z
  .object({
    status: z.enum(["INVITED", "ACTIVE", "DISABLED"]).optional(),
    password: passwordSchema.optional(),
    role_keys: roleKeysSchema.optional(),
  })
  .refine((v) => v.status || v.password || v.role_keys, {
    message: "At least one of status, password, role_keys is required",
  });

export type UpdateUserInput = z.infer<typeof updateUserInputSchema>;

export function validateUpdateUserInput(data: unknown): UpdateUserInput {
  try {
    return updateUserInputSchema.parse(data);
  } catch (err) {
    logger.warn("Invalid update user input", { error: err });
    throw err instanceof Error
      ? new ValidationError(err.message)
      : new ValidationError("Invalid update user input");
  }
}

export const createRoleInputSchema = z.object({
  key: roleKeySchema,
  name: z.string().trim().min(1).max(200),
  description: z.string().trim().max(5000).optional(),
  // New RBAC format: read/write + scope per permission key
  permission_grants: permissionGrantsSchema.optional(),
  // Back-compat: legacy list of permission keys
  permission_keys: permissionKeysSchema.optional(),
});

export type CreateRoleInput = z.infer<typeof createRoleInputSchema>;

export function validateCreateRoleInput(data: unknown): CreateRoleInput {
  try {
    return createRoleInputSchema.parse(data);
  } catch (err) {
    logger.warn("Invalid create role input", { error: err });
    throw err instanceof Error
      ? new ValidationError(err.message)
      : new ValidationError("Invalid create role input");
  }
}

export const updateRoleInputSchema = z
  .object({
    name: z.string().trim().min(1).max(200).optional(),
    description: z.string().trim().max(5000).nullable().optional(),
    permission_grants: permissionGrantsSchema.optional(),
    permission_keys: permissionKeysSchema.optional(),
  })
  .refine((v) => v.name || v.description !== undefined || v.permission_keys || v.permission_grants, {
    message: "At least one of name, description, permission_keys, permission_grants is required",
  });

export type UpdateRoleInput = z.infer<typeof updateRoleInputSchema>;

export function validateUpdateRoleInput(data: unknown): UpdateRoleInput {
  try {
    return updateRoleInputSchema.parse(data);
  } catch (err) {
    logger.warn("Invalid update role input", { error: err });
    throw err instanceof Error
      ? new ValidationError(err.message)
      : new ValidationError("Invalid update role input");
  }
}

export const createUserFromCrmInputSchema = z.object({
  crm_user_id: z.string().trim().min(1),
  role_keys: roleKeysSchema.optional(),
  // Optional override; otherwise we auto-detect from CRM groups membership.
  crm_group_id: z.string().trim().min(1).optional(),
});

export type CreateUserFromCrmInput = z.infer<typeof createUserFromCrmInputSchema>;

export function validateCreateUserFromCrmInput(data: unknown): CreateUserFromCrmInput {
  try {
    return createUserFromCrmInputSchema.parse(data);
  } catch (err) {
    logger.warn("Invalid create user from CRM input", { error: err });
    throw err instanceof Error
      ? new ValidationError(err.message)
      : new ValidationError("Invalid create user from CRM input");
  }
}
