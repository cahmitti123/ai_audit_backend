-- Add raw JSON storage for distributed step workers + enforce idempotency per (audit, step)

-- AlterTable
ALTER TABLE "audit_step_results" ADD COLUMN IF NOT EXISTS "raw_result" JSONB;

-- Deduplicate existing rows so we can enforce uniqueness.
-- Keep the newest row (highest id) per (audit_id, step_position).
DELETE FROM "audit_step_results" a
USING "audit_step_results" b
WHERE a."audit_id" = b."audit_id"
  AND a."step_position" = b."step_position"
  AND a."id" < b."id";

-- CreateIndex (idempotency for step workers)
CREATE UNIQUE INDEX IF NOT EXISTS "audit_step_results_audit_id_step_position_key"
ON "audit_step_results"("audit_id", "step_position");


