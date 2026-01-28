-- Normalize fiche_cache.raw_data core objects (information, prospect, etiquettes)
-- into dedicated tables to reduce JSON storage and improve queryability.

CREATE TABLE "fiche_cache_information" (
    "id" BIGSERIAL NOT NULL,
    "fiche_cache_id" BIGINT NOT NULL,
    "cle" TEXT NOT NULL,
    "date_insertion" TEXT NOT NULL,
    "createur" TEXT,
    "fiches_associees" TEXT,
    "nombre_acces" INTEGER NOT NULL,
    "dernier_acces" TEXT NOT NULL,
    "groupe" TEXT NOT NULL,
    "groupe_responsable" TEXT,
    "groupe_gestion" TEXT,
    "groupe_reclamation" TEXT,
    "agence_id" TEXT NOT NULL,
    "agence_nom" TEXT NOT NULL,
    "attribution_user_id" TEXT NOT NULL,
    "attribution_user_nom" TEXT NOT NULL,
    "provenance_id" TEXT NOT NULL,
    "provenance_nom" TEXT NOT NULL,
    "provenance_numero" TEXT,
    "provenance_periode_rappel" TEXT,
    "origine_id" TEXT,
    "origine_nom" TEXT,
    "attribution_bis_user_id" TEXT,
    "attribution_bis_user_nom" TEXT,
    "refus_demarchage" BOOLEAN NOT NULL,
    "exception_demarchage" BOOLEAN NOT NULL,
    "exception_demarchage_commentaire" TEXT,
    "niveau_interet" INTEGER,
    "nombre_ouverture_mails" INTEGER NOT NULL,
    "derniere_ouverture_mail" TEXT,
    "nombre_visualisation_pages" INTEGER NOT NULL,
    "derniere_visualisation_page" TEXT,
    "espace_prospect_url" TEXT,
    "ferme_espace_prospect" BOOLEAN NOT NULL,
    "desinscription_mail" BOOLEAN NOT NULL,
    "corbeille" BOOLEAN NOT NULL,
    "archive" BOOLEAN NOT NULL,
    "modules" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "fiche_cache_information_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "fiche_cache_information_fiche_cache_id_key"
    ON "fiche_cache_information"("fiche_cache_id");

CREATE INDEX "fiche_cache_information_groupe_idx"
    ON "fiche_cache_information"("groupe");

ALTER TABLE "fiche_cache_information"
ADD CONSTRAINT "fiche_cache_information_fiche_cache_id_fkey"
FOREIGN KEY ("fiche_cache_id") REFERENCES "fiche_cache"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "fiche_cache_etiquettes" (
    "id" BIGSERIAL NOT NULL,
    "fiche_cache_id" BIGINT NOT NULL,
    "etiquette_index" INTEGER NOT NULL,
    "nom" TEXT NOT NULL,
    "date" TEXT NOT NULL,
    "style" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "fiche_cache_etiquettes_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "fiche_cache_etiquettes_fiche_cache_id_etiquette_index_key"
    ON "fiche_cache_etiquettes"("fiche_cache_id", "etiquette_index");

CREATE INDEX "fiche_cache_etiquettes_fiche_cache_id_idx"
    ON "fiche_cache_etiquettes"("fiche_cache_id");

ALTER TABLE "fiche_cache_etiquettes"
ADD CONSTRAINT "fiche_cache_etiquettes_fiche_cache_id_fkey"
FOREIGN KEY ("fiche_cache_id") REFERENCES "fiche_cache"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "fiche_cache_prospects" (
    "id" BIGSERIAL NOT NULL,
    "fiche_cache_id" BIGINT NOT NULL,
    "prospect_id" TEXT NOT NULL,
    "civilite" INTEGER NOT NULL,
    "civilite_text" TEXT NOT NULL,
    "nom" TEXT NOT NULL,
    "prenom" TEXT NOT NULL,
    "date_naissance" TEXT NOT NULL,
    "regime" TEXT NOT NULL,
    "regime_text" TEXT NOT NULL,
    "telephone" TEXT,
    "mobile" TEXT,
    "telephone_2" TEXT,
    "mail" TEXT,
    "mail_2" TEXT,
    "adresse" TEXT,
    "code_postal" TEXT,
    "ville" TEXT,
    "num_secu" TEXT,
    "num_affiliation" TEXT,
    "situation_familiale" INTEGER,
    "situation_familiale_text" TEXT,
    "madelin" BOOLEAN NOT NULL DEFAULT false,
    "profession" TEXT,
    "csp" INTEGER,
    "csp_text" TEXT,
    "fax" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "fiche_cache_prospects_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "fiche_cache_prospects_fiche_cache_id_key"
    ON "fiche_cache_prospects"("fiche_cache_id");

CREATE INDEX "fiche_cache_prospects_prospect_id_idx"
    ON "fiche_cache_prospects"("prospect_id");

ALTER TABLE "fiche_cache_prospects"
ADD CONSTRAINT "fiche_cache_prospects_fiche_cache_id_fkey"
FOREIGN KEY ("fiche_cache_id") REFERENCES "fiche_cache"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

