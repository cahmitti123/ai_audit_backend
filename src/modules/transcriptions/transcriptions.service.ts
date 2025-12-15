/**
 * Transcriptions Service
 * ======================
 * Business logic for transcription operations
 */

import { TranscriptionService } from "./transcriptions.elevenlabs.js";
import { getCachedFiche } from "../fiches/fiches.repository.js";
import {
  getRecordingsByFiche,
  updateRecordingTranscription,
} from "./transcriptions.repository.js";
import type {
  TranscriptionResult,
  TranscriptionStatus,
} from "./transcriptions.types.js";
import { transcriptionWebhooks } from "../../shared/webhook.js";
import { mapWithConcurrency } from "../../utils/concurrency.js";
import { logger } from "../../shared/logger.js";

/**
 * Progress callback for transcription updates
 */
export type TranscriptionProgressCallback = (progress: {
  ficheId: string;
  currentIndex: number;
  total: number;
  totalRecordings: number;
  transcribed: number;
  pending: number;
}) => Promise<void> | void;

/**
 * Transcribe all recordings for a fiche and update database
 */
export async function transcribeFicheRecordings(
  ficheId: string,
  apiKey: string,
  onProgress?: TranscriptionProgressCallback
): Promise<TranscriptionResult> {
  logger.info("Transcribing recordings", { fiche_id: ficheId });

  // Get fiche cache
  const ficheCache = await getCachedFiche(ficheId).catch((err) => {
    logger.warn("Database not available, proceeding without DB tracking", {
      fiche_id: ficheId,
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  });

  if (!ficheCache) {
    logger.warn("Fiche not cached; DB storage will be skipped", { fiche_id: ficheId });
    return {
      total: 0,
      transcribed: 0,
      newTranscriptions: 0,
      error: "Database not available - cannot track transcriptions",
    };
  }

  const recordings = await getRecordingsByFiche(ficheId).catch(() => []);
  logger.info("Found recordings in DB", { fiche_id: ficheId, recordings: recordings.length });

  // Filter untranscribed
  const untranscribed = recordings.filter((r) => !r.hasTranscription);
  const alreadyTranscribed = recordings.filter(
    (r) => r.hasTranscription
  ).length;
  logger.info("Transcription status", {
    fiche_id: ficheId,
    already_transcribed: alreadyTranscribed,
    to_transcribe: untranscribed.length,
  });

  // Send status check webhook
  await transcriptionWebhooks.statusCheck(
    ficheId,
    recordings.length,
    alreadyTranscribed,
    untranscribed.length
  );

  if (untranscribed.length === 0) {
    logger.info("All recordings already transcribed", { fiche_id: ficheId });
    return {
      total: recordings.length,
      transcribed: recordings.length,
      newTranscriptions: 0,
    };
  }

  // Initialize transcription service
  const transcriptionService = new TranscriptionService(apiKey);

  // Transcribe recordings with bounded parallelism
  const recordingConcurrency = Math.max(
    1,
    Number(process.env.TRANSCRIPTION_RECORDING_CONCURRENCY || 2)
  );

  logger.info("Starting bounded-parallel transcription", {
    fiche_id: ficheId,
    to_transcribe: untranscribed.length,
    concurrency: recordingConcurrency,
  });

  const results: Array<{ callId: string; transcriptionId: string }> = [];
  const failures: Array<{ callId: string; error: string }> = [];
  let completedCount = 0;
  let succeededCount = 0;
  let failedCount = 0;

  await mapWithConcurrency(
    untranscribed,
    recordingConcurrency,
    async (rec, i) => {
      const idx = i + 1;
      logger.debug("Transcribing recording", {
        fiche_id: ficheId,
        call_id: rec.callId,
        index: idx,
        total: untranscribed.length,
      });

      // Send "started" only when we actually start processing this recording
      await transcriptionWebhooks.recordingStarted(
        ficheId,
        rec.callId,
        idx,
        untranscribed.length,
        rec.recordingUrl || undefined
      );

      try {
        if (!rec.recordingUrl) {
          const errorMsg = "No recording URL available";
          logger.warn("Recording has no URL; marking as failed", {
            fiche_id: ficheId,
            call_id: rec.callId,
            error: errorMsg,
          });

          await transcriptionWebhooks.recordingFailed(
            ficheId,
            rec.callId,
            errorMsg,
            idx,
            untranscribed.length
          );

          failedCount++;
          completedCount++;
          failures.push({ callId: rec.callId, error: errorMsg });

          const currentTranscribed = alreadyTranscribed + succeededCount;
          const pending = recordings.length - currentTranscribed - failedCount;

          await transcriptionWebhooks.progress(
            ficheId,
            recordings.length,
            currentTranscribed,
            pending,
            failedCount
          );

          if (onProgress) {
            await onProgress({
              ficheId,
              currentIndex: completedCount,
              total: untranscribed.length,
              totalRecordings: recordings.length,
              transcribed: currentTranscribed,
              pending,
            });
          }

          return;
        }

        const transcription = await transcriptionService.transcribe(rec.recordingUrl);

        // Update database with transcription ID and text
        await updateRecordingTranscription(
          ficheCache.id,
          rec.callId,
          transcription.transcription_id!,
          transcription.transcription.text,
          transcription.transcription
        );

        logger.info("Recording transcribed", {
          fiche_id: ficheId,
          call_id: rec.callId,
          transcription_id: transcription.transcription_id,
        });

        await transcriptionWebhooks.recordingCompleted(
          ficheId,
          rec.callId,
          transcription.transcription_id!,
          idx,
          untranscribed.length
        );

        succeededCount++;
        completedCount++;
        results.push({
          callId: rec.callId,
          transcriptionId: transcription.transcription_id!,
        });
      } catch (error: unknown) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        logger.error("Transcription failed for recording", {
          fiche_id: ficheId,
          call_id: rec.callId,
          error: errorMsg,
        });

        await transcriptionWebhooks.recordingFailed(
          ficheId,
          rec.callId,
          errorMsg,
          idx,
          untranscribed.length
        );

        failedCount++;
        completedCount++;
        failures.push({ callId: rec.callId, error: errorMsg });
      }

      // Send progress webhook after each completion (throttling can be added later if needed)
      const currentTranscribed = alreadyTranscribed + succeededCount;
      const pending = recordings.length - currentTranscribed - failedCount;

      await transcriptionWebhooks.progress(
        ficheId,
        recordings.length,
        currentTranscribed,
        pending,
        failedCount
      );

      if (onProgress) {
        await onProgress({
          ficheId,
          currentIndex: completedCount,
          total: untranscribed.length,
          totalRecordings: recordings.length,
          transcribed: currentTranscribed,
          pending,
        });
      }
    }
  );

  logger.info("Transcription complete", {
    fiche_id: ficheId,
    succeeded: results.length,
    attempted: untranscribed.length,
    failed: failures.length,
  });

  return {
    total: recordings.length,
    transcribed: alreadyTranscribed + results.length,
    newTranscriptions: results.length,
    failed: failures.length,
    results,
  };
}

/**
 * Get transcription status for a fiche
 */
export async function getFicheTranscriptionStatus(
  ficheId: string
): Promise<TranscriptionStatus> {
  const recordings = await getRecordingsByFiche(ficheId);

  const transcribed = recordings.filter((r) => r.hasTranscription).length;
  const total = recordings.length;

  return {
    ficheId,
    total,
    transcribed,
    pending: total - transcribed,
    percentage: total > 0 ? Math.round((transcribed / total) * 100) : 0,
    recordings: recordings.map((r) => ({
      callId: r.callId,
      hasTranscription: r.hasTranscription,
      transcriptionId: r.transcriptionId,
      transcribedAt: r.transcribedAt,
      recordingDate: r.recordingDate,
      recordingTime: r.recordingTime,
      durationSeconds: r.durationSeconds,
    })),
  };
}

/**
 * Batch transcribe multiple fiches in parallel
 */
export async function batchTranscribeFiches(
  ficheIds: string[],
  apiKey: string
) {
  logger.info("Batch transcribing fiches", { fiche_count: ficheIds.length });

  const transcriptionPromises = ficheIds.map(async (ficheId) => {
    try {
      const result = await transcribeFicheRecordings(ficheId, apiKey);
      logger.info("Fiche transcription complete", { fiche_id: ficheId });
      return { ficheId, ...result, success: true };
    } catch (error: unknown) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      logger.error("Failed to transcribe fiche", {
        fiche_id: ficheId,
        error: errorMsg,
      });
      return {
        ficheId,
        success: false,
        error: errorMsg,
      };
    }
  });

  const results = await Promise.all(transcriptionPromises);

  const successCount = results.filter((r) => r.success).length;
  logger.info("Batch transcription complete", {
    successful: successCount,
    total: ficheIds.length,
  });

  return results;
}
