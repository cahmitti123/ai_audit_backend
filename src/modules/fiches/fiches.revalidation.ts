/**
 * Fiches Revalidation Logic
 * ==========================
 * RESPONSIBILITY: Cache revalidation logic
 * - Determines when caches should be refreshed
 * - Synchronous revalidation (blocks until complete)
 * - Date-based revalidation logic
 *
 * LAYER: Business Logic
 */

import { logger } from "../../shared/logger.js";
import * as fichesApi from "./fiches.api.js";
import * as fichesCache from "./fiches.cache.js";
import * as fichesRepository from "./fiches.repository.js";

/**
 * Check if a date is today
 */
export function isToday(dateString: string): boolean {
  const date = new Date(dateString);
  const today = new Date();

  return (
    date.getFullYear() === today.getFullYear() &&
    date.getMonth() === today.getMonth() &&
    date.getDate() === today.getDate()
  );
}

/**
 * Check if cache needs revalidation
 */
export function shouldRevalidate(
  dateString: string,
  lastRevalidatedAt: Date | null
): { shouldRevalidate: boolean; reason: string } {
  // Always revalidate if querying today
  if (isToday(dateString)) {
    return {
      shouldRevalidate: true,
      reason: "date_is_today",
    };
  }

  // If never validated, need to revalidate
  if (!lastRevalidatedAt) {
    return {
      shouldRevalidate: true,
      reason: "never_validated",
    };
  }

  // Check if last validation was > 24 hours ago
  const hoursSinceLastRevalidation =
    (Date.now() - lastRevalidatedAt.getTime()) / (1000 * 60 * 60);

  if (hoursSinceLastRevalidation > 24) {
    return {
      shouldRevalidate: true,
      reason: "stale_cache",
    };
  }

  return {
    shouldRevalidate: false,
    reason: "cache_fresh",
  };
}

/**
 * Revalidate fiches for a specific date (synchronous - waits for completion)
 * Fetches from external API and syncs with database
 * Used when no cache exists - user waits for this
 */
export async function revalidateFichesForDateSync(date: string) {
  logger.info("Starting synchronous revalidation for date", { date });

  try {
    // Fetch sales list from external API
    const salesResponse = await fichesApi.fetchSalesWithCalls(date, date, { includeRecordings: process.env.FICHE_SALES_INCLUDE_RECORDINGS === "1" });

    logger.info("Fetched sales from API", {
      date,
      count: salesResponse.fiches.length,
    });

    // Fetch and cache all fiches in parallel batches
    const BATCH_SIZE = 5; // Process 5 fiches at a time
    const batches = [];

    for (let i = 0; i < salesResponse.fiches.length; i += BATCH_SIZE) {
      batches.push(salesResponse.fiches.slice(i, i + BATCH_SIZE));
    }

    let processed = 0;
    let failed = 0;
    const errors: Array<{ ficheId: string; error: string }> = [];

    for (const batch of batches) {
      const results = await Promise.allSettled(
        batch.map(async (sale) => {
          try {
            // Fetch full fiche details
            const ficheDetails = await fichesApi.fetchFicheDetails(sale.id);

            // Validate information exists before caching
            if (!ficheDetails.information) {
              throw new Error("Missing information object");
            }

            // Cache the fiche (upsert)
            await fichesCache.cacheFicheDetails(ficheDetails, {
              lastRevalidatedAt: new Date(),
            });

            logger.debug("Cached fiche during sync revalidation", {
              fiche_id: sale.id,
              date,
            });

            return { success: true, ficheId: sale.id };
          } catch (error) {
            const err = error as Error;
            logger.error("Failed to cache fiche during sync revalidation", {
              fiche_id: sale.id,
              date,
              error: err.message,
            });
            throw error;
          }
        })
      );

      // Count successes and failures
      results.forEach((result, idx) => {
        const sale = batch[idx];
        if (result.status === "fulfilled") {
          processed++;
        } else {
          failed++;
          errors.push({
            ficheId: sale.id,
            error: result.reason?.message || "Unknown error",
          });
        }
      });
    }

    logger.info("Synchronous revalidation completed", {
      date,
      total: salesResponse.fiches.length,
      processed,
      failed,
    });

    return {
      success: true,
      date,
      total: salesResponse.fiches.length,
      processed,
      failed,
      errors,
    };
  } catch (error) {
    const err = error as Error;
    logger.error("Synchronous revalidation failed", {
      date,
      error: err.message,
    });
    throw error;
  }
}

/**
 * Get the most recent revalidation date for a date range
 */
export async function getLastRevalidationForDateRange(
  startDate: Date,
  endDate: Date
): Promise<Date | null> {
  const result = await fichesRepository.getLatestRevalidationInRange(
    startDate,
    endDate
  );

  return result;
}
