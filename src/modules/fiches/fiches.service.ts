/**
 * Fiches Service
 * ==============
 * Business logic for fiche operations
 */

import axios from "axios";
import { logger } from "../../shared/logger.js";

// Types
export interface SalesResponse {
  success: boolean;
  fiches: any[];
  total: number;
}

const baseUrl =
  process.env.FICHE_API_BASE_URL || "https://api.devis-mutuelle-pas-cher.com";
const apiBase = `${baseUrl}/api`;
/**
 * Fetch sales list by date
 */
export async function fetchApiSales(date: string): Promise<SalesResponse> {
  const formattedDate = date.split("-").reverse().join("/");
  console.log("fetchApiSales - Starting fetch", { date, formattedDate });
  logger.info("Fetching sales list", { date, formatted_date: formattedDate });

  try {
    const params = new URLSearchParams({
      date: formattedDate,
      criteria_type: "1",
      force_new_session: "false",
    });

    console.log("fetchApiSales - Request params", {
      params: params.toString(),
    });
    console.log("fetchApiSales - API URL", {
      url: `${apiBase}/fiches/search/by-date?${params}`,
    });

    const response = await axios.get(
      `${apiBase}/fiches/search/by-date?${params}`,
      {
        timeout: 60000,
      }
    );

    console.log("fetchApiSales - Response received", {
      status: response.status,
      dataKeys: Object.keys(response.data || {}),
      fichesLength: response.data?.fiches?.length,
    });

    const fiches = response.data?.fiches || [];
    console.log("fetchApiSales - Fiches extracted", { count: fiches.length });
    logger.info("Sales list fetched", {
      date,
      fiches_count: fiches.length,
      total: fiches.length,
    });

    return {
      success: true,
      fiches,
      total: fiches.length,
    };
  } catch (error: any) {
    console.error("fetchApiSales - Error occurred", {
      date,
      status: error.response?.status,
      message: error.message,
      stack: error.stack,
    });
    logger.error("Failed to fetch sales", {
      date,
      status: error.response?.status,
      message: error.message,
    });
    throw error;
  }
}
/**
 * Fetch fiche details from API
 */
export async function fetchApiFicheDetails(
  ficheId: string,
  cle?: string
): Promise<any> {
  logger.info("Fetching fiche details", {
    fiche_id: ficheId,
    has_cle: Boolean(cle),
  });

  try {
    const params: any = {
      include_recordings: "true",
      include_transcriptions: "false",
    };
    if (cle) params.cle = cle;

    const query = new URLSearchParams(params);
    const response = await axios.get(
      `${apiBase}/fiches/by-id/${ficheId}?${query}`,
      {
        timeout: 30000,
      }
    );

    if (!response.data || !response.data.success) {
      throw new Error("Fiche not found");
    }

    const ficheData = response.data;
    logger.info("Fiche details fetched successfully", {
      fiche_id: ficheId,
      recordings_count: ficheData.recordings?.length || 0,
      has_prospect: Boolean(ficheData.prospect),
      groupe: ficheData.information?.groupe,
    });

    return ficheData;
  } catch (error: any) {
    logger.error("Failed to fetch fiche details", {
      fiche_id: ficheId,
      status: error.response?.status,
      message: error.message,
    });

    if (error.response?.status === 404) {
      throw new Error(`Fiche ${ficheId} not found`);
    }
    throw error;
  }
}

/**
 * Get fiche with auto-caching
 */
export async function getFicheWithCache(ficheId: string, cle?: string) {
  console.log("Getting fiche with cache", {
    fiche_id: ficheId,
    has_cle: Boolean(cle),
  });
  logger.info("Getting fiche with cache", {
    fiche_id: ficheId,
    has_cle: Boolean(cle),
  });

  console.log("Importing repository functions");
  const { getCachedFiche, cacheFiche } = await import("./fiches.repository.js");

  // Check cache
  console.log("Looking up fiche in cache", { fiche_id: ficheId });
  logger.debug("Looking up fiche in cache", { fiche_id: ficheId });
  const cached = await getCachedFiche(ficheId);

  if (cached && cached.expiresAt > new Date()) {
    console.log("Fiche retrieved from cache", {
      fiche_id: ficheId,
      cache_id: cached.id.toString(),
      recordings_count: cached.recordingsCount,
      cached_count: cached.recordingsCount,
    });
    logger.debug("Fiche retrieved from cache", {
      fiche_id: ficheId,
      cache_id: cached.id.toString(),
      recordings_count: cached.recordingsCount,
      cached_count: cached.recordingsCount,
    });
    return cached.rawData;
  }

  console.log("Fiche not found in cache or expired", { fiche_id: ficheId });
  logger.debug("Fiche not found in cache", { fiche_id: ficheId });
  console.log("Cache miss, fetching from API", { fiche_id: ficheId });
  logger.info("Cache miss, fetching from API", { fiche_id: ficheId });

  // Fetch and cache
  console.log("Fetching fiche details from API", { fiche_id: ficheId });
  const ficheData = await fetchApiFicheDetails(ficheId, cle);
  console.log("Caching fiche data", { fiche_id: ficheId });
  await cacheFiche(ficheData);

  console.log("Fiche cached successfully", {
    fiche_id: ficheId,
    recordings_count: ficheData.recordings?.length || 0,
  });
  logger.info("Fiche cached successfully", {
    fiche_id: ficheId,
    recordings_count: ficheData.recordings?.length || 0,
  });

  return ficheData;
}

/**
 * Force refresh fiche from API and upsert to database
 * This bypasses the cache and always fetches fresh data
 */
export async function refreshFicheFromApi(ficheId: string, cle?: string) {
  console.log("Force refreshing fiche from API", {
    fiche_id: ficheId,
    has_cle: Boolean(cle),
  });
  logger.info("Force refreshing fiche from API", {
    fiche_id: ficheId,
    has_cle: Boolean(cle),
  });

  // Always fetch from API
  console.log("Fetching fresh fiche details from API", { fiche_id: ficheId });
  const ficheData = await fetchApiFicheDetails(ficheId, cle);

  // Import repository and upsert to database
  console.log("Importing repository functions");
  const { cacheFiche } = await import("./fiches.repository.js");

  console.log("Upserting fresh fiche data to database", { fiche_id: ficheId });
  await cacheFiche(ficheData);

  console.log("Fiche refreshed and upserted successfully", {
    fiche_id: ficheId,
    recordings_count: ficheData.recordings?.length || 0,
  });
  logger.info("Fiche refreshed and upserted successfully", {
    fiche_id: ficheId,
    recordings_count: ficheData.recordings?.length || 0,
  });

  return ficheData;
}

export const FichesService = {
  fetchApiSales,
  fetchApiFicheDetails,
  getFicheWithCache,
  refreshFicheFromApi,
};
