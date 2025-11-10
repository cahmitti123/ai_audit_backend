/**
 * Fiches Workflows
 * ================
 * Inngest workflow functions for fiche operations
 */

import { inngest } from "../../inngest/client.js";
import { NonRetriableError } from "inngest";
import { fetchApiFicheDetails } from "./fiches.service.js";
import { cacheFiche, getCachedFiche } from "./fiches.repository.js";
import { enrichRecording } from "../../utils/recording-parser.js";
import { RATE_LIMITS, TIMEOUTS } from "../../shared/constants.js";
import { logger } from "../../shared/logger.js";

export interface FicheFetchResult {
  success: boolean;
  cached: boolean;
  fiche_id: string;
  cache_id: string;
  recordings_count: number;
  message?: string;
}

/**
 * Fetch Fiche Function
 * ====================
 * Fetches fiche from external API and caches in database
 * - Retries: 3 times
 * - Rate limited: 20/min per fiche
 * - Timeout: 5 minutes
 * - Idempotent: per fiche_id
 */
export const fetchFicheFunction = inngest.createFunction(
  {
    id: "fetch-fiche",
    name: "Fetch Fiche from API",
    retries: 3,
    rateLimit: {
      ...RATE_LIMITS.FICHE_FETCH,
      key: "event.data.fiche_id",
    },
    timeouts: {
      finish: TIMEOUTS.FICHE_FETCH,
    },
    idempotency: "event.data.fiche_id",
  },
  { event: "fiche/fetch" },
  async ({ event, step, logger }): Promise<FicheFetchResult> => {
    const { fiche_id, cle, force_refresh } = event.data;

    logger.info("Starting fiche fetch", {
      fiche_id,
      force_refresh: force_refresh || false,
    });

    // Step 1: Check cache
    const cached = await step.run("check-cache", async () => {
      logger.info("Checking database cache", { fiche_id, force_refresh });

      const cachedData = await getCachedFiche(fiche_id);

      if (!cachedData) {
        logger.info("No cache found", { fiche_id });
        return null;
      }

      const isExpired = cachedData.expiresAt <= new Date();

      if (isExpired || force_refresh) {
        logger.info("Cache expired or refresh forced", {
          fiche_id,
          expired: isExpired,
          force_refresh,
        });
        return null;
      }

      logger.info("Valid cache found", {
        fiche_id,
        cache_id: String(cachedData.id),
        recordings: cachedData.recordingsCount,
        expires_at: cachedData.expiresAt,
      });

      return cachedData;
    });

    // If cached, emit completion event and return
    if (cached) {
      const cacheId = String(cached.id);

      await step.sendEvent("emit-cached-result", {
        name: "fiche/fetched",
        data: {
          fiche_id,
          cache_id: cacheId,
          recordings_count: cached.recordingsCount || 0,
          cached: true,
        },
      });

      logger.info("Returning cached fiche", {
        fiche_id,
        cache_id: cacheId,
        recordings_count: cached.recordingsCount,
      });

      return {
        success: true,
        cached: true,
        fiche_id,
        cache_id: cacheId,
        recordings_count: cached.recordingsCount || 0,
        message: "Using cached data",
      };
    }

    // Step 2: Fetch from API with retry
    const ficheData = await step.run("fetch-from-api", async () => {
      logger.info("Fetching from external API", {
        fiche_id,
        has_cle: Boolean(cle),
      });

      try {
        const data = await fetchApiFicheDetails(fiche_id, cle);

        logger.info("API fetch successful", {
          fiche_id,
          recordings_count: data.recordings?.length || 0,
          has_prospect: Boolean(data.prospect),
          groupe: data.information?.groupe,
        });

        return data;
      } catch (error: unknown) {
        const err = error as { response?: { status: number }; message: string };

        logger.error("API fetch failed", {
          fiche_id,
          status: err.response?.status,
          message: err.message,
        });

        // Non-retriable errors (don't retry)
        if (err.response?.status === 404) {
          throw new NonRetriableError(`Fiche ${fiche_id} not found`);
        }
        if (err.response?.status === 401 || err.response?.status === 403) {
          throw new NonRetriableError(
            `Authentication failed for fiche ${fiche_id}`
          );
        }

        // Retriable errors (will auto-retry up to 3 times)
        throw error;
      }
    });

    // Step 3: Enrich recordings metadata
    const enrichedData = await step.run("enrich-recordings", async () => {
      const recordingsCount = ficheData.recordings?.length || 0;

      logger.info("Enriching recordings metadata", {
        fiche_id,
        count: recordingsCount,
      });

      if (recordingsCount > 0) {
        ficheData.recordings = ficheData.recordings.map((rec: any, index: number) => {
          const enriched = enrichRecording(rec);

          // Log first recording as sample
          if (index === 0) {
            logger.debug("Sample enriched recording", {
              call_id: enriched.call_id,
              has_parsed: Boolean(enriched.parsed),
              duration: enriched.duration_seconds,
            });
          }

          return enriched;
        });
      }

      logger.info("Recordings enriched", {
        fiche_id,
        total: recordingsCount,
      });

      return ficheData;
    });

    // Step 4: Store recordings individually
    const recordingsStored = await step.run("store-recordings", async () => {
      const count = enrichedData.recordings?.length || 0;

      logger.info("Preparing to store recordings", {
        fiche_id,
        count,
      });

      return count;
    });

    // Step 5: Cache in database
    const ficheCacheEntry = await step.run("cache-in-db", async () => {
      logger.info("Saving to database", {
        fiche_id,
        recordings_to_store: recordingsStored,
      });

      const cached = await cacheFiche(enrichedData);

      logger.info("Database save successful", {
        fiche_id,
        cache_id: String(cached.id),
        recordings_stored: recordingsStored,
        expires_at: cached.expiresAt,
      });

      return cached;
    });

    const cacheId = String(ficheCacheEntry.id);
    const recordingsCount = enrichedData.recordings?.length || 0;

    // Step 6: Emit completion event
    await step.sendEvent("emit-completion", {
      name: "fiche/fetched",
      data: {
        fiche_id,
        cache_id: cacheId,
        recordings_count: recordingsCount,
        cached: false,
      },
    });

    logger.info("Fiche fetch workflow completed", {
      fiche_id,
      cache_id: cacheId,
      recordings_count: recordingsCount,
      cached: false,
      total_steps: 6,
    });

    return {
      success: true,
      cached: false,
      fiche_id,
      cache_id: cacheId,
      recordings_count: recordingsCount,
      message: "Fiche fetched and cached successfully",
    };
  }
);

export const functions = [fetchFicheFunction];
