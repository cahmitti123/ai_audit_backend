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
import {
  getInngestGlobalConcurrency,
  getInngestParallelismPerServer,
} from "../../shared/inngest-concurrency.js";
import { prisma } from "../../shared/prisma.js";
import { publishRealtimeEvent, topicForJob } from "../../shared/realtime.js";
import type {
  FicheDetailsResponse,
  Recording,
  SalesFicheWithRecordings,
  SalesWithCallsResponse,
} from "./fiches.schemas.js";

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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isSalesListOnlyRawData(value: unknown): boolean {
  return isRecord(value) && value._salesListOnly === true;
}

function getCleFromRawData(rawData: unknown): string | null {
  if (!isRecord(rawData)) return null;

  const cle = rawData.cle;
  if (typeof cle === "string" && cle) return cle;

  const info = rawData.information;
  if (isRecord(info)) {
    const cle2 = info.cle;
    if (typeof cle2 === "string" && cle2) return cle2;
  }

  return null;
}

function getProgressiveFetchDayContext(event: unknown): {
  jobId?: string;
  date?: string;
} {
  if (!isRecord(event)) return {};
  const data = event.data;
  if (!isRecord(data)) return {};
  const jobId = typeof data.jobId === "string" ? data.jobId : undefined;
  const date = typeof data.date === "string" ? data.date : undefined;
  return { jobId, date };
}

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
        const rawData: unknown = cachedData.rawData;
        if (isSalesListOnlyRawData(rawData)) {
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

      const cle = getCleFromRawData(cached.rawData);

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
        const data = await fichesApi.fetchSalesWithCalls(startDate, endDate, { includeRecordings: process.env.FICHE_SALES_INCLUDE_RECORDINGS === "1" });
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
        const allFiches: SalesWithCallsResponse["fiches"] = [];
        let successfulChunks = 0;
        let failedChunks = 0;

        for (const range of dateRanges) {
          try {
            const chunkSales = await fichesApi.fetchSalesWithCalls(
              range.start,
              range.end,
              { includeRecordings: process.env.FICHE_SALES_INCLUDE_RECORDINGS === "1" }
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

        const data: SalesWithCallsResponse = {
          fiches: allFiches,
          total: allFiches.length,
        };

        return {
          source: "api_chunked" as const,
          startDate,
          endDate,
          total: allFiches.length,
          fiches_count: allFiches.length,
          data,
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

        const cacheConcurrency = Math.max(
          1,
          Number(
            process.env.FICHE_SALES_CACHE_CONCURRENCY ||
              getInngestParallelismPerServer()
          )
        );
        const { mapWithConcurrency } = await import("../../utils/concurrency.js");

        type CacheOneResult =
          | { ok: true; ficheId: string }
          | { ok: false; ficheId: string; error: string };

        const perFicheResults = await mapWithConcurrency<
          SalesFicheWithRecordings,
          CacheOneResult
        >(salesData.fiches as SalesFicheWithRecordings[], cacheConcurrency, async (fiche) => {
          if (!fiche.cle) {
            return { ok: false, ficheId: fiche.id, error: "Missing cle" };
          }

          try {
            const cached = await fichesCache.cacheFicheSalesSummary(
              {
                id: fiche.id,
                cle: fiche.cle,
                nom: fiche.nom,
                prenom: fiche.prenom,
                email: fiche.email,
                telephone: fiche.telephone,
                telephone_2: fiche.telephone_2,
                statut: fiche.statut,
                date_insertion: fiche.date_insertion,
                date_modification: fiche.date_modification,
                recordings: fiche.recordings,
              },
              {
                lastRevalidatedAt: new Date(),
              }
            );

            logger.debug("Cached fiche with recordings", {
              fiche_id: fiche.id,
              recordings_count: fiche.recordings?.length || 0,
              cache_id: String(cached.id),
            });

            return { ok: true, ficheId: fiche.id };
          } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : String(err);
            logger.error("Failed to cache fiche", { fiche_id: fiche.id, error: msg });
            return { ok: false, ficheId: fiche.id, error: msg || "Unknown error" };
          }
        });

        const cachedFicheIds = perFicheResults
          .filter((r): r is { ok: true; ficheId: string } => r.ok)
          .map((r) => r.ficheId);
        const failedFicheIds = perFicheResults
          .filter((r): r is { ok: false; ficheId: string; error: string } => !r.ok)
          .map((r) => ({ fiche_id: r.ficheId, error: r.error }));

        const totalCached = cachedFicheIds.length;
        const totalFailed = failedFicheIds.length;
        const batchesProcessed = Math.ceil(
          salesData.fiches.length / Math.max(1, cacheConcurrency)
        );

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
          batches_processed: batchesProcessed,
          batch_size: cacheConcurrency,
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
 * Orchestrator: fans out per-day work so multiple replicas can process the date range in parallel.
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
    const { jobId } = event.data;

    const job = await step.run("load-job", async () => {
      return await prisma.progressiveFetchJob.findUnique({
        where: { id: jobId },
      });
    });

    if (!job) {
      throw new NonRetriableError(`Job ${jobId} not found in database`);
    }

    if (job.status === "complete" || job.status === "failed") {
      logger.info("Job already finalized, skipping fan-out", {
        jobId,
        status: job.status,
      });
      return { success: true, jobId, status: job.status, skipped: true };
    }

    // Ensure job is marked processing (idempotent)
    await step.run("mark-processing", async () => {
      await prisma.progressiveFetchJob.update({
        where: { id: jobId },
        data: { status: "processing" },
      });
      return { ok: true };
    });

    const remainingDates = job.datesRemaining || [];
    if (remainingDates.length === 0) {
      logger.info("No remaining dates to fetch; updater will finalize if needed", {
        jobId,
      });
      return { success: true, jobId, remaining: 0 };
    }

    logger.info("Fanning out progressive fetch day workers", {
      jobId,
      remaining: remainingDates.length,
    });

    await step.sendEvent(
      "fan-out-days",
      remainingDates.map((date) => ({
        name: "fiches/progressive-fetch-day",
        data: { jobId, date },
        id: `pf-day-${jobId}-${date}`,
      }))
    );

    return {
      success: true,
      jobId,
      remaining: remainingDates.length,
    };
  }
);

/**
 * Progressive Fetch Day Worker (Distributed)
 * ==========================================
 * Fetches a single day and caches it (can run on any replica).
 * Emits a processed event which is serialized per job by the updater.
 */
export const progressiveFetchDayFunction = inngest.createFunction(
  {
    id: "progressive-fetch-day",
    name: "Progressive Fetch - Fetch & Cache Single Day",
    retries: 2,
    rateLimit: {
      limit: 20,
      period: "1m",
      key: "event.data.date",
    },
    timeouts: {
      finish: "10m",
    },
    concurrency: [
      {
        limit: Math.max(
          1,
          Number(
            process.env.PROGRESSIVE_FETCH_DAY_CONCURRENCY ||
              getInngestGlobalConcurrency()
          )
        ),
      },
      // Avoid multiple replicas hammering the same date at once
      {
        key: "event.data.date",
        limit: 1,
      },
    ],
    onFailure: async ({ error, step, event }) => {
      const { jobId, date } = getProgressiveFetchDayContext(event);

      if (jobId && date) {
        await step.sendEvent("emit-day-failed", {
          name: "fiches/progressive-fetch-day.processed",
          data: {
            jobId,
            date,
            ok: false,
            cached: false,
            fichesCount: 0,
            error: error.message,
          },
          id: `pf-day-processed-${jobId}-${date}-failed`,
        });
      }
    },
  },
  { event: "fiches/progressive-fetch-day" },
  async ({ event, step, logger }) => {
    const { jobId, date } = event.data;

    const alreadyCached = await step.run("check-date-cached", async () => {
      return await fichesRepository.hasDataForDate(date);
    });

    if (!alreadyCached) {
      const includeRecordings = process.env.FICHE_SALES_INCLUDE_RECORDINGS === "1";

      const salesData = await step.run("fetch-sales", async () => {
        return await fichesApi.fetchSalesWithCalls(date, date, { includeRecordings });
      });

      const cacheConcurrency = Math.max(
        1,
        Number(
          process.env.FICHE_SALES_CACHE_CONCURRENCY ||
            getInngestParallelismPerServer()
        )
      );

      await step.run("cache-sales-summaries", async () => {
        const { mapWithConcurrency } = await import("../../utils/concurrency.js");
        await mapWithConcurrency(salesData.fiches, cacheConcurrency, async (fiche) => {
          // Skip fiches without cle (can't fetch details later)
          if (!fiche.cle) {
            logger.warn("Fiche missing cle, skipping", {
              fiche_id: fiche.id,
              date,
            });
            return;
          }

          await fichesCache.cacheFicheSalesSummary(
            {
              id: fiche.id,
              cle: fiche.cle,
              nom: fiche.nom,
              prenom: fiche.prenom,
              email: fiche.email,
              telephone: fiche.telephone,
              recordings: fiche.recordings,
            },
            {
              lastRevalidatedAt: new Date(),
              salesDate: date,
            }
          );
        });

        return { cached: true, count: salesData.fiches.length };
      });

      await step.sendEvent("emit-day-processed", {
        name: "fiches/progressive-fetch-day.processed",
        data: {
          jobId,
          date,
          ok: true,
          cached: false,
          fichesCount: salesData.fiches.length,
        },
        id: `pf-day-processed-${jobId}-${date}`,
      });

      return { success: true, jobId, date, cached: false, fichesCount: salesData.fiches.length };
    }

    // If day was already cached, emit a processed signal (idempotent)
    await step.sendEvent("emit-day-processed-cached", {
      name: "fiches/progressive-fetch-day.processed",
      data: {
        jobId,
        date,
        ok: true,
        cached: true,
        fichesCount: 0,
      },
      id: `pf-day-processed-${jobId}-${date}-cached`,
    });

    return { success: true, jobId, date, cached: true, fichesCount: 0 };
  }
);

/**
 * Progressive Fetch Job Updater (Serialized per Job)
 * =================================================
 * Applies the result of each day worker to the job record, sends progress events/webhooks,
 * and finalizes the job when all days are processed.
 */
export const progressiveFetchUpdateJobFunction = inngest.createFunction(
  {
    id: "progressive-fetch-update-job",
    name: "Progressive Fetch - Update Job Progress",
    retries: 2,
    timeouts: {
      finish: "30m",
    },
    concurrency: {
      key: "event.data.jobId",
      limit: 1,
    },
  },
  { event: "fiches/progressive-fetch-day.processed" },
  async ({ event, step, logger }) => {
    const { jobId, date, ok, error } = event.data;

    const job = await step.run("load-job", async () => {
      return await prisma.progressiveFetchJob.findUnique({
        where: { id: jobId },
      });
    });

    if (!job) {
      logger.warn("Job not found for processed day event", { jobId, date });
      return { skipped: true, reason: "job_not_found" };
    }

    if (job.status === "complete" || job.status === "failed") {
      return { skipped: true, reason: "already_finalized", status: job.status };
    }

    const buildAllDates = (start: string, end: string) => {
      const dates: string[] = [];
      const cur = new Date(`${start}T00:00:00.000Z`);
      const last = new Date(`${end}T00:00:00.000Z`);
      while (cur <= last) {
        dates.push(cur.toISOString().split("T")[0]);
        cur.setUTCDate(cur.getUTCDate() + 1);
      }
      return dates;
    };

    const allDates = buildAllDates(job.startDate, job.endDate);
    const prevProcessed =
      (job.datesAlreadyFetched?.length || 0) + (job.datesFailed?.length || 0);

    const completedSet = new Set<string>(job.datesAlreadyFetched || []);
    const failedSet = new Set<string>(job.datesFailed || []);

    if (ok) {
      completedSet.add(date);
      failedSet.delete(date);
    } else {
      failedSet.add(date);
      logger.warn("Day failed for progressive fetch job", { jobId, date, error });
    }

    const completedDates = allDates.filter((d) => completedSet.has(d));
    const failedDates = allDates.filter((d) => failedSet.has(d));
    const remainingDates = allDates.filter(
      (d) => !completedSet.has(d) && !failedSet.has(d)
    );

    const processedDays = completedDates.length + failedDates.length;
    const progress = Math.round((processedDays / Math.max(1, allDates.length)) * 100);
    const completedDays = completedDates.length;

    // If nothing changed (duplicate processed event), avoid noisy updates/webhooks.
    // IMPORTANT: if the job is already "done" (no remaining dates) but not finalized,
    // we must NOT early-return. This allows retries to finalize the job even if a
    // previous attempt failed after partially updating the DB.
    const shouldFinalize =
      remainingDates.length === 0 &&
      job.status !== "complete" &&
      job.status !== "failed";

    if (
      processedDays === prevProcessed &&
      remainingDates.length === (job.datesRemaining?.length || 0) &&
      !shouldFinalize
    ) {
      return { noop: true, processedDays };
    }

    // Compute current total fiches in range (DB is the source of truth)
    const totalFiches = await step.run("count-fiches-in-range", async () => {
      const startOfRange = new Date(job.startDate);
      startOfRange.setHours(0, 0, 0, 0);
      const endOfRange = new Date(job.endDate);
      endOfRange.setHours(23, 59, 59, 999);
      const currentCachedData = await fichesRepository.getFichesByDateRange(
        startOfRange,
        endOfRange
      );
      return currentCachedData.length;
    });

    await step.run("update-job", async () => {
      await prisma.progressiveFetchJob.update({
        where: { id: jobId },
        data: {
          status: "processing",
          progress,
          completedDays,
          totalFiches: totalFiches || 0,
          datesAlreadyFetched: completedDates,
          datesFailed: failedDates,
          datesRemaining: remainingDates,
          error: ok ? null : job.error,
        },
      });
      return { updated: true };
    });

    // Realtime progress event (best-effort)
    publishRealtimeEvent({
      topic: topicForJob(jobId),
      type: "fiches.progressive_fetch.progress",
      source: "fiches-job-updater",
      data: {
        jobId,
        status: "processing",
        startDate: job.startDate,
        endDate: job.endDate,
        progress,
        completedDays,
        totalDays: allDates.length,
        totalFiches,
        datesCompleted: completedDates,
        datesRemaining: remainingDates,
        datesFailed: failedDates,
        latestDate: date,
      },
    }).catch(() => null);

    const webhookUrl = job.webhookUrl || undefined;
    const webhookSecret = job.webhookSecret || undefined;

    const WEBHOOK_FREQUENCY = Math.max(
      1,
      Number(process.env.PROGRESSIVE_FETCH_WEBHOOK_FREQUENCY || 5)
    );

    const shouldSendProgressWebhook =
      Boolean(webhookUrl) &&
      (processedDays % WEBHOOK_FREQUENCY === 0 || remainingDates.length === 0);

    if (shouldSendProgressWebhook && webhookUrl) {
      await step.run("send-progress-webhook", async () => {
        const startOfRange = new Date(job.startDate);
        startOfRange.setHours(0, 0, 0, 0);
        const endOfRange = new Date(job.endDate);
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
            totalFiches: totalFiches || 0,
            progress,
            currentFichesCount: currentCachedData.length,
            latestDate: date,
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
      });
    }

    // Finalize if no remaining dates
    if (remainingDates.length === 0) {
      const finalStatus = failedDates.length > 0 ? "failed" : "complete";
      const finalError =
        finalStatus === "failed"
          ? `${failedDates.length} date(s) failed during progressive fetch`
          : null;

      await step.run("finalize-job", async () => {
        await prisma.progressiveFetchJob.update({
          where: { id: jobId },
          data: {
            status: finalStatus,
            progress: 100,
            completedAt: new Date(),
            error: finalError,
            datesFailed: failedDates,
            datesRemaining: [],
          },
        });
        return { finalized: true };
      });

      publishRealtimeEvent({
        topic: topicForJob(jobId),
        type:
          finalStatus === "complete"
            ? "fiches.progressive_fetch.complete"
            : "fiches.progressive_fetch.failed",
        source: "fiches-job-updater",
        data: {
          jobId,
          status: finalStatus,
          startDate: job.startDate,
          endDate: job.endDate,
          progress: 100,
          completedDays,
          totalDays: allDates.length,
          totalFiches,
          datesCompleted: completedDates,
          datesRemaining: [],
          datesFailed: failedDates,
        },
      }).catch(() => null);

      if (webhookUrl) {
        const apiBaseUrl = process.env.API_BASE_URL || "http://localhost:3002";
        if (finalStatus === "complete") {
          await step.run("send-complete-webhook", async () => {
            await fichesWebhooks.sendCompletionWebhook(
              webhookUrl,
              jobId,
              {
                totalDays: allDates.length,
                totalFiches: totalFiches || 0,
                dataUrl: `${apiBaseUrl}/api/fiches/status/by-date-range?startDate=${job.startDate}&endDate=${job.endDate}`,
              },
              webhookSecret
            );
          });
        } else {
          await step.run("send-failed-webhook", async () => {
            await fichesWebhooks.sendFailureWebhook(
              webhookUrl,
              jobId,
              finalError || "Progressive fetch failed",
              webhookSecret
            );
          });
        }
      }
    }

    logger.info("Progressive fetch job updated", {
      jobId,
      date,
      ok,
      processedDays,
      totalDays: allDates.length,
      remaining: remainingDates.length,
    });

    return { success: true, jobId, processedDays, remaining: remainingDates.length };
  }
);

export const functions = [
  fetchFicheFunction,
  revalidateFichesFunction,
  cacheSalesListFunction,
  progressiveFetchContinueFunction,
  progressiveFetchDayFunction,
  progressiveFetchUpdateJobFunction,
];
