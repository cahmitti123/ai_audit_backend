/**
 * Log Sanitizer
 * =============
 * Utilities to sanitize values before logging or persisting debug metadata.
 *
 * Goals:
 * - Avoid leaking secrets (tokens, api keys, authorization/cookies, etc.)
 * - Avoid crashing JSON.stringify (eg. BigInt)
 * - Keep log payloads bounded (truncate long strings/arrays/objects)
 */
export type SanitizeForLoggingOptions = {
  maxDepth?: number;
  maxStringLength?: number;
  maxArrayLength?: number;
  maxObjectKeys?: number;
};

const DEFAULTS: Required<SanitizeForLoggingOptions> = {
  maxDepth: 6,
  maxStringLength: 2_000,
  maxArrayLength: 50,
  maxObjectKeys: 200,
};

const REDACT_KEY_PATTERNS: ReadonlyArray<RegExp> = [
  /^authorization$/i,
  /^cookie$/i,
  /^set-cookie$/i,
  /token/i,
  /secret/i,
  /password/i,
  /api[_-]?key/i,
  /signing[_-]?key/i,
  /webhook[_-]?secret/i,
  /xi[_-]?api[_-]?key/i,
];

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null) {return false;}
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function shouldRedactKey(key: string): boolean {
  return REDACT_KEY_PATTERNS.some((re) => re.test(key));
}

function truncateString(value: string, maxLen: number): string {
  if (value.length <= maxLen) {return value;}
  return `${value.slice(0, maxLen)}…(truncated ${value.length - maxLen} chars)`;
}

function sanitizeString(value: string, maxLen: number): string {
  let s = value;

  // Best-effort redaction of common header/token formats
  s = s.replace(/\bBearer\s+[A-Za-z0-9._-]+/gi, "Bearer [REDACTED]");
  s = s.replace(/\bxi-api-key\s*[:=]\s*[^,\s]+/gi, "xi-api-key=[REDACTED]");

  // Best-effort query param redaction (even when not a valid URL)
  s = s.replace(
    /([?&](?:api_key|apikey|token|signature|sig|key)=)[^&\s]+/gi,
    "$1[REDACTED]"
  );

  // If it looks like a URL, drop query params entirely.
  if (/^https?:\/\//i.test(s)) {
    try {
      const u = new URL(s);
      if (u.search) {u.search = "";}
      if (u.username) {u.username = "";}
      if (u.password) {u.password = "";}
      s = u.toString();
    } catch {
      // Ignore URL parse failures (keep best-effort regex redaction above)
    }
  }

  return truncateString(s, maxLen);
}

function sanitizeValue(
  value: unknown,
  opts: Required<SanitizeForLoggingOptions>,
  depth: number
): unknown {
  if (value === null || value === undefined) {return value;}
  if (depth > opts.maxDepth) {return "[Truncated depth]";}

  if (typeof value === "string") {return sanitizeString(value, opts.maxStringLength);}
  if (typeof value === "number") {return Number.isFinite(value) ? value : String(value);}
  if (typeof value === "boolean") {return value;}
  if (typeof value === "bigint") {return value.toString();}
  if (typeof value === "symbol") {return value.toString();}
  if (typeof value === "function") {return "[Function]";}

  if (value instanceof Date) {return value.toISOString();}
  if (value instanceof Error) {
    return {
      name: value.name,
      message: sanitizeString(value.message, opts.maxStringLength),
    };
  }

  if (Array.isArray(value)) {
    const max = Math.max(0, opts.maxArrayLength);
    const sliced = value.slice(0, max).map((v) => sanitizeValue(v, opts, depth + 1));
    if (value.length <= max) {return sliced;}
    return [...sliced, `…(${value.length - max} more)`];
  }

  if (isPlainObject(value)) {
    const entries = Object.entries(value);
    const max = Math.max(0, opts.maxObjectKeys);
    const sliced = entries.slice(0, max);

    const out: Record<string, unknown> = {};
    for (const [k, v] of sliced) {
      out[k] = shouldRedactKey(k) ? "[REDACTED]" : sanitizeValue(v, opts, depth + 1);
    }

    if (entries.length > max) {
      out._truncated_keys = entries.length - max;
    }

    return out;
  }

  // Fallback: make it JSON-safe and bounded.
  try {
    return sanitizeString(String(value), opts.maxStringLength);
  } catch {
    return "[Unserializable]";
  }
}

export function sanitizeForLogging(
  value: unknown,
  options?: SanitizeForLoggingOptions
): unknown {
  const opts: Required<SanitizeForLoggingOptions> = {
    ...DEFAULTS,
    ...(options ?? {}),
  };
  return sanitizeValue(value, opts, 0);
}

