import { createHash, randomBytes } from "node:crypto";

import { jwtVerify, SignJWT } from "jose";

import type { PermissionGrant, PermissionScope } from "./auth-context.js";
import { AuthenticationError, ConfigurationError } from "./errors.js";

function envString(key: string): string | undefined {
  const raw = process.env[key];
  const trimmed = typeof raw === "string" ? raw.trim() : "";
  return trimmed.length > 0 ? trimmed : undefined;
}

function envInt(key: string, fallback: number): number {
  const raw = envString(key);
  if (!raw) {return fallback;}
  const v = Number(raw);
  return Number.isFinite(v) && v > 0 ? Math.floor(v) : fallback;
}

export type AccessTokenClaims = {
  sub: string; // user id (stringified BigInt)
  email: string;
  roles: string[];
  crmUserId: string | null;
  groupes: string[];
  permissions: PermissionGrant[];
};

export type AuthConfig = {
  issuer: string;
  audience: string;
  accessTtlSeconds: number;
  refreshTtlSeconds: number;
  refreshCookieName: string;
  cookieSecure: boolean;
  cookieSameSite: "lax" | "strict" | "none";
};

export function getAuthConfig(): AuthConfig {
  const issuer = envString("JWT_ISSUER") || "ai-audit";
  const audience = envString("JWT_AUDIENCE") || "ai-audit";
  const accessTtlSeconds = envInt("AUTH_ACCESS_TTL_SECONDS", 15 * 60);
  const refreshTtlSeconds = envInt("AUTH_REFRESH_TTL_SECONDS", 30 * 24 * 60 * 60);
  const refreshCookieName = envString("AUTH_REFRESH_COOKIE_NAME") || "refresh_token";

  const sameSiteRaw = (envString("AUTH_COOKIE_SAMESITE") || "lax").toLowerCase();
  const cookieSameSite: AuthConfig["cookieSameSite"] =
    sameSiteRaw === "strict" ? "strict" : sameSiteRaw === "none" ? "none" : "lax";

  const cookieSecureRaw = (process.env.AUTH_COOKIE_SECURE ?? "").trim().toLowerCase();
  const cookieSecure =
    cookieSecureRaw === "1" ||
    cookieSecureRaw === "true" ||
    (cookieSecureRaw === "" && process.env.NODE_ENV === "production");

  return {
    issuer,
    audience,
    accessTtlSeconds,
    refreshTtlSeconds,
    refreshCookieName,
    cookieSecure,
    cookieSameSite,
  };
}

function requireJwtAccessSecret(): Uint8Array {
  const secret = envString("JWT_ACCESS_SECRET");
  if (!secret) {throw new ConfigurationError("JWT_ACCESS_SECRET is required");}
  return new TextEncoder().encode(secret);
}

export async function signAccessToken(params: {
  userId: string;
  email: string;
  roles: string[];
  crmUserId?: string | null;
  groupes?: string[];
  permissions: PermissionGrant[];
}): Promise<string> {
  const cfg = getAuthConfig();
  const key = requireJwtAccessSecret();

  // Keep payload small and deterministic.
  const roles = Array.from(new Set((params.roles || []).map(String))).filter(Boolean);
  const groupes = Array.from(new Set((params.groupes || []).map(String))).filter(Boolean);
  const crmUserId = params.crmUserId ? String(params.crmUserId).trim() : null;

  const permissions = Array.isArray(params.permissions) ? params.permissions : [];
  const normalizedPerms: PermissionGrant[] = [];
  const seen = new Set<string>();
  for (const p of permissions) {
    if (!p || typeof p !== "object") {continue;}
    const permKey = typeof p.key === "string" ? p.key.trim() : "";
    if (!permKey || seen.has(permKey)) {continue;}
    seen.add(permKey);
    normalizedPerms.push({
      key: permKey,
      read: Boolean(p.read),
      write: Boolean(p.write),
      read_scope: (p.read_scope as PermissionScope) ?? "SELF",
      write_scope: (p.write_scope as PermissionScope) ?? "SELF",
    });
  }

  return await new SignJWT({
    email: params.email,
    roles,
    crm_user_id: crmUserId,
    groupes,
    permission_grants: normalizedPerms,
  })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setIssuer(cfg.issuer)
    .setAudience(cfg.audience)
    .setSubject(String(params.userId))
    .setIssuedAt()
    .setExpirationTime(`${cfg.accessTtlSeconds}s`)
    .sign(key);
}

