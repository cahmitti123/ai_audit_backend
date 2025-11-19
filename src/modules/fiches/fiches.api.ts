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
import { logger } from "../../shared/logger.js";
import {
  type FicheDetailsResponse,
  type SalesWithCallsResponse,
  validateFicheDetailsResponse,
  validateSalesWithCallsResponse,
} from "./fiches.schemas.js";

const baseUrl =
  process.env.FICHE_API_BASE_URL || "https://api.devis-mutuelle-pas-cher.com";
const apiBase = `${baseUrl}/api`;

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
  // DEFAULT to FALSE - recordings fetched only on fiche details request
  const includeRecordings = options?.includeRecordings ?? false;

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
        timeout: 300000, // 5 minutes - CRM can be slow
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
 * @param cle - The fiche security key (required by CRM)
 * @param options - Optional parameters
 * @param options.includeRecordings - Include call recordings (default: TRUE - recordings fetched here!)
 */
export async function fetchFicheDetails(
  ficheId: string,
  cle: string,
  options?: {
    includeRecordings?: boolean;
  }
): Promise<FicheDetailsResponse> {
  const includeRecordings = options?.includeRecordings ?? true; // TRUE by default for details

  logger.info("Fetching fiche details", {
    fiche_id: ficheId,
    has_cle: Boolean(cle),
    include_recordings: includeRecordings,
  });

  try {
    // CRM API endpoint: /fiches/{ficheId}?cle={cle}&include_recordings=true
    const params = new URLSearchParams({
      cle: cle, // Required by CRM
      include_recordings: String(includeRecordings),
      include_transcriptions: "false", // Always false - we use our own transcription system
    });

    const response = await axios.get<FicheDetailsResponse>(
      `${apiBase}/fiches/${ficheId}?${params}`,
      {
        timeout: 120000, // 2 minutes - CRM can be slow with full details
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
    });

    return validatedData;
  } catch (error) {
    const err = error as { response?: { status?: number }; message: string };
    logger.error("Failed to fetch fiche details", {
      fiche_id: ficheId,
      status: err.response?.status,
      message: err.message,
    });

    if (err.response?.status === 404) {
      throw new Error(`Fiche ${ficheId} not found`);
    }
    throw error;
  }
}
