/**
 * Inngest Functions
 * =================
 * Event-driven workflow functions with retry, concurrency, and orchestration
 * All functions are strictly typed and follow Inngest best practices
 */

import { inngest } from "./client.js";
import { NonRetriableError } from "inngest";
import type { FicheCache } from "@prisma/client";
import { fetchApiFicheDetails } from "../services/fiche-api.js";
import { cacheFiche, getCachedFiche } from "../services/database.js";
import {
  transcribeFicheRecordings,
  getFicheTranscriptionStatus,
} from "../services/transcription-manager.js";
import { runAudit } from "../services/audit-runner.js";
import { enrichRecording } from "../utils/recording-parser.js";
import type {
  FicheFetchResult,
  ExtendedTranscriptionResult,
  BatchTranscriptionResult,
  AuditFunctionResult,
  BatchAuditResult,
  TranscriptionStatus,
  TranscriptionResult,
  AuditResult,
} from "./types.js";
import { isFullyTranscribed } from "./types.js";

// ═══════════════════════════════════════════════════════════════════════════
// FICHE FETCH FUNCTION
// ═══════════════════════════════════════════════════════════════════════════

export const fetchFicheFunction = inngest.createFunction(
  {
    id: "fetch-fiche",
    name: "Fetch Fiche from API",
    retries: 3, // Retry up to 3 times on failure
    rateLimit: {
      limit: 20,
      period: "1m",
      key: "event.data.fiche_id", // Rate limit per fiche
    },
    timeouts: {
      finish: "5m", // Max 5 minutes
    },
    idempotency: "event.data.fiche_id", // Prevent duplicate fetches
  },
  { event: "fiche/fetch" },
  async ({ event, step, logger }) => {
    const { fiche_id, cle, force_refresh } = event.data;

    logger.info("Starting fiche fetch", {
      fiche_id,
      force_refresh: force_refresh || false,
    });

    // Check cache
    const cached = await step.run("check-cache", async () => {
      const cachedData: FicheCache | null = await getCachedFiche(fiche_id);

      if (cachedData && !force_refresh && cachedData.expiresAt > new Date()) {
        logger.info("Found valid cache", { fiche_id });
        return cachedData;
      }

      return null;
    });

    if (cached) {
      // Send completion event for waiters
      await step.sendEvent("emit-cached-result", {
        name: "fiche/fetched",
        data: {
          fiche_id,
          cache_id: (cached.id as bigint).toString() || "",
          recordings_count: cached.recordingsCount || 0,
          cached: true,
        },
      });

      return {
        success: true,
        cached: true,
        fiche_id,
        cache_id: (cached.id as bigint).toString() || "",
        message: "Using cached data",
      };
    }

    // Fetch from API with retry
    const ficheData = await step.run("fetch-from-api", async () => {
      try {
        logger.info("Fetching from external API", { fiche_id });
        return await fetchApiFicheDetails(fiche_id, cle);
      } catch (error: any) {
        // Check if it's a 404 or authentication error (non-retriable)
        if (error.response?.status === 404 || error.response?.status === 401) {
          throw new NonRetriableError(
            `Fiche not found or unauthorized: ${error.message}`
          );
        }
        // Other errors will be retried
        throw error;
      }
    });

    // Enrich recordings (make durable by putting in a step)
    const enrichedData = await step.run("enrich-recordings", async () => {
      logger.info("Enriching recordings", {
        count: ficheData.recordings.length,
      });
      ficheData.recordings = ficheData.recordings.map(enrichRecording);
      return ficheData;
    });

    // Cache in DB
    const ficheCacheEntry = await step.run("cache-in-db", async () => {
      logger.info("Caching fiche in database", { fiche_id });
      return await cacheFiche(enrichedData);
    });

    // Send completion event
    await step.sendEvent("emit-completion", {
      name: "fiche/fetched",
      data: {
        fiche_id,
        cache_id: (ficheCacheEntry.id as bigint).toString() || "",
        recordings_count: enrichedData.recordings.length,
        cached: false,
      },
    });

    logger.info("Fiche fetch completed", {
      fiche_id,
      recordings_count: enrichedData.recordings.length,
    });

    return {
      success: true,
      cached: false,
      fiche_id,
      cache_id: (ficheCacheEntry.id as bigint).toString() || "",
      recordings_count: enrichedData.recordings.length,
    };
  }
);

