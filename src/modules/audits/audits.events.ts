/**
 * Audits Events
 * ==============
 * Event type definitions for the audits domain
 */

/**
 * Audit Events
 */
export type AuditsEvents = {
  "audit/run": {
    fiche_id: string;
    audit_config_id: number;
    user_id?: string;
  };
  /**
   * Analyze a single audit step (fan-out worker).
   * This lets steps execute across multiple backend replicas.
   */
  "audit/step.analyze": {
    audit_db_id: string; // Audit DB id as string (BigInt serialized)
    audit_id: string; // Tracking audit id (used for webhooks/realtime)
    fiche_id: string;
    audit_config_id: number;
    step_position: number;
  };
  /**
   * Emitted after a single step is analyzed (success or failure).
   * Used to drive progress updates and audit finalization.
   */
  "audit/step.analyzed": {
    audit_db_id: string;
    audit_id: string;
    fiche_id: string;
    audit_config_id: number;
    step_position: number;
    ok: boolean;
    error?: string;
  };
  "audit/completed": {
    fiche_id: string;
    audit_id: string;
    audit_config_id: number;
    score: number;
    niveau: string;
    duration_ms: number;
  };
  "audit/failed": {
    fiche_id: string;
    audit_config_id: number;
    error: string;
    retry_count: number;
  };
  "audit/batch": {
    fiche_ids: string[];
    audit_config_id?: number;
    user_id?: string;
  };
  "audit/batch.completed": {
    batch_id?: string;
    total: number;
    succeeded: number;
    failed: number;
    audit_config_id?: number;
  };
  /**
   * Re-run a single audit step for an existing audit.
   * Triggered via HTTP route and processed asynchronously via Inngest.
   */
  "audit/step-rerun": {
    audit_id: string; // Audit DB id as string (BigInt serialized)
    step_position: number;
    custom_prompt?: string;
  };
  /**
   * Emitted when a step re-run completes (for downstream consumers / observability).
   */
  "audit/step-rerun-completed": {
    audit_id: string;
    step_position: number;
    original_score: number;
    new_score: number;
    score_changed: boolean;
    conforme_changed: boolean;
  };
};
