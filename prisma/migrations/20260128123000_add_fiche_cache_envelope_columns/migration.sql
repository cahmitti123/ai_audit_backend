-- Reduce JSON storage in fiche_cache.raw_data by moving stable scalar fields to columns.

ALTER TABLE "fiche_cache"
ADD COLUMN "cle" TEXT;

ALTER TABLE "fiche_cache"
ADD COLUMN "details_success" BOOLEAN;

ALTER TABLE "fiche_cache"
ADD COLUMN "details_message" TEXT;

