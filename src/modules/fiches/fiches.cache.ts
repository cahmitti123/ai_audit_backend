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
import { enrichRecording, type RecordingLike } from "../../utils/recording-parser.js";
import type { FicheDetailsResponse } from "./fiches.schemas.js";
import * as fichesRepository from "./fiches.repository.js";
import * as fichesApi from "./fiches.api.js";
import { prisma } from "../../shared/prisma.js";
import type { Prisma } from "@prisma/client";
import { ValidationError } from "../../shared/errors.js";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function toPrismaJsonValue(value: unknown): Prisma.InputJsonValue {
  const json: unknown = JSON.parse(JSON.stringify(value));
  return json as Prisma.InputJsonValue;
}

function getCleFromRawData(rawData: Record<string, unknown>): string | null {
  const cle = rawData.cle;
  if (typeof cle === "string" && cle) return cle;
  const info = rawData.information;
  if (isRecord(info)) {
    const cle2 = info.cle;
    if (typeof cle2 === "string" && cle2) return cle2;
  }
  return null;
}

/**
 * Get fiche with auto-caching
 * Checks cache first, fetches from API if expired/missing
 */
export async function getFicheWithCache(
  ficheId: string
): Promise<FicheDetailsResponse> {
  logger.info("Getting fiche with cache", {
    fiche_id: ficheId,
  });

  // Check cache
  const cached = await fichesRepository.getCachedFiche(ficheId);

  if (cached) {
    const rawData = cached.rawData;
    const isExpired = cached.expiresAt <= new Date();

    // If cache is minimal (sales list only) OR expired, we can still refresh using `cle`
    // from cached rawData. Expiration is a "freshness" hint, not a hard requirement.
    if (rawData._salesListOnly === true || isExpired) {
      logger.info(
        rawData._salesListOnly === true
          ? "Cache has only sales list data, fetching full details"
          : "Cache expired, refreshing fiche details",
        {
          fiche_id: ficheId,
          cache_id: cached.id.toString(),
          expired: isExpired,
          sales_list_only: rawData._salesListOnly === true,
          expires_at: cached.expiresAt?.toISOString?.() || String(cached.expiresAt),
        }
      );

      const cle = getCleFromRawData(rawData);
      if (!cle) {
        logger.error("No cle found in cached data", { fiche_id: ficheId });

        // If we have full details but no cle, return stale cached data rather than failing.
        if (rawData._salesListOnly !== true) {
          return cached.rawData as unknown as FicheDetailsResponse;
        }

        throw new ValidationError(
          `Cannot fetch fiche ${ficheId}: missing cle parameter in cached data`
        );
      }

      const ficheData = await fichesApi.fetchFicheDetails(ficheId, cle);

      // Best-effort cache write: even if DB is temporarily unavailable,
      // return the fetched fiche details to the caller.
      try {
        await cacheFicheDetails(ficheData, { salesDate: cached.salesDate || undefined });
      } catch (err) {
        logger.error("Failed to persist refreshed fiche to cache; returning data anyway", {
          fiche_id: ficheId,
          error: err instanceof Error ? err.message : String(err),
        });
      }

      return ficheData;
    }

    logger.debug("Fiche retrieved from cache (full details)", {
      fiche_id: ficheId,
      cache_id: cached.id.toString(),
      recordings_count: cached.recordingsCount,
    });
    return cached.rawData as unknown as FicheDetailsResponse;
  }

  logger.info("Cache miss, fetching from API", { fiche_id: ficheId });

  // Cannot fetch without cle - fiches should come from sales list first
  throw new ValidationError(
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
    throw new ValidationError(`Cannot refresh fiche ${ficheId}: not in cache`);
  }

  const rawData = cached.rawData;
  const cle = getCleFromRawData(rawData);

  if (!cle) {
    throw new ValidationError(
      `Cannot refresh fiche ${ficheId}: missing cle parameter`
    );
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
        rawData: toPrismaJsonValue(ficheData),
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
    telephone_2?: string | null;
    statut?: string | null;
    date_insertion?: string | null;
    date_modification?: string | null;
    recordings?: RecordingLike[];
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

  // IMPORTANT: Sales-list caching must be additive.
  // If full fiche details already exist in the DB, do NOT overwrite them with sales-list-only rawData
  // (that would effectively "remove" previously cached details).
  const existing = await prisma.ficheCache.findUnique({
    where: { ficheId: ficheData.id },
    select: {
      id: true,
      rawData: true,
      groupe: true,
      agenceNom: true,
      prospectNom: true,
      prospectPrenom: true,
      prospectEmail: true,
      prospectTel: true,
      salesDate: true,
    },
  });

  const existingRaw = existing?.rawData as unknown;
  const existingIsSalesListOnly =
    isRecord(existingRaw) && existingRaw._salesListOnly === true;

  const summaryRawData = {
    id: ficheData.id,
    cle: ficheData.cle, // ← IMPORTANT: Store cle for later detail fetching
    nom: ficheData.nom,
    prenom: ficheData.prenom,
    telephone: ficheData.telephone,
    telephone_2: ficheData.telephone_2 ?? null,
    email: ficheData.email,
    statut: ficheData.statut ?? null,
    date_insertion: ficheData.date_insertion ?? null,
    date_modification: ficheData.date_modification ?? null,
    recordings: enrichedRecordings,
    _salesListOnly: true as const,
  };

  // Decide what rawData to persist:
  // - If we only ever had sales-list-only data, keep it sales-list-only (update it).
  // - If full details exist, preserve full details rawData and only patch `cle` (and optionally keep a small marker).
  const nextRawData: unknown =
    existing && !existingIsSalesListOnly && isRecord(existingRaw)
      ? (() => {
          // Preserve existing full details.
          const merged: Record<string, unknown> = { ...existingRaw };
          merged.cle = ficheData.cle;
          const info = merged.information;
          if (isRecord(info)) {
            info.cle = ficheData.cle;
          }
          return merged;
        })()
      : summaryRawData;

  const ficheCache = await fichesRepository.upsertFicheCache({
    ficheId: ficheData.id,
    // Never overwrite existing groupe/agence with empty strings.
    // If they exist, keep them; otherwise leave null.
    groupe: existing?.groupe ?? undefined,
    agenceNom: existing?.agenceNom ?? undefined,
    prospectNom: ficheData.nom || existing?.prospectNom || undefined,
    prospectPrenom: ficheData.prenom || existing?.prospectPrenom || undefined,
    prospectEmail: ficheData.email || existing?.prospectEmail || undefined,
    prospectTel: ficheData.telephone || existing?.prospectTel || undefined,
    // Track which CRM sales date this fiche belongs to (used by date-range queries)
    salesDate: options?.salesDate ?? existing?.salesDate ?? undefined,
    rawData: nextRawData,
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
