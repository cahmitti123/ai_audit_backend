/**
 * Transcriptions Workflows
 * =========================
 * Inngest workflow functions for transcription operations
 */

import { inngest } from "../../inngest/client.js";
import { NonRetriableError } from "inngest";
import {
  transcribeFicheRecordings,
  getFicheTranscriptionStatus,
} from "./transcriptions.service.js";
import type {
  ExtendedTranscriptionResult,
  BatchTranscriptionResult,
  TranscriptionStatus,
} from "./transcriptions.types.js";
import { isFullyTranscribed } from "./transcriptions.types.js";
import {
  RATE_LIMITS,
  TIMEOUTS,
  BATCH_CONFIG,
  CONCURRENCY,
} from "../../shared/constants.js";
import { transcriptionWebhooks } from "../../shared/webhook.js";

/**
 * Transcribe Fiche Function
 * ==========================
 * Transcribes all recordings for a fiche using ElevenLabs
 * - Retries: 3 times
 * - Rate limited: 10/min (ElevenLabs quota)
 * - Timeout: 15 minutes
 * - Idempotent: per fiche_id
 * - Batch events: max 5 fiches per batch, 10s timeout
 */
export const transcribeFicheFunction = inngest.createFunction(
  {
    id: "transcribe-fiche",
    name: "Transcribe Fiche Recordings",
    retries: 3,
    concurrency: [
      {
        limit: CONCURRENCY.TRANSCRIPTION.limit,
      },
    ],
    rateLimit: {
      ...RATE_LIMITS.TRANSCRIPTION,
      key: "event.data.fiche_id",
    },
    timeouts: {
      finish: TIMEOUTS.TRANSCRIPTION,
    },
    // REMOVED idempotency to allow parallel execution from automation workflows
    // The transcription logic itself handles duplicate checks
    batchEvents: BATCH_CONFIG.TRANSCRIPTION,
  },
  { event: "fiche/transcribe" },
  async ({ event, step, logger }): Promise<BatchTranscriptionResult> => {
    // Handle batch processing if multiple events
    const events = Array.isArray(event) ? event : [event];
    logger.info("Processing transcription batch", {
      count: events.length,
      fiches: events.map((e) => e.data.fiche_id),
    });

    const results: ExtendedTranscriptionResult[] = [];

    for (const evt of events) {
      const { fiche_id, priority = "normal" } = evt.data;

      // Capture start time in a step to persist it across Inngest checkpoints
      const startTime = await step.run(
        `capture-start-time-${fiche_id}`,
        async (): Promise<number> => {
          return Date.now();
        }
      );

      // Validate API key at function level (non-retriable error)
      const apiKey = process.env.ELEVENLABS_API_KEY;
      if (!apiKey) {
        throw new NonRetriableError("ElevenLabs API key not configured");
      }

      logger.info("Starting transcription", { fiche_id, priority });

      // Check if already transcribed (progress webhooks sent during transcription)
      const status = await step.run(`check-status-${fiche_id}`, async () => {
        const status = await getFicheTranscriptionStatus(fiche_id);
        if (status.total === null || status.transcribed === null) {
          throw new NonRetriableError("Transcription status not found");
        }
        return status;
      });

      // Send workflow started webhook
      await step.run(`send-transcription-started-${fiche_id}`, async () => {
        await transcriptionWebhooks.started(
          fiche_id,
          status.total || 0,
          priority
        );
        return { notified: true };
      });

      if (
        status.total !== null &&
        status.transcribed !== null &&
        status.total > 0 &&
        status.transcribed === status.total
      ) {
        logger.info("All recordings already transcribed", {
          fiche_id,
          count: status.transcribed,
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

      // Perform transcription with retry and progress updates
      let result;
      try {
        result = await step.run(
          `transcribe-recordings-${fiche_id}`,
          async () => {
            logger.info("Calling transcription service", {
              fiche_id,
              to_transcribe: (status.total || 0) - (status.transcribed || 0),
            });

            // Transcribe with progress callback
            // Note: Individual recording webhooks are sent by the service
            return await transcribeFicheRecordings(
              fiche_id,
              apiKey,
              async (progress) => {
                // Log progress for monitoring
                logger.info("Transcription progress update", {
                  fiche_id: progress.ficheId,
                  transcribed: progress.transcribed,
                  total: progress.totalRecordings,
                  current: `${progress.currentIndex}/${progress.total}`,
                });
              }
            );
          }
        );
      } catch (error: any) {
        // Log for monitoring
        logger.error("Transcription failed", {
          fiche_id,
          error: error.message,
        });

        // Send failure webhook
        await step.run(`send-transcription-failed-${fiche_id}`, async () => {
          await transcriptionWebhooks.failed(
            fiche_id,
            error.message || "Unknown error",
            // Include partial results if available
            status && {
              total: status.total || 0,
              transcribed: status.transcribed || 0,
              failed: (status.total || 0) - (status.transcribed || 0),
            }
          );
          return { notified: true };
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

      // Calculate duration
      const durationMs = Date.now() - startTime;
      const durationSeconds = Math.round(durationMs / 1000);

      // Send completion webhook
      await step.run(`send-transcription-completed-${fiche_id}`, async () => {
        await transcriptionWebhooks.completed(
          fiche_id,
          result.total || 0,
          result.transcribed || 0,
          result.failed || 0,
          durationSeconds
        );
        return { notified: true };
      });

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
        newTranscriptions: result.newTranscriptions,
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

export const functions = [transcribeFicheFunction];
