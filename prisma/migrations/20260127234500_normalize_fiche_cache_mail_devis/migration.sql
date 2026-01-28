-- Normalize fiche_cache.raw_data.mail_devis into dedicated tables (fully structured)

CREATE TABLE "fiche_cache_mail_devis" (
    "id" BIGSERIAL NOT NULL,
    "fiche_cache_id" BIGINT NOT NULL,

    "date_envoi" TEXT NOT NULL,
    "type_mail" TEXT NOT NULL,
    "utilisateur" TEXT NOT NULL,
    "visualisation_url" TEXT,

    "customer_email" TEXT,
    "customer_phone" TEXT,
    "customer_name" TEXT,

    "garanties_link_url" TEXT NOT NULL,
    "garanties_link_text" TEXT,

    "details_gamme" TEXT NOT NULL,
    "details_product_name" TEXT NOT NULL,
    "details_formule" TEXT NOT NULL,
    "details_price" TEXT,
    "details_age_range" TEXT,
    "details_subscription_link" TEXT,

    "agence_nom" TEXT,
    "agence_adresse" TEXT,
    "agence_telephone" TEXT,
    "agence_email" TEXT,
    "agence_logo_url" TEXT,

    "fiche_info_fiche_id" TEXT NOT NULL,
    "fiche_info_cle" TEXT,
    "fiche_info_conseiller" TEXT,

    "subscriber_civilite" TEXT,
    "subscriber_nom" TEXT,
    "subscriber_prenom" TEXT,

    "doc_conditions_generales" TEXT,
    "doc_tableau_garanties" TEXT,
    "doc_document_information" TEXT,
    "doc_exemples_remboursements" TEXT,

    "menu_home" TEXT,
    "menu_garanties" TEXT,
    "menu_documents" TEXT,
    "menu_subscription" TEXT,

    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "fiche_cache_mail_devis_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "fiche_cache_mail_devis_fiche_cache_id_key"
    ON "fiche_cache_mail_devis"("fiche_cache_id");

ALTER TABLE "fiche_cache_mail_devis"
ADD CONSTRAINT "fiche_cache_mail_devis_fiche_cache_id_fkey"
FOREIGN KEY ("fiche_cache_id") REFERENCES "fiche_cache"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "fiche_cache_mail_devis_garantie_categories" (
    "id" BIGSERIAL NOT NULL,
    "mail_devis_id" BIGINT NOT NULL,
    "category_key" TEXT NOT NULL,
    "category_name" TEXT NOT NULL,
    "subcategories_format" TEXT NOT NULL DEFAULT 'named',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "fiche_cache_mail_devis_garantie_categories_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "fiche_cache_mail_devis_garantie_categories_mail_devis_id_category_key_key"
    ON "fiche_cache_mail_devis_garantie_categories"("mail_devis_id", "category_key");

ALTER TABLE "fiche_cache_mail_devis_garantie_categories"
ADD CONSTRAINT "fiche_cache_mail_devis_garantie_categories_mail_devis_id_fkey"
FOREIGN KEY ("mail_devis_id") REFERENCES "fiche_cache_mail_devis"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "fiche_cache_mail_devis_garantie_category_note_refs" (
    "id" BIGSERIAL NOT NULL,
    "category_id" BIGINT NOT NULL,
    "row_index" INTEGER NOT NULL,
    "note_reference" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "fiche_cache_mail_devis_garantie_category_note_refs_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "fiche_cache_mail_devis_garantie_category_note_refs_category_id_row_index_key"
    ON "fiche_cache_mail_devis_garantie_category_note_refs"("category_id", "row_index");

ALTER TABLE "fiche_cache_mail_devis_garantie_category_note_refs"
ADD CONSTRAINT "fiche_cache_mail_devis_garantie_category_note_refs_category_id_fkey"
FOREIGN KEY ("category_id") REFERENCES "fiche_cache_mail_devis_garantie_categories"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "fiche_cache_mail_devis_garantie_category_items" (
    "id" BIGSERIAL NOT NULL,
    "category_id" BIGINT NOT NULL,
    "row_index" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "note_ref" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "fiche_cache_mail_devis_garantie_category_items_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "fiche_cache_mail_devis_garantie_category_items_category_id_row_index_key"
    ON "fiche_cache_mail_devis_garantie_category_items"("category_id", "row_index");

ALTER TABLE "fiche_cache_mail_devis_garantie_category_items"
ADD CONSTRAINT "fiche_cache_mail_devis_garantie_category_items_category_id_fkey"
FOREIGN KEY ("category_id") REFERENCES "fiche_cache_mail_devis_garantie_categories"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "fiche_cache_mail_devis_garantie_subcategories" (
    "id" BIGSERIAL NOT NULL,
    "category_id" BIGINT NOT NULL,
    "sub_key" TEXT NOT NULL,
    "name" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "fiche_cache_mail_devis_garantie_subcategories_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "fiche_cache_mail_devis_garantie_subcategories_category_id_sub_key_key"
    ON "fiche_cache_mail_devis_garantie_subcategories"("category_id", "sub_key");

ALTER TABLE "fiche_cache_mail_devis_garantie_subcategories"
ADD CONSTRAINT "fiche_cache_mail_devis_garantie_subcategories_category_id_fkey"
FOREIGN KEY ("category_id") REFERENCES "fiche_cache_mail_devis_garantie_categories"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "fiche_cache_mail_devis_garantie_subcategory_items" (
    "id" BIGSERIAL NOT NULL,
    "subcategory_id" BIGINT NOT NULL,
    "row_index" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "note_ref" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "fiche_cache_mail_devis_garantie_subcategory_items_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "fiche_cache_mail_devis_garantie_subcategory_items_subcategory_id_row_index_key"
    ON "fiche_cache_mail_devis_garantie_subcategory_items"("subcategory_id", "row_index");

ALTER TABLE "fiche_cache_mail_devis_garantie_subcategory_items"
ADD CONSTRAINT "fiche_cache_mail_devis_garantie_subcategory_items_subcategory_id_fkey"
FOREIGN KEY ("subcategory_id") REFERENCES "fiche_cache_mail_devis_garantie_subcategories"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "fiche_cache_mail_devis_notes" (
    "id" BIGSERIAL NOT NULL,
    "mail_devis_id" BIGINT NOT NULL,
    "row_index" INTEGER NOT NULL,
    "number" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "fiche_cache_mail_devis_notes_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "fiche_cache_mail_devis_notes_mail_devis_id_row_index_key"
    ON "fiche_cache_mail_devis_notes"("mail_devis_id", "row_index");

ALTER TABLE "fiche_cache_mail_devis_notes"
ADD CONSTRAINT "fiche_cache_mail_devis_notes_mail_devis_id_fkey"
FOREIGN KEY ("mail_devis_id") REFERENCES "fiche_cache_mail_devis"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

