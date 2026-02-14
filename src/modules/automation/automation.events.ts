/**
 * Automation Events
 * =================
 * Type definitions for automation domain events
 */

import type { FicheSelection } from "../../schemas.js";

/**
 * Automation Event Schemas
 */
export type AutomationEvents = {
  /**
   * Run automation schedule
   */
  "automation/run": {
    schedule_id: number | string;
    override_fiche_selection?: FicheSelection;
    // Optional: when dispatched by the scheduler, this is the computed due time (ISO string).
    // Used to correlate and to mark schedules as "running" at the correct scheduled time.
    due_at?: string;
  };

  /**
   * Automation completed
   */
  "automation/completed": {
    schedule_id: number | string;
    run_id: string;
    status: "completed" | "partial" | "failed";
    total_fiches: number;
    successful_fiches: number;
    failed_fiches: number;
    duration_ms: number;
  };

  /**
   * Automation failed
   */
  "automation/failed": {
    schedule_id: number | string;
    run_id: string;
    error: string;
  };

  /**
   * Process a single day (child workflow invoked by orchestrator)
   */
  "automation/process-day": {
    date: string; // DD/MM/YYYY
    schedule_id: string;
    run_id: string;
    audit_config_id: number;
    run_transcription: boolean;
    run_audits: boolean;
    max_recordings: number;
    max_fiches?: number;
    only_with_recordings: boolean;
    use_rlm: boolean;
    api_key?: string;
    only_unaudited?: boolean;
    groupes?: string[];
  };

  /**
   * Process a single fiche (child workflow invoked by day worker)
   */
  "automation/process-fiche": {
    fiche_id: string;
    audit_config_id: number;
    schedule_id: string;
    run_id: string;
    run_transcription: boolean;
    run_audits: boolean;
    max_recordings?: number;
    only_with_recordings?: boolean;
    use_rlm?: boolean;
  };
};
