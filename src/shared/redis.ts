/**
 * Redis Singleton
 * ===============
 * Centralized Redis client setup used for realtime and coordination.
 *
 * Notes:
 * - Uses lazy connection (connect on first use).
 * - If REDIS_URL is not configured, functions return null to allow local/dev fallback.
 */

import { createClient, type RedisClientType } from "redis";

import { logger } from "./logger.js";

let client: RedisClientType | null = null;
let connectPromise: Promise<void> | null = null;

function getRedisUrl(): string | null {
  const url = process.env.REDIS_URL;
  return url && url.trim().length > 0 ? url.trim() : null;
}

async function ensureConnected(c: RedisClientType): Promise<void> {
  if (c.isOpen) {return;}
  if (!connectPromise) {
    connectPromise = c
      .connect()
      .then(() => undefined)
      .catch((err) => {
      // Reset promise so future attempts can retry
      connectPromise = null;
      throw err;
      });
  }
  await connectPromise;
}

/**
 * Get the shared Redis client, or null if Redis is not configured.
 */
export async function getRedisClient(): Promise<RedisClientType | null> {
  const url = getRedisUrl();
  if (!url) {return null;}

  if (!client) {
    client = createClient({ url });
    client.on("error", (err) => {
      logger.error("Redis client error", { error: (err as Error).message });
    });
    client.on("reconnecting", () => {
      logger.warn("Redis reconnecting...");
    });
  }

  await ensureConnected(client);
  return client;
}

/**
 * Create a dedicated client for blocking reads (streams) or pub/sub.
 */
export async function getRedisDedicatedClient(
  purpose: string
): Promise<RedisClientType | null> {
  const base = await getRedisClient();
  if (!base) {return null;}

  const dedicated = base.duplicate();
  dedicated.on("error", (err) => {
    logger.error("Redis client error", {
      purpose,
      error: (err as Error).message,
    });
  });
  await ensureConnected(dedicated);
  return dedicated;
}

export async function disconnectRedis(): Promise<void> {
  if (!client) {return;}
  try {
    if (client.isOpen) {
      await client.quit();
    }
  } catch {
    // ignore
  } finally {
    client = null;
    connectPromise = null;
  }
}


