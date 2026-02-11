/**
 * Shared Constants
 * ================
 * Application-wide constants and configuration
 */

import { getInngestGlobalConcurrency } from "./inngest-concurrency.js";

function toPositiveInt(value: unknown, fallback: number): number {
  const n = typeof value === "string" ? Number.parseInt(value, 10) : Number(value);
  if (!Number.isFinite(n) || n <= 0) {return fallback;}
  return Math.floor(n);
}

// Cache Configuration
export const CACHE_EXPIRATION_HOURS = 240;

// Audit Configuration
export const DEFAULT_AUDIT_CONFIG_ID = 10; // Quick Audit

// Timeline Generation
export const TIMELINE_CHUNK_SIZE = 10; // Messages per chunk

// Inngest Rate Limits (increased for efficiency)
// Note: These are OUR function's rate limits
// Inngest also has INTERNAL rate limits on step.invoke() calls (~10-15/min)
// which requires delays between invocations in the automation workflow
export const RATE_LIMITS = {
  FICHE_FETCH: {
    limit: 100, // Increased from 20 - our function limit
    period: "1m" as const,
  },
  TRANSCRIPTION: {
    limit: 50, // Increased from 10 - our function limit
    period: "1m" as const,
  },
} as const;

// Inngest Timeouts
export const TIMEOUTS = {
  FICHE_FETCH: "5m",
  TRANSCRIPTION: "15m",
  AUDIT_RUN: "30m",
  BATCH_AUDIT: "1h",
} as const;

// Inngest Concurrency (maximum throughput)
export const CONCURRENCY = {
  AUDIT_RUN: {
    // Default: 10 per server * number of server replicas
    limit: toPositiveInt(process.env.AUDIT_RUN_CONCURRENCY, getInngestGlobalConcurrency()),
  },
  TRANSCRIPTION: {
    // Default: 10 per server * number of server replicas
    limit: toPositiveInt(
      process.env.TRANSCRIPTION_FICHE_CONCURRENCY,
      getInngestGlobalConcurrency()
    ),
  },
  FICHE_SALES_SEARCH: {
    // IMPORTANT: This hits the upstream CRM (via the gateway). Do NOT scale with replicas by default.
    // Default: 1 concurrent sales search globally across all replicas.
    limit: toPositiveInt(process.env.FICHE_SALES_SEARCH_CONCURRENCY, 1),
  },
  FICHE_FETCH: {
    // IMPORTANT: This hits the upstream CRM (via the gateway). Do NOT scale with replicas by default.
    // Default: 3 concurrent fiche detail fetches globally across all replicas.
    limit: toPositiveInt(
      process.env.FICHE_FETCH_CONCURRENCY,
      3
    ),
  },
} as const;

// Batch Processing (increased for efficiency)
export const BATCH_CONFIG = {
  TRANSCRIPTION: {
    maxSize: 10, // Increased from 5
    timeout: "15s", // Increased from 10s
  },
} as const;

// Compliance Scoring Thresholds
export const COMPLIANCE_THRESHOLDS = {
  EXCELLENT: 90,
  BON: 75,
  ACCEPTABLE: 60,
} as const;

// API Timeouts (in milliseconds)
export const API_TIMEOUTS = {
  SALES: 30000, // 30 seconds (increased from 10s)
  FICHE_DETAILS: 60000, // 60 seconds (increased from 30s)
} as const;