// ═══════════════════════════════════════════════════════════════════════════
// TRANSCRIPTION FUNCTION
// ═══════════════════════════════════════════════════════════════════════════

export const transcribeFicheFunction = inngest.createFunction(
  {
    id: "transcribe-fiche",
    name: "Transcribe Fiche Recordings",
    retries: 3,
    rateLimit: {
      limit: 10,
      period: "1m", // ElevenLabs rate limiting
      key: "event.data.fiche_id",
    },
    timeouts: {
      finish: "15m", // Transcription can take time
    },
    idempotency: "event.data.fiche_id",
    // Batch multiple transcription requests together
    batchEvents: {
      maxSize: 5,
      timeout: "10s",
    },
  },
  { event: "fiche/transcribe" },
  async ({ event, step, logger }) => {
    // Handle batch processing if multiple events
    const events = Array.isArray(event) ? event : [event];
    logger.info("Processing transcription batch", {
      count: events.length,
      fiches: events.map((e) => e.data.fiche_id),
    });

    const results: ExtendedTranscriptionResult[] = [];

    for (const evt of events) {
      const { fiche_id, priority = "normal" } = evt.data;

      // Validate API key at function level (non-retriable error)
      const apiKey = process.env.ELEVENLABS_API_KEY;
      if (!apiKey) {
        throw new NonRetriableError("ElevenLabs API key not configured");
      }

      logger.info("Starting transcription", { fiche_id, priority });

      // Check if already transcribed
      const status = await step.run(`check-status-${fiche_id}`, async () => {
        const status = await getFicheTranscriptionStatus(fiche_id);
        if (status.total === null || status.transcribed === null) {
          throw new NonRetriableError("Transcription status not found");
        }
        return status;
      });

      if (
        status.total !== null &&
        status.transcribed !== null &&
        status.total > 0 &&
        status.transcribed === status.total
      ) {
        logger.info("All recordings already transcribed", {
          fiche_id,
          cached: status.transcribed === status.total,
        });

        // Send completion event
        await step.sendEvent(`emit-completion-${fiche_id}`, {
          name: "fiche/transcribed",
          data: {
            fiche_id,
            transcribed_count: 0,
            cached_count: 0,
            failed_count: 0,
          },
        });

        results.push({
          success: true,
          fiche_id,
          cached: true,
          total: status.total || 0,
          transcribed: status.transcribed || 0,
          newTranscriptions: 0,
          failed: 0,
        });
        continue;
      }

      // Perform transcription with retry
      const result = await step.run(
        `transcribe-recordings-${fiche_id}`,
        async () => {
          try {
            logger.info("Calling transcription service", {
              fiche_id,
              to_transcribe: status.total
                ? status.total - (status.transcribed || 0)
                : 0,
            });
            return await transcribeFicheRecordings(fiche_id, apiKey);
          } catch (error: any) {
            // Log for monitoring
            logger.error("Transcription failed", {
              fiche_id,
              error: error.message,
            });

            // Check for quota errors (non-retriable)
            if (
              error.message?.includes("quota") ||
              error.message?.includes("limit exceeded")
            ) {
              throw new NonRetriableError(
                `ElevenLabs quota exceeded: ${error.message}`
              );
            }

            throw error;
          }
        }
      );

      // Send completion event
      await step.sendEvent(`emit-completion-${fiche_id}`, {
        name: "fiche/transcribed",
        data: {
          fiche_id,
          transcribed_count: result.transcribed || 0,
          cached_count: result.newTranscriptions || 0,
          failed_count: result.newTranscriptions || 0,
        },
      });

      logger.info("Transcription completed", {
        fiche_id,
        transcribed: result.transcribed,
        cached: result.newTranscriptions,
        failed: result.newTranscriptions,
      });

      results.push({
        success: true,
        fiche_id,
        cached: false,
        total: result.total || 0,
        transcribed: result.transcribed || 0,
        newTranscriptions: result.newTranscriptions || 0,
        failed: 0,
      });
    }

    return {
      success: true,
      batch_size: events.length,
      results,
    };
  }
);

