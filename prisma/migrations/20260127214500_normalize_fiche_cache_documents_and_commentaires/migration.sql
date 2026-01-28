-- Normalize fiche_cache.raw_data lists (documents, commentaires) into dedicated tables.
-- Goal: reduce JSON storage and improve queryability while keeping API compatibility.

CREATE TABLE "fiche_cache_documents" (
    "id" BIGSERIAL NOT NULL,
    "fiche_cache_id" BIGINT NOT NULL,
    "row_index" INTEGER NOT NULL,
    "document_id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "nom" TEXT NOT NULL,
    "taille" TEXT NOT NULL,
    "date_creation" TEXT NOT NULL,
    "selection_mail" BOOLEAN NOT NULL,
    "partage_prospect" BOOLEAN NOT NULL,
    "signer" BOOLEAN NOT NULL,
    "download_url" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "fiche_cache_documents_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "fiche_cache_documents_fiche_cache_id_row_index_key"
    ON "fiche_cache_documents"("fiche_cache_id", "row_index");

CREATE INDEX "fiche_cache_documents_fiche_cache_id_idx"
    ON "fiche_cache_documents"("fiche_cache_id");

CREATE INDEX "fiche_cache_documents_document_id_idx"
    ON "fiche_cache_documents"("document_id");

ALTER TABLE "fiche_cache_documents"
ADD CONSTRAINT "fiche_cache_documents_fiche_cache_id_fkey"
FOREIGN KEY ("fiche_cache_id") REFERENCES "fiche_cache"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "fiche_cache_commentaires" (
    "id" BIGSERIAL NOT NULL,
    "fiche_cache_id" BIGINT NOT NULL,
    "row_index" INTEGER NOT NULL,
    "commentaire_id" TEXT NOT NULL,
    "date" TEXT NOT NULL,
    "utilisateur" TEXT NOT NULL,
    "texte" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "fiche_cache_commentaires_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "fiche_cache_commentaires_fiche_cache_id_row_index_key"
    ON "fiche_cache_commentaires"("fiche_cache_id", "row_index");

CREATE INDEX "fiche_cache_commentaires_fiche_cache_id_idx"
    ON "fiche_cache_commentaires"("fiche_cache_id");

CREATE INDEX "fiche_cache_commentaires_commentaire_id_idx"
    ON "fiche_cache_commentaires"("commentaire_id");

ALTER TABLE "fiche_cache_commentaires"
ADD CONSTRAINT "fiche_cache_commentaires_fiche_cache_id_fkey"
FOREIGN KEY ("fiche_cache_id") REFERENCES "fiche_cache"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

