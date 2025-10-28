/**
 * Shared Constants
 * ================
 * Application-wide constants and configuration
 */

// Cache Configuration
export const CACHE_EXPIRATION_HOURS = 240;

// Audit Configuration
export const DEFAULT_AUDIT_CONFIG_ID = 10; // Quick Audit

// Timeline Generation
export const TIMELINE_CHUNK_SIZE = 10; // Messages per chunk

// Inngest Rate Limits
export const RATE_LIMITS = {
  FICHE_FETCH: {
    limit: 20,
    period: "1m" as const,
  },
  TRANSCRIPTION: {
    limit: 10,
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

// Inngest Concurrency
export const CONCURRENCY = {
  AUDIT_RUN: {
    limit: 10,
    key: "event.data.audit_config_id" as const,
  },
} as const;

// Batch Processing
export const BATCH_CONFIG = {
  TRANSCRIPTION: {
    maxSize: 5,
    timeout: "10s",
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
