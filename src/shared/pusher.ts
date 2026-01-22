/**
 * Pusher (Server SDK) Helpers
 * ==========================
 * - Centralizes Pusher client creation (env-driven, lazy).
 * - Defines channel naming conventions for our domain.
 * - Adds payload-size guarding to avoid Pusher message size limits.
 *
 * NOTE: This backend currently has **no auth middleware** (see docs).
 * If you enable private/presence channels, you should implement real user/org auth
 * or proxy auth through a trusted Next.js API route.
 */

import Pusher from "pusher";

import { getPayloadSize } from "../utils/payload-size.js";
import { logger } from "./logger.js";

const DEFAULT_PUSHER_MAX_PAYLOAD_BYTES = 9000; // keep buffer vs Pusher limits (~10KB)

const CHANNEL_ALLOWED_CHARS = /^[A-Za-z0-9_\-=@,.;]+$/;
const CHANNEL_DISALLOWED_CHARS = /[^A-Za-z0-9_\-=@,.;]/g;

let cachedPusher: Pusher | null | undefined;
let warnedMissingConfig = false;

function envString(key: string): string | undefined {
  const raw = process.env[key];
  const trimmed = typeof raw === "string" ? raw.trim() : "";
  return trimmed.length > 0 ? trimmed : undefined;
}

export function isPusherConfigured(): boolean {
  return Boolean(
    envString("PUSHER_APP_ID") &&
      (envString("PUSHER_KEY") || envString("NEXT_PUBLIC_PUSHER_KEY")) &&
      envString("PUSHER_SECRET") &&
      envString("PUSHER_CLUSTER")
  );
}

export function usePrivatePusherChannels(): boolean {
  const raw = (process.env.PUSHER_USE_PRIVATE_CHANNELS ?? "1").trim().toLowerCase();
  return raw !== "0" && raw !== "false" && raw !== "no";
}

export function channelForAuditId(auditId: string): string {
  const prefix = usePrivatePusherChannels() ? "private-" : "";
  return `${prefix}audit-${normalizePusherChannelPart(auditId)}`;
}

export function channelForFicheId(ficheId: string): string {
  const prefix = usePrivatePusherChannels() ? "private-" : "";
  return `${prefix}fiche-${normalizePusherChannelPart(ficheId)}`;
}

export function channelForJobId(jobId: string): string {
  const prefix = usePrivatePusherChannels() ? "private-" : "";
  return `${prefix}job-${normalizePusherChannelPart(jobId)}`;
}

export function getPusherClient(): Pusher | null {
  if (cachedPusher !== undefined) {return cachedPusher;}

  const appId = envString("PUSHER_APP_ID");
  const key = envString("PUSHER_KEY") || envString("NEXT_PUBLIC_PUSHER_KEY");
  const secret = envString("PUSHER_SECRET");
  const cluster = envString("PUSHER_CLUSTER");

  if (!appId || !key || !secret || !cluster) {
    cachedPusher = null;
    if (!warnedMissingConfig) {
      warnedMissingConfig = true;
      logger.warn("Pusher is not configured; realtime Pusher publishing is disabled", {
        hasAppId: Boolean(appId),
        hasKey: Boolean(key),
        hasSecret: Boolean(secret),
        hasCluster: Boolean(cluster),
      });
    }
    return cachedPusher;
  }

  cachedPusher = new Pusher({
    appId,
    key,
    secret,
    cluster,
    useTLS: true,
  });

  logger.info("Pusher configured", {
    cluster,
    privateChannels: usePrivatePusherChannels(),
  });

  return cachedPusher;
}

/**
 * Test helper: reset the cached singleton so tests can safely modify env.
 * Not used by production code.
 */
export function __resetPusherClientForTests() {
  cachedPusher = undefined;
  warnedMissingConfig = false;
}

export function normalizePusherChannelPart(value: string): string {
  const cleaned = String(value || "")
    .trim()
    // Replace any unsupported char with "_"
    .replace(CHANNEL_DISALLOWED_CHARS, "_");

  // Keep room for prefixes (private-/presence- + kind + "-")
  return cleaned.slice(0, 180);
}

