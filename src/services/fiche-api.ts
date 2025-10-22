/**
 * Fiche API Service
 * =================
 * Handles communication with external fiche API
 */

import axios from "axios";
import {
  validateSalesResponse,
  validateFicheDetailsResponse,
  SalesResponse,
  FicheDetailsResponse,
} from "../schemas/fiche-schemas.js";

const baseUrl =
  process.env.FICHE_API_BASE_URL || "https://api.devis-mutuelle-pas-cher.com";
const apiBase = `${baseUrl}/api`;

/**
 * Fetch sales list by date
 */
export async function fetchApiSales(date: string): Promise<SalesResponse> {
  try {
    const params = new URLSearchParams({
      date: date.split("-").reverse().join("/"), // YYYY-MM-DD -> DD/MM/YYYY
      criteria_type: "1",
      force_new_session: "false",
    });

    const url = `${apiBase}/fiches/search/by-date?${params}`;
    console.log(`📡 Fetching sales from: ${url}`);

    const response = await axios.get(url, {
      headers: { accept: "application/json" },
      timeout: 60000,
    });

    console.log(`✓ Response status: ${response.status}`);
    console.log(`✓ Total fiches: ${response.data.total || 0}`);

    // API returns directly { fiches: [], total: N }, no "success" wrapper
    return validateSalesResponse(response.data);
  } catch (error) {
    if (axios.isAxiosError(error)) {
      const status = error.response?.status;
      console.error(
        `❌ API Error ${status}:`,
        error.response?.data || error.message
      );

      if (status === 404) {
        // Return empty results instead of error (no sales for this date)
        return { fiches: [], total: 0 };
      }
      if (status === 401 || status === 403) {
        throw new Error(`Authentication failed: ${error.message}`);
      }
      if (status === 429) {
        throw new Error("Rate limit exceeded");
      }
      throw new Error(`API error: ${error.message}`);
    }
    throw error;
  }
}

/**
 * Fetch fiche details with recordings
 */
export async function fetchApiFicheDetails(
  ficheId: string,
  cle?: string
): Promise<FicheDetailsResponse> {
  try {
    const params = new URLSearchParams({
      include_recordings: "true",
      include_transcriptions: "false",
    });

    if (cle) {
      params.append("cle", cle);
    }

    const ficheUrl = `${apiBase}/fiches/by-id/${ficheId}?${params.toString()}`;

    const response = await axios.get(ficheUrl, {
      headers: { accept: "application/json" },
      timeout: 60000,
    });

    return validateFicheDetailsResponse(response.data);
  } catch (error) {
    if (axios.isAxiosError(error)) {
      const status = error.response?.status;
      if (status === 404) {
        throw new Error(`Fiche ${ficheId} not found`);
      }
      if (status === 401 || status === 403) {
        throw new Error(`Authentication failed: ${error.message}`);
      }
      if (status === 429) {
        throw new Error("Rate limit exceeded");
      }
      throw new Error(`API error: ${error.message}`);
    }
    throw error;
  }
}
