/**
 * Concurrency Utilities
 * =====================
 * Small helpers to safely limit parallelism without extra dependencies.
 */

export type Limiter = <T>(fn: () => Promise<T>) => Promise<T>;

/**
 * Create a concurrency limiter (similar to `p-limit`).
 */
export function createConcurrencyLimiter(concurrency: number): Limiter {
  const n = Number(concurrency);
  if (!Number.isFinite(n) || n < 1) {
    throw new Error(`Invalid concurrency: ${concurrency}`);
  }

  let activeCount = 0;
  const queue: Array<() => void> = [];

  const next = () => {
    activeCount--;
    const run = queue.shift();
    if (run) run();
  };

  const runLimited = async <T>(
    fn: () => Promise<T>,
    resolve: (value: T) => void,
    reject: (reason: unknown) => void
  ) => {
    activeCount++;
    try {
      const result = await fn();
      resolve(result);
    } catch (err) {
      reject(err);
    } finally {
      next();
    }
  };

  return <T>(fn: () => Promise<T>) =>
    new Promise<T>((resolve, reject) => {
      const run = () => void runLimited(fn, resolve, reject);
      if (activeCount < n) run();
      else queue.push(run);
    });
}

/**
 * Map items with bounded concurrency. Preserves result order.
 */
export async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const limit = createConcurrencyLimiter(concurrency);
  const tasks = items.map((item, index) => limit(() => worker(item, index)));
  return await Promise.all(tasks);
}