// ═══════════════════════════════════════════════════════════════════════════
// AUDIT RUN FUNCTION
// ═══════════════════════════════════════════════════════════════════════════

export const runAuditFunction = inngest.createFunction(
  {
    id: "run-audit",
    name: "Run AI Audit",
    concurrency: {
      limit: 3, // Max 3 concurrent audits
      key: "event.data.audit_config_id", // Limit per config type
    },
    retries: 2, // Less retries for expensive operations
    timeouts: {
      finish: "30m", // Audits can take time
    },
    idempotency: "event.data.fiche_id + '-' + event.data.audit_config_id",
    onFailure: async ({ error, event, step }) => {
      // Send failure event for monitoring
      const auditEvent = event as any;
      await step.sendEvent("emit-failure", {
        name: "audit/failed",
        data: {
          fiche_id: auditEvent.data?.fiche_id || "unknown",
          audit_config_id: auditEvent.data?.audit_config_id || 0,
          error: error.message,
          retry_count: 0,
        },
      });
    },
  },
  { event: "audit/run" },
  async ({ event, step, logger }) => {
    const { fiche_id, audit_config_id, user_id } = event.data;
    const startTime = Date.now();

    logger.info("Starting audit", {
      fiche_id,
      audit_config_id,
      user_id,
    });

    // Step 1: Ensure fiche is fetched (use proper orchestration)
    const ficheData = await step.run("ensure-fiche", async () => {
      const cached = await getCachedFiche(fiche_id);

      if (!cached || cached.expiresAt < new Date()) {
        logger.info("Fiche not cached, triggering fetch", { fiche_id });
        return null;
      }

      logger.info("Fiche already cached", { fiche_id });
      return cached;
    });

    // If not cached, invoke fetch function and wait for completion
    if (!ficheData) {
      logger.info("Invoking fiche fetch function", { fiche_id });

      // Use step.invoke to directly call the fetch function
      const fetchResult = await step.invoke("fetch-fiche", {
        function: fetchFicheFunction,
        data: {
          fiche_id,
        },
      });

      logger.info("Fiche fetch completed", {
        fiche_id,
        cached: fetchResult.cached,
      });
    }

    // Step 2: Ensure transcriptions (parallel check and invoke if needed)
    const transcriptionStatus = await step.run(
      "check-transcription-status",
      async () => {
        return await getFicheTranscriptionStatus(fiche_id);
      }
    );

    if (!isFullyTranscribed(transcriptionStatus as any)) {
      logger.info("Transcriptions incomplete, triggering transcription", {
        fiche_id,
        total: transcriptionStatus.total,
        transcribed: transcriptionStatus.transcribed,
      });

      // Invoke transcription function
      await step.invoke("transcribe-fiche", {
        function: transcribeFicheFunction,
        data: {
          fiche_id,
          priority: "high", // High priority for audits
        },
      });

      logger.info("Transcription completed", { fiche_id });
    } else {
      logger.info("All recordings already transcribed", {
        fiche_id,
        count: transcriptionStatus.total,
      });
    }

    // Step 3: Run the audit
    const auditResult = await step.run("execute-audit", async () => {
      try {
        logger.info("Executing audit", {
          fiche_id,
          audit_config_id,
        });

        return await runAudit({
          ficheId: fiche_id,
          auditConfigId: audit_config_id,
          saveToFile: false,
        });
      } catch (error: any) {
        logger.error("Audit execution failed", {
          fiche_id,
          audit_config_id,
          error: error.message,
        });

        // If it's a configuration error, don't retry
        if (
          error.message?.includes("config not found") ||
          error.message?.includes("invalid config")
        ) {
          throw new NonRetriableError(`Invalid audit config: ${error.message}`);
        }

        throw error;
      }
    });

    const duration = Date.now() - startTime;

    // Step 4: Send completion event
    await step.sendEvent("emit-completion", {
      name: "audit/completed",
      data: {
        fiche_id,
        audit_id: "completed", // Will be saved to DB separately
        audit_config_id,
        score: auditResult.audit.compliance.score || 0,
        niveau: auditResult.audit.compliance.niveau,
        duration_ms: duration,
      },
    });

    logger.info("Audit completed successfully", {
      fiche_id,
      audit_config_id,
      score: auditResult.audit.compliance.score,
      niveau: auditResult.audit.compliance.niveau,
      duration_ms: duration,
    });

    return {
      success: true,
      fiche_id,
      audit_id: "completed",
      audit_config_id,
      score: auditResult.audit.compliance.score || 0,
      niveau: auditResult.audit.compliance.niveau,
      duration_ms: duration,
    };
  }
);

