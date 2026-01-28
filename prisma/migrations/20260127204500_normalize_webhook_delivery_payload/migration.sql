-- Normalize webhook_deliveries.payload into structured columns/tables.
-- Goal: reduce JSON storage while preserving retry/signature fidelity.

ALTER TABLE "webhook_deliveries"
ADD COLUMN "payload_timestamp" TEXT,
ADD COLUMN "payload_status" TEXT,
ADD COLUMN "payload_progress" INTEGER,
ADD COLUMN "payload_completed_days" INTEGER,
ADD COLUMN "payload_total_days" INTEGER,
ADD COLUMN "payload_total_fiches" INTEGER,
ADD COLUMN "payload_current_fiches_count" INTEGER,
ADD COLUMN "payload_latest_date" TEXT,
ADD COLUMN "payload_error" TEXT,
ADD COLUMN "payload_data_url" TEXT;

CREATE TABLE "webhook_delivery_partial_fiches" (
    "id" BIGSERIAL NOT NULL,
    "delivery_id" TEXT NOT NULL,
    "row_index" INTEGER NOT NULL,
    "fiche_id" TEXT NOT NULL,
    "groupe" TEXT,
    "prospect_nom" TEXT,
    "prospect_prenom" TEXT,
    "recordings_count" INTEGER NOT NULL,
    "fiche_created_at" TEXT NOT NULL,

    CONSTRAINT "webhook_delivery_partial_fiches_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "webhook_delivery_partial_fiches_delivery_id_row_index_key"
    ON "webhook_delivery_partial_fiches"("delivery_id", "row_index");

CREATE INDEX "webhook_delivery_partial_fiches_delivery_id_idx"
    ON "webhook_delivery_partial_fiches"("delivery_id");

ALTER TABLE "webhook_delivery_partial_fiches"
ADD CONSTRAINT "webhook_delivery_partial_fiches_delivery_id_fkey"
FOREIGN KEY ("delivery_id") REFERENCES "webhook_deliveries"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

