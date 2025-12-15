-- Remove duplicate audit_step_results rows so we can add a unique constraint
-- Keep newest row (highest id) per (audit_id, step_position)

DELETE FROM "audit_step_results" a
USING "audit_step_results" b
WHERE a."audit_id" = b."audit_id"
  AND a."step_position" = b."step_position"
  AND a."id" < b."id";

CREATE UNIQUE INDEX IF NOT EXISTS "audit_step_results_audit_id_step_position_key"
ON "audit_step_results"("audit_id", "step_position");






