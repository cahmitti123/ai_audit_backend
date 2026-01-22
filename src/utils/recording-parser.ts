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
    const fileNameWithQuery = url.split("/").pop() || url;
    // Strip querystring/fragment so patterns match: "file.mp3?token=..." -> "file.mp3"
    const fileName = fileNameWithQuery.split("?")[0]?.split("#")[0] || fileNameWithQuery;

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

  const getStringField = (key: string): string | null => {
    const v = (recording as Record<string, unknown>)[key];
    return typeof v === "string" && v.trim() ? v.trim() : null;
  };

  const startTimeRaw =
    getStringField("start_time") ||
    getStringField("startTime") ||
    null;

  const fromRaw =
    getStringField("from_number") ||
    getStringField("fromNumber") ||
    null;

  const toRaw =
    getStringField("to_number") ||
    getStringField("toNumber") ||
    null;

  const uuidRaw = getStringField("uuid");

  const pad2 = (n: number) => String(n).padStart(2, "0");

  const buildParsedFromStartTime = (): {
    date: string;
    time: string;
    timestamp: string;
  } | null => {
    if (!startTimeRaw) {return null;}

    // Try ISO parsing first (works for "2026-01-22T16:20:00Z", etc.)
    const ms = Date.parse(startTimeRaw);
    if (Number.isFinite(ms)) {
      const d = new Date(ms);
      const date = `${pad2(d.getUTCDate())}/${pad2(d.getUTCMonth() + 1)}/${d.getUTCFullYear()}`;
      const time = `${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())}`;
      return { date, time, timestamp: d.toISOString() };
    }

    // Fallback: "YYYY-MM-DD HH:MM(:SS)" or "YYYY-MM-DDTHH:MM"
    const mYmd = /^(\d{4})-(\d{2})-(\d{2})(?:[T\s](\d{2}):(\d{2}))/.exec(startTimeRaw);
    if (mYmd) {
      const [, yyyy, mm, dd, hh, min] = mYmd;
      const date = `${dd}/${mm}/${yyyy}`;
      const time = `${hh}:${min}`;
      const iso = `${yyyy}-${mm}-${dd}T${hh}:${min}:00.000Z`;
      return { date, time, timestamp: iso };
    }

    // Fallback: "DD/MM/YYYY HH:MM"
    const mDmy = /^(\d{2})\/(\d{2})\/(\d{4})(?:\s(\d{2}):(\d{2}))/.exec(startTimeRaw);
    if (mDmy) {
      const [, dd, mm, yyyy, hh, min] = mDmy;
      const date = `${dd}/${mm}/${yyyy}`;
      const time = `${hh}:${min}`;
      const iso = `${yyyy}-${mm}-${dd}T${hh}:${min}:00.000Z`;
      return { date, time, timestamp: iso };
    }

    return null;
  };

  logger.debug("enrichRecording: processing recording", {
    call_id: callId,
    has_recording_url: Boolean(recording.recording_url),
    has_recordingUrl: Boolean(recording.recordingUrl),
    final_url: url ? `${url.substring(0, 50)}...` : "MISSING",
  });

  const parsed = parseRecordingUrl(url);

  if (!parsed) {
    // Fallback: if the API already provides start_time/from/to, use them instead of parsing the URL.
    const fallbackTime = buildParsedFromStartTime();
    const canFallback = Boolean(fallbackTime || fromRaw || toRaw || uuidRaw);

    // Only warn when we have neither a parseable URL nor enough metadata to build a useful fallback.
    if (!canFallback) {
      logger.warn("enrichRecording: failed to parse URL", { call_id: callId });
    }

    return {
      ...recording,
      // Normalize field names to snake_case
      recording_url: url,
      call_id: callId,
      parsed: canFallback
        ? {
            uuid: uuidRaw || "",
            date: fallbackTime?.date || "",
            time: fallbackTime?.time || "",
            timestamp: fallbackTime?.timestamp || "",
            from_number: fromRaw ? formatPhoneNumber(fromRaw) : "",
            to_number: toRaw ? formatPhoneNumber(toRaw) : "",
            from_number_raw: fromRaw || "",
            to_number_raw: toRaw || "",
          }
        : null,
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
