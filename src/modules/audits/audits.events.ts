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
    automation_schedule_id?: string; // BigInt serialized as string
    automation_run_id?: string; // BigInt serialized as string
    trigger_source?: string; // e.g. "automation" | "api"
    /**
     * Optional per-request toggle for RLM-style transcript tools mode.
     * - true: use transcript tools (out-of-prompt evidence lookup)
     * - false: legacy prompt stuffing
     * - undefined: use server default (env)
     */
    use_rlm?: boolean;
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
    use_rlm?: boolean;
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
    use_rlm?: boolean;
  };
  "audit/completed": {
    fiche_id: string;
    audit_id: string;
    audit_config_id: number;
    score: number;
    niveau: string;
    duration_ms: number;
    use_rlm?: boolean;
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
    use_rlm?: boolean;
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

  /**
   * Re-run a single control point (sub-step) inside an existing audit step.
   */
  "audit/step-control-point-rerun": {
    audit_id: string; // Audit DB id as string (BigInt serialized)
    step_position: number;
    control_point_index: number; // 1-based index in the step's controlPoints config
    custom_prompt?: string;
  };

  /**
   * Emitted when a control point re-run completes (for downstream consumers / observability).
   */
  "audit/step-control-point-rerun-completed": {
    audit_id: string;
    step_position: number;
    control_point_index: number;
    statut_changed: boolean;
    citations_changed: boolean;
  };
};
