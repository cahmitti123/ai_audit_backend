-- CreateTable
CREATE TABLE "groupes" (
    "groupe_id" BIGSERIAL NOT NULL,
    "id" VARCHAR(2) NOT NULL,
    "libelle" VARCHAR(17) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "groupes_pkey" PRIMARY KEY ("groupe_id")
);

-- CreateTable
CREATE TABLE "gammes" (
    "gamme_id" BIGSERIAL NOT NULL,
    "groupe_id" BIGINT NOT NULL,
    "documents" JSONB NOT NULL,
    "id" VARCHAR(3) NOT NULL,
    "libelle" VARCHAR(29) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "gammes_pkey" PRIMARY KEY ("gamme_id")
);

-- CreateTable
CREATE TABLE "formules" (
    "formule_id" BIGSERIAL NOT NULL,
    "gamme_id" BIGINT NOT NULL,
    "appareils_auditifs" VARCHAR(46),
    "chambre_particuliere" VARCHAR(47),
    "cure_thermale" VARCHAR(42),
    "delai_attente" VARCHAR(50),
    "dentaire" VARCHAR(50),
    "frais_dossier" VARCHAR(13),
    "garanties_html" VARCHAR(87) NOT NULL,
    "hospi_non_optam" VARCHAR(4),
    "hospitalisation" VARCHAR(46),
    "id" VARCHAR(4) NOT NULL,
    "libelle" VARCHAR(14) NOT NULL,
    "libelle_alternatif" VARCHAR(13),
    "maternite" VARCHAR(48),
    "medecine_douce" VARCHAR(40),
    "medecines" VARCHAR(50),
    "optique" VARCHAR(50),
    "optique_vc" VARCHAR(43),
    "soins_non_optam" VARCHAR(12),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "formules_pkey" PRIMARY KEY ("formule_id")
);

-- CreateTable
CREATE TABLE "garanties_parsed" (
    "garantie_parsed_id" BIGSERIAL NOT NULL,
    "gamme_id" BIGINT,
    "formule_id" BIGINT,
    "title" VARCHAR(255),
    "intro_text" TEXT[],
    "formule_indicator" VARCHAR(50),
    "notes_and_legal" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "garanties_parsed_pkey" PRIMARY KEY ("garantie_parsed_id")
);

-- CreateTable
CREATE TABLE "garantie_categories" (
    "category_id" BIGSERIAL NOT NULL,
    "garantie_parsed_id" BIGINT NOT NULL,
    "section_index" INTEGER NOT NULL,
    "category_name" TEXT NOT NULL,
    "display_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "garantie_categories_pkey" PRIMARY KEY ("category_id")
);

-- CreateTable
CREATE TABLE "garantie_items" (
    "item_id" BIGSERIAL NOT NULL,
    "category_id" BIGINT NOT NULL,
    "guarantee_name" TEXT NOT NULL,
    "guarantee_value" TEXT NOT NULL,
    "display_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "garantie_items_pkey" PRIMARY KEY ("item_id")
);

-- CreateTable
CREATE TABLE "documents" (
    "document_id" BIGSERIAL NOT NULL,
    "gamme_id" BIGINT,
    "formule_id" BIGINT,
    "document_type" VARCHAR(50) NOT NULL,
    "url" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "documents_pkey" PRIMARY KEY ("document_id")
);

-- CreateIndex
CREATE INDEX "groupes_libelle_idx" ON "groupes"("libelle");

-- CreateIndex
CREATE INDEX "idx_gammes_groupe" ON "gammes"("groupe_id");

-- CreateIndex
CREATE INDEX "idx_gammes_libelle" ON "gammes"("libelle");

-- CreateIndex
CREATE INDEX "idx_formules_gamme" ON "formules"("gamme_id");

-- CreateIndex
CREATE INDEX "idx_formules_libelle" ON "formules"("libelle");

-- CreateIndex
CREATE INDEX "idx_garanties_parsed_gamme" ON "garanties_parsed"("gamme_id");

-- CreateIndex
CREATE INDEX "idx_garanties_parsed_formule" ON "garanties_parsed"("formule_id");

-- CreateIndex
CREATE INDEX "idx_categories_parsed" ON "garantie_categories"("garantie_parsed_id");

-- CreateIndex
CREATE INDEX "idx_categories_name" ON "garantie_categories"("category_name");

-- CreateIndex
CREATE INDEX "idx_items_category" ON "garantie_items"("category_id");

-- CreateIndex
CREATE INDEX "idx_items_name" ON "garantie_items"("guarantee_name");

-- CreateIndex
CREATE INDEX "idx_documents_gamme" ON "documents"("gamme_id");

-- CreateIndex
CREATE INDEX "idx_documents_formule" ON "documents"("formule_id");

-- CreateIndex
CREATE INDEX "idx_documents_type" ON "documents"("document_type");

-- AddForeignKey
ALTER TABLE "gammes" ADD CONSTRAINT "gammes_groupe_id_fkey" FOREIGN KEY ("groupe_id") REFERENCES "groupes"("groupe_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "formules" ADD CONSTRAINT "formules_gamme_id_fkey" FOREIGN KEY ("gamme_id") REFERENCES "gammes"("gamme_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "garanties_parsed" ADD CONSTRAINT "garanties_parsed_gamme_id_fkey" FOREIGN KEY ("gamme_id") REFERENCES "gammes"("gamme_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "garanties_parsed" ADD CONSTRAINT "garanties_parsed_formule_id_fkey" FOREIGN KEY ("formule_id") REFERENCES "formules"("formule_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "garantie_categories" ADD CONSTRAINT "garantie_categories_garantie_parsed_id_fkey" FOREIGN KEY ("garantie_parsed_id") REFERENCES "garanties_parsed"("garantie_parsed_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "garantie_items" ADD CONSTRAINT "garantie_items_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "garantie_categories"("category_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "documents" ADD CONSTRAINT "documents_gamme_id_fkey" FOREIGN KEY ("gamme_id") REFERENCES "gammes"("gamme_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "documents" ADD CONSTRAINT "documents_formule_id_fkey" FOREIGN KEY ("formule_id") REFERENCES "formules"("formule_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ============================================
-- Useful Views
-- ============================================

-- View: Complete product hierarchy
CREATE VIEW v_product_hierarchy AS
SELECT 
    g.groupe_id,
    g.libelle AS groupe_name,
    gm.gamme_id,
    gm.libelle AS gamme_name,
    f.formule_id,
    f.libelle AS formule_name,
    f.libelle_alternatif,
    gp.garantie_parsed_id,
    gp.title AS garantie_title
FROM groupes g
LEFT JOIN gammes gm ON g.groupe_id = gm.groupe_id
LEFT JOIN formules f ON gm.gamme_id = f.gamme_id
LEFT JOIN garanties_parsed gp ON f.formule_id = gp.formule_id OR gm.gamme_id = gp.gamme_id;

-- View: Guarantee details with full context
CREATE VIEW v_guarantee_details AS
SELECT 
    g.libelle AS groupe_name,
    gm.libelle AS gamme_name,
    f.libelle AS formule_name,
    gc.category_name,
    gi.guarantee_name,
    gi.guarantee_value
FROM garantie_items gi
JOIN garantie_categories gc ON gi.category_id = gc.category_id
JOIN garanties_parsed gp ON gc.garantie_parsed_id = gp.garantie_parsed_id
LEFT JOIN formules f ON gp.formule_id = f.formule_id
LEFT JOIN gammes gm ON gp.gamme_id = gm.gamme_id OR f.gamme_id = gm.gamme_id
LEFT JOIN groupes g ON gm.groupe_id = g.groupe_id;
