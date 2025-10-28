/**
 * Fiches Events
 * ==============
 * Event type definitions for the fiches domain
 */

/**
 * Fiche Fetch Event
 * Triggers fetching fiche from external API
 */
export type FicheFetchEvent = {
  name: "fiche/fetch";
  data: {
    fiche_id: string;
    cle?: string;
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
 * All Fiches Events
 */
export type FichesEvents = {
  "fiche/fetch": FicheFetchEvent["data"];
  "fiche/fetched": FicheFetchedEvent["data"];
  "fiche/cache.expired": FicheCacheExpiredEvent["data"];
};
