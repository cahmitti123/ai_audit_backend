import { timingSafeEqual } from "node:crypto";

import type { RequestHandler } from "express";

import { AuthenticationError } from "../shared/errors.js";

function uniq(values: string[]): string[] {
  return Array.from(new Set(values));
}

function getConfiguredTokens(): string[] {
  const single = (process.env.API_AUTH_TOKEN || "").trim();
  const multi = (process.env.API_AUTH_TOKENS || "").trim();

  const tokens = [
    ...(single ? [single] : []),
    ...(multi
      ? multi
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean)
      : []),
  ];

  return uniq(tokens);
}

function safeEqual(a: string, b: string): boolean {
  const aa = Buffer.from(a);
  const bb = Buffer.from(b);
  if (aa.length !== bb.length) {return false;}
  return timingSafeEqual(aa, bb);
}

function extractBearerToken(value: unknown): string | null {
  if (typeof value !== "string") {return null;}
  const v = value.trim();
  if (!v) {return null;}
  const m = /^Bearer\s+(.+)$/i.exec(v);
  if (!m) {return null;}
  const token = m[1]?.trim();
  return token ? token : null;
}

function extractApiTokenFromRequest(req: Parameters<RequestHandler>[0]): string | null {
  const authHeader = req.headers.authorization;
  const bearer = extractBearerToken(authHeader);
  if (bearer) {return bearer;}

  const apiKey = req.headers["x-api-key"];
  if (typeof apiKey === "string" && apiKey.trim()) {return apiKey.trim();}

  return null;
}

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
  const tokens = getConfiguredTokens();
  if (tokens.length === 0) {return next();}

  // Only protect API routes; `/health` stays public.
  const path = req.path || req.originalUrl || "";
  if (!path.startsWith("/api")) {return next();}

  // Inngest endpoint has its own auth/signing; do not require the API token here.
  if (path.startsWith("/api/inngest")) {return next();}

  const provided = extractApiTokenFromRequest(req);
  const ok =
    typeof provided === "string" &&
    provided.length > 0 &&
    tokens.some((t) => safeEqual(provided, t));

  if (!ok) {
    return next(new AuthenticationError("Missing or invalid API token"));
  }

  return next();
};

