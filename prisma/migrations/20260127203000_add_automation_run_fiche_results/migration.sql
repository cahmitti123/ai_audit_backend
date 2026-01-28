-- Normalize automation_runs.result_summary per-fiche arrays into a dedicated table.
-- Goal: reduce JSON storage and improve queryability.

CREATE TABLE "automation_run_fiche_results" (
    "id" BIGSERIAL NOT NULL,
    "run_id" BIGINT NOT NULL,
    "fiche_id" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "error" TEXT,
    "ignore_reason" TEXT,
    "recordings_count" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "automation_run_fiche_results_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "automation_run_fiche_results_run_id_fiche_id_key"
    ON "automation_run_fiche_results"("run_id", "fiche_id");

CREATE INDEX "automation_run_fiche_results_run_id_idx"
    ON "automation_run_fiche_results"("run_id");

CREATE INDEX "automation_run_fiche_results_status_idx"
    ON "automation_run_fiche_results"("status");

ALTER TABLE "automation_run_fiche_results"
ADD CONSTRAINT "automation_run_fiche_results_run_id_fkey"
FOREIGN KEY ("run_id") REFERENCES "automation_runs"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

