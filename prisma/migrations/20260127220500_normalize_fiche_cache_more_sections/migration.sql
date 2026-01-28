-- Normalize additional fiche_cache.raw_data sections into dedicated tables:
-- - mails, rendez_vous, alertes, enfants, conjoint
-- Goal: reduce JSON storage and improve queryability while keeping API compatibility via reconstruction.

CREATE TABLE "fiche_cache_mails" (
    "id" BIGSERIAL NOT NULL,
    "fiche_cache_id" BIGINT NOT NULL,
    "row_index" INTEGER NOT NULL,
    "date_envoi" TEXT NOT NULL,
    "type_mail" TEXT NOT NULL,
    "utilisateur" TEXT NOT NULL,
    "visualisation_url" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "fiche_cache_mails_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "fiche_cache_mails_fiche_cache_id_row_index_key"
    ON "fiche_cache_mails"("fiche_cache_id", "row_index");
CREATE INDEX "fiche_cache_mails_fiche_cache_id_idx"
    ON "fiche_cache_mails"("fiche_cache_id");

ALTER TABLE "fiche_cache_mails"
ADD CONSTRAINT "fiche_cache_mails_fiche_cache_id_fkey"
FOREIGN KEY ("fiche_cache_id") REFERENCES "fiche_cache"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "fiche_cache_rendez_vous" (
    "id" BIGSERIAL NOT NULL,
    "fiche_cache_id" BIGINT NOT NULL,
    "row_index" INTEGER NOT NULL,
    "rdv_id" TEXT NOT NULL,
    "etiquette" TEXT,
    "etiquette_color" TEXT,
    "utilisateur" TEXT NOT NULL,
    "date_debut" TEXT NOT NULL,
    "date_fin" TEXT,
    "commentaire" TEXT,
    "statut" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "fiche_cache_rendez_vous_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "fiche_cache_rendez_vous_fiche_cache_id_row_index_key"
    ON "fiche_cache_rendez_vous"("fiche_cache_id", "row_index");
CREATE INDEX "fiche_cache_rendez_vous_fiche_cache_id_idx"
    ON "fiche_cache_rendez_vous"("fiche_cache_id");
CREATE INDEX "fiche_cache_rendez_vous_rdv_id_idx"
    ON "fiche_cache_rendez_vous"("rdv_id");

ALTER TABLE "fiche_cache_rendez_vous"
ADD CONSTRAINT "fiche_cache_rendez_vous_fiche_cache_id_fkey"
FOREIGN KEY ("fiche_cache_id") REFERENCES "fiche_cache"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "fiche_cache_alertes" (
    "id" BIGSERIAL NOT NULL,
    "fiche_cache_id" BIGINT NOT NULL,
    "row_index" INTEGER NOT NULL,
    "alerte_id" TEXT NOT NULL,
    "etat" TEXT NOT NULL,
    "date" TEXT NOT NULL,
    "etiquette" TEXT,
    "libelle" TEXT NOT NULL,
    "deposee_le" TEXT NOT NULL,
    "deposee_par" TEXT NOT NULL,
    "commentaire" TEXT,
    "attribuee_a" TEXT,
    "traitee_le" TEXT,
    "traitee_par" TEXT,
    "commentaire_traitement" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "fiche_cache_alertes_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "fiche_cache_alertes_fiche_cache_id_row_index_key"
    ON "fiche_cache_alertes"("fiche_cache_id", "row_index");
CREATE INDEX "fiche_cache_alertes_fiche_cache_id_idx"
    ON "fiche_cache_alertes"("fiche_cache_id");
CREATE INDEX "fiche_cache_alertes_alerte_id_idx"
    ON "fiche_cache_alertes"("alerte_id");

ALTER TABLE "fiche_cache_alertes"
ADD CONSTRAINT "fiche_cache_alertes_fiche_cache_id_fkey"
FOREIGN KEY ("fiche_cache_id") REFERENCES "fiche_cache"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "fiche_cache_enfants" (
    "id" BIGSERIAL NOT NULL,
    "fiche_cache_id" BIGINT NOT NULL,
    "row_index" INTEGER NOT NULL,
    "enfant_id" TEXT NOT NULL,
    "civilite" INTEGER NOT NULL,
    "civilite_text" TEXT NOT NULL,
    "nom" TEXT NOT NULL,
    "prenom" TEXT NOT NULL,
    "date_naissance" TEXT NOT NULL,
    "regime" TEXT,
    "regime_text" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "fiche_cache_enfants_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "fiche_cache_enfants_fiche_cache_id_row_index_key"
    ON "fiche_cache_enfants"("fiche_cache_id", "row_index");
CREATE INDEX "fiche_cache_enfants_fiche_cache_id_idx"
    ON "fiche_cache_enfants"("fiche_cache_id");
CREATE INDEX "fiche_cache_enfants_enfant_id_idx"
    ON "fiche_cache_enfants"("enfant_id");

ALTER TABLE "fiche_cache_enfants"
ADD CONSTRAINT "fiche_cache_enfants_fiche_cache_id_fkey"
FOREIGN KEY ("fiche_cache_id") REFERENCES "fiche_cache"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "fiche_cache_conjoints" (
    "id" BIGSERIAL NOT NULL,
    "fiche_cache_id" BIGINT NOT NULL,
    "conjoint_id" TEXT NOT NULL,
    "civilite" INTEGER NOT NULL,
    "civilite_text" TEXT NOT NULL,
    "nom" TEXT NOT NULL,
    "prenom" TEXT NOT NULL,
    "date_naissance" TEXT NOT NULL,
    "regime" TEXT,
    "regime_text" TEXT,
    "telephone" TEXT,
    "mobile" TEXT,
    "mail" TEXT,
    "profession" TEXT,
    "csp" INTEGER,
    "csp_text" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "fiche_cache_conjoints_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "fiche_cache_conjoints_fiche_cache_id_key"
    ON "fiche_cache_conjoints"("fiche_cache_id");
CREATE INDEX "fiche_cache_conjoints_conjoint_id_idx"
    ON "fiche_cache_conjoints"("conjoint_id");

ALTER TABLE "fiche_cache_conjoints"
ADD CONSTRAINT "fiche_cache_conjoints_fiche_cache_id_fkey"
FOREIGN KEY ("fiche_cache_id") REFERENCES "fiche_cache"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

