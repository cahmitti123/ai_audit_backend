/**
 * Realtime Event Bus
 * ==================
 * Shared realtime event stream for the frontend.
 *
 * - Uses Redis Streams when `REDIS_URL` is configured (supports resume via stream IDs).
 * - Falls back to an in-memory EventEmitter (single-process dev only).
 *
 * Stream key format:
 * - `realtime:{topic}`
 *
 * Topic conventions:
 * - `audit:{auditId}`
 * - `fiche:{ficheId}`
 * - `job:{jobId}`
 */

import { EventEmitter } from "events";
import type { RedisClientType } from "redis";
import { logger } from "./logger.js";
import { getRedisClient, getRedisDedicatedClient } from "./redis.js";

export type RealtimeEvent = {
  /**
   * Redis Stream entry id (e.g. "1734040000000-0")
   * Present when read from Redis.
   */
  id?: string;
  topic: string;
  type: string;
  timestamp: string;
  source: string;
  data: unknown;
};

const emitter = new EventEmitter();
emitter.setMaxListeners(1000);

export function topicForAudit(auditId: string): string {
  return `audit:${auditId}`;
}

export function topicForFiche(ficheId: string): string {
  return `fiche:${ficheId}`;
}

export function topicForJob(jobId: string): string {
  return `job:${jobId}`;
}

function streamKey(topic: string): string {
  return `realtime:${topic}`;
}

function toRecord(fields: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (let i = 0; i < fields.length; i += 2) {
    out[String(fields[i])] = String(fields[i + 1]);
  }
  return out;
}

export type RealtimeStreamReader = {
  read: (params: {
    lastId: string;
    blockMs?: number;
    count?: number;
  }) => Promise<{ events: RealtimeEvent[]; lastId: string }>;
  close: () => Promise<void>;
};

export async function createRealtimeRedisStreamReader(
  topic: string
): Promise<RealtimeStreamReader | null> {
  const key = streamKey(topic);
  let redis: RedisClientType | null;
  try {
    redis = await getRedisDedicatedClient("realtime-stream-reader");
  } catch (err) {
    logger.warn("Realtime Redis reader unavailable", {
      topic,
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
  if (!redis) return null;
  const redisClient = redis;

  const read: RealtimeStreamReader["read"] = async (params) => {
    const blockMs = Math.max(1000, Number(params.blockMs || 15000));
    const count = Math.max(1, Number(params.count || 50));

    const reply = await redisClient.sendCommand<unknown>([
      "XREAD",
      "BLOCK",
      String(blockMs),
      "COUNT",
      String(count),
      "STREAMS",
      key,
      params.lastId,
    ]);

    if (!reply) {
      return { events: [], lastId: params.lastId };
    }

    const streams = reply as Array<[string, Array<[string, string[]]>]>;
    const out: RealtimeEvent[] = [];
    let newLastId = params.lastId;

    for (const [, entries] of streams) {
      for (const [id, fields] of entries) {
        const record = toRecord(fields);
        const type = record.type || "message";
        const timestamp = record.timestamp || new Date().toISOString();
        const source = record.source || "redis";
        let data: unknown = null;
        try {
          data = record.data ? JSON.parse(record.data) : null;
        } catch {
          data = record.data ?? null;
        }

        out.push({
          id,
          topic,
          type,
          timestamp,
          source,
          data,
        });
        newLastId = id;
      }
    }

    return { events: out, lastId: newLastId };
  };

  const close: RealtimeStreamReader["close"] = async () => {
    try {
      if (redisClient.isOpen) await redisClient.quit();
    } catch {
      // ignore
    }
  };

  return { read, close };
}

/**
 * Publish an event to realtime subscribers.
 *
 * Returns the Redis stream id when Redis is enabled, otherwise null.
 */
export async function publishRealtimeEvent(params: {
  topic: string;
  type: string;
  data: unknown;
  source?: string;
}): Promise<string | null> {
  const { topic, type, data } = params;
  const source = params.source || "api";
  const timestamp = new Date().toISOString();

  // Always emit locally (useful even when Redis is enabled)
  emitter.emit(topic, { topic, type, timestamp, source, data } satisfies RealtimeEvent);

  let redis: RedisClientType | null;
  try {
    redis = await getRedisClient();
  } catch (err) {
    logger.warn("Realtime Redis unavailable", {
      topic,
      type,
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
  if (!redis) return null;

  const maxLen = Math.max(100, Number(process.env.REALTIME_STREAM_MAXLEN || 1000));
  const key = streamKey(topic);

  try {
    const id = await redis.sendCommand<string>([
      "XADD",
      key,
      "MAXLEN",
      "~",
      String(maxLen),
      "*",
      "type",
      type,
      "timestamp",
      timestamp,
      "source",
      source,
      "data",
      JSON.stringify(data ?? null),
    ]);
    return id;
  } catch (err) {
    logger.error("Failed to publish realtime event", {
      topic,
      type,
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

/**
 * Subscribe to local (in-process) events. Useful as a fallback when Redis isn't configured.
 */
export function subscribeLocal(
  topic: string,
  handler: (event: RealtimeEvent) => void
): () => void {
  emitter.on(topic, handler);
  return () => emitter.off(topic, handler);
}

/**
 * Blocking read from Redis Stream for SSE streaming.
 */
export async function readRealtimeEvents(params: {
  topic: string;
  lastId: string;
  blockMs?: number;
  count?: number;
}): Promise<{ events: RealtimeEvent[]; lastId: string }> {
  const { topic } = params;
  const reader = await createRealtimeRedisStreamReader(topic);
  if (!reader) return { events: [], lastId: params.lastId };
  try {
    return await reader.read({
      lastId: params.lastId,
      blockMs: params.blockMs,
      count: params.count,
    });
  } finally {
    await reader.close();
  }
}


