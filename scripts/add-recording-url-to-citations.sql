-- Add recording_url column to citations table
-- This allows direct access to recording URLs from citations

ALTER TABLE citations 
ADD COLUMN IF NOT EXISTS recording_url TEXT;

-- Add comment for documentation
COMMENT ON COLUMN citations.recording_url IS 'Direct URL to the recording audio file';

-- Show sample of updated structure
SELECT 
  id, 
  recording_index, 
  recording_date, 
  recording_time,
  recording_url,
  LEFT(texte, 50) as citation_preview
FROM citations 
LIMIT 5;




