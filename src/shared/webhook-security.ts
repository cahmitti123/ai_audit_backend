/**
 * Webhook Security Helpers
 * =======================
 * Centralized validation to reduce SSRF risk for user-provided webhook URLs.
 */

import net from "net";

function parseAllowedOrigins(): string[] {
  const raw = process.env.WEBHOOK_ALLOWED_ORIGINS;
  if (!raw) {return [];}
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

function isDevelopmentMode(): boolean {
  const nodeEnv = (process.env.NODE_ENV || "").toLowerCase();
  // Default to "development" when unset (common in local runs)
  if (!nodeEnv) {return true;}
  return nodeEnv !== "production";
}

function isPrivateIpv4(ip: string): boolean {
  const parts = ip.split(".").map((p) => Number(p));
  if (parts.length !== 4 || parts.some((n) => !Number.isFinite(n))) {return false;}

  const [a, b] = parts;

  // 0.0.0.0/8
  if (a === 0) {return true;}
  // 127.0.0.0/8 loopback
  if (a === 127) {return true;}
  // 10.0.0.0/8
  if (a === 10) {return true;}
  // 172.16.0.0/12
  if (a === 172 && b >= 16 && b <= 31) {return true;}
  // 192.168.0.0/16
  if (a === 192 && b === 168) {return true;}
  // 169.254.0.0/16 link-local
  if (a === 169 && b === 254) {return true;}

  return false;
}

function isPrivateIpv6(ip: string): boolean {
  const normalized = ip.toLowerCase();
  if (normalized === "::1") {return true;} // loopback
  // Unique local addresses fc00::/7
  if (normalized.startsWith("fc") || normalized.startsWith("fd")) {return true;}
  // Link-local fe80::/10
  if (normalized.startsWith("fe8") || normalized.startsWith("fe9") || normalized.startsWith("fea") || normalized.startsWith("feb")) {
    return true;
  }
  return false;
}

export function validateOutgoingWebhookUrl(webhookUrl: string): {
  ok: true;
  url: URL;
} | {
  ok: false;
  error: string;
} {
  let url: URL;
  try {
    url = new URL(webhookUrl);
  } catch {
    return { ok: false, error: "Invalid webhookUrl format" };
  }

  if (!["http:", "https:"].includes(url.protocol)) {
    return { ok: false, error: "webhookUrl must use http or https protocol" };
  }

  if (url.username || url.password) {
    return { ok: false, error: "webhookUrl must not include credentials" };
  }

  const allowedOrigins = parseAllowedOrigins();
  if (allowedOrigins.length > 0) {
    if (!allowedOrigins.includes(url.origin)) {
      return {
        ok: false,
        error: `webhookUrl origin not allowed (set WEBHOOK_ALLOWED_ORIGINS). Got ${url.origin}`,
      };
    }
    // Allowlist overrides hostname/IP checks (explicit operator intent).
    return { ok: true, url };
  }

  const host = url.hostname.toLowerCase();
  const allowLocalhostInDev = isDevelopmentMode();
  if (
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host.endsWith(".local")
  ) {
    if (allowLocalhostInDev) {
      return { ok: true, url };
    }
    return { ok: false, error: "webhookUrl hostname not allowed" };
  }

  const ipType = net.isIP(host);
  // Allow loopback IPs in development when no allowlist is configured
  if (allowLocalhostInDev && (host === "127.0.0.1" || host === "::1")) {
    return { ok: true, url };
  }
  if (ipType === 4 && isPrivateIpv4(host)) {
    return { ok: false, error: "webhookUrl IP not allowed" };
  }
  if (ipType === 6 && isPrivateIpv6(host)) {
    return { ok: false, error: "webhookUrl IP not allowed" };
  }

  return { ok: true, url };
}


