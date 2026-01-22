/**
 * Redis Distributed Lock
 * ======================
 * Small helper for cross-replica mutual exclusion.
 *
 * Uses:
 * - SET key value NX PX ttl
 * - Safe release via Lua compare-and-del
 *
 * If Redis is not configured, locks are treated as acquired (no-op release).
 */

import crypto from "crypto";

import { logger } from "./logger.js";
import { getRedisClient } from "./redis.js";

export type RedisLock = {
  acquired: boolean;
  key: string;
  token: string;
  release: () => Promise<void>;
};

const RELEASE_SCRIPT = `
if redis.call("GET", KEYS[1]) == ARGV[1] then
  return redis.call("DEL", KEYS[1])
else
  return 0
end
`;

export async function acquireRedisLock(params: {
  key: string;
  ttlMs: number;
}): Promise<RedisLock> {
  const { acquired, token, enabled } = await tryAcquireRedisLock({
    key: params.key,
    ttlMs: params.ttlMs,
  });

  return {
    acquired,
    key: params.key,
    token,
    release: async () => {
      if (!enabled) {return;}
      await releaseRedisLock({ key: params.key, token });
    },
  };
}

export async function tryAcquireRedisLock(params: {
  key: string;
  ttlMs: number;
}): Promise<{ acquired: boolean; token: string; enabled: boolean }> {
  const token = crypto.randomUUID();
  const key = params.key;
  const ttlMs = Math.max(1000, Number(params.ttlMs));

  let redis;
  try {
    redis = await getRedisClient();
  } catch (err) {
    logger.warn("Redis unavailable for lock (treating as unlocked)", {
      key,
      error: (err as Error).message,
    });
    return { acquired: true, token, enabled: false };
  }

  if (!redis) {
    return { acquired: true, token, enabled: false };
  }

  const result = await redis.set(key, token, { NX: true, PX: ttlMs });
  return { acquired: result === "OK", token, enabled: true };
}

export async function releaseRedisLock(params: {
  key: string;
  token: string;
}): Promise<void> {
  const key = params.key;
  const token = params.token;

  let redis;
  try {
    redis = await getRedisClient();
  } catch (err) {
    logger.warn("Redis unavailable for lock release", {
      key,
      error: (err as Error).message,
    });
    return;
  }

  if (!redis) {return;}

  try {
    await redis.sendCommand(["EVAL", RELEASE_SCRIPT, "1", key, token]);
  } catch (err) {
    logger.warn("Failed to release redis lock", {
      key,
      error: (err as Error).message,
    });
  }
}


