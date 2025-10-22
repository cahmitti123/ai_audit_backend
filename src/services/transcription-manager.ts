/**
 * Transcription Manager
 * ====================
 * Manages transcription with ElevenLabs and database storage
 */

import { TranscriptionService } from "./transcription.js";
import {
  getCachedFiche,
  getRecordingsByFiche,
  updateRecordingTranscription,
  getUntranscribedRecordings,
} from "./database.js";

/**
 * Transcribe all recordings for a fiche and update database
 */
export async function transcribeFicheRecordings(
  ficheId: string,
  apiKey: string
) {
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
  }

  // Get recordings from database if available
  if (!ficheCache) {
    // Database not available - can't track transcription status
    console.warn(`⚠️  Cannot check transcription status without database`);
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
  console.log(`⏳ Need to transcribe: ${untranscribed.length}`);

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

  // Transcribe each recording
  const results = [];
  for (let i = 0; i < untranscribed.length; i++) {
    const rec = untranscribed[i];
    console.log(
      `[${i + 1}/${untranscribed.length}] Transcribing ${rec.callId}...`
    );

    try {
      if (!rec.recordingUrl) {
        console.log(`  ⚠️  No recording URL`);
        continue;
      }

      const transcription = await transcriptionService.transcribe(
        rec.recordingUrl
      );

      // Update database with transcription ID
      await updateRecordingTranscription(
        ficheCache.id,
        rec.callId,
        transcription.transcription_id!
      );

      console.log(`  ✓ Transcribed (ID: ${transcription.transcription_id})`);
      results.push({
        callId: rec.callId,
        transcriptionId: transcription.transcription_id,
      });
    } catch (error: any) {
      console.error(`  ❌ Error:`, error.message);
    }
  }

  console.log(
    `\n✅ Transcription complete: ${results.length}/${untranscribed.length}`
  );

  return {
    total: recordings.length,
    transcribed:
      recordings.filter((r) => r.hasTranscription).length + results.length,
    newTranscriptions: results.length,
    results,
  };
}

/**
 * Get transcription status for a fiche
 */
export async function getFicheTranscriptionStatus(ficheId: string) {
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
 * Batch transcribe multiple fiches
 */
export async function batchTranscribeFiches(
  ficheIds: string[],
  apiKey: string
) {
  console.log(`🎤 Batch transcribing ${ficheIds.length} fiches...`);

  const results = [];
  for (const ficheId of ficheIds) {
    try {
      const result = await transcribeFicheRecordings(ficheId, apiKey);
      results.push({ ficheId, ...result, success: true });
    } catch (error: any) {
      console.error(`❌ Failed to transcribe fiche ${ficheId}:`, error.message);
      results.push({
        ficheId,
        success: false,
        error: error.message,
      });
    }
  }

  return results;
}
