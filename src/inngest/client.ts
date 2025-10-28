/**
 * Inngest Client
 * ==============
 * Event-driven workflow client with typed event schemas
 *
 * Event schemas are imported from domain modules to maintain
 * domain-driven architecture. Each module defines its own events.
 */

import { Inngest, EventSchemas } from "inngest";
import type { FichesEvents } from "../modules/fiches/fiches.events.js";
import type { TranscriptionsEvents } from "../modules/transcriptions/transcriptions.events.js";
import type { AuditsEvents } from "../modules/audits/audits.events.js";

/**
 * Combined Event Type Definitions
 * ================================
 * Aggregates all domain events into single type
 */
type Events = {
  // Fiches domain events
  "fiche/fetch": { data: FichesEvents["fiche/fetch"] };
  "fiche/fetched": { data: FichesEvents["fiche/fetched"] };
  "fiche/cache.expired": { data: FichesEvents["fiche/cache.expired"] };

  // Transcriptions domain events
  "fiche/transcribe": { data: TranscriptionsEvents["fiche/transcribe"] };
  "fiche/transcribed": { data: TranscriptionsEvents["fiche/transcribed"] };

  // Audits domain events
  "audit/run": { data: AuditsEvents["audit/run"] };
  "audit/completed": { data: AuditsEvents["audit/completed"] };
  "audit/failed": { data: AuditsEvents["audit/failed"] };
  "audit/batch": { data: AuditsEvents["audit/batch"] };
  "audit/batch.completed": { data: AuditsEvents["audit/batch.completed"] };
};

/**
 * Inngest Client Instance
 * =======================
 * Configured with event schemas for type safety
 */
export const inngest = new Inngest({
  id: "ai-audit-system",
  schemas: new EventSchemas().fromRecord<Events>(),
  eventKey: process.env.INNGEST_EVENT_KEY, // For production
});