// ═══════════════════════════════════════════════════════════════════════════
// BATCH AUDIT FUNCTION (Fan-Out Pattern)
// ═══════════════════════════════════════════════════════════════════════════

export const batchAuditFunction = inngest.createFunction(
  {
    id: "batch-audit",
    name: "Batch Process Audits",
    retries: 1,
    timeouts: {
      finish: "1h",
    },
  },
  { event: "audit/batch" },
  async ({ event, step, logger }) => {
    const { fiche_ids, audit_config_id, user_id } = event.data;
    const defaultAuditConfigId = audit_config_id || 10; // Default to Quick Audit

    logger.info("Starting batch audit", {
      total: fiche_ids.length,
      audit_config_id: defaultAuditConfigId,
      user_id,
    });

    // Fan-out: Send events in parallel using step.sendEvent()
    await step.sendEvent(
      "fan-out-audits",
      fiche_ids.map((fiche_id) => ({
        name: "audit/run",
        data: {
          fiche_id,
          audit_config_id: defaultAuditConfigId,
          user_id,
        },
        // Add deduplication ID to prevent duplicate audits
        id: `audit-${fiche_id}-${defaultAuditConfigId}-${Date.now()}`,
      }))
    );

    logger.info("Dispatched all audit events", {
      count: fiche_ids.length,
    });

    // Wait for all audits to complete (with timeout)
    const completionEvents = await step.waitForEvent("wait-for-completions", {
      event: "audit/completed",
      timeout: "45m",
      match: "data.audit_config_id",
    });

    // Count results (optional - for tracking)
    const results = (await step.run("count-results", async () => {
      // Could query database for actual completion status
      return {
        total: fiche_ids.length,
        succeeded: completionEvents ? 1 : 0, // Simplified
        failed: 0,
      };
    })) as unknown as { total: number; succeeded: number; failed: number };

    // Send batch completion event
    await step.sendEvent("emit-batch-completion", {
      name: "audit/batch.completed",
      data: {
        total: fiche_ids.length,
        succeeded: results.succeeded,
        failed: results.failed,
        audit_config_id: defaultAuditConfigId,
      },
    });

    logger.info("Batch audit completed", results);

    return {
      success: true,
      total_fiches: fiche_ids.length,
      audit_config_id: defaultAuditConfigId,
      ...results,
    };
  }
);

// ═══════════════════════════════════════════════════════════════════════════
// CLEANUP CRON JOB (Scheduled Function)
// ═══════════════════════════════════════════════════════════════════════════

export const cleanupOldCachesFunction = inngest.createFunction(
  {
    id: "cleanup-old-caches",
    name: "Cleanup Expired Cache Entries",
    retries: 1,
  },
  { cron: "0 2 * * *" }, // Run daily at 2 AM
  async ({ step, logger }) => {
    logger.info("Starting cache cleanup");

    const deleted = await step.run("delete-expired-caches", async () => {
      // This would need a database function to delete expired entries
      // For now, just log
      logger.info("Cleanup logic would run here");
      return 0;
    });

    logger.info("Cache cleanup completed", { deleted });

    return {
      success: true,
      deleted,
    };
  }
);

// ═══════════════════════════════════════════════════════════════════════════
// EXPORT ALL FUNCTIONS
// ═══════════════════════════════════════════════════════════════════════════

export const functions = [
  fetchFicheFunction,
  transcribeFicheFunction,
  runAuditFunction,
  batchAuditFunction,
  cleanupOldCachesFunction,
];
