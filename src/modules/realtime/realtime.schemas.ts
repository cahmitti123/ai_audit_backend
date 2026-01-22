/**
 * Realtime Schemas
 * ================
 * Validation for Pusher endpoints.
 */

import { z } from "zod";

import { ValidationError } from "../../shared/errors.js";
import { logger } from "../../shared/logger.js";

export const pusherAuthInputSchema = z.object({
  socket_id: z.string().trim().min(1),
  channel_name: z.string().trim().min(1),
  // Presence channels only:
  user_id: z.string().trim().min(1).optional(),
  user_info: z.record(z.unknown()).optional(),
});

export type PusherAuthInput = z.infer<typeof pusherAuthInputSchema>;

export function validatePusherAuthInput(data: unknown): PusherAuthInput {
  try {
    return pusherAuthInputSchema.parse(data);
  } catch (err) {
    logger.warn("Invalid pusher auth input", { error: err });
    throw err instanceof Error
      ? new ValidationError(err.message)
      : new ValidationError("Invalid pusher auth input");
  }
}

export const pusherTestInputSchema = z.object({
  channel: z.string().trim().min(1).optional(),
  event: z.string().trim().min(1).optional(),
  payload: z.unknown().optional(),
});

export type PusherTestInput = z.infer<typeof pusherTestInputSchema>;

export function validatePusherTestInput(data: unknown): PusherTestInput {
  try {
    return pusherTestInputSchema.parse(data);
  } catch (err) {
    logger.warn("Invalid pusher test input", { error: err });
    throw err instanceof Error
      ? new ValidationError(err.message)
      : new ValidationError("Invalid pusher test input");
  }
}



