import type { RequestHandler } from "express";

import { extractApiTokenFromRequest, getConfiguredApiTokens, isValidApiToken } from "../shared/api-tokens.js";
import { extractBearerToken, verifyAccessToken } from "../shared/auth.js";
import { getRequestAuth } from "../shared/auth-context.js";
import { AuthenticationError, ConfigurationError } from "../shared/errors.js";

/**
 * Optional API authentication middleware.
 *
 * - Disabled by default (when no token env is set).
 * - When enabled, requires one of:
 *   - `Authorization: Bearer <token>`
 *   - `X-API-Key: <token>`
 *
 * Env vars:
 * - `API_AUTH_TOKEN="..."`
 * - `API_AUTH_TOKENS="token1,token2"` (for rotation)
 */
export const apiAuthMiddleware: RequestHandler = (req, _res, next) => {
  const tokens = getConfiguredApiTokens();
  if (tokens.length === 0) {return next();}

  // Only protect API routes; `/health` stays public.
  const path = req.path || req.originalUrl || "";
  if (!path.startsWith("/api")) {return next();}

  // Inngest endpoint has its own auth/signing; do not require the API token here.
  if (path.startsWith("/api/inngest")) {return next();}

  // Auth endpoints must remain reachable to bootstrap user sessions.
  if (path.startsWith("/api/auth")) {return next();}

  // If auth context was already established (JWT or API token), allow.
  if (getRequestAuth(req)) {return next();}

  // Fallback: validate credentials directly (useful if middleware ordering changes).
  const provided = extractApiTokenFromRequest(req);
  if (provided && isValidApiToken(provided)) {return next();}

  const bearer = extractBearerToken(req.headers.authorization);
  if (!bearer) {return next(new AuthenticationError("Missing or invalid credentials"));}

  void verifyAccessToken(bearer)
    .then(() => next())
    .catch((err: unknown) => {
      if (err instanceof ConfigurationError) {return next(err);}
      return next(new AuthenticationError("Missing or invalid credentials"));
    });
};

