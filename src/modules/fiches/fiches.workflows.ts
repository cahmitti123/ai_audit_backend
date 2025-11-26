/**
 * Fiches Workflows
 * ================
 * RESPONSIBILITY: Background jobs (Inngest)
 * - Fetch fiche workflow
 * - Revalidation workflows
 * - Cache sales list workflow
 * - Uses cache layer for operations
 *
 * LAYER: Presentation (Background Jobs)
 */

import { inngest } from "../../inngest/client.js";
import { NonRetriableError } from "inngest";
import * as fichesApi from "./fiches.api.js";
import * as fichesCache from "./fiches.cache.js";
import * as fichesRepository from "./fiches.repository.js";
import * as fichesWebhooks from "./fiches.webhooks.js";
import { enrichRecording } from "../../utils/recording-parser.js";
import { RATE_LIMITS, TIMEOUTS, CONCURRENCY } from "../../shared/constants.js";
import { prisma } from "../../shared/prisma.js";
import type { FicheDetailsResponse, Recording } from "./fiches.schemas.js";

// Type definitions for step returns
type CacheCheckResultNotFound = {
  found: false;
  reason: "no_cache" | "cache_expired" | "force_refresh" | "sales_list_only";
  fiche_id: string;
  cache_id: string | null;
  recordings_count: number;
  expires_at: string | null;
};

type CacheCheckResultFound = {
  found: true;
  reason: "cache_valid" | "cache_valid_full_details";
  fiche_id: string;
  cache_id: string;
  recordings_count: number;
  expires_at: string;
  cached_data: unknown;
};

type CacheCheckResult = CacheCheckResultNotFound | CacheCheckResultFound;

export interface FicheFetchResult {
  success: boolean;
  cached: boolean;
  fiche_id: string;
  cache_id: string;
  recordings_count: number;
  message?: string;
  cache_check?: {
    found: boolean;
    reason: string;
    expires_at: string | null;
  };
  workflow_summary?: {
    total_steps_executed?: number;
    used_cache?: boolean;
    cache_check?: string;
    api_fetch?: unknown;
    enrichment?: unknown;
    database?: unknown;
  };
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
    concurrency: [
      {
        limit: CONCURRENCY.FICHE_FETCH.limit,
      },
    ],
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
    const { fiche_id, force_refresh } = event.data;

    logger.info("Starting fiche fetch", {
      fiche_id,
      force_refresh: force_refresh || false,
    });

    // Step 1: Check cache
    const cacheCheckResult = await step.run(
      "check-cache",
      async (): Promise<CacheCheckResult> => {
        logger.info("Checking database cache", { fiche_id, force_refresh });

        const { getCachedFiche } = await import("./fiches.repository.js");
        const cachedData = await getCachedFiche(fiche_id);

        if (!cachedData) {
          logger.info("No cache found", { fiche_id });
          return {
            found: false,
            reason: "no_cache",
            fiche_id,
            cache_id: null,
            recordings_count: 0,
            expires_at: null,
          };
        }

        const isExpired = cachedData.expiresAt <= new Date();

        if (isExpired || force_refresh) {
          logger.info("Cache expired or refresh forced", {
            fiche_id,
            expired: isExpired,
            force_refresh,
          });
          return {
            found: false,
            reason: isExpired ? "cache_expired" : "force_refresh",
            fiche_id,
            cache_id: String(cachedData.id),
            recordings_count: cachedData.recordingsCount || 0,
            expires_at: cachedData.expiresAt.toISOString(),
          };
        }

        // Check if cached data is only sales list (minimal data without recordings)
        const rawData = cachedData.rawData as any;
        if (rawData._salesListOnly) {
          logger.info(
            "Cache has only sales list data, need to fetch full details",
            {
              fiche_id,
              cache_id: String(cachedData.id),
              recordings: cachedData.recordingsCount,
            }
          );
          return {
            found: false,
            reason: "sales_list_only",
            fiche_id,
            cache_id: String(cachedData.id),
            recordings_count: cachedData.recordingsCount || 0,
            expires_at: cachedData.expiresAt.toISOString(),
          };
        }

        logger.info("Valid cache found with full details", {
          fiche_id,
          cache_id: String(cachedData.id),
          recordings: cachedData.recordingsCount,
          expires_at: cachedData.expiresAt,
        });

        return {
          found: true,
          reason: "cache_valid_full_details",
          fiche_id,
          cache_id: String(cachedData.id),
          recordings_count: cachedData.recordingsCount || 0,
          expires_at: cachedData.expiresAt.toISOString(),
          cached_data: cachedData.rawData,
        };
      }
    );

