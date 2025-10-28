/**
 * Audits Types
 * ============
 * Type definitions for audit operations
 */

/**
 * Audit Function Result (returned by workflow)
 */
export interface AuditFunctionResult {
  success: boolean;
  fiche_id: string;
  audit_id: string;
  audit_config_id: number;
  score: number;
  niveau: string;
  duration_ms: number;
}

/**
 * Batch Audit Result
 */
export interface BatchAuditResult {
  success: boolean;
  total_fiches: number;
  audit_config_id: number;
  total: number;
  succeeded: number;
  failed: number;
}
