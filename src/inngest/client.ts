/**
 * Inngest Client
 * ==============
 * Event-driven workflow client with typed event schemas
 *
 * Event schemas are imported from domain modules to maintain
 * domain-driven architecture. Each module defines its own events.
 */

import { EventSchemas,Inngest } from "inngest";

import type { AuditsEvents } from "../modules/audits/audits.events.js";
import type { AutomationEvents } from "../modules/automation/automation.events.js";
import type { FichesEvents } from "../modules/fiches/fiches.events.js";
import type { TranscriptionsEvents } from "../modules/transcriptions/transcriptions.events.js";
import { logger } from "../shared/logger.js";

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
  "fiches/revalidate-date": { data: FichesEvents["fiches/revalidate-date"] };
  "fiches/cache-sales-list": { data: FichesEvents["fiches/cache-sales-list"] };
  "fiches/progressive-fetch-continue": {
    data: FichesEvents["fiches/progressive-fetch-continue"];
  };
  "fiches/progressive-fetch-day": {
    data: FichesEvents["fiches/progressive-fetch-day"];
  };
  "fiches/progressive-fetch-day.processed": {
    data: FichesEvents["fiches/progressive-fetch-day.processed"];
  };

  // Transcriptions domain events
  "fiche/transcribe": { data: TranscriptionsEvents["fiche/transcribe"] };
  "fiche/transcribed": { data: TranscriptionsEvents["fiche/transcribed"] };
  "transcription/recording.transcribe": {
    data: TranscriptionsEvents["transcription/recording.transcribe"];
  };
  "transcription/recording.transcribed": {
    data: TranscriptionsEvents["transcription/recording.transcribed"];
  };

  // Audits domain events
  "audit/run": { data: AuditsEvents["audit/run"] };
  "audit/step.analyze": { data: AuditsEvents["audit/step.analyze"] };
  "audit/step.analyzed": { data: AuditsEvents["audit/step.analyzed"] };
  "audit/completed": { data: AuditsEvents["audit/completed"] };
  "audit/failed": { data: AuditsEvents["audit/failed"] };
  "audit/batch": { data: AuditsEvents["audit/batch"] };
  "audit/batch.completed": { data: AuditsEvents["audit/batch.completed"] };
  "audit/step-rerun": { data: AuditsEvents["audit/step-rerun"] };
  "audit/step-rerun-completed": {
    data: AuditsEvents["audit/step-rerun-completed"];
  };
  "audit/step-control-point-rerun": {
    data: AuditsEvents["audit/step-control-point-rerun"];
  };
  "audit/step-control-point-rerun-completed": {
    data: AuditsEvents["audit/step-control-point-rerun-completed"];
  };

  // Automation domain events
  "automation/run": { data: AutomationEvents["automation/run"] };
  "automation/completed": { data: AutomationEvents["automation/completed"] };
  "automation/failed": { data: AutomationEvents["automation/failed"] };
  "automation/process-day": { data: AutomationEvents["automation/process-day"] };
  "automation/process-fiche": { data: AutomationEvents["automation/process-fiche"] };
};

/**
 * Inngest Configuration Debugging
 * ================================
 */
const isDevelopment =
  process.env.INNGEST_DEV === "1" || process.env.NODE_ENV === "development";
const hasBaseUrl = Boolean(process.env.INNGEST_BASE_URL);
const hasEventKey = Boolean(process.env.INNGEST_EVENT_KEY);

// Log configuration on startup
logger.info("Inngest client configuration", {
  mode: isDevelopment ? "DEVELOPMENT" : hasBaseUrl ? "SELF-HOSTED" : "CLOUD",
  isDev: isDevelopment,
  baseUrl: process.env.INNGEST_BASE_URL || "not set (will use cloud)",
  hasEventKey,
  nodeEnv: process.env.NODE_ENV,
});

/**
 * Inngest Client Instance
 * =======================
 * Configured with event schemas for type safety
 *
 * Configuration modes:
 * 1. Development (INNGEST_DEV=1): Uses local dev server, no external dependencies
 * 2. Self-hosted (INNGEST_BASE_URL set): Connects to your Inngest instance
 * 3. Cloud (default): Connects to Inngest Cloud (requires event key)
 */
export const inngest = new Inngest({
  id: "ai-audit-system",
  schemas: new EventSchemas().fromRecord<Events>(),
  eventKey: process.env.INNGEST_EVENT_KEY,

  // Development mode - no external Inngest server needed
  isDev: isDevelopment,

  // Self-hosted Inngest server URL (for production)
  ...(hasBaseUrl && {
    baseUrl: process.env.INNGEST_BASE_URL,
  }),
});
