/**
 * Fiches API Client
 * ==================
 * RESPONSIBILITY: External API calls only
 * - Fetches data from external fiches API
 * - Validates API responses
 * - No business logic or database operations
 *
 * LAYER: Data Access (External API)
 */

import axios from "axios";

import { AppError } from "../../shared/errors.js";
import { logger } from "../../shared/logger.js";
import {
  type FicheDetailsResponse,
  type SalesWithCallsResponse,
  validateFicheDetailsResponse,
  validateSalesWithCallsResponse,
} from "./fiches.schemas.js";

const baseUrl =
  process.env.FICHE_API_BASE_URL ||
  process.env.FICHE_API_URL ||
  "https://api.devis-mutuelle-pas-cher.com";
const apiBase = `${baseUrl}/api`;

type AxiosErrorMeta = {
  status?: number;
  code?: string;
  retryAfterMs?: number;
};

function getAuthHeaders(): Record<string, string> {
  const token = (process.env.FICHE_API_AUTH_TOKEN || "").trim();
  if (!token) {return {};}
  // Accept either raw token or already-prefixed "Bearer ..."
  const value = token.toLowerCase().startsWith("bearer ") ? token : `Bearer ${token}`;
  return { Authorization: value };
}

export class FicheApiError extends AppError {
  status?: number;
  upstreamCode?: string;
  path?: string;

  constructor(
    message: string,
    options?: { status?: number; code?: string; path?: string }
  ) {
    const upstreamStatus = options?.status;
    const statusCode = upstreamStatus === 404 ? 404 : 502;
    const code = upstreamStatus === 404 ? "NOT_FOUND" : "EXTERNAL_API_ERROR";
    super(message, statusCode, code);
    this.status = upstreamStatus;
    this.upstreamCode = options?.code;
    this.path = options?.path;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseRetryAfterMs(value: unknown): number | undefined {
  // Retry-After can be seconds (preferred) or an HTTP date.
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.max(0, Math.floor(value * 1000));
  }
  if (typeof value !== "string") {return undefined;}

  const trimmed = value.trim();
  if (!trimmed) {return undefined;}

  const seconds = Number(trimmed);
  if (Number.isFinite(seconds)) {
    return Math.max(0, Math.floor(seconds * 1000));
  }

  const date = Date.parse(trimmed);
  if (!Number.isFinite(date)) {return undefined;}

  return Math.max(0, date - Date.now());
}

function getAxiosErrorMeta(error: unknown): AxiosErrorMeta {
  if (!axios.isAxiosError(error)) {return {};}

  const status =
    typeof error.response?.status === "number" ? error.response.status : undefined;
  const code = typeof error.code === "string" ? error.code : undefined;

  // Axios normalizes header names to lowercase keys.
  const retryAfterMs = parseRetryAfterMs(
    (error.response?.headers as Record<string, unknown> | undefined)?.["retry-after"]
  );

  return { status, code, retryAfterMs };
}

function isRetryableFicheApiError(error: unknown): {
  retry: boolean;
  reason?: string;
  meta: AxiosErrorMeta;
} {
  const meta = getAxiosErrorMeta(error);

  // HTTP-based retry logic
  if (typeof meta.status === "number") {
    if (meta.status === 408) {
      return { retry: true, reason: "http_408_timeout", meta };
    }
    if (meta.status === 429) {
      return { retry: true, reason: "http_429_rate_limited", meta };
    }
    if (meta.status >= 500 && meta.status <= 599) {
      return { retry: true, reason: "http_5xx", meta };
    }
    return { retry: false, meta };
  }

  // Network/timeout errors
  const code = meta.code;
  if (!code) {return { retry: false, meta };}

  const retryableCodes = new Set([
    "ECONNABORTED", // axios timeout
    "ETIMEDOUT",
    "ECONNRESET",
    "EAI_AGAIN",
    "ENOTFOUND",
    "ENETUNREACH",
    "EPIPE",
    "ECONNREFUSED",
  ]);

  if (retryableCodes.has(code)) {
    return { retry: true, reason: `net_${code.toLowerCase()}`, meta };
  }

  return { retry: false, meta };
}

function computeRetryDelayMs(params: {
  retryNumber: number; // 1-based
  baseDelayMs: number;
  maxDelayMs: number;
  jitterRatio: number;
  serverSuggestedDelayMs?: number;
}): number {
  const base =
    typeof params.serverSuggestedDelayMs === "number" &&
    Number.isFinite(params.serverSuggestedDelayMs) &&
    params.serverSuggestedDelayMs > 0
      ? params.serverSuggestedDelayMs
      : params.baseDelayMs * 2 ** Math.max(0, params.retryNumber - 1);

  const capped = Math.min(params.maxDelayMs, Math.max(0, base));
  const jitter = Math.max(0, capped * params.jitterRatio);
  const min = Math.max(0, capped - jitter);
  const max = capped + jitter;
  return Math.floor(min + Math.random() * (max - min));
}

async function withFicheApiRetry<T>(
  context: { operation: string; path: string },
  fn: () => Promise<T>,
  options?: { maxAttempts?: number; baseDelayMs?: number; maxDelayMs?: number; jitterRatio?: number }
): Promise<T> {
  const maxAttempts = Math.max(1, options?.maxAttempts ?? 3);
  const baseDelayMs = Math.max(0, options?.baseDelayMs ?? 1000);
  const maxDelayMs = Math.max(baseDelayMs, options?.maxDelayMs ?? 15000);
  const jitterRatio = Math.min(1, Math.max(0, options?.jitterRatio ?? 0.2));

  let retryNumber = 0;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      const decision = isRetryableFicheApiError(error);
      if (!decision.retry || attempt >= maxAttempts) {
        throw error;
      }

      retryNumber++;
      const delayMs = computeRetryDelayMs({
        retryNumber,
        baseDelayMs,
        maxDelayMs,
        jitterRatio,
        serverSuggestedDelayMs: decision.meta.retryAfterMs,
      });

      logger.warn("Retrying fiche API request after upstream failure", {
        operation: context.operation,
        path: context.path,
        attempt,
        max_attempts: maxAttempts,
        delay_ms: delayMs,
        status: decision.meta.status,
        upstream_code: decision.meta.code,
        reason: decision.reason,
      });

      await sleep(delayMs);
    }
  }

  // Should be unreachable, but TS doesn't always narrow correctly in loops.
  throw new Error("Fiche API retry loop exhausted");
}

