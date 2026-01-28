-- Normalize fiche_cache.raw_data.tarification into dedicated tables

CREATE TABLE "fiche_cache_tarifications" (
    "id" BIGSERIAL NOT NULL,
    "fiche_cache_id" BIGINT NOT NULL,
    "row_index" INTEGER NOT NULL,
    "nom" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "fiche_cache_tarifications_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "fiche_cache_tarifications_fiche_cache_id_row_index_key"
    ON "fiche_cache_tarifications"("fiche_cache_id", "row_index");
CREATE INDEX "fiche_cache_tarifications_fiche_cache_id_idx"
    ON "fiche_cache_tarifications"("fiche_cache_id");
CREATE INDEX "fiche_cache_tarifications_nom_idx"
    ON "fiche_cache_tarifications"("nom");

ALTER TABLE "fiche_cache_tarifications"
ADD CONSTRAINT "fiche_cache_tarifications_fiche_cache_id_fkey"
FOREIGN KEY ("fiche_cache_id") REFERENCES "fiche_cache"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "fiche_cache_tarification_gammes" (
    "id" BIGSERIAL NOT NULL,
    "tarification_id" BIGINT NOT NULL,
    "row_index" INTEGER NOT NULL,
    "nom" TEXT NOT NULL,
    "logo_url" TEXT,
    "garanties_url" TEXT,
    "conditions_generales_url" TEXT,
    "bulletin_adhesion_url" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "fiche_cache_tarification_gammes_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "fiche_cache_tarification_gammes_tarification_id_row_index_key"
    ON "fiche_cache_tarification_gammes"("tarification_id", "row_index");
CREATE INDEX "fiche_cache_tarification_gammes_tarification_id_idx"
    ON "fiche_cache_tarification_gammes"("tarification_id");
CREATE INDEX "fiche_cache_tarification_gammes_nom_idx"
    ON "fiche_cache_tarification_gammes"("nom");

ALTER TABLE "fiche_cache_tarification_gammes"
ADD CONSTRAINT "fiche_cache_tarification_gammes_tarification_id_fkey"
FOREIGN KEY ("tarification_id") REFERENCES "fiche_cache_tarifications"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "fiche_cache_tarification_formules" (
    "id" BIGSERIAL NOT NULL,
    "gamme_id" BIGINT NOT NULL,
    "row_index" INTEGER NOT NULL,
    "formule_id" TEXT NOT NULL,
    "nom" TEXT NOT NULL,
    "prix" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "fiche_cache_tarification_formules_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "fiche_cache_tarification_formules_gamme_id_row_index_key"
    ON "fiche_cache_tarification_formules"("gamme_id", "row_index");
CREATE INDEX "fiche_cache_tarification_formules_gamme_id_idx"
    ON "fiche_cache_tarification_formules"("gamme_id");
CREATE INDEX "fiche_cache_tarification_formules_formule_id_idx"
    ON "fiche_cache_tarification_formules"("formule_id");

ALTER TABLE "fiche_cache_tarification_formules"
ADD CONSTRAINT "fiche_cache_tarification_formules_gamme_id_fkey"
FOREIGN KEY ("gamme_id") REFERENCES "fiche_cache_tarification_gammes"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "fiche_cache_tarification_formule_details" (
    "id" BIGSERIAL NOT NULL,
    "formule_row_id" BIGINT NOT NULL,
    "detail_key" TEXT NOT NULL,
    "detail_value" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "fiche_cache_tarification_formule_details_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "fiche_cache_tarification_formule_details_formule_row_id_detail_key_key"
    ON "fiche_cache_tarification_formule_details"("formule_row_id", "detail_key");
CREATE INDEX "fiche_cache_tarification_formule_details_formule_row_id_idx"
    ON "fiche_cache_tarification_formule_details"("formule_row_id");
CREATE INDEX "fiche_cache_tarification_formule_details_detail_key_idx"
    ON "fiche_cache_tarification_formule_details"("detail_key");

ALTER TABLE "fiche_cache_tarification_formule_details"
ADD CONSTRAINT "fiche_cache_tarification_formule_details_formule_row_id_fkey"
FOREIGN KEY ("formule_row_id") REFERENCES "fiche_cache_tarification_formules"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

