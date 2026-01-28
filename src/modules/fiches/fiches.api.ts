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

    const response = await axios.get<SalesWithCallsResponse>(
      `${apiBase}/fiches/search/by-date-with-calls?${params}`,
      {
        timeout: 120000, // 2 minutes - fail faster, workflow will retry
        headers: getAuthHeaders(),
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
    const err = error as { response?: { status?: number }; message: string };
    logger.error("Failed to fetch sales", {
      start_date: startDate,
      end_date: endDate,
      status: err.response?.status,
      message: err.message,
    });
    throw error;
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

    const response = await axios.get<FicheDetailsResponse>(
      `${apiBase}/fiches/by-id/${ficheId}?${params}`,
      {
        timeout: 120000, // 2 minutes - CRM can be slow with full details
        headers: getAuthHeaders(),
      }
    );

    if (!response.data || !response.data.success) {
      throw new Error(`Fiche ${ficheId} not found`);
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
    // IMPORTANT: Never rethrow raw Axios errors here.
    // Inngest (and other runtimes) may log the full AxiosError object, which includes
    // request URL + query params. We only surface safe metadata.
    const path = `/api/fiches/by-id/${ficheId}`;

    if (axios.isAxiosError(error)) {
      const status =
        typeof error.response?.status === "number" ? error.response.status : undefined;
      const code = typeof error.code === "string" ? error.code : undefined;

      logger.error("Failed to fetch fiche details", {
        fiche_id: ficheId,
        path,
        status,
        code,
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
