-- Normalize automation_schedules.fiche_selection (JSON) into dedicated columns
-- to reduce JSON storage and improve queryability.

-- 1) Add new normalized columns
ALTER TABLE "automation_schedules"
ADD COLUMN     "fiche_selection_mode" TEXT NOT NULL DEFAULT 'date_range',
ADD COLUMN     "fiche_selection_date_range" TEXT,
ADD COLUMN     "fiche_selection_custom_start_date" TEXT,
ADD COLUMN     "fiche_selection_custom_end_date" TEXT,
ADD COLUMN     "fiche_selection_groupes" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "fiche_selection_only_with_recordings" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "fiche_selection_only_unaudited" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "fiche_selection_use_rlm" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "fiche_selection_max_fiches" INTEGER,
ADD COLUMN     "fiche_selection_max_recordings_per_fiche" INTEGER,
ADD COLUMN     "fiche_selection_fiche_ids" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

-- 2) Backfill from legacy JSON column (if present)
UPDATE "automation_schedules"
SET
  "fiche_selection_mode" = COALESCE("fiche_selection"->>'mode', 'date_range'),
  "fiche_selection_date_range" = NULLIF("fiche_selection"->>'dateRange', ''),
  "fiche_selection_custom_start_date" = NULLIF("fiche_selection"->>'customStartDate', ''),
  "fiche_selection_custom_end_date" = NULLIF("fiche_selection"->>'customEndDate', ''),
  "fiche_selection_groupes" = CASE
    WHEN jsonb_typeof("fiche_selection"->'groupes') = 'array' THEN
      COALESCE(
        (SELECT ARRAY_AGG(value) FROM jsonb_array_elements_text("fiche_selection"->'groupes') AS value),
        ARRAY[]::TEXT[]
      )
    ELSE ARRAY[]::TEXT[]
  END,
  "fiche_selection_only_with_recordings" = COALESCE(("fiche_selection"->>'onlyWithRecordings')::boolean, false),
  "fiche_selection_only_unaudited" = COALESCE(("fiche_selection"->>'onlyUnaudited')::boolean, false),
  "fiche_selection_use_rlm" = COALESCE(("fiche_selection"->>'useRlm')::boolean, false),
  "fiche_selection_max_fiches" = CASE
    WHEN ("fiche_selection" ? 'maxFiches') THEN ("fiche_selection"->>'maxFiches')::integer
    ELSE NULL
  END,
  "fiche_selection_max_recordings_per_fiche" = CASE
    WHEN ("fiche_selection" ? 'maxRecordingsPerFiche') THEN ("fiche_selection"->>'maxRecordingsPerFiche')::integer
    ELSE NULL
  END,
  "fiche_selection_fiche_ids" = CASE
    WHEN jsonb_typeof("fiche_selection"->'ficheIds') = 'array' THEN
      COALESCE(
        (SELECT ARRAY_AGG(value) FROM jsonb_array_elements_text("fiche_selection"->'ficheIds') AS value),
        ARRAY[]::TEXT[]
      )
    ELSE ARRAY[]::TEXT[]
  END;

-- 3) Drop legacy JSON column
ALTER TABLE "automation_schedules" DROP COLUMN "fiche_selection";

