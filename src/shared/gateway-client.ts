/**
 * CRM Gateway Client (shared)
 * ============================
 * Single source of truth for the CRM/gateway base URL and auth headers.
 *
 * Usage:
 *   import { gateway } from "../../shared/gateway-client.js";
 *
 *   const url = gateway.url("/fiches/by-id/123");
 *   // → "https://api.devis-mutuelle-pas-cher.com/api/fiches/by-id/123"
 *
 *   const headers = gateway.authHeaders();
 *   // → { Authorization: "Bearer ..." } or {}
 *
 * Rules:
 *   - The base URL always ends with "/api" (exactly once).
 *   - Paths passed to gateway.url() should NOT include "/api" — just the resource path.
 *   - If a path accidentally starts with "/api", it is stripped to prevent double-prefix.
 */

import { logger } from "./logger.js";

function resolveBaseUrl(): string {
  const raw =
    process.env.FICHE_API_BASE_URL ||
    process.env.FICHE_API_URL ||
    "https://api.devis-mutuelle-pas-cher.com";

  // Strip trailing slashes
  let base = raw.replace(/\/+$/, "");

  // Ensure it ends with exactly "/api"
  if (!base.endsWith("/api")) {
    base += "/api";
  }

  return base;
}

// Resolved once at startup
const BASE = resolveBaseUrl();

/**
 * Build a full gateway URL from a resource path.
 *
 * @param path - Resource path WITHOUT the "/api" prefix, e.g. "/fiches/by-id/123"
 *               If the path accidentally starts with "/api", it is stripped automatically.
 * @param params - Optional URLSearchParams to append
 * @returns Full URL string
 *
 * @example
 *   gateway.url("/fiches/by-id/123")
 *   // → "https://api.devis-mutuelle-pas-cher.com/api/fiches/by-id/123"
 *
 *   gateway.url("/fiches/search/by-date-with-calls", new URLSearchParams({ date: "06/02/2026" }))
 *   // → "https://…/api/fiches/search/by-date-with-calls?date=06%2F02%2F2026"
 */
function url(path: string, params?: URLSearchParams): string {
  // Safety: strip accidental "/api" or "/api/" prefix to prevent double "/api/api/..."
  let cleanPath = path;
  if (cleanPath.startsWith("/api/")) {
    cleanPath = cleanPath.slice(4); // "/api/fiches/..." → "/fiches/..."
  } else if (cleanPath.startsWith("/api")) {
    cleanPath = cleanPath.slice(4) || "/";
  }

  // Ensure path starts with "/"
  if (!cleanPath.startsWith("/")) {
    cleanPath = "/" + cleanPath;
  }

  const full = `${BASE}${cleanPath}`;
  if (params && params.toString()) {
    return `${full}?${params}`;
  }
  return full;
}

/**
 * Get auth headers for the gateway (empty object when no token is configured).
 */
function authHeaders(overrideToken?: string): Record<string, string> {
  const token = (overrideToken || process.env.FICHE_API_AUTH_TOKEN || "").trim();
  if (!token) {return {};}
  const value = token.toLowerCase().startsWith("bearer ") ? token : `Bearer ${token}`;
  return { Authorization: value };
}

/**
 * Build a URL relative to the ROOT domain (bypasses the "/api" prefix).
 * Use only for endpoints that live outside "/api", e.g. "/health".
 *
 * @param path - Path from domain root, e.g. "/health"
 */
function rootUrl(path: string): string {
  // BASE is "https://host/api" → strip "/api" to get the domain root
  const root = BASE.replace(/\/api$/, "");
  const cleanPath = path.startsWith("/") ? path : "/" + path;
  return `${root}${cleanPath}`;
}

/**
 * Get the resolved base URL (for logging/diagnostics only).
 */
function getBaseUrl(): string {
  return BASE;
}

export const gateway = {
  url,
  rootUrl,
  authHeaders,
  getBaseUrl,
} as const;

// Log once at startup so operators can verify the resolved URL
logger.info("CRM gateway base URL resolved", { base: BASE });
