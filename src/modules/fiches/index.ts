/**
 * Fiches Module
 * =============
 * Centralized exports for all fiche-related functionality
 */

// ═══════════════════════════════════════════════════════════════════════════
// PRESENTATION LAYER
// ═══════════════════════════════════════════════════════════════════════════

// Routes (HTTP endpoints)
export { fichesRouter } from "./fiches.routes.js";

// Workflows (Background jobs)
export { functions as fichesFunctions } from "./fiches.workflows.js";

// ═══════════════════════════════════════════════════════════════════════════
// ORCHESTRATION LAYER
// ═══════════════════════════════════════════════════════════════════════════

// Service (Business logic)
export * as fichesService from "./fiches.service.js";

// Cache (Caching operations)
export * as fichesCache from "./fiches.cache.js";

// Revalidation (Cache revalidation logic)
export * as fichesRevalidation from "./fiches.revalidation.js";

// ═══════════════════════════════════════════════════════════════════════════
// DATA LAYER
// ═══════════════════════════════════════════════════════════════════════════

// Repository (Database operations)
export * as fichesRepository from "./fiches.repository.js";

// API Client (External API calls)
export * as fichesApi from "./fiches.api.js";

// ═══════════════════════════════════════════════════════════════════════════
// FOUNDATION LAYER
// ═══════════════════════════════════════════════════════════════════════════

// Types & Schemas (All types inferred from Zod schemas)
export type * from "./fiches.schemas.js";
export {
  // Schemas
  salesFicheSchema,
  salesWithCallsResponseSchema,
  recordingSchema,
  ficheStatusSchema,
  transcriptionStatusSchema,
  auditStatusSchema,
  recordingStatusSchema,
  auditStatusRecordSchema,
  // Validators
  validateSalesWithCallsResponse,
  validateFicheDetailsResponse,
} from "./fiches.schemas.js";

// Events
export type { FichesEvents } from "./fiches.events.js";
