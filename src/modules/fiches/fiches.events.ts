/**
 * Fiches Events
 * ==============
 * RESPONSIBILITY: Event type definitions
 * - Inngest event schemas
 * - Event data types
 * - No implementation logic
 *
 * LAYER: Foundation (Types)
 */

/**
 * Fiche Fetch Event
 * Triggers fetching fiche from external API
 */
export type FicheFetchEvent = {
  name: "fiche/fetch";
  data: {
    fiche_id: string;
    force_refresh?: boolean;
    user_id?: string;
  };
};

/**
 * Fiche Fetched Event
 * Emitted when fiche has been successfully fetched and cached
 */
export type FicheFetchedEvent = {
  name: "fiche/fetched";
  data: {
    fiche_id: string;
    cache_id: string;
    recordings_count: number;
    cached: boolean;
    fetch_duration_ms?: number;
  };
};

/**
 * Fiche Cache Expired Event
 * Emitted when cache entry is about to expire (for proactive refresh)
 */
export type FicheCacheExpiredEvent = {
  name: "fiche/cache.expired";
  data: {
    fiche_id: string;
    cache_id: string;
    expired_at: string;
  };
};

/**
 * Fiches Revalidate Date Event
 * Triggers revalidation of all fiches for a specific date
 */
export type FichesRevalidateDateEvent = {
  name: "fiches/revalidate-date";
  data: {
    date: string; // YYYY-MM-DD format
  };
};

/**
 * Fiches Cache Sales List Event
 * Triggers caching of sales list with recordings for a date range
 */
export type FichesCacheSalesListEvent = {
  name: "fiches/cache-sales-list";
  data: {
    startDate: string; // YYYY-MM-DD format
    endDate: string; // YYYY-MM-DD format
    salesData?: unknown; // Pre-fetched sales data (optional)
  };
};

/**
 * Fiches Progressive Fetch Event
 * Triggers progressive fetching with immediate first result and background continuation
 */
export type FichesProgressiveFetchEvent = {
  name: "fiches/progressive-fetch-continue";
  data: {
    jobId: string;
    startDate: string; // YYYY-MM-DD format
    endDate: string; // YYYY-MM-DD format
    datesAlreadyFetched: string[]; // Dates already returned to user
    webhookUrl?: string; // Optional webhook for completion notification
    webhookSecret?: string; // Optional secret for webhook signature
  };
};

/**
 * All Fiches Events
 */
export type FichesEvents = {
  "fiche/fetch": FicheFetchEvent["data"];
  "fiche/fetched": FicheFetchedEvent["data"];
  "fiche/cache.expired": FicheCacheExpiredEvent["data"];
  "fiches/revalidate-date": FichesRevalidateDateEvent["data"];
  "fiches/cache-sales-list": FichesCacheSalesListEvent["data"];
  "fiches/progressive-fetch-continue": FichesProgressiveFetchEvent["data"];
};
