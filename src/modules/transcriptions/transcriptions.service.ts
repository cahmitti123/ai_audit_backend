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
  console.log(`🎤 Transcribing recordings for fiche ${ficheId}...`);

  // Get fiche cache
  const ficheCache = await getCachedFiche(ficheId).catch((err) => {
    console.warn(`⚠️  Database not available, proceeding without DB tracking`);
    return null;
  });

  if (!ficheCache) {
    console.warn(
      `⚠️  Fiche ${ficheId} not cached - DB storage will be skipped`
    );
    return {
      total: 0,
      transcribed: 0,
      newTranscriptions: 0,
      error: "Database not available - cannot track transcriptions",
    };
  }

  const recordings = await getRecordingsByFiche(ficheId).catch(() => []);
  console.log(`📋 Found ${recordings.length} recordings in DB`);

  // Filter untranscribed
  const untranscribed = recordings.filter((r) => !r.hasTranscription);
  const alreadyTranscribed = recordings.filter(
    (r) => r.hasTranscription
  ).length;
  console.log(`⏳ Need to transcribe: ${untranscribed.length}`);

  // Send status check webhook
  await transcriptionWebhooks.statusCheck(
    ficheId,
    recordings.length,
    alreadyTranscribed,
    untranscribed.length
  );

  if (untranscribed.length === 0) {
    console.log(`✅ All recordings already transcribed`);
    return {
      total: recordings.length,
      transcribed: recordings.length,
      newTranscriptions: 0,
    };
  }

  // Initialize transcription service
  const transcriptionService = new TranscriptionService(apiKey);

  // Transcribe recordings in parallel
  console.log(
    `🚀 Starting parallel transcription of ${untranscribed.length} recordings...`
  );

  const results = [];
  const failures: Array<{ callId: string; error: string }> = [];
  let completedCount = 0;

  // Send all recording started webhooks
  await Promise.all(
    untranscribed.map((rec, i) =>
      transcriptionWebhooks.recordingStarted(
        ficheId,
        rec.callId,
        i + 1,
        untranscribed.length,
        rec.recordingUrl || undefined
      )
    )
  );

  // Process transcriptions in parallel
  const transcriptionPromises = untranscribed.map(async (rec, i) => {
    console.log(
      `[${i + 1}/${untranscribed.length}] Transcribing ${rec.callId}...`
    );

    try {
      if (!rec.recordingUrl) {
        const errorMsg = "No recording URL available";
        console.log(`  ⚠️  ${errorMsg}`);

        // Send recording failed webhook
        await transcriptionWebhooks.recordingFailed(
          ficheId,
          rec.callId,
          errorMsg,
          i + 1,
          untranscribed.length
        );

        return { success: false, callId: rec.callId, error: errorMsg };
      }

      const transcription = await transcriptionService.transcribe(
        rec.recordingUrl
      );

      // Update database with transcription ID and text
      await updateRecordingTranscription(
        ficheCache.id,
        rec.callId,
        transcription.transcription_id!,
        transcription.transcription.text
      );

      console.log(`  ✓ Transcribed (ID: ${transcription.transcription_id})`);

      // Send recording completed webhook
      await transcriptionWebhooks.recordingCompleted(
        ficheId,
        rec.callId,
        transcription.transcription_id!,
        i + 1,
        untranscribed.length
      );

      return {
        success: true,
        callId: rec.callId,
        transcriptionId: transcription.transcription_id,
      };
    } catch (error: any) {
      const errorMsg = error.message || "Unknown error";
      console.error(`  ❌ Error:`, errorMsg);

      // Send recording failed webhook
      await transcriptionWebhooks.recordingFailed(
        ficheId,
        rec.callId,
        errorMsg,
        i + 1,
        untranscribed.length
      );

      return { success: false, callId: rec.callId, error: errorMsg };
    }
  });

  // Wait for all transcriptions to complete and collect results
  const transcriptionResults = await Promise.all(transcriptionPromises);

  // Separate successes and failures
  for (const result of transcriptionResults) {
    completedCount++;
    if (result.success) {
      results.push({
        callId: result.callId,
        transcriptionId: result.transcriptionId,
      });
    } else {
      failures.push({
        callId: result.callId,
        error: result.error,
      });
    }

    // Send progress webhook after each completion
    const currentTranscribed = alreadyTranscribed + results.length;
    const pending = recordings.length - currentTranscribed - failures.length;

    await transcriptionWebhooks.progress(
      ficheId,
      recordings.length,
      currentTranscribed,
      pending,
      failures.length
    );

    // Call progress callback
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

  console.log(
    `\n✅ Transcription complete: ${results.length}/${untranscribed.length} (${failures.length} failed)`
  );

  return {
    total: recordings.length,
    transcribed:
      recordings.filter((r) => r.hasTranscription).length + results.length,
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
  console.log(`🎤 Batch transcribing ${ficheIds.length} fiches in parallel...`);

  const transcriptionPromises = ficheIds.map(async (ficheId) => {
    try {
      const result = await transcribeFicheRecordings(ficheId, apiKey);
      console.log(`✅ Fiche ${ficheId} transcription complete`);
      return { ficheId, ...result, success: true };
    } catch (error: any) {
      console.error(`❌ Failed to transcribe fiche ${ficheId}:`, error.message);
      return {
        ficheId,
        success: false,
        error: error.message,
      };
    }
  });

  const results = await Promise.all(transcriptionPromises);

  const successCount = results.filter((r) => r.success).length;
  console.log(
    `✅ Batch transcription complete: ${successCount}/${ficheIds.length} successful`
  );

  return results;
}
