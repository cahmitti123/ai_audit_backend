/**
 * Transcriptions Repository
 * ==========================
 * Database operations for transcriptions
 */

import {
  getRecordingsByFiche,
  getUntranscribedRecordings,
  updateRecordingTranscription,
} from "../recordings/recordings.repository.js";

// Re-export recordings functions for transcription use
export {
  getRecordingsByFiche,
  getUntranscribedRecordings,
  updateRecordingTranscription,
};
