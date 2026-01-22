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
};
