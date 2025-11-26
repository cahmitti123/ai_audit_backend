/**
 * Fiches Cache Operations
 * ========================
 * RESPONSIBILITY: Caching orchestration
 * - Cache lookup and management
 * - Enriches recordings before caching
 * - Handles cache expiration
 * - Coordinates between API and repository
 *
 * LAYER: Orchestration
 */

import { logger } from "../../shared/logger.js";
import { CACHE_EXPIRATION_HOURS } from "../../shared/constants.js";
import { enrichRecording } from "../../utils/recording-parser.js";
import type { FicheDetailsResponse } from "./fiches.schemas.js";
import * as fichesRepository from "./fiches.repository.js";
import * as fichesApi from "./fiches.api.js";
import { prisma } from "../../shared/prisma.js";

/**
 * Get fiche with auto-caching
 * Checks cache first, fetches from API if expired/missing
 */
export async function getFicheWithCache(ficheId: string) {
  logger.info("Getting fiche with cache", {
    fiche_id: ficheId,
  });

  // Check cache
  const cached = await fichesRepository.getCachedFiche(ficheId);

  if (cached && cached.expiresAt > new Date()) {
    const rawData = cached.rawData as any;

    // Check if we only have sales list data (minimal)
    if (rawData._salesListOnly) {
      logger.info("Cache has only sales list data, fetching full details", {
        fiche_id: ficheId,
      });

      // Extract cle from cached data
      const cle = rawData.cle;

      if (!cle) {
        logger.error("No cle found in cached data", {
          fiche_id: ficheId,
        });
        throw new Error(
          `Cannot fetch fiche ${ficheId}: missing cle parameter in cached data`
        );
      }

      // Fetch and cache full details with cle
      const ficheData = await fichesApi.fetchFicheDetails(ficheId, cle);
      await cacheFicheDetails(ficheData, {
        salesDate: cached.salesDate || undefined,
      });

      return ficheData;
    }

    logger.debug("Fiche retrieved from cache (full details)", {
      fiche_id: ficheId,
      cache_id: cached.id.toString(),
      recordings_count: cached.recordingsCount,
    });
    return cached.rawData;
  }

  logger.info("Cache miss, fetching from API", { fiche_id: ficheId });

  // Cannot fetch without cle - fiches should come from sales list first
  throw new Error(
    `Fiche ${ficheId} not found in cache. Fetch via date range endpoint first to get cle.`
  );
}

/**
 * Force refresh fiche from API and update cache
 * Bypasses cache and always fetches fresh data
 */
export async function refreshFicheFromApi(ficheId: string) {
  logger.info("Force refreshing fiche from API", {
    fiche_id: ficheId,
  });

  // Get cached data to extract cle
  const cached = await fichesRepository.getCachedFiche(ficheId);

  if (!cached) {
    throw new Error(`Cannot refresh fiche ${ficheId}: not in cache`);
  }

  const rawData = cached.rawData as any;
  const cle = rawData.cle || rawData.information?.cle;

  if (!cle) {
    throw new Error(`Cannot refresh fiche ${ficheId}: missing cle parameter`);
  }

  // Always fetch from API with cle
  const ficheData = await fichesApi.fetchFicheDetails(ficheId, cle);

  // Update cache
  await cacheFicheDetails(ficheData, {
    salesDate: cached.salesDate || undefined,
  });

  logger.info("Fiche refreshed and cached successfully", {
    fiche_id: ficheId,
    recordings_count: ficheData.recordings?.length || 0,
  });

  return ficheData;
}

/**
 * Cache full fiche details from API response
 * High-level operation that enriches recordings and stores everything
 */
