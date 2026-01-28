-- Normalize additional fiche_cache.raw_data sections into dedicated tables:
-- - reclamations, autres_contrats, raw_sections

CREATE TABLE "fiche_cache_reclamations" (
    "id" BIGSERIAL NOT NULL,
    "fiche_cache_id" BIGINT NOT NULL,
    "row_index" INTEGER NOT NULL,
    "reclamation_id" TEXT NOT NULL,
    "date_creation" TEXT NOT NULL,
    "assureur" TEXT,
    "type_reclamation" TEXT,
    "description" TEXT,
    "statut" TEXT,
    "date_traitement" TEXT,
    "utilisateur_creation" TEXT,
    "utilisateur_traitement" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "fiche_cache_reclamations_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "fiche_cache_reclamations_fiche_cache_id_row_index_key"
    ON "fiche_cache_reclamations"("fiche_cache_id", "row_index");
CREATE INDEX "fiche_cache_reclamations_fiche_cache_id_idx"
    ON "fiche_cache_reclamations"("fiche_cache_id");
CREATE INDEX "fiche_cache_reclamations_reclamation_id_idx"
    ON "fiche_cache_reclamations"("reclamation_id");

ALTER TABLE "fiche_cache_reclamations"
ADD CONSTRAINT "fiche_cache_reclamations_fiche_cache_id_fkey"
FOREIGN KEY ("fiche_cache_id") REFERENCES "fiche_cache"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "fiche_cache_autres_contrats" (
    "id" BIGSERIAL NOT NULL,
    "fiche_cache_id" BIGINT NOT NULL,
    "row_index" INTEGER NOT NULL,
    "contrat_id" TEXT NOT NULL,
    "type_contrat" TEXT NOT NULL,
    "assureur" TEXT,
    "numero_contrat" TEXT,
    "date_souscription" TEXT,
    "montant" TEXT,
    "commentaire" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "fiche_cache_autres_contrats_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "fiche_cache_autres_contrats_fiche_cache_id_row_index_key"
    ON "fiche_cache_autres_contrats"("fiche_cache_id", "row_index");
CREATE INDEX "fiche_cache_autres_contrats_fiche_cache_id_idx"
    ON "fiche_cache_autres_contrats"("fiche_cache_id");
CREATE INDEX "fiche_cache_autres_contrats_contrat_id_idx"
    ON "fiche_cache_autres_contrats"("contrat_id");

ALTER TABLE "fiche_cache_autres_contrats"
ADD CONSTRAINT "fiche_cache_autres_contrats_fiche_cache_id_fkey"
FOREIGN KEY ("fiche_cache_id") REFERENCES "fiche_cache"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "fiche_cache_raw_sections" (
    "id" BIGSERIAL NOT NULL,
    "fiche_cache_id" BIGINT NOT NULL,
    "section_key" TEXT NOT NULL,
    "section_value" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "fiche_cache_raw_sections_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "fiche_cache_raw_sections_fiche_cache_id_section_key_key"
    ON "fiche_cache_raw_sections"("fiche_cache_id", "section_key");
CREATE INDEX "fiche_cache_raw_sections_fiche_cache_id_idx"
    ON "fiche_cache_raw_sections"("fiche_cache_id");

ALTER TABLE "fiche_cache_raw_sections"
ADD CONSTRAINT "fiche_cache_raw_sections_fiche_cache_id_fkey"
FOREIGN KEY ("fiche_cache_id") REFERENCES "fiche_cache"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

