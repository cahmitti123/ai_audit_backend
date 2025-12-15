/**
 * Inngest Concurrency Helpers
 * ==========================
 *
 * Goal: Make concurrency scale with the number of API server replicas.
 *
 * Terminology:
 * - "per-server" concurrency: how much parallelism a single Node instance should attempt.
 * - "global" concurrency: total concurrency across ALL replicas (perServer * replicas).
 */

function toPositiveInt(value: unknown, fallback: number): number {
  const n = typeof value === "string" ? Number.parseInt(value, 10) : Number(value);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.floor(n);
}

/**
 * Number of API server replicas that can execute Inngest functions.
 *
 * This must be provided by the deployment (docker compose / k8s), because the runtime
 * cannot reliably discover "how many replicas exist" from inside a container.
 */
export function getInngestServerReplicas(): number {
  return toPositiveInt(
    process.env.INNGEST_SERVER_REPLICAS ?? process.env.SERVER_REPLICAS,
    1
  );
}

/**
 * Default parallelism per server instance.
 *
 * This is used as the default per-key limit (per audit/per fiche) and as the
 * multiplier for global concurrency.
 */
export function getInngestParallelismPerServer(): number {
  return toPositiveInt(process.env.INNGEST_PARALLELISM_PER_SERVER, 10);
}

/**
 * Default global concurrency across all replicas.
 */
export function getInngestGlobalConcurrency(): number {
  return Math.max(1, getInngestServerReplicas() * getInngestParallelismPerServer());
}