function readStringArray(payloadValue: unknown): string[] {
  if (!Array.isArray(payloadValue)) {return [];}
  const out: string[] = [];
  for (const v of payloadValue) {
    if (typeof v === "string" && v.trim()) {out.push(v.trim());}
  }
  return out;
}

function readScope(value: unknown): PermissionScope {
  return value === "ALL" ? "ALL" : value === "GROUP" ? "GROUP" : "SELF";
}

function readPermissionGrants(payloadValue: unknown): PermissionGrant[] {
  if (!Array.isArray(payloadValue)) {return [];}
  const out: PermissionGrant[] = [];
  const seen = new Set<string>();
  for (const v of payloadValue) {
    if (typeof v !== "object" || v === null) {continue;}
    const rec = v as Record<string, unknown>;
    const key = typeof rec.key === "string" ? rec.key.trim() : "";
    if (!key || seen.has(key)) {continue;}
    seen.add(key);
    out.push({
      key,
      read: Boolean(rec.read),
      write: Boolean(rec.write),
      read_scope: readScope(rec.read_scope),
      write_scope: readScope(rec.write_scope),
    });
  }
  return out;
}

export async function verifyAccessToken(token: string): Promise<AccessTokenClaims> {
  const cfg = getAuthConfig();
  const key = requireJwtAccessSecret();

  try {
    const { payload } = await jwtVerify(token, key, {
      issuer: cfg.issuer,
      audience: cfg.audience,
      algorithms: ["HS256"],
    });

    const sub = typeof payload.sub === "string" && payload.sub.trim() ? payload.sub.trim() : null;
    const email = typeof payload.email === "string" && payload.email.trim() ? payload.email.trim() : null;
    if (!sub || !email) {
      throw new AuthenticationError("Invalid access token");
    }

    const roles = readStringArray(payload.roles);
    const groupes = readStringArray(payload.groupes);
    const crmUserId =
      typeof payload.crm_user_id === "string" && payload.crm_user_id.trim()
        ? payload.crm_user_id.trim()
        : null;
    const permissions = readPermissionGrants(payload.permission_grants);

    return { sub, email, roles, crmUserId, groupes, permissions };
  } catch (err: unknown) {
    if (err instanceof ConfigurationError) {throw err;}
    throw new AuthenticationError("Invalid or expired access token");
  }
}

export function extractBearerToken(value: unknown): string | null {
  if (typeof value !== "string") {return null;}
  const v = value.trim();
  if (!v) {return null;}
  const m = /^Bearer\s+(.+)$/i.exec(v);
  if (!m) {return null;}
  const token = m[1]?.trim();
  return token ? token : null;
}

export function generateOpaqueToken(bytes = 32): string {
  return randomBytes(Math.max(16, bytes)).toString("base64url");
}

export function hashOpaqueToken(token: string): string {
  return createHash("sha256").update(String(token || ""), "utf8").digest("base64url");
}

export function parseCookieHeader(header: unknown): Record<string, string> {
  if (typeof header !== "string" || header.trim().length === 0) {return {};}
  const out: Record<string, string> = {};
  const parts = header.split(";");
  for (const part of parts) {
    const idx = part.indexOf("=");
    if (idx === -1) {continue;}
    const rawKey = part.slice(0, idx).trim();
    const rawVal = part.slice(idx + 1).trim();
    if (!rawKey) {continue;}
    try {
      out[rawKey] = decodeURIComponent(rawVal);
    } catch {
      out[rawKey] = rawVal;
    }
  }
  return out;
}

export function getCookieValue(cookieHeader: unknown, name: string): string | null {
  const cookies = parseCookieHeader(cookieHeader);
  const v = cookies[name];
  return typeof v === "string" && v.length > 0 ? v : null;
}