export function isValidPusherChannelName(channel: string): { ok: true } | { ok: false; error: string } {
  const name = String(channel || "");
  if (name.length === 0) {return { ok: false, error: "channel_name is required" };}
  if (name.length > 200) {return { ok: false, error: "channel_name too long (max 200 chars)" };}
  if (!CHANNEL_ALLOWED_CHARS.test(name)) {
    return { ok: false, error: "channel_name contains invalid characters" };
  }
  // Avoid reserved internal prefix
  if (name.startsWith("pusher-")) {
    return { ok: false, error: "channel_name cannot start with 'pusher-'" };
  }
  return { ok: true };
}

export function isValidPusherEventName(event: string): { ok: true } | { ok: false; error: string } {
  const name = String(event || "");
  if (name.length === 0) {return { ok: false, error: "event is required" };}
  if (name.length > 200) {return { ok: false, error: "event too long (max 200 chars)" };}
  if (name.startsWith("pusher:")) {return { ok: false, error: "event name cannot start with 'pusher:'" };}
  return { ok: true };
}

export function globalPusherChannel(): string {
  const prefix = usePrivatePusherChannels() ? "private-" : "";
  return `${prefix}global`;
}

function getStringField(obj: Record<string, unknown>, key: string): string | null {
  const v = obj[key];
  if (typeof v === "string" && v.trim().length > 0) {return v.trim();}
  return null;
}

export function derivePusherChannelsForEvent(params: {
  event: string;
  payload: unknown;
}): string[] {
  const out = new Set<string>();

  const event = String(params.event || "");
  const payload = params.payload;
  const isGlobalEvent = event === "notification" || event.startsWith("batch.");

  if (typeof payload === "object" && payload !== null && !Array.isArray(payload)) {
    const rec = payload as Record<string, unknown>;

    const auditId = getStringField(rec, "audit_id");
    const auditDbId = getStringField(rec, "audit_db_id");
    const ficheId = getStringField(rec, "fiche_id");
    const jobId = getStringField(rec, "jobId") || getStringField(rec, "job_id");
    const batchId = getStringField(rec, "batch_id");

    if (auditId) {out.add(channelForAuditId(auditId));}
    if (auditDbId && auditDbId !== auditId) {out.add(channelForAuditId(auditDbId));}
    if (ficheId) {out.add(channelForFicheId(ficheId));}
    if (jobId) {out.add(channelForJobId(jobId));}
    if (batchId) {out.add(channelForJobId(batchId));}
  }

  if (out.size === 0 || isGlobalEvent) {
    out.add(globalPusherChannel());
  }

  return Array.from(out);
}

