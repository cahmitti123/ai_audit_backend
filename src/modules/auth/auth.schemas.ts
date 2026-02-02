/**
 * Auth Schemas
 * ============
 * Validation for authentication endpoints.
 */

import { z } from "zod";

import { ValidationError } from "../../shared/errors.js";
import { logger } from "../../shared/logger.js";

const emailSchema = z.string().trim().toLowerCase().email();
const passwordSchema = z.string().min(8).max(200);

export const loginInputSchema = z.object({
  email: emailSchema,
  password: passwordSchema,
});

export type LoginInput = z.infer<typeof loginInputSchema>;

export function validateLoginInput(data: unknown): LoginInput {
  try {
    return loginInputSchema.parse(data);
  } catch (err) {
    logger.warn("Invalid login input", { error: err });
    throw err instanceof Error ? new ValidationError(err.message) : new ValidationError("Invalid login input");
  }
}

export const refreshInputSchema = z.object({
  // Optional: for non-cookie clients (CLI / tests)
  refresh_token: z.string().trim().min(1).optional(),
});

export type RefreshInput = z.infer<typeof refreshInputSchema>;

export function validateRefreshInput(data: unknown): RefreshInput {
  try {
    return refreshInputSchema.parse(data);
  } catch (err) {
    logger.warn("Invalid refresh input", { error: err });
    throw err instanceof Error
      ? new ValidationError(err.message)
      : new ValidationError("Invalid refresh input");
  }
}

