/**
 * Inngest Client
 * ==============
 * Event-driven workflow client with typed event schemas
 */

import { Inngest, EventSchemas } from "inngest";

/**
 * Event Type Definitions
 * ======================
 * All events in the system with their payload schemas
 */
type Events = {
  // Fiche fetch events
  "fiche/fetch": {
    data: {
      fiche_id: string;
      cle?: string;
      force_refresh?: boolean;
    };
  };
  "fiche/fetched": {
    data: {
      fiche_id: string;
      cache_id: string;
      recordings_count: number;
      cached: boolean;
    };
  };

  // Transcription events
  "fiche/transcribe": {
    data: {
      fiche_id: string;
      priority?: "high" | "normal" | "low";
    };
  };
  "fiche/transcribed": {
    data: {
      fiche_id: string;
      transcribed_count: number;
      cached_count: number;
      failed_count: number;
    };
  };

  // Audit events
  "audit/run": {
    data: {
      fiche_id: string;
      audit_config_id: number;
      user_id?: string;
    };
  };
  "audit/completed": {
    data: {
      fiche_id: string;
      audit_id: string;
      audit_config_id: number;
      score: number;
      niveau: string;
      duration_ms: number;
    };
  };
  "audit/failed": {
    data: {
      fiche_id: string;
      audit_config_id: number;
      error: string;
      retry_count: number;
    };
  };

  // Batch events
  "audit/batch": {
    data: {
      fiche_ids: string[];
      audit_config_id?: number;
      user_id?: string;
    };
  };
  "audit/batch.completed": {
    data: {
      total: number;
      succeeded: number;
      failed: number;
      audit_config_id?: number;
    };
  };
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
