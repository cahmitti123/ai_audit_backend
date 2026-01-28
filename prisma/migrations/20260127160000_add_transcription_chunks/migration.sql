-- AlterTable
ALTER TABLE "recordings" ADD COLUMN     "transcription_language_code" TEXT,
ADD COLUMN     "transcription_language_probability" DOUBLE PRECISION;

-- CreateTable
CREATE TABLE "recording_transcription_chunks" (
    "id" BIGSERIAL NOT NULL,
    "recording_id" BIGINT NOT NULL,
    "chunk_index" INTEGER NOT NULL,
    "start_timestamp" DOUBLE PRECISION NOT NULL,
    "end_timestamp" DOUBLE PRECISION NOT NULL,
    "message_count" INTEGER NOT NULL,
    "speakers" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "full_text" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "recording_transcription_chunks_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "recording_transcription_chunks_recording_id_idx" ON "recording_transcription_chunks"("recording_id");

-- CreateIndex
CREATE INDEX "recording_transcription_chunks_chunk_index_idx" ON "recording_transcription_chunks"("chunk_index");

-- CreateIndex
CREATE UNIQUE INDEX "recording_transcription_chunks_recording_id_chunk_index_key" ON "recording_transcription_chunks"("recording_id", "chunk_index");

-- AddForeignKey
ALTER TABLE "recording_transcription_chunks" ADD CONSTRAINT "recording_transcription_chunks_recording_id_fkey" FOREIGN KEY ("recording_id") REFERENCES "recordings"("id") ON DELETE CASCADE ON UPDATE CASCADE;