    // If cached, emit completion event and return
    if (cacheCheckResult.found) {
      // TypeScript now knows this is the 'found: true' variant
      const cacheId: string = cacheCheckResult.cache_id;
      const recordingsCount: number = cacheCheckResult.recordings_count || 0;

      await step.sendEvent("emit-cached-result", {
        name: "fiche/fetched",
        data: {
          fiche_id,
          cache_id: cacheId,
          recordings_count: recordingsCount,
          cached: true,
        },
      });

      logger.info("Returning cached fiche", {
        fiche_id,
        cache_id: cacheId,
        recordings_count: recordingsCount,
      });

      return {
        success: true,
        cached: true,
        fiche_id,
        cache_id: cacheId,
        recordings_count: recordingsCount,
        message: "Using cached data",
        cache_check: {
          found: true as const,
          reason: cacheCheckResult.reason,
          expires_at: cacheCheckResult.expires_at,
        },
        workflow_summary: {
          total_steps_executed: 1,
          used_cache: true,
        },
      };
    }

    // Step 2: Fetch from API with retry
    const apiResult = await step.run("fetch-from-api", async () => {
      logger.info("Fetching from external API", {
        fiche_id,
      });

      // Get cached data to extract cle
      const cached = await prisma.ficheCache.findUnique({
        where: { ficheId: fiche_id },
      });

      if (!cached) {
        throw new Error(
          `Fiche ${fiche_id} not in cache - cannot fetch without cle`
        );
      }

      const rawData = cached.rawData as any;
      const cle = rawData.cle || rawData.information?.cle;

      if (!cle) {
        throw new Error(`Missing cle parameter for fiche ${fiche_id}`);
      }

      try {
        const data = await fichesApi.fetchFicheDetails(fiche_id, cle);

        logger.info("API fetch successful", {
          fiche_id,
          recordings_count: data.recordings?.length || 0,
          has_prospect: Boolean(data.prospect),
          groupe: data.information?.groupe,
        });

        return {
          success: true,
          fiche_id,
          data,
          summary: {
            has_prospect: Boolean(data.prospect),
            has_information: Boolean(data.information),
            groupe: data.information?.groupe || null,
            prospect_name: data.prospect
              ? `${data.prospect.prenom} ${data.prospect.nom}`
              : null,
            recordings_count: data.recordings?.length || 0,
            commentaires_count: data.commentaires?.length || 0,
            alertes_count: data.alertes?.length || 0,
            mails_count: data.mails?.length || 0,
          },
        };
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
    const enrichResult = await step.run("enrich-recordings", async () => {
      const ficheData = apiResult.data;
      const recordingsCount = ficheData.recordings?.length || 0;

      logger.info("Enriching recordings metadata", {
        fiche_id,
        count: recordingsCount,
      });

      if (recordingsCount === 0) {
        return {
          success: true,
          fiche_id,
          enriched_count: 0,
          recordings_count: 0,
          message: "No recordings to enrich",
        };
      }

      if (ficheData.recordings) {
        // Enrich all recordings with parsed metadata
        const enrichedRecordings = ficheData.recordings.map((rec, index) => {
          // Cast to unknown first to avoid Inngest JsonifyObject type issues
          const enriched = enrichRecording(rec as unknown as Recording);

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

        // Count successfully enriched recordings
        const enrichedCount = enrichedRecordings.filter((r) => r.parsed).length;

        // Update recordings array - need to cast due to Inngest serialization
        (ficheData as { recordings?: unknown[] }).recordings =
          enrichedRecordings;

        logger.info("Recordings enriched", {
          fiche_id,
          total: recordingsCount,
          enriched: enrichedCount,
        });

        return {
          success: true,
          fiche_id,
          enriched_count: enrichedCount,
          recordings_count: recordingsCount,
          enrichment_rate: `${enrichedCount}/${recordingsCount}`,
          sample_recording: enrichedRecordings[0]
            ? {
                call_id: enrichedRecordings[0].call_id,
                duration: enrichedRecordings[0].duration_seconds,
                has_parsed_data: Boolean(enrichedRecordings[0].parsed),
              }
            : null,
        };
      }

      return {
        success: true,
        fiche_id,
        enriched_count: 0,
        recordings_count: recordingsCount,
        message: "No recordings array found",
      };
    });

    // Step 4: Cache in database
    const cacheResult = await step.run("cache-in-db", async () => {
      // Get the fiche data and cast to proper type (Inngest serializes to JsonifyObject)
      const ficheData = apiResult.data as unknown as FicheDetailsResponse;

      logger.info("Saving to database", {
        fiche_id,
        recordings_to_store: ficheData.recordings?.length || 0,
      });

      const cached = await fichesCache.cacheFicheDetails(ficheData);

      logger.info("Database save successful", {
        fiche_id,
        cache_id: String(cached.id),
        recordings_stored: ficheData.recordings?.length || 0,
        expires_at: cached.expiresAt,
      });

      return {
        success: true,
        fiche_id,
        cache_id: String(cached.id),
        database_entry: {
          id: String(cached.id),
          fiche_id: cached.ficheId,
          groupe: cached.groupe,
          agence_nom: cached.agenceNom,
          prospect_nom: cached.prospectNom || null,
          prospect_prenom: cached.prospectPrenom || null,
          recordings_count: cached.recordingsCount || 0,
          has_recordings: cached.hasRecordings,
          fetched_at: cached.fetchedAt.toISOString(),
          expires_at: cached.expiresAt.toISOString(),
        },
      };
    });

    const cacheId: string = cacheResult.cache_id;
    const recordingsCount: number = enrichResult.recordings_count || 0;

    // Step 5: Emit completion event
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
      total_steps: 5,
    });

    return {
      success: true,
      cached: false,
      fiche_id,
      cache_id: cacheId,
      recordings_count: recordingsCount,
      message: "Fiche fetched and cached successfully",
      workflow_summary: {
        cache_check: cacheCheckResult.reason,
        api_fetch: apiResult.summary,
        enrichment: {
          recordings_enriched: enrichResult.enriched_count,
          recordings_total: enrichResult.recordings_count,
        },
        database: cacheResult.database_entry,
      },
    };
  }
);

/**
 * Revalidate Fiches for Date
 * ===========================
 * Background job to revalidate/update sales list for a single date
 * Used for daily revalidation of individual dates
 */
export const revalidateFichesFunction = inngest.createFunction(
  {
    id: "revalidate-fiches-for-date",
    name: "Revalidate Fiches for Date",
    retries: 3,
    rateLimit: {
      limit: 20,
      period: "1m",
    },
    timeouts: {
      finish: "5m",
    },
  },
  { event: "fiches/revalidate-date" },
  async ({ event, step, logger }) => {
    const { date } = event.data;

    logger.info("Starting fiches revalidation for single date", { date });

    // Use the cache-sales-list workflow with date as both start and end
    const cacheWorkflowResult = await step.invoke("cache-sales-list", {
      function: cacheSalesListFunction,
      data: {
        startDate: date,
        endDate: date,
      },
    });

    logger.info("Revalidation delegated to cache workflow", { date });

    return {
      success: true,
      date,
      delegated_to: "cache-sales-list",
      cache_workflow_result: {
        total_fiches: cacheWorkflowResult.workflow_summary.total_fiches,
        cached_successfully:
          cacheWorkflowResult.workflow_summary.cached_successfully,
        cache_failures: cacheWorkflowResult.workflow_summary.cache_failures,
        data_source: cacheWorkflowResult.workflow_summary.data_source,
      },
    };
  }
);

/**
 * Cache Sales List for Date Range
 * ================================
 * Caches sales list with recordings for a date range
 * Uses efficient /sales-with-calls endpoint (single API call)
 * Does NOT fetch individual fiche details - those are on-demand
 */
export const cacheSalesListFunction = inngest.createFunction(
  {
    id: "cache-sales-list-for-date-range",
    name: "Cache Sales List for Date Range",
    retries: 2, // Reduced retries since we handle timeouts gracefully
    rateLimit: {
      limit: 20,
      period: "1m",
    },
    timeouts: {
      finish: "10m", // Increased for large date ranges
    },
  },
  { event: "fiches/cache-sales-list" },
  async ({ event, step, logger }) => {
    const { startDate, endDate, salesData } = event.data;

    logger.info("Starting sales list caching", {
      startDate,
      endDate,
      has_prefetched_data: Boolean(salesData),
    });

    // Step 1: Get sales data (use prefetched or fetch from API with retry logic)
    const salesResult = await step.run("get-sales-data", async () => {
      if (salesData) {
        logger.info("Using prefetched sales data");
        const prefetchedData = salesData as {
          fiches: unknown[];
          total: number;
        };
        return {
          source: "prefetched" as const,
          startDate,
          endDate,
          total: prefetchedData.total,
          fiches_count: prefetchedData.fiches.length,
          data: prefetchedData,
        };
      }

      logger.info("Fetching sales with calls from API", { startDate, endDate });

      try {
        const data = await fichesApi.fetchSalesWithCalls(startDate, endDate);
        logger.info("Sales with calls fetched successfully", {
          startDate,
          endDate,
          total: data.total,
        });

        return {
          source: "api_direct" as const,
          startDate,
          endDate,
          total: data.total,
          fiches_count: data.fiches.length,
          data,
        };
      } catch (error) {
        const err = error as Error;

        // If timeout or large range, try fetching in smaller chunks
        logger.warn("API fetch failed, attempting to fetch in 5-day chunks", {
          startDate,
          endDate,
          error: err.message,
        });

        // Generate date ranges in 5-day chunks
        const dateRanges: Array<{ start: string; end: string }> = [];
        const current = new Date(startDate);
        const end = new Date(endDate);
        const CHUNK_DAYS = 5;

        while (current <= end) {
          const chunkStart = new Date(current);
          const chunkEnd = new Date(current);
          chunkEnd.setDate(chunkEnd.getDate() + CHUNK_DAYS - 1);

          // Don't exceed the final end date
          if (chunkEnd > end) {
            chunkEnd.setTime(end.getTime());
          }

          dateRanges.push({
            start: chunkStart.toISOString().split("T")[0],
            end: chunkEnd.toISOString().split("T")[0],
          });

          // Move to next chunk
          current.setDate(current.getDate() + CHUNK_DAYS);
        }

        logger.info("Fetching sales in 5-day chunks", {
          chunks_count: dateRanges.length,
          chunk_size: CHUNK_DAYS,
        });

        // Fetch each range separately (slower but more reliable)
        const allFiches: unknown[] = [];
        let successfulChunks = 0;
        let failedChunks = 0;

        for (const range of dateRanges) {
          try {
            const chunkSales = await fichesApi.fetchSalesWithCalls(
              range.start,
              range.end
            );
            allFiches.push(...chunkSales.fiches);
            successfulChunks++;
            logger.debug("Chunk sales fetched", {
              start: range.start,
              end: range.end,
              count: chunkSales.fiches.length,
            });
          } catch (chunkError) {
            failedChunks++;
            logger.error("Failed to fetch chunk sales", {
              start: range.start,
              end: range.end,
              error: (chunkError as Error).message,
            });
            // Continue with other chunks
          }
        }

        logger.info("All chunked sales fetched", {
          total_fiches: allFiches.length,
          chunks_attempted: dateRanges.length,
          successful: successfulChunks,
          failed: failedChunks,
        });

        return {
          source: "api_chunked" as const,
          startDate,
          endDate,
          total: allFiches.length,
          fiches_count: allFiches.length,
          data: { fiches: allFiches, total: allFiches.length },
          chunk_stats: {
            total_chunks: dateRanges.length,
            successful_chunks: successfulChunks,
            failed_chunks: failedChunks,
            success_rate: `${successfulChunks}/${dateRanges.length}`,
          },
        };
      }
    });

    // Step 2: Cache all fiches with recordings in parallel batches
    const cacheResult = await step.run(
      "cache-fiches-with-recordings",
      async () => {
        const salesData = salesResult.data;

        logger.info("Caching fiches with recordings", {
          count: salesData.fiches.length,
        });

        const BATCH_SIZE = 10;
        const batches = [];

        for (let i = 0; i < salesData.fiches.length; i += BATCH_SIZE) {
          batches.push(salesData.fiches.slice(i, i + BATCH_SIZE));
        }

        let totalCached = 0;
        let totalFailed = 0;
        const cachedFicheIds: string[] = [];
        const failedFicheIds: Array<{ fiche_id: string; error: string }> = [];

        for (const batch of batches) {
          const results = await Promise.allSettled(
            batch.map(async (fiche: unknown) => {
              const ficheData = fiche as {
                id: string;
                nom: string;
                prenom: string;
                email: string;
                telephone: string;
                recordings?: unknown[];
              };

              // Use cache layer's dedicated function for sales summaries
              const cached = await fichesCache.cacheFicheSalesSummary(
                ficheData as any, // Type includes cle from API
                {
                  lastRevalidatedAt: new Date(),
                }
              );

              logger.debug("Cached fiche with recordings", {
                fiche_id: ficheData.id,
                recordings_count: ficheData.recordings?.length || 0,
                cache_id: String(cached.id),
              });

              return {
                success: true,
                ficheId: ficheData.id,
                cacheId: String(cached.id),
                recordingsCount: ficheData.recordings?.length || 0,
              };
            })
          );

          // Count results
          results.forEach((result, idx) => {
            if (result.status === "fulfilled") {
              totalCached++;
              cachedFicheIds.push(result.value.ficheId);
            } else {
              totalFailed++;
              const ficheData = batch[idx] as { id: string };
              failedFicheIds.push({
                fiche_id: ficheData.id,
                error: result.reason?.message || "Unknown error",
              });
              logger.error("Failed to cache fiche in batch", {
                fiche_id: ficheData.id,
                error: result.reason?.message,
              });
            }
          });
        }

        logger.info("All fiches cached", {
          total: salesData.fiches.length,
          cached: totalCached,
          failed: totalFailed,
        });

        return {
          success: true,
          startDate,
          endDate,
          total_fiches: salesData.fiches.length,
          cached_count: totalCached,
          failed_count: totalFailed,
          success_rate: `${totalCached}/${salesData.fiches.length}`,
          batches_processed: batches.length,
          batch_size: BATCH_SIZE,
          cached_fiche_ids: cachedFicheIds,
          failed_fiches: failedFicheIds,
        };
      }
    );

    logger.info("Sales list caching completed", {
      startDate,
      endDate,
      total: salesResult.fiches_count,
      cached: cacheResult.cached_count,
      failed: cacheResult.failed_count,
    });

    return {
      success: true,
      startDate,
      endDate,
      workflow_summary: {
        data_source: salesResult.source,
        total_fiches: salesResult.fiches_count,
        total_from_api: salesResult.total,
        cached_successfully: cacheResult.cached_count,
        cache_failures: cacheResult.failed_count,
        success_rate: cacheResult.success_rate,
        batches_processed: cacheResult.batches_processed,
      },
      sales_fetch: {
        source: salesResult.source,
        total: salesResult.total,
        fiches_count: salesResult.fiches_count,
        chunk_stats:
          "chunk_stats" in salesResult ? salesResult.chunk_stats : null,
      },
      cache_operation: {
        cached_count: cacheResult.cached_count,
        failed_count: cacheResult.failed_count,
        success_rate: cacheResult.success_rate,
        failed_fiches: cacheResult.failed_fiches.slice(0, 5), // Show first 5 failures
      },
    };
  }
);

/**
 * Progressive Fetch Continuation
 * ==============================
 * Background job to continue fetching remaining dates after initial response
 * Sends webhook notification when complete
 */
export const progressiveFetchContinueFunction = inngest.createFunction(
  {
    id: "progressive-fetch-continue",
    name: "Progressive Fetch Continuation",
    retries: 2,
    rateLimit: {
      limit: 20,
      period: "1m",
    },
    timeouts: {
      finish: "30m",
    },
    concurrency: {
      // Prevent duplicate runs for the same job
      key: "event.data.jobId",
      limit: 1,
    },
  },
  { event: "fiches/progressive-fetch-continue" },
  async ({ event, step, logger }) => {
    const {
      jobId,
      startDate,
      endDate,
      datesAlreadyFetched,
      webhookUrl,
      webhookSecret,
    } = event.data;

    try {
      logger.info("Starting progressive fetch continuation", {
        jobId,
        startDate,
        endDate,
        alreadyFetched: datesAlreadyFetched.length,
        hasWebhook: Boolean(webhookUrl),
      });

      // Load job from database
      const job = await step.run("load-job", async () => {
        const jobRecord = await prisma.progressiveFetchJob.findUnique({
          where: { id: jobId },
        });

        if (!jobRecord) {
          throw new Error(`Job ${jobId} not found in database`);
        }

        // Update status to processing
        await prisma.progressiveFetchJob.update({
          where: { id: jobId },
          data: { status: "processing" },
        });

        return jobRecord;
      });

      // Generate array of all dates in range
      const allDates: string[] = [];
      const current = new Date(startDate);
      const end = new Date(endDate);

      while (current <= end) {
        allDates.push(current.toISOString().split("T")[0]);
        current.setDate(current.getDate() + 1);
      }

      // Get the actual remaining dates from the job record
      const remainingDates = job.datesRemaining;

      logger.info("Dates to fetch from job record", {
        jobId,
        total: allDates.length,
        remaining: remainingDates.length,
        alreadyCompleted: job.datesAlreadyFetched.length,
        remainingDates: remainingDates.slice(0, 5), // First 5
      });

      // If nothing to fetch, exit early
      if (remainingDates.length === 0) {
        logger.info("No remaining dates to fetch, marking complete", { jobId });

        await prisma.progressiveFetchJob.update({
          where: { id: jobId },
          data: { status: "complete", completedAt: new Date() },
        });

        return {
          success: true,
          jobId,
          totalDays: allDates.length,
          completedDays: allDates.length,
          totalFiches: 0,
          failedDates: [],
          ficheIds: [],
          message: "All dates already processed",
        };
      }

      let completedDays = job.completedDays || 0;
      let totalFiches = job.totalFiches || 0;
      const ficheIds: string[] = [...job.resultFicheIds];
      const failedDates: string[] = [];

      // Process dates in parallel batches for better performance
      const BATCH_SIZE = 3; // Process 3 dates concurrently
      const WEBHOOK_FREQUENCY = 5; // Send progress webhook every 5 dates

      for (
        let batchStart = 0;
        batchStart < remainingDates.length;
        batchStart += BATCH_SIZE
      ) {
        const batchDates = remainingDates.slice(
          batchStart,
          batchStart + BATCH_SIZE
        );

        logger.info("Processing batch of dates", {
          jobId,
          batchSize: batchDates.length,
          dates: batchDates,
          progress: `${batchStart}/${remainingDates.length}`,
        });

        // Process batch dates in parallel
        const batchResults = await Promise.allSettled(
          batchDates.map(async (date) => {
            return await step.run(`fetch-day-${date}`, async () => {
              try {
                logger.info("Fetching day in background", {
                  jobId,
                  date,
                  batchProgress: `${batchStart + 1}-${
                    batchStart + batchDates.length
                  }/${remainingDates.length}`,
                });

                // Check if already cached (deduplication)
                const alreadyCached = await fichesRepository.hasDataForDate(
                  date
                );
                if (alreadyCached) {
                  logger.info("Day already cached, skipping", { jobId, date });
                  return {
                    success: true,
                    date,
                    cached: true,
                    fichesCount: 0,
                    ficheIds: [],
                  };
                }

                // Fetch from API with retry
                let salesData;
                let retries = 0;
                const MAX_RETRIES = 2;

                while (retries <= MAX_RETRIES) {
                  try {
                    salesData = await fichesApi.fetchSalesWithCalls(date, date);
                    break; // Success
                  } catch (fetchError) {
                    retries++;
                    if (retries > MAX_RETRIES) {
                      throw fetchError; // Give up after retries
                    }
                    logger.warn("Fetch failed, retrying", {
                      jobId,
                      date,
                      attempt: retries,
                      maxRetries: MAX_RETRIES,
                      error: (fetchError as Error).message,
                    });
                    // Wait before retry (exponential backoff)
                    await new Promise((resolve) =>
                      setTimeout(resolve, 5000 * retries)
                    );
                  }
                }

                if (!salesData) {
                  throw new Error("Failed to fetch sales data after retries");
                }

                logger.info("Day fetched from API", {
                  jobId,
                  date,
                  count: salesData.fiches.length,
                });

                // Cache all fiches with the salesDate they belong to
                const cachedFicheIds: string[] = [];
                for (const fiche of salesData.fiches) {
                  // Skip fiches without cle (can't fetch details later)
                  if (!fiche.cle) {
                    logger.warn("Fiche missing cle, skipping", {
                      fiche_id: fiche.id,
                      date,
                    });
                    continue;
                  }

                  await fichesCache.cacheFicheSalesSummary(
                    {
                      id: fiche.id,
                      cle: fiche.cle, // Store cle for later detail fetching
                      nom: fiche.nom,
                      prenom: fiche.prenom,
                      email: fiche.email,
                      telephone: fiche.telephone,
                      recordings: fiche.recordings,
                    },
                    {
                      lastRevalidatedAt: new Date(),
                      salesDate: date, // Track which CRM sales date this fiche belongs to
                    }
                  );
                  cachedFicheIds.push(fiche.id);
                }

                logger.info("Day cached successfully", {
                  jobId,
                  date,
                  fichesCount: salesData.fiches.length,
                });

                return {
                  success: true,
                  date,
                  cached: false,
                  fichesCount: salesData.fiches.length,
                  ficheIds: cachedFicheIds,
                };
              } catch (error) {
                const err = error as Error;
                logger.error("Failed to fetch day", {
                  jobId,
                  date,
                  error: err.message,
                });

                return {
                  success: false,
                  date,
                  error: err.message,
                };
              }
            });
          })
        );

        // Process batch results
        for (let i = 0; i < batchResults.length; i++) {
          const result = batchResults[i];
          const date = batchDates[i];

          if (result.status === "fulfilled" && result.value.success) {
            completedDays++;
            totalFiches += (result.value as { fichesCount: number })
              .fichesCount;
            ficheIds.push(...(result.value as { ficheIds: string[] }).ficheIds);
          } else {
            failedDates.push(date);

            // Update job with failed date
            await prisma.progressiveFetchJob.update({
              where: { id: jobId },
              data: {
                datesFailed: { push: date },
              },
            });
          }
        }

        // Update job progress after each batch
        const progress = Math.round((completedDays / allDates.length) * 100);
        const completedDatesArray = allDates.slice(0, completedDays);
        const remainingDatesArray = remainingDates.slice(
          batchStart + BATCH_SIZE
        );

        await prisma.progressiveFetchJob.update({
          where: { id: jobId },
          data: {
            completedDays,
            progress,
            totalFiches,
            resultFicheIds: ficheIds,
            datesAlreadyFetched: completedDatesArray,
            datesRemaining: remainingDatesArray,
          },
        });

        // Send progress webhook periodically (not every date)
        const shouldSendWebhook =
          webhookUrl &&
          (completedDays % WEBHOOK_FREQUENCY === 0 ||
            completedDays === allDates.length);

        if (shouldSendWebhook) {
          logger.info("Sending progress webhook", {
            jobId,
            completedDays,
            totalDays: allDates.length,
            progress,
          });

          // Get current cached fiches for the entire range
          const startOfRange = new Date(startDate);
          startOfRange.setHours(0, 0, 0, 0);
          const endOfRange = new Date(endDate);
          endOfRange.setHours(23, 59, 59, 999);

          const currentCachedData = await fichesRepository.getFichesByDateRange(
            startOfRange,
            endOfRange
          );

          await fichesWebhooks.sendProgressWebhookWithData(
            webhookUrl,
            jobId,
            {
              completedDays,
              totalDays: allDates.length,
              totalFiches,
              progress,
              currentFichesCount: currentCachedData.length,
              latestDate: batchDates[batchDates.length - 1],
              fiches: currentCachedData.map((fc) => ({
                ficheId: fc.ficheId,
                groupe: fc.groupe,
                prospectNom: fc.prospectNom,
                prospectPrenom: fc.prospectPrenom,
                recordingsCount: fc.recordings.length,
                createdAt: fc.createdAt,
              })),
            },
            webhookSecret
          );
        }

        logger.info("Batch completed", {
          jobId,
          batchDates,
          completedDays,
          totalDays: allDates.length,
          progress,
        });
      }

      // Mark complete and send final webhook
      await step.run("notify-completion", async () => {
        // Update job to complete status
        await prisma.progressiveFetchJob.update({
          where: { id: jobId },
          data: {
            status: failedDates.length === 0 ? "complete" : "complete",
            progress: 100,
            completedAt: new Date(),
          },
        });

        if (webhookUrl) {
          logger.info("Sending completion webhook", {
            jobId,
            totalDays: allDates.length,
            totalFiches,
            failedDates: failedDates.length,
          });

          const apiBaseUrl =
            process.env.API_BASE_URL || "http://localhost:3000";

          await fichesWebhooks.sendCompletionWebhook(
            webhookUrl,
            jobId,
            {
              totalDays: allDates.length,
              totalFiches,
              dataUrl: `${apiBaseUrl}/api/fiches/status/by-date-range?startDate=${startDate}&endDate=${endDate}`,
            },
            webhookSecret
          );

          logger.info("Completion webhook sent", { jobId });
        }
      });

      logger.info("Progressive fetch continuation completed", {
        jobId,
        totalDays: allDates.length,
        completedDays,
        totalFiches,
        failedDates: failedDates.length,
      });

      return {
        success: true,
        jobId,
        totalDays: allDates.length,
        completedDays,
        totalFiches,
        failedDates,
        ficheIds: ficheIds.slice(0, 10), // Return first 10 IDs
      };
    } catch (error) {
      const err = error as Error;
      logger.error("Progressive fetch job failed", {
        jobId,
        error: err.message,
        stack: err.stack,
      });

      // Update job as failed
      await prisma.progressiveFetchJob.update({
        where: { id: jobId },
        data: {
          status: "failed",
          error: err.message,
          completedAt: new Date(),
        },
      });

      // Send failure webhook if configured
      if (webhookUrl) {
        await fichesWebhooks.sendFailureWebhook(
          webhookUrl,
          jobId,
          err.message,
          webhookSecret
        );
      }

      throw err; // Re-throw for Inngest to handle
    }
  }
);

export const functions = [
  fetchFicheFunction,
  revalidateFichesFunction,
  cacheSalesListFunction,
  progressiveFetchContinueFunction,
];
