-- Cross-workflow logs (audit / transcription / automation / fiche)
-- Used for correlating Inngest event/step execution across replicas.

CREATE TABLE IF NOT EXISTS "workflow_logs" (
  "id" BIGSERIAL NOT NULL,
  "workflow" TEXT NOT NULL,
  "level" TEXT NOT NULL,

  "entity_type" TEXT,
  "entity_id" TEXT,
  "trace_id" TEXT,

  "inngest_event_id" TEXT,
  "function_id" TEXT,
  "step_name" TEXT,

  "message" TEXT NOT NULL,
  "data" JSONB DEFAULT '{}'::jsonb,

  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "workflow_logs_pkey" PRIMARY KEY ("id")
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_indexes
    WHERE schemaname = current_schema()
      AND indexname = 'workflow_logs_workflow_idx'
  ) THEN
    CREATE INDEX "workflow_logs_workflow_idx" ON "workflow_logs"("workflow");
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_indexes
    WHERE schemaname = current_schema()
      AND indexname = 'workflow_logs_level_idx'
  ) THEN
    CREATE INDEX "workflow_logs_level_idx" ON "workflow_logs"("level");
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_indexes
    WHERE schemaname = current_schema()
      AND indexname = 'workflow_logs_entity_type_entity_id_idx'
  ) THEN
    CREATE INDEX "workflow_logs_entity_type_entity_id_idx" ON "workflow_logs"("entity_type", "entity_id");
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_indexes
    WHERE schemaname = current_schema()
      AND indexname = 'workflow_logs_trace_id_idx'
  ) THEN
    CREATE INDEX "workflow_logs_trace_id_idx" ON "workflow_logs"("trace_id");
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_indexes
    WHERE schemaname = current_schema()
      AND indexname = 'workflow_logs_inngest_event_id_idx'
  ) THEN
    CREATE INDEX "workflow_logs_inngest_event_id_idx" ON "workflow_logs"("inngest_event_id");
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_indexes
    WHERE schemaname = current_schema()
      AND indexname = 'workflow_logs_created_at_idx'
  ) THEN
    CREATE INDEX "workflow_logs_created_at_idx" ON "workflow_logs"("created_at");
  END IF;
END $$;