function toFicheApiError(
  error: unknown,
  context: { path: string; message: string }
): FicheApiError {
  if (error instanceof FicheApiError) {return error;}

  const meta = getAxiosErrorMeta(error);
  const safeMsg = error instanceof Error ? error.message : String(error);

  if (axios.isAxiosError(error)) {
    return new FicheApiError(`${context.message}: ${safeMsg}`, {
      status: meta.status,
      code: meta.code,
      path: context.path,
    });
  }

  return new FicheApiError(`${context.message}: ${safeMsg}`, { path: context.path });
}

/**
 * Convert YYYY-MM-DD to DD/MM/YYYY format for CRM API
 */
function convertToCRMDateFormat(dateStr: string): string {
  const parts = dateStr.split("-");
  if (parts.length === 3) {
    return `${parts[2]}/${parts[1]}/${parts[0]}`; // DD/MM/YYYY
  }
  return dateStr;
}

/**
 * Fetch sales list for a date range
 * NOTE: CRM API only accepts single dates, so for ranges we fetch startDate only
 * Background jobs will handle fetching each day individually
 *
 * IMPORTANT: For date range requests, recordings are NOT included (performance optimization)
 * Recordings are only fetched when requesting individual fiche details
 *
 * @param startDate - Start date in YYYY-MM-DD format (will be converted to DD/MM/YYYY for CRM)
 * @param endDate - End date in YYYY-MM-DD format (ignored - CRM only accepts single dates)
 * @param options - Optional parameters
 * @param options.statusId - Status ID to filter (NOT USED - CRM endpoint doesn't support status filtering)
 * @param options.includeRecordings - Include call recordings (default: FALSE for performance)
 */
export async function fetchSalesWithCalls(
  startDate: string,
  endDate: string,
  options?: {
    statusId?: string;
    includeRecordings?: boolean;
  }
): Promise<SalesWithCallsResponse> {
  // DEFAULT to TRUE - recordings fetched only on fiche details request
  const includeRecordings = options?.includeRecordings ?? true;

  // Convert startDate from YYYY-MM-DD to DD/MM/YYYY for CRM API
  // NOTE: CRM API only accepts single date, not ranges!
  const crmDate = convertToCRMDateFormat(startDate);

  logger.info("Fetching sales for single date", {
    start_date: startDate,
    end_date: endDate,
    crm_date: crmDate,
    note:
      startDate === endDate ? "single day" : "range (fetching start date only)",
    include_recordings: includeRecordings,
    optimization: includeRecordings
      ? "with recordings"
      : "sales list only (fast)",
  });

  try {
    // CRM API endpoint: /fiches/search/by-date-with-calls
    // Parameters:
    //   - date: DD/MM/YYYY format
    //   - criteria_type: 1 (filter by date_insertion)  //   - include_recordings: true/false
    //   - include_transcriptions: false (we handle our own)
    //   - force_new_session: false
    const params = new URLSearchParams({
      date: crmDate,
      criteria_type: "1",
      include_recordings: String(includeRecordings),
      include_transcriptions: "false",
      force_new_session: "false",
    });

    const path = "/api/fiches/search/by-date-with-calls";
    const response = await withFicheApiRetry(
      { operation: "fetchSalesWithCalls", path },
      async () => {
        return await axios.get<SalesWithCallsResponse>(`${apiBase}${path}?${params}`, {
          timeout: 120000, // 2 minutes - fail faster, workflow will retry
          headers: getAuthHeaders(),
        });
      }
    );

    // Validate response structure at runtime
    const validatedData = validateSalesWithCallsResponse(response.data);

    const recordingsCount = validatedData.fiches.reduce(
      (acc, fiche) => acc + (fiche.recordings?.length || 0),
      0
    );

    logger.info("Sales fetched and validated", {
      start_date: startDate,
      end_date: endDate,
      fiches_count: validatedData.fiches.length,
      total: validatedData.total,
      recordings_count: recordingsCount,
    });

    return validatedData;
  } catch (error) {
    const path = "/api/fiches/search/by-date-with-calls";
    const meta = getAxiosErrorMeta(error);
    const message = error instanceof Error ? error.message : String(error);

    logger.error("Failed to fetch sales", {
      start_date: startDate,
      end_date: endDate,
      path,
      status: meta.status,
      upstream_code: meta.code,
      message,
    });

    throw toFicheApiError(error, {
      path,
      message: `Failed to fetch sales with calls for ${startDate}${startDate === endDate ? "" : `..${endDate}`}`,
    });
  }
}

