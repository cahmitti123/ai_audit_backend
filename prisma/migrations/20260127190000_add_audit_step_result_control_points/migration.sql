-- CreateTable
CREATE TABLE "audit_step_result_control_points" (
    "id" BIGSERIAL NOT NULL,
    "audit_id" BIGINT NOT NULL,
    "step_position" INTEGER NOT NULL,
    "control_point_index" INTEGER NOT NULL,
    "point" TEXT NOT NULL,
    "statut" TEXT NOT NULL,
    "commentaire" TEXT NOT NULL,
    "minutages" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "erreur_transcription_notee" BOOLEAN NOT NULL,
    "variation_phonetique_utilisee" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "audit_step_result_control_points_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_step_result_citations" (
    "id" BIGSERIAL NOT NULL,
    "audit_id" BIGINT NOT NULL,
    "step_position" INTEGER NOT NULL,
    "control_point_index" INTEGER NOT NULL,
    "citation_index" INTEGER NOT NULL,
    "texte" TEXT NOT NULL,
    "minutage" TEXT NOT NULL,
    "minutage_secondes" DOUBLE PRECISION NOT NULL,
    "speaker" TEXT NOT NULL,
    "recording_index" INTEGER NOT NULL,
    "chunk_index" INTEGER NOT NULL,
    "recording_date" TEXT NOT NULL,
    "recording_time" TEXT NOT NULL,
    "recording_url" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_step_result_citations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "audit_step_result_control_points_audit_id_step_position_idx" ON "audit_step_result_control_points"("audit_id", "step_position");

-- CreateIndex
CREATE INDEX "audit_step_result_control_points_control_point_index_idx" ON "audit_step_result_control_points"("control_point_index");

-- CreateIndex
CREATE UNIQUE INDEX "audit_step_result_control_points_audit_id_step_position_con_key" ON "audit_step_result_control_points"("audit_id", "step_position", "control_point_index");

-- CreateIndex
CREATE INDEX "audit_step_result_citations_audit_id_step_position_idx" ON "audit_step_result_citations"("audit_id", "step_position");

-- CreateIndex
CREATE INDEX "audit_step_result_citations_audit_id_step_position_control__idx" ON "audit_step_result_citations"("audit_id", "step_position", "control_point_index");

-- CreateIndex
CREATE INDEX "audit_step_result_citations_recording_index_idx" ON "audit_step_result_citations"("recording_index");

-- CreateIndex
CREATE INDEX "audit_step_result_citations_chunk_index_idx" ON "audit_step_result_citations"("chunk_index");

-- CreateIndex
CREATE UNIQUE INDEX "audit_step_result_citations_audit_id_step_position_control__key" ON "audit_step_result_citations"("audit_id", "step_position", "control_point_index", "citation_index");

-- AddForeignKey
ALTER TABLE "audit_step_result_control_points" ADD CONSTRAINT "audit_step_result_control_points_audit_id_step_position_fkey" FOREIGN KEY ("audit_id", "step_position") REFERENCES "audit_step_results"("audit_id", "step_position") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_step_result_citations" ADD CONSTRAINT "audit_step_result_citations_audit_id_step_position_control_fkey" FOREIGN KEY ("audit_id", "step_position", "control_point_index") REFERENCES "audit_step_result_control_points"("audit_id", "step_position", "control_point_index") ON DELETE CASCADE ON UPDATE CASCADE;

