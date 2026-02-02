import { timingSafeEqual } from "node:crypto";

import type { Request } from "express";

import { extractBearerToken } from "./auth.js";

function uniq(values: string[]): string[] {
  return Array.from(new Set(values));
}

export function getConfiguredApiTokens(): string[] {
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

export function isValidApiToken(token: string | null | undefined): boolean {
  const t = typeof token === "string" ? token.trim() : "";
  if (!t) {return false;}
  const tokens = getConfiguredApiTokens();
  if (tokens.length === 0) {return false;}
  return tokens.some((known) => safeEqual(t, known));
}

export function extractApiTokenFromRequest(req: Request): string | null {
  const authHeader = req.headers.authorization;
  const bearer = extractBearerToken(authHeader);
  if (bearer) {return bearer;}

  const apiKey = req.headers["x-api-key"];
  if (typeof apiKey === "string" && apiKey.trim()) {return apiKey.trim();}

  return null;
}