/**
 * Fetch fiche details from API
 * IMPORTANT: Recordings are ALWAYS included for fiche details (default: true)
 * This is where recordings should be fetched (not in date range lists)
 *
 * Note: Transcriptions are always disabled as we use our own transcription system
 * IMPORTANT: Requires `cle` parameter from fiche data
 *
 * @param ficheId - The fiche ID
 * @param cle - Deprecated (gateway refreshes cle internally); kept for backwards compatibility
 * @param options - Optional parameters
 * @param options.includeRecordings - Include call recordings (default: TRUE - recordings fetched here!)
 * @param options.includeMailDevis - Include Mail Devis Personnalisé details (default: FALSE - opt-in)
 */
export async function fetchFicheDetails(
  ficheId: string,
  cle?: string,
  options?: {
    includeRecordings?: boolean;
    includeMailDevis?: boolean;
  }
): Promise<FicheDetailsResponse> {
  const includeRecordings = options?.includeRecordings ?? true; // TRUE by default for details
  const includeMailDevis = options?.includeMailDevis ?? false;

  logger.info("Fetching fiche details", {
    fiche_id: ficheId,
    include_recordings: includeRecordings,
    include_mail_devis: includeMailDevis,
  });

  const path = `/api/fiches/by-id/${ficheId}`;

  try {
    // Gateway endpoint: /api/fiches/by-id/:ficheId
    // NOTE: The gateway is responsible for handling/refreshing `cle` internally.
    // We intentionally do not pass `cle` query params even if a cached value is present.
    const params = new URLSearchParams({
      include_recordings: String(includeRecordings),
      // We run our own transcription system; ask the gateway not to include upstream transcriptions.
      include_transcriptions: "false",
      include_mail_devis: String(includeMailDevis),
    });

    const response = await withFicheApiRetry(
      { operation: "fetchFicheDetails", path },
      async () => {
        return await axios.get<FicheDetailsResponse>(`${apiBase}${path}?${params}`, {
          timeout: 120000, // 2 minutes - CRM can be slow with full details
          headers: getAuthHeaders(),
        });
      }
    );

    if (!response.data || !response.data.success) {
      // Some gateway errors come back as 200 with `success=false`. Treat as NOT_FOUND
      // so downstream workflows can decide terminal handling without retry loops.
      throw new FicheApiError(`Fiche ${ficheId} not found`, { status: 404, path });
    }

    // Validate response structure at runtime
    const validatedData = validateFicheDetailsResponse(response.data);

    logger.info("Fiche details fetched and validated", {
      fiche_id: ficheId,
      recordings_count: validatedData.recordings?.length || 0,
      has_prospect: Boolean(validatedData.prospect),
      groupe: validatedData.information?.groupe,
      commentaires_count: validatedData.commentaires?.length || 0,
      alertes_count: validatedData.alertes?.length || 0,
      has_mail_devis: Boolean(validatedData.mail_devis),
    });

    return validatedData;
  } catch (error: unknown) {
    if (error instanceof FicheApiError) {
      // Already sanitized/typed.
      throw error;
    }

    // IMPORTANT: Never rethrow raw Axios errors here.
    // Inngest (and other runtimes) may log the full AxiosError object, which includes
    // request URL + query params. We only surface safe metadata.
    if (axios.isAxiosError(error)) {
      const status =
        typeof error.response?.status === "number" ? error.response.status : undefined;
      const code = typeof error.code === "string" ? error.code : undefined;

      logger.error("Failed to fetch fiche details", {
        fiche_id: ficheId,
        path,
        status,
        upstream_code: code,
        message: error.message,
      });

      if (status === 404) {
        throw new FicheApiError(`Fiche ${ficheId} not found`, { status, code, path });
      }

      throw new FicheApiError(
        `Failed to fetch fiche details for ${ficheId}: ${error.message}`,
        { status, code, path }
      );
    }

    const msg = error instanceof Error ? error.message : String(error);
    logger.error("Failed to fetch fiche details", {
      fiche_id: ficheId,
      path,
      message: msg,
    });
    throw new FicheApiError(`Failed to fetch fiche details for ${ficheId}: ${msg}`, {
      path,
    });
  }
}