export async function publishPusherEvent(params: {
  event: string;
  payload: unknown;
  channels?: string[];
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const channels = params.channels?.length
    ? params.channels
    : derivePusherChannelsForEvent({ event: params.event, payload: params.payload });
  return await triggerPusher({ channels, event: params.event, payload: params.payload });
}

export function isAllowedAuthChannel(channelName: string): boolean {
  const name = String(channelName || "");

  // If we are using public channels, we generally don't need auth.
  // Still, allow auth for private/presence for migration.
  if (name.startsWith("private-audit-")) {return true;}
  if (name.startsWith("private-fiche-")) {return true;}
  if (name.startsWith("private-job-")) {return true;}

  // Optional future conventions (not wired today, but safe to support)
  if (name.startsWith("private-user-")) {return true;}
  if (name.startsWith("private-org-")) {return true;}
  if (name.startsWith("private-tenant-")) {return true;}
  if (name.startsWith("presence-org-")) {return true;}

  // Global notifications / batch events
  if (name === "private-global" || name === "presence-global") {return true;}

  // Allow a dedicated test channel
  if (name === "private-realtime-test" || name === "presence-realtime-test") {return true;}

  return false;
}

function shrinkRealtimeEventPayload(payload: unknown): unknown {
  // Best effort: shrink payloads that exceed Pusher limits.
  if (typeof payload !== "object" || payload === null) {
    return { truncated: true };
  }
  const rec = payload as Record<string, unknown>;

  // If it looks like the legacy SSE envelope, preserve some envelope metadata.
  const looksLikeEnvelope =
    typeof rec.topic === "string" &&
    typeof rec.type === "string" &&
    typeof rec.timestamp === "string" &&
    "data" in rec;

  const base: Record<string, unknown> = looksLikeEnvelope
    ? {
        topic: rec.topic,
        type: rec.type,
        timestamp: rec.timestamp,
        source: rec.source,
        ...(typeof rec.id === "string" ? { id: rec.id } : {}),
      }
    : {};

  const data = looksLikeEnvelope ? rec.data : payload;
  if (typeof data !== "object" || data === null || Array.isArray(data)) {
    return looksLikeEnvelope
      ? { ...base, data: data ?? null, truncated: true }
      : { truncated: true };
  }

  const d = data as Record<string, unknown>;
  const pickKeys = [
    // Correlation
    "audit_id",
    "audit_db_id",
    "audit_config_id",
    "fiche_id",
    "event_id",
    "batch_id",
    "job_id",
    "jobId",
    // Reruns / step-level signals
    "rerun_id",
    "rerun_scope",
    "step_position",
    "step_name",
    "control_point_index",
    // Common status/progress fields (snake_case + legacy camelCase)
    "schedule_id",
    "run_id",
    "status",
    "progress",
    "current_phase",
    "progress_percentage",
    "completed_steps",
    "total_steps",
    "failed_steps",
    "completedSteps",
    "totalSteps",
    "failedSteps",
    "completedDays",
    "totalDays",
    "totalFiches",
  ] as const;

  const picked: Record<string, unknown> = {};
  for (const k of pickKeys) {
    if (k in d) {picked[k] = d[k];}
  }

  // Include array lengths for a couple common bulky fields
  for (const k of ["datesCompleted", "datesRemaining", "datesFailed"] as const) {
    const v = d[k];
    if (Array.isArray(v)) {picked[`${k}Count`] = v.length;}
  }

  if (looksLikeEnvelope) {
    return { ...base, data: picked, truncated: true };
  }
  return { ...picked, truncated: true };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function toPusherPayload(value: unknown): Record<string, unknown> | null {
  if (value === null || value === undefined) {return null;}
  if (isRecord(value)) {return value;}
  // Pusher SDK types expect an object; wrap primitives/arrays.
  return { value };
}

export async function triggerPusher(params: {
  channels: string[];
  event: string;
  payload: unknown;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const pusher = getPusherClient();
  if (!pusher) {return { ok: false, error: "Pusher not configured" };}

  const channels = (params.channels || []).filter(Boolean);
  if (channels.length === 0) {return { ok: false, error: "No channels to publish to" };}

  const eventOk = isValidPusherEventName(params.event);
  if (!eventOk.ok) {return { ok: false, error: eventOk.error };}

  const maxBytes = Math.max(
    1000,
    Number(process.env.PUSHER_MAX_PAYLOAD_BYTES || DEFAULT_PUSHER_MAX_PAYLOAD_BYTES)
  );

  let payload = toPusherPayload(params.payload ?? null);
  let size = getPayloadSize(payload);
  if (size > maxBytes) {
    const shrunk = shrinkRealtimeEventPayload(payload);
    const shrunkSize = getPayloadSize(shrunk);
    logger.warn("Pusher payload exceeded size limit; sending truncated payload", {
      event: params.event,
      channelsCount: channels.length,
      bytes: size,
      maxBytes,
      shrunkBytes: shrunkSize,
    });
    payload = toPusherPayload(shrunk);
    size = getPayloadSize(payload);
  }

  // Safety: never send insanely large payloads even after truncation.
  if (size > maxBytes) {
    logger.error("Pusher payload still too large after truncation; dropping data", {
      event: params.event,
      channelsCount: channels.length,
      bytes: size,
      maxBytes,
    });
    payload = { truncated: true };
  }

  // Test mode: avoid outbound network calls.
  const dryRun = (process.env.PUSHER_DRY_RUN || "").trim() === "1";
  if (dryRun) {
    logger.info("Pusher dry-run: would publish event", {
      event: params.event,
      channels,
      bytes: getPayloadSize(payload),
    });
    return { ok: true };
  }

  // Pusher supports up to 10 channels per trigger.
  const chunks: string[][] = [];
  for (let i = 0; i < channels.length; i += 10) {
    chunks.push(channels.slice(i, i + 10));
  }

  try {
    for (const chunk of chunks) {
      await pusher.trigger(chunk, params.event, payload);
    }
    return { ok: true };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error("Pusher publish failed", {
      event: params.event,
      channelsCount: channels.length,
      error: msg,
    });
    return { ok: false, error: msg };
  }
}


