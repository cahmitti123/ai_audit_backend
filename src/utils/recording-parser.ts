/**
 * Recording URL Parser
 * ====================
 * Parses recording URLs to extract date, time, UUID, and phone numbers
 */

import { logger } from "../shared/logger.js";

interface ParsedRecording {
  uuid: string;
  date: string; // DD/MM/YYYY
  time: string; // HH:MM
  timestamp: Date;
  fromNumber: string;
  toNumber: string;
  fileName: string;
}

export type RecordingLike = {
  recording_url?: string | null;
  recordingUrl?: string | null;
  call_id?: string;
  callId?: string;
  [key: string]: unknown;
};

export type EnrichedParsedRecording = {
  uuid: string;
  date: string;
  time: string;
  timestamp: string;
  from_number: string;
  to_number: string;
  from_number_raw: string;
  to_number_raw: string;
};

/**
 * Parse recording URL/filename
 * Format: {uuid}-{dd}-{mm}-{yy}-{hh}h{mm}-{from_number}-{to_number}.mp3
 * Example: 6e85f049-1b2e-4ab4-a3a9-19af4d0a31cb-13-10-25-14h41-33755520797-33676796218.mp3
 */
export function parseRecordingUrl(url: string): ParsedRecording | null {
  try {
    // Extract filename from URL
    const fileName = url.split("/").pop() || url;

    // Regex pattern for recording filename
    // UUID (with hyphens) - DD-MM-YY-HHhMM-FROM_NUMBER-TO_NUMBER.mp3
    const pattern =
      /^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})-(\d{2})-(\d{2})-(\d{2})-(\d{2})h(\d{2})-(\d+)-(\d+)\.mp3$/i;

    const match = fileName.match(pattern);

    if (!match) {
      return null;
    }

    const [, uuid, day, month, year, hour, minute, fromNumber, toNumber] =
      match;

    // Convert 2-digit year to 4-digit (assuming 2000s)
    const fullYear = `20${year}`;

    // Format date as DD/MM/YYYY
    const date = `${day}/${month}/${fullYear}`;

    // Format time as HH:MM
    const time = `${hour}:${minute}`;

    // Create timestamp
    const timestamp = new Date(
      parseInt(fullYear),
      parseInt(month) - 1, // Month is 0-indexed
      parseInt(day),
      parseInt(hour),
      parseInt(minute)
    );

    return {
      uuid,
      date,
      time,
      timestamp,
      fromNumber,
      toNumber,
      fileName,
    };
  } catch (error) {
    logger.error("Error parsing recording URL", {
      url,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

/**
 * Format phone number for display
 * Example: 33676796218 -> +33 6 76 79 62 18
 */
export function formatPhoneNumber(phone: string): string {
  if (phone.startsWith("33") && phone.length === 11) {
    // French number
    return `+33 ${phone.substring(2, 3)} ${phone.substring(
      3,
      5
    )} ${phone.substring(5, 7)} ${phone.substring(7, 9)} ${phone.substring(
      9,
      11
    )}`;
  }
  return phone;
}

/**
 * Get direction from phone numbers
 */
export function getCallDirection(
  fromNumber: string,
  toNumber: string,
  agentNumbers: string[] = []
): "in" | "out" | "unknown" {
  // If we have agent numbers, check them
  if (agentNumbers.length > 0) {
    if (agentNumbers.includes(fromNumber)) {return "out";}
    if (agentNumbers.includes(toNumber)) {return "in";}
  }

  // Heuristic: if from number starts with standard mobile/landline, it's likely incoming
  // French mobile: 06, 07
  // French landline: 01-05, 09
  if (fromNumber.startsWith("336") || fromNumber.startsWith("337")) {
    return "in";
  }

  return "unknown";
}

/**
 * Enrich recording with parsed information
 * Handles both snake_case (API) and camelCase (Database) field names
 * ALWAYS returns recording_url in snake_case for consistency
 */
export function enrichRecording<T extends RecordingLike>(
  recording: T
): T & { recording_url: string; call_id: string; parsed: EnrichedParsedRecording | null } {
  // Handle both formats: recording_url (API) and recordingUrl (DB)
  const url = recording.recording_url || recording.recordingUrl || "";
  const callId = recording.call_id || recording.callId || "";

  logger.debug("enrichRecording: processing recording", {
    call_id: callId,
    has_recording_url: Boolean(recording.recording_url),
    has_recordingUrl: Boolean(recording.recordingUrl),
    final_url: url ? `${url.substring(0, 50)}...` : "MISSING",
  });

  const parsed = parseRecordingUrl(url);

  if (!parsed) {
    logger.warn("enrichRecording: failed to parse URL", { call_id: callId });
    return {
      ...recording,
      // Normalize field names to snake_case
      recording_url: url,
      call_id: callId,
      parsed: null,
    };
  }

  logger.debug("enrichRecording: successfully enriched", {
    call_id: callId,
    date: parsed.date,
    time: parsed.time,
    url_length: url.length,
  });

  return {
    ...recording,
    // Normalize field names to snake_case (critical for timeline generation)
    recording_url: url,
    call_id: callId,
    parsed: {
      uuid: parsed.uuid,
      date: parsed.date,
      time: parsed.time,
      timestamp: parsed.timestamp.toISOString(),
      from_number: formatPhoneNumber(parsed.fromNumber),
      to_number: formatPhoneNumber(parsed.toNumber),
      from_number_raw: parsed.fromNumber,
      to_number_raw: parsed.toNumber,
    },
  };
}
