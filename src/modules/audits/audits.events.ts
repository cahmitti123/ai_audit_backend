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
    total: number;
    succeeded: number;
    failed: number;
    audit_config_id?: number;
  };
};
