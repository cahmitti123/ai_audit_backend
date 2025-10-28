/**
 * Fiches Module
 * =============
 * Exports all fiche-related functionality
 */

export { fichesRouter } from "./fiches.routes.js";
export { FichesService } from "./fiches.service.js";
export * as fichesRepository from "./fiches.repository.js";
export { functions as fichesFunctions } from "./fiches.workflows.js";
export type { FichesEvents } from "./fiches.events.js";
