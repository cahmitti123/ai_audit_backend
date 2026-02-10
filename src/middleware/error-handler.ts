/**
 * Error Handler Middleware
 * ========================
 * Central place for unhandled route errors.
 *
 * Notes:
 * - Use with `asyncHandler` to capture async/await errors.
 * - Keep responses consistent (success=false) and avoid leaking stack traces.
 */

import type { ErrorRequestHandler } from "express";
import { ZodError } from "zod";

import { AppError, ValidationError } from "../shared/errors.js";
import { fail } from "../shared/http.js";

type SyntaxErrorWithType = SyntaxError & { type?: unknown };

function isBodyParserSyntaxError(error: unknown): boolean {
  const err = error as SyntaxErrorWithType;
  return (
    error instanceof SyntaxError &&
    typeof err?.type === "string" &&
    err.type === "entity.parse.failed"
  );
}

export const errorHandler: ErrorRequestHandler = (error, req, res, next) => {
  if (res.headersSent) {return next(error);}

  // Inngest SDK endpoint expects standard error semantics from the handler.
  // Some AppErrors carry upstream HTTP status codes (eg 502) which can confuse
  // the Inngest engine when returned as the SDK response status.
  // Normalize ALL 5xx AppErrors to 500 for `/api/inngest`.
  const path = req.originalUrl;
  const isInngest = typeof path === "string" && path.startsWith("/api/inngest");

  // Zod validation errors (request body/query/params parsing)
  if (error instanceof ZodError) {
    const firstIssue = error.issues?.[0];
    const message = firstIssue?.message
      ? `Validation error: ${firstIssue.message}`
      : "Validation error";
    return fail(res, new ValidationError(message, error.issues), 400, {
      method: req.method,
      path,
    });
  }

  // Bad JSON body (express.json)
  if (isBodyParserSyntaxError(error)) {
    return fail(
      res,
      new AppError("Invalid JSON body", 400, "INVALID_JSON"),
      400,
      {
        method: req.method,
        path,
      }
    );
  }

  // For Inngest: normalize upstream 5xx (eg 502) to 500.
  if (isInngest && error instanceof AppError && error.statusCode >= 500) {
    const normalized = new Error(error.message);
    normalized.name = error.name;
    return fail(res, normalized, 500, {
      method: req.method,
      path,
      original_status: error.statusCode,
      original_code: error.code,
      original_name: error.name,
    });
  }

  return fail(res, error, 500, {
    method: req.method,
    path,
  });
};


