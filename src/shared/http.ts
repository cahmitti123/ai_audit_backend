/**
 * HTTP Response Helpers
 * =====================
 * Small helpers to keep routes consistent and reduce boilerplate.
 */

import type { Response } from "express";

import { jsonResponse } from "./bigint-serializer.js";
import { AppError } from "./errors.js";
import { logger } from "./logger.js";

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {return error.message;}
  try {
    return String(error);
  } catch {
    return "Unknown error";
  }
}

/**
 * Send a success response with BigInt-safe serialization.
 */
export function ok<T>(res: Response, data: T, statusCode = 200) {
  return jsonResponse(res, { success: true, data }, statusCode);
}

/**
 * Send a standard error response.
 *
 * - Supports AppError for statusCode/code.
 * - Avoids leaking stack traces outside development by default.
 */
export function fail(
  res: Response,
  error: unknown,
  statusCode = 500,
  meta: Record<string, unknown> = {}
) {
  const msg = getErrorMessage(error);
  const app = error instanceof AppError ? error : null;
  const finalStatus = app?.statusCode ?? statusCode;

  const logPayload = {
    status: finalStatus,
    code: app?.code,
    error: msg,
    ...meta,
  };

  // Avoid spamming ERROR logs for expected client failures (401/403/404/validation).
  // Keep ERROR level for 5xx only.
  if (finalStatus >= 500) {
    logger.error("API error", logPayload);
  } else if (finalStatus === 401 || finalStatus === 403) {
    logger.info("API error", logPayload);
  } else if (finalStatus === 404) {
    logger.info("API error", logPayload);
  } else if (finalStatus >= 400) {
    logger.warn("API error", logPayload);
  } else {
    logger.info("API error", logPayload);
  }

  const payload: Record<string, unknown> = {
    success: false,
    error: msg || "Internal server error",
  };

  if (app?.code) {payload.code = app.code;}
  if (process.env.NODE_ENV === "development" && error instanceof Error) {
    payload.stack = error.stack;
  }

  return res.status(finalStatus).json(payload);
}


