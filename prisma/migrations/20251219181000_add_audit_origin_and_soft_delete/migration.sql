-- Add optional origin metadata + automation linkage for audits, plus soft-delete support.
-- This is additive (no destructive changes) and safe for existing data.

-- AlterTable
ALTER TABLE "audits" ADD COLUMN IF NOT EXISTS "automation_schedule_id" BIGINT;
ALTER TABLE "audits" ADD COLUMN IF NOT EXISTS "automation_run_id" BIGINT;
ALTER TABLE "audits" ADD COLUMN IF NOT EXISTS "trigger_source" TEXT;
ALTER TABLE "audits" ADD COLUMN IF NOT EXISTS "trigger_user_id" TEXT;
ALTER TABLE "audits" ADD COLUMN IF NOT EXISTS "notes" TEXT;
ALTER TABLE "audits" ADD COLUMN IF NOT EXISTS "deleted_at" TIMESTAMP(3);

-- Foreign keys (best-effort idempotent)
DO $$
BEGIN
  ALTER TABLE "audits"
    ADD CONSTRAINT "audits_automation_schedule_id_fkey"
    FOREIGN KEY ("automation_schedule_id")
    REFERENCES "automation_schedules"("id")
    ON DELETE SET NULL
    ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE "audits"
    ADD CONSTRAINT "audits_automation_run_id_fkey"
    FOREIGN KEY ("automation_run_id")
    REFERENCES "automation_runs"("id")
    ON DELETE SET NULL
    ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- Indexes
CREATE INDEX IF NOT EXISTS "audits_automation_schedule_id_idx" ON "audits"("automation_schedule_id");
CREATE INDEX IF NOT EXISTS "audits_automation_run_id_idx" ON "audits"("automation_run_id");
CREATE INDEX IF NOT EXISTS "audits_deleted_at_idx" ON "audits"("deleted_at");
CREATE INDEX IF NOT EXISTS "audits_trigger_source_idx" ON "audits"("trigger_source");