export async function cacheFicheDetails(
  ficheData: FicheDetailsResponse,
  options?: {
    expirationHours?: number;
    lastRevalidatedAt?: Date;
    salesDate?: string; // YYYY-MM-DD - Which CRM sales date this fiche belongs to
  }
) {
  // Validate that required information exists
  if (!ficheData.information) {
    throw new Error("Cannot cache fiche: missing information object");
  }

  const expirationHours = options?.expirationHours || CACHE_EXPIRATION_HOURS;
  const expiresAt = new Date();
  expiresAt.setHours(expiresAt.getHours() + expirationHours);

  // Enrich recordings with parsed metadata
  if (ficheData.recordings) {
    ficheData.recordings = ficheData.recordings.map(enrichRecording);
  }

  // Extract salesDate from date_insertion (format: "DD/MM/YYYY HH:MM" -> "YYYY-MM-DD")
  let salesDate = options?.salesDate;
  if (!salesDate && ficheData.information.date_insertion) {
    const dateStr = ficheData.information.date_insertion;
    // Split by space to get date part only (ignore time)
    const datePart = dateStr.split(" ")[0];
    const parts = datePart.split("/");
    if (parts.length === 3 && parts[2].length === 4) {
      // Validate year is 4 digits
      salesDate = `${parts[2]}-${parts[1].padStart(2, "0")}-${parts[0].padStart(
        2,
        "0"
      )}`; // DD/MM/YYYY -> YYYY-MM-DD
    }
  }

  const ficheCache = await fichesRepository.upsertFicheCache({
    ficheId: ficheData.information.fiche_id,
    groupe: ficheData.information.groupe,
    agenceNom: ficheData.information.agence_nom,
    prospectNom: ficheData.prospect?.nom || undefined,
    prospectPrenom: ficheData.prospect?.prenom || undefined,
    prospectEmail: ficheData.prospect?.mail || undefined,
    prospectTel:
      ficheData.prospect?.telephone || ficheData.prospect?.mobile || undefined,
    salesDate, // Track which CRM sales date this fiche belongs to
    rawData: ficheData,
    hasRecordings: ficheData.recordings?.length > 0,
    recordingsCount: ficheData.recordings?.length || 0,
    expiresAt,
    lastRevalidatedAt: options?.lastRevalidatedAt,
  });

  // Store recordings separately in recordings table
  if (ficheData.recordings?.length > 0) {
    await fichesRepository.upsertRecordings(
      ficheCache.id,
      ficheData.recordings
    );

    // Update rawData to include recordings (keep in sync)
    await prisma.ficheCache.update({
      where: { id: ficheCache.id },
      data: {
        rawData: ficheData as any,
      },
    });
  }

  logger.debug("Fiche cached with details", {
    fiche_id: ficheData.information.fiche_id,
    cache_id: String(ficheCache.id),
    recordings_count: ficheData.recordings?.length || 0,
  });

  return ficheCache;
}

/**
 * Cache fiche from sales list data (minimal data)
 * Used when caching sales list with recordings before full details are fetched
 */
export async function cacheFicheSalesSummary(
  ficheData: {
    id: string;
    cle: string; // Security key - required for fetching full details later
    nom: string;
    prenom: string;
    email: string;
    telephone: string;
    recordings?: unknown[];
  },
  options?: {
    expirationHours?: number;
    lastRevalidatedAt?: Date;
    salesDate?: string; // YYYY-MM-DD - Which CRM sales date this fiche belongs to
  }
) {
  const expirationHours =
    options?.expirationHours || CACHE_EXPIRATION_HOURS || 72;
  const expiresAt = new Date();
  expiresAt.setHours(expiresAt.getHours() + expirationHours);

  // Enrich recordings
  const enrichedRecordings = ficheData.recordings?.map(enrichRecording) || [];

  const ficheCache = await fichesRepository.upsertFicheCache({
    ficheId: ficheData.id,
    groupe: "", // Will be populated when full details fetched
    agenceNom: "",
    prospectNom: ficheData.nom,
    prospectPrenom: ficheData.prenom,
    prospectEmail: ficheData.email,
    prospectTel: ficheData.telephone,
    salesDate: options?.salesDate, // Track which CRM sales date this fiche belongs to
    rawData: {
      // Store COMPLETE sales data from API
      id: ficheData.id,
      cle: ficheData.cle, // ← IMPORTANT: Store cle for later detail fetching
      nom: ficheData.nom,
      prenom: ficheData.prenom,
      telephone: ficheData.telephone,
      telephone_2: (ficheData as any).telephone_2 || null,
      email: ficheData.email,
      statut: (ficheData as any).statut || null,
      date_insertion: (ficheData as any).date_insertion || null,
      date_modification: (ficheData as any).date_modification || null,
      recordings: enrichedRecordings,
      _salesListOnly: true, // Flag to indicate this is minimal data (no full details yet)
    },
    hasRecordings: enrichedRecordings.length > 0,
    recordingsCount: enrichedRecordings.length,
    expiresAt,
    lastRevalidatedAt: options?.lastRevalidatedAt,
  });

  // Store recordings separately
  if (enrichedRecordings.length > 0) {
    await fichesRepository.upsertRecordings(ficheCache.id, enrichedRecordings);
  }

  logger.debug("Fiche cached with sales summary", {
    fiche_id: ficheData.id,
    cache_id: String(ficheCache.id),
    recordings_count: enrichedRecordings.length,
  });

  return ficheCache;
}

/**
 * NOTE: Cleanup logic removed
 * All sales data is permanently stored in the database
 * No automatic deletion of expired caches
 */
