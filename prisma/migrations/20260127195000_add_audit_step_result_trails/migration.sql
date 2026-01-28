-- Add structured audit trail tables for audit step results.
-- Goal: reduce JSON growth in audit_step_results.raw_result by moving
-- `human_review` + `rerun_history` entries into dedicated tables.

CREATE TABLE "audit_step_result_human_reviews" (
    "id" BIGSERIAL NOT NULL,
    "audit_id" BIGINT NOT NULL,
    "step_position" INTEGER NOT NULL,
    "reviewed_at" TIMESTAMP(3) NOT NULL,
    "reviewer" TEXT,
    "reason" TEXT,
    "kind" TEXT NOT NULL DEFAULT 'step',
    "control_point_index" INTEGER,
    "point" TEXT,
    "previous_traite" BOOLEAN,
    "previous_conforme" TEXT,
    "previous_score" INTEGER,
    "previous_niveau_conformite" TEXT,
    "override_traite" BOOLEAN,
    "override_conforme" TEXT,
    "override_score" INTEGER,
    "override_niveau_conformite" TEXT,
    "previous_statut" TEXT,
    "previous_commentaire" TEXT,
    "override_statut" TEXT,
    "override_commentaire" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_step_result_human_reviews_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "audit_step_result_rerun_events" (
    "id" BIGSERIAL NOT NULL,
    "audit_id" BIGINT NOT NULL,
    "step_position" INTEGER NOT NULL,
    "occurred_at" TIMESTAMP(3) NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'unknown',
    "rerun_id" TEXT,
    "event_id" TEXT,
    "custom_prompt" TEXT,
    "control_point_index" INTEGER,
    "point" TEXT,
    "previous_score" INTEGER,
    "previous_conforme" TEXT,
    "previous_total_citations" INTEGER,
    "next_score" INTEGER,
    "next_conforme" TEXT,
    "next_total_citations" INTEGER,
    "previous_statut" TEXT,
    "previous_commentaire" TEXT,
    "previous_citations" INTEGER,
    "previous_step_score" INTEGER,
    "previous_step_conforme" TEXT,
    "next_statut" TEXT,
    "next_commentaire" TEXT,
    "next_citations" INTEGER,
    "next_step_score" INTEGER,
    "next_step_conforme" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_step_result_rerun_events_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "audit_step_result_human_reviews_audit_id_step_position_idx"
    ON "audit_step_result_human_reviews"("audit_id", "step_position");
CREATE INDEX "audit_step_result_human_reviews_reviewed_at_idx"
    ON "audit_step_result_human_reviews"("reviewed_at");
CREATE INDEX "audit_step_result_human_reviews_kind_idx"
    ON "audit_step_result_human_reviews"("kind");
CREATE INDEX "audit_step_result_human_reviews_control_point_index_idx"
    ON "audit_step_result_human_reviews"("control_point_index");

CREATE INDEX "audit_step_result_rerun_events_audit_id_step_position_idx"
    ON "audit_step_result_rerun_events"("audit_id", "step_position");
CREATE INDEX "audit_step_result_rerun_events_occurred_at_idx"
    ON "audit_step_result_rerun_events"("occurred_at");
CREATE INDEX "audit_step_result_rerun_events_kind_idx"
    ON "audit_step_result_rerun_events"("kind");
CREATE INDEX "audit_step_result_rerun_events_rerun_id_idx"
    ON "audit_step_result_rerun_events"("rerun_id");
CREATE INDEX "audit_step_result_rerun_events_control_point_index_idx"
    ON "audit_step_result_rerun_events"("control_point_index");

ALTER TABLE "audit_step_result_human_reviews"
ADD CONSTRAINT "audit_step_result_human_reviews_audit_id_step_position_fkey"
FOREIGN KEY ("audit_id", "step_position")
REFERENCES "audit_step_results"("audit_id", "step_position")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "audit_step_result_rerun_events"
ADD CONSTRAINT "audit_step_result_rerun_events_audit_id_step_position_fkey"
FOREIGN KEY ("audit_id", "step_position")
REFERENCES "audit_step_results"("audit_id", "step_position")
ON DELETE CASCADE ON UPDATE CASCADE;

