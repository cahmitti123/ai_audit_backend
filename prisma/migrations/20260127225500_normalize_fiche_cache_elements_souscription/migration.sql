-- Normalize fiche_cache.raw_data.elements_souscription into a structured 1:1 table

CREATE TABLE "fiche_cache_elements_souscription" (
    "id" BIGSERIAL NOT NULL,
    "fiche_cache_id" BIGINT NOT NULL,

    "souscription_id" TEXT,
    "date_souscription" TEXT,
    "date_signature" TEXT,
    "date_validation" TEXT,
    "num_contrat" TEXT,
    "annulation_contrat" BOOLEAN NOT NULL DEFAULT FALSE,
    "type_vente" TEXT,
    "vente_a_froid" TEXT,
    "vf_accept" TEXT,

    "ancien_deja_assure" BOOLEAN,
    "ancien_plus_12_mois" BOOLEAN,
    "ancien_ria_requested" BOOLEAN,
    "ancien_assureur" TEXT,
    "ancien_code_assureur" TEXT,
    "ancien_adresse" TEXT,
    "ancien_code_postal" TEXT,
    "ancien_ville" TEXT,
    "ancien_date_souscription" TEXT,
    "ancien_date_echeance" TEXT,
    "ancien_num_contrat" TEXT,
    "ancien_formule" TEXT,
    "ancien_cotisation" TEXT,

    "produit_date_effet" TEXT,
    "produit_date_effet_modifiable" TEXT,
    "produit_formule" TEXT,
    "produit_groupe_nom" TEXT,
    "produit_gamme_nom" TEXT,
    "produit_formule_nom" TEXT,
    "produit_cotisation" TEXT,
    "produit_type_contrat" TEXT,
    "produit_type_client" TEXT,
    "produit_logo_url" TEXT,
    "produit_garanties_url" TEXT,
    "produit_dipa_url" TEXT,
    "produit_conditions_generales_url" TEXT,
    "produit_bulletin_adhesion_url" TEXT,
    "produit_devoir_conseil_url" TEXT,

    "paiement_mode_paiement" TEXT,
    "paiement_prelevement_le" TEXT,
    "paiement_periodicite" TEXT,
    "paiement_pas_coord_bancaires" BOOLEAN,

    "prelevement_account_id" TEXT,
    "prelevement_titulaire_nom" TEXT,
    "prelevement_titulaire_prenom" TEXT,
    "prelevement_titulaire_adresse" TEXT,
    "prelevement_titulaire_cp" TEXT,
    "prelevement_titulaire_ville" TEXT,

    "virement_account_id" TEXT,
    "virement_titulaire_nom" TEXT,
    "virement_titulaire_prenom" TEXT,
    "virement_titulaire_adresse" TEXT,
    "virement_titulaire_cp" TEXT,
    "virement_titulaire_ville" TEXT,

    "questions_complementaires" JSONB,
    "questions_conseil" JSONB,
    "raw_data" JSONB,

    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "fiche_cache_elements_souscription_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "fiche_cache_elements_souscription_fiche_cache_id_key"
    ON "fiche_cache_elements_souscription"("fiche_cache_id");
CREATE INDEX "fiche_cache_elements_souscription_fiche_cache_id_idx"
    ON "fiche_cache_elements_souscription"("fiche_cache_id");

ALTER TABLE "fiche_cache_elements_souscription"
ADD CONSTRAINT "fiche_cache_elements_souscription_fiche_cache_id_fkey"
FOREIGN KEY ("fiche_cache_id") REFERENCES "fiche_cache"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

