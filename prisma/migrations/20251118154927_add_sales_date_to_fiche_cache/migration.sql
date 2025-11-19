-- CreateEnum
CREATE TYPE "AuditSeverity" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL');

-- CreateEnum
CREATE TYPE "ScheduleType" AS ENUM ('MANUAL', 'DAILY', 'WEEKLY', 'MONTHLY', 'CRON');

-- CreateTable
CREATE TABLE "audit_configs" (
    "id" BIGSERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "system_prompt" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "run_automatically" BOOLEAN NOT NULL DEFAULT false,
    "created_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "audit_configs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_steps" (
    "id" BIGSERIAL NOT NULL,
    "audit_config_id" BIGINT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "prompt" TEXT NOT NULL,
    "control_points" TEXT[],
    "keywords" TEXT[],
    "severity_level" "AuditSeverity" NOT NULL,
    "is_critical" BOOLEAN NOT NULL DEFAULT false,
    "position" INTEGER NOT NULL,
    "chronological_important" BOOLEAN NOT NULL DEFAULT false,
    "weight" INTEGER NOT NULL DEFAULT 5,
    "verify_product_info" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "audit_steps_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fiche_cache" (
    "id" BIGSERIAL NOT NULL,
    "fiche_id" TEXT NOT NULL,
    "groupe" TEXT,
    "agence_nom" TEXT,
    "prospect_nom" TEXT,
    "prospect_prenom" TEXT,
    "prospect_email" TEXT,
    "prospect_tel" TEXT,
    "sales_date" TEXT,
    "raw_data" JSONB NOT NULL,
    "has_recordings" BOOLEAN NOT NULL DEFAULT false,
    "recordings_count" INTEGER,
    "fetched_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "last_revalidated_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "fiche_cache_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "recordings" (
    "id" BIGSERIAL NOT NULL,
    "fiche_cache_id" BIGINT NOT NULL,
    "call_id" TEXT NOT NULL,
    "recording_url" TEXT NOT NULL,
    "recording_date" TEXT,
    "recording_time" TEXT,
    "from_number" TEXT,
    "to_number" TEXT,
    "uuid" TEXT,
    "direction" TEXT,
    "answered" BOOLEAN,
    "start_time" TIMESTAMP(3),
    "duration_seconds" INTEGER,
    "transcription_id" TEXT,
    "transcription_text" TEXT,
    "has_transcription" BOOLEAN NOT NULL DEFAULT false,
    "transcribed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "recordings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audits" (
    "id" BIGSERIAL NOT NULL,
    "fiche_cache_id" BIGINT NOT NULL,
    "audit_config_id" BIGINT NOT NULL,
    "overall_score" DECIMAL(5,2) NOT NULL,
    "score_percentage" DECIMAL(5,2) NOT NULL,
    "niveau" TEXT NOT NULL,
    "is_compliant" BOOLEAN NOT NULL,
    "critical_passed" INTEGER NOT NULL,
    "critical_total" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "started_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),
    "duration_ms" INTEGER,
    "error_message" TEXT,
    "total_tokens" INTEGER,
    "successful_steps" INTEGER,
    "failed_steps" INTEGER,
    "recordings_count" INTEGER,
    "timeline_chunks" INTEGER,
    "result_data" JSONB,
    "version" INTEGER NOT NULL DEFAULT 1,
    "is_latest" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "audits_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_step_results" (
    "id" BIGSERIAL NOT NULL,
    "audit_id" BIGINT NOT NULL,
    "step_position" INTEGER NOT NULL,
    "step_name" TEXT NOT NULL,
    "severity_level" TEXT NOT NULL,
    "is_critical" BOOLEAN NOT NULL,
    "weight" INTEGER NOT NULL,
    "traite" BOOLEAN NOT NULL,
    "conforme" TEXT NOT NULL,
    "score" INTEGER NOT NULL,
    "niveau_conformite" TEXT NOT NULL,
    "commentaire_global" TEXT NOT NULL,
    "mots_cles_trouves" TEXT[],
    "minutages" TEXT[],
    "erreurs_transcription_tolerees" INTEGER NOT NULL DEFAULT 0,
    "total_citations" INTEGER NOT NULL DEFAULT 0,
    "total_tokens" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_step_results_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "chat_conversations" (
    "id" BIGSERIAL NOT NULL,
    "fiche_id" TEXT NOT NULL,
    "audit_id" BIGINT,
    "title" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "chat_conversations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "chat_messages" (
    "id" BIGSERIAL NOT NULL,
    "conversation_id" BIGINT NOT NULL,
    "role" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "chat_messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "automation_schedules" (
    "id" BIGSERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "schedule_type" "ScheduleType" NOT NULL,
    "cron_expression" TEXT,
    "timezone" TEXT NOT NULL DEFAULT 'UTC',
    "time_of_day" TEXT,
    "day_of_week" INTEGER,
    "day_of_month" INTEGER,
    "fiche_selection" JSONB NOT NULL,
    "run_transcription" BOOLEAN NOT NULL DEFAULT true,
    "skip_if_transcribed" BOOLEAN NOT NULL DEFAULT true,
    "transcription_priority" TEXT NOT NULL DEFAULT 'normal',
    "run_audits" BOOLEAN NOT NULL DEFAULT true,
    "use_automatic_audits" BOOLEAN NOT NULL DEFAULT true,
    "specific_audit_configs" BIGINT[],
    "continue_on_error" BOOLEAN NOT NULL DEFAULT true,
    "retry_failed" BOOLEAN NOT NULL DEFAULT false,
    "max_retries" INTEGER NOT NULL DEFAULT 0,
    "notify_on_complete" BOOLEAN NOT NULL DEFAULT true,
    "notify_on_error" BOOLEAN NOT NULL DEFAULT true,
    "webhook_url" TEXT,
    "notify_emails" TEXT[],
    "external_api_key" TEXT,
    "last_run_at" TIMESTAMP(3),
    "last_run_status" TEXT,
    "total_runs" INTEGER NOT NULL DEFAULT 0,
    "successful_runs" INTEGER NOT NULL DEFAULT 0,
    "failed_runs" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "automation_schedules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "automation_runs" (
    "id" BIGSERIAL NOT NULL,
    "schedule_id" BIGINT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'running',
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMP(3),
    "duration_ms" INTEGER,
    "total_fiches" INTEGER NOT NULL DEFAULT 0,
    "successful_fiches" INTEGER NOT NULL DEFAULT 0,
    "failed_fiches" INTEGER NOT NULL DEFAULT 0,
    "transcriptions_run" INTEGER NOT NULL DEFAULT 0,
    "audits_run" INTEGER NOT NULL DEFAULT 0,
    "error_message" TEXT,
    "error_details" JSONB,
    "config_snapshot" JSONB NOT NULL,
    "result_summary" JSONB,

    CONSTRAINT "automation_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "automation_logs" (
    "id" BIGSERIAL NOT NULL,
    "run_id" BIGINT NOT NULL,
    "level" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "metadata" JSONB DEFAULT '{}',
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "automation_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "progressive_fetch_jobs" (
    "id" TEXT NOT NULL,
    "start_date" TEXT NOT NULL,
    "end_date" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "progress" INTEGER NOT NULL DEFAULT 0,
    "total_days" INTEGER NOT NULL,
    "completed_days" INTEGER NOT NULL DEFAULT 0,
    "total_fiches" INTEGER NOT NULL DEFAULT 0,
    "dates_already_fetched" TEXT[],
    "dates_remaining" TEXT[],
    "dates_failed" TEXT[],
    "webhook_url" TEXT,
    "webhook_secret" TEXT,
    "webhook_events" TEXT[] DEFAULT ARRAY['complete', 'failed']::TEXT[],
    "last_webhook_sent_at" TIMESTAMP(3),
    "webhook_attempts" INTEGER NOT NULL DEFAULT 0,
    "webhook_last_error" TEXT,
    "result_fiche_ids" TEXT[],
    "error" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "completed_at" TIMESTAMP(3),

    CONSTRAINT "progressive_fetch_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "webhook_deliveries" (
    "id" TEXT NOT NULL,
    "job_id" TEXT NOT NULL,
    "event" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "status_code" INTEGER,
    "response_body" TEXT,
    "attempt" INTEGER NOT NULL DEFAULT 1,
    "max_attempts" INTEGER NOT NULL DEFAULT 3,
    "next_retry_at" TIMESTAMP(3),
    "sent_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "webhook_deliveries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "audit_configs_is_active_idx" ON "audit_configs"("is_active");

-- CreateIndex
CREATE INDEX "audit_configs_run_automatically_idx" ON "audit_configs"("run_automatically");

-- CreateIndex
CREATE INDEX "audit_configs_created_at_idx" ON "audit_configs"("created_at");

-- CreateIndex
CREATE INDEX "audit_steps_audit_config_id_idx" ON "audit_steps"("audit_config_id");

-- CreateIndex
CREATE INDEX "audit_steps_position_idx" ON "audit_steps"("position");

-- CreateIndex
CREATE UNIQUE INDEX "fiche_cache_fiche_id_key" ON "fiche_cache"("fiche_id");

-- CreateIndex
CREATE INDEX "fiche_cache_fiche_id_idx" ON "fiche_cache"("fiche_id");

-- CreateIndex
CREATE INDEX "fiche_cache_expires_at_idx" ON "fiche_cache"("expires_at");

-- CreateIndex
CREATE INDEX "fiche_cache_groupe_idx" ON "fiche_cache"("groupe");

-- CreateIndex
CREATE INDEX "fiche_cache_sales_date_idx" ON "fiche_cache"("sales_date");

-- CreateIndex
CREATE INDEX "fiche_cache_last_revalidated_at_idx" ON "fiche_cache"("last_revalidated_at");

-- CreateIndex
CREATE INDEX "recordings_fiche_cache_id_idx" ON "recordings"("fiche_cache_id");

-- CreateIndex
CREATE INDEX "recordings_call_id_idx" ON "recordings"("call_id");

-- CreateIndex
CREATE INDEX "recordings_recording_date_idx" ON "recordings"("recording_date");

-- CreateIndex
CREATE UNIQUE INDEX "recordings_fiche_cache_id_call_id_key" ON "recordings"("fiche_cache_id", "call_id");

-- CreateIndex
CREATE INDEX "audits_fiche_cache_id_idx" ON "audits"("fiche_cache_id");

-- CreateIndex
CREATE INDEX "audits_audit_config_id_idx" ON "audits"("audit_config_id");

-- CreateIndex
CREATE INDEX "audits_status_idx" ON "audits"("status");

-- CreateIndex
CREATE INDEX "audits_is_compliant_idx" ON "audits"("is_compliant");

-- CreateIndex
CREATE INDEX "audits_created_at_idx" ON "audits"("created_at");

-- CreateIndex
CREATE INDEX "audits_is_latest_idx" ON "audits"("is_latest");

-- CreateIndex
CREATE INDEX "audit_step_results_audit_id_idx" ON "audit_step_results"("audit_id");

-- CreateIndex
CREATE INDEX "audit_step_results_step_position_idx" ON "audit_step_results"("step_position");

-- CreateIndex
CREATE INDEX "audit_step_results_conforme_idx" ON "audit_step_results"("conforme");

-- CreateIndex
CREATE INDEX "chat_conversations_fiche_id_idx" ON "chat_conversations"("fiche_id");

-- CreateIndex
CREATE INDEX "chat_conversations_audit_id_idx" ON "chat_conversations"("audit_id");

-- CreateIndex
CREATE INDEX "chat_conversations_created_at_idx" ON "chat_conversations"("created_at");

-- CreateIndex
CREATE UNIQUE INDEX "chat_conversations_fiche_id_audit_id_key" ON "chat_conversations"("fiche_id", "audit_id");

-- CreateIndex
CREATE INDEX "chat_messages_conversation_id_idx" ON "chat_messages"("conversation_id");

-- CreateIndex
CREATE INDEX "chat_messages_timestamp_idx" ON "chat_messages"("timestamp");

-- CreateIndex
CREATE INDEX "automation_schedules_is_active_idx" ON "automation_schedules"("is_active");

-- CreateIndex
CREATE INDEX "automation_schedules_schedule_type_idx" ON "automation_schedules"("schedule_type");

-- CreateIndex
CREATE INDEX "automation_schedules_last_run_at_idx" ON "automation_schedules"("last_run_at");

-- CreateIndex
CREATE INDEX "automation_schedules_created_at_idx" ON "automation_schedules"("created_at");

-- CreateIndex
CREATE INDEX "automation_runs_schedule_id_idx" ON "automation_runs"("schedule_id");

-- CreateIndex
CREATE INDEX "automation_runs_status_idx" ON "automation_runs"("status");

-- CreateIndex
CREATE INDEX "automation_runs_started_at_idx" ON "automation_runs"("started_at");

-- CreateIndex
CREATE INDEX "automation_logs_run_id_idx" ON "automation_logs"("run_id");

-- CreateIndex
CREATE INDEX "automation_logs_level_idx" ON "automation_logs"("level");

-- CreateIndex
CREATE INDEX "automation_logs_timestamp_idx" ON "automation_logs"("timestamp");

-- CreateIndex
CREATE INDEX "progressive_fetch_jobs_status_idx" ON "progressive_fetch_jobs"("status");

-- CreateIndex
CREATE INDEX "progressive_fetch_jobs_start_date_end_date_idx" ON "progressive_fetch_jobs"("start_date", "end_date");

-- CreateIndex
CREATE INDEX "progressive_fetch_jobs_created_at_idx" ON "progressive_fetch_jobs"("created_at");

-- CreateIndex
CREATE INDEX "progressive_fetch_jobs_completed_at_idx" ON "progressive_fetch_jobs"("completed_at");

-- CreateIndex
CREATE INDEX "webhook_deliveries_job_id_idx" ON "webhook_deliveries"("job_id");

-- CreateIndex
CREATE INDEX "webhook_deliveries_status_next_retry_at_idx" ON "webhook_deliveries"("status", "next_retry_at");

-- CreateIndex
CREATE INDEX "webhook_deliveries_event_idx" ON "webhook_deliveries"("event");

-- CreateIndex
CREATE INDEX "webhook_deliveries_created_at_idx" ON "webhook_deliveries"("created_at");

-- AddForeignKey
ALTER TABLE "audit_steps" ADD CONSTRAINT "audit_steps_audit_config_id_fkey" FOREIGN KEY ("audit_config_id") REFERENCES "audit_configs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recordings" ADD CONSTRAINT "recordings_fiche_cache_id_fkey" FOREIGN KEY ("fiche_cache_id") REFERENCES "fiche_cache"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audits" ADD CONSTRAINT "audits_fiche_cache_id_fkey" FOREIGN KEY ("fiche_cache_id") REFERENCES "fiche_cache"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audits" ADD CONSTRAINT "audits_audit_config_id_fkey" FOREIGN KEY ("audit_config_id") REFERENCES "audit_configs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_step_results" ADD CONSTRAINT "audit_step_results_audit_id_fkey" FOREIGN KEY ("audit_id") REFERENCES "audits"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chat_messages" ADD CONSTRAINT "chat_messages_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "chat_conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "automation_runs" ADD CONSTRAINT "automation_runs_schedule_id_fkey" FOREIGN KEY ("schedule_id") REFERENCES "automation_schedules"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "automation_logs" ADD CONSTRAINT "automation_logs_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "automation_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "webhook_deliveries" ADD CONSTRAINT "webhook_deliveries_job_id_fkey" FOREIGN KEY ("job_id") REFERENCES "progressive_fetch_jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
