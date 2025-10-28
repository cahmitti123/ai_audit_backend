/**
 * Transcriptions Repository
 * ==========================
 * Database operations for transcriptions
 */

import {
  getRecordingsByFiche,
  updateRecordingTranscription,
  getUntranscribedRecordings,
} from "../recordings/recordings.repository.js";

// Re-export recordings functions for transcription use
export {
  getRecordingsByFiche,
  updateRecordingTranscription,
  getUntranscribedRecordings,
};
