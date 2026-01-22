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

import type { Prisma } from "@prisma/client";

import { CACHE_EXPIRATION_HOURS } from "../../shared/constants.js";
import { logger } from "../../shared/logger.js";
import { prisma } from "../../shared/prisma.js";
import { enrichRecording, type RecordingLike } from "../../utils/recording-parser.js";
import * as fichesApi from "./fiches.api.js";
import * as fichesRepository from "./fiches.repository.js";
import type { FicheDetailsResponse } from "./fiches.schemas.js";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function toYyyyMmDdFromDateLike(value: string): string | undefined {
  const trimmed = value.trim();
  if (!trimmed) {return undefined;}

  // Accept:
  // - "YYYY-MM-DD"
  // - "YYYY-MM-DDTHH:MM:SSZ"
  // - "DD/MM/YYYY"
  // - "DD/MM/YYYY HH:MM"
  const firstToken = trimmed.split(/\s+/)[0] || "";
  const datePart = firstToken.includes("T") ? firstToken.split("T")[0] || "" : firstToken;

  if (/^\d{4}-\d{2}-\d{2}$/.test(datePart)) {return datePart;}

  const parts = datePart.split("/");
  if (parts.length === 3) {
    const [dayRaw, monthRaw, yearRaw] = parts;
    const day = (dayRaw || "").trim();
    const month = (monthRaw || "").trim();
    const year = (yearRaw || "").trim();
    if (!/^\d{1,2}$/.test(day) || !/^\d{1,2}$/.test(month) || !/^\d{4}$/.test(year)) {
      return undefined;
    }
    return `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
  }

  return undefined;
}

function toPrismaJsonValue(value: unknown): Prisma.InputJsonValue {
  const json: unknown = JSON.parse(JSON.stringify(value));
  return json as Prisma.InputJsonValue;
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

    // If cache is minimal (sales list only) OR expired, refresh from API.
    // Expiration is a "freshness" hint, not a hard requirement.
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

      try {
        const ficheData = await fichesApi.fetchFicheDetails(ficheId);

        // Best-effort cache write: even if DB is temporarily unavailable,
        // return the fetched fiche details to the caller.
        try {
          await cacheFicheDetails(ficheData, { salesDate: cached.salesDate || undefined });
        } catch (persistErr) {
          logger.error("Failed to persist refreshed fiche to cache; returning data anyway", {
            fiche_id: ficheId,
            error: persistErr instanceof Error ? persistErr.message : String(persistErr),
          });
        }

        return ficheData;
      } catch (err) {
        // If we already have full details in cache, prefer returning stale cached data over failing.
        if (rawData._salesListOnly !== true) {
          logger.warn("Failed to refresh fiche; returning cached data", {
            fiche_id: ficheId,
            error: err instanceof Error ? err.message : String(err),
          });
          return cached.rawData as unknown as FicheDetailsResponse;
        }

        logger.error("Failed to fetch fiche details (cache miss/incomplete cache)", {
          fiche_id: ficheId,
          error: err instanceof Error ? err.message : String(err),
        });
        throw err;
      }
    }

    logger.debug("Fiche retrieved from cache (full details)", {
      fiche_id: ficheId,
      cache_id: cached.id.toString(),
      recordings_count: cached.recordingsCount,
    });
    return cached.rawData as unknown as FicheDetailsResponse;
  }

  logger.info("Cache miss, fetching from API", { fiche_id: ficheId });

  const ficheData = await fichesApi.fetchFicheDetails(ficheId);

  // Best-effort cache write: even if DB is temporarily unavailable,
  // return the fetched fiche details to the caller.
  try {
    await cacheFicheDetails(ficheData);
  } catch (err) {
    logger.error("Failed to persist fetched fiche to cache; returning data anyway", {
      fiche_id: ficheId,
      error: err instanceof Error ? err.message : String(err),
    });
  }

  return ficheData;
}

/**
 * Force refresh fiche from API and update cache
 * Bypasses cache and always fetches fresh data
 */
export async function refreshFicheFromApi(ficheId: string) {
  logger.info("Force refreshing fiche from API", {
    fiche_id: ficheId,
  });

  const cached = await fichesRepository.getCachedFiche(ficheId);

  // Fetch from API (gateway handles `cle` refresh internally)
  const ficheData = await fichesApi.fetchFicheDetails(ficheId);

  // Update cache
  await cacheFicheDetails(ficheData, {
    salesDate: cached?.salesDate || undefined,
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
    cle?: string | null; // Security key (optional; gateway can refresh internally)
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
    cle: typeof ficheData.cle === "string" && ficheData.cle ? ficheData.cle : null,
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
          if (typeof ficheData.cle === "string" && ficheData.cle) {
            merged.cle = ficheData.cle;
            const info = merged.information;
            if (isRecord(info)) {
              info.cle = ficheData.cle;
            }
          }
          return merged;
        })()
      : summaryRawData;

  // Ensure we always try to set `salesDate` when we can.
  // This is critical because date-range queries use `FicheCache.salesDate` as the source of truth.
  let salesDate: string | undefined =
    options?.salesDate ?? existing?.salesDate ?? undefined;
  if (!salesDate) {
    if (typeof ficheData.date_insertion === "string") {
      salesDate = toYyyyMmDdFromDateLike(ficheData.date_insertion);
    }
    if (!salesDate && typeof ficheData.date_modification === "string") {
      salesDate = toYyyyMmDdFromDateLike(ficheData.date_modification);
    }
  }

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
    salesDate,
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
