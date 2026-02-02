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
    status: z.enum(["ACTIVE", "DISABLED"]).optional(),
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

