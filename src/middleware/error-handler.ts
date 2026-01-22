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

  // Zod validation errors (request body/query/params parsing)
  if (error instanceof ZodError) {
    const firstIssue = error.issues?.[0];
    const message = firstIssue?.message
      ? `Validation error: ${firstIssue.message}`
      : "Validation error";
    return fail(res, new ValidationError(message, error.issues), 400, {
      method: req.method,
      path: req.originalUrl,
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
        path: req.originalUrl,
      }
    );
  }

  return fail(res, error, 500, {
    method: req.method,
    path: req.originalUrl,
  });
};


