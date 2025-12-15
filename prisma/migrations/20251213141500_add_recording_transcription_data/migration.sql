-- Add transcription_data to recordings for storing full transcription payload (words/timestamps)
ALTER TABLE "recordings"
ADD COLUMN "transcription_data" JSONB;






