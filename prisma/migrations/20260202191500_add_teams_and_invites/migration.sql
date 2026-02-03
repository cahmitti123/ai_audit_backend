-- Add enum value for invited users (idempotent)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_enum e
    JOIN pg_type t ON t.oid = e.enumtypid
    WHERE t.typname = 'UserStatus' AND e.enumlabel = 'INVITED'
  ) THEN
    ALTER TYPE "UserStatus" ADD VALUE 'INVITED';
  END IF;
END $$;

-- Allow users without a password until first login (invite flow)
ALTER TABLE "users"
  ALTER COLUMN "password_hash" DROP NOT NULL;

-- Link app users to CRM users (optional)
ALTER TABLE "users"
  ADD COLUMN IF NOT EXISTS "crm_user_id" TEXT;

-- Unique CRM user mapping (nullable unique is OK)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_indexes
    WHERE schemaname = current_schema()
      AND indexname = 'users_crm_user_id_key'
  ) THEN
    CREATE UNIQUE INDEX "users_crm_user_id_key" ON "users"("crm_user_id");
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_indexes
    WHERE schemaname = current_schema()
      AND indexname = 'users_crm_user_id_idx'
  ) THEN
    CREATE INDEX "users_crm_user_id_idx" ON "users"("crm_user_id");
  END IF;
END $$;

-- Teams (CRM groups)
CREATE TABLE IF NOT EXISTS "teams" (
  "id" BIGSERIAL NOT NULL,
  "crm_group_id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "responsable_1" TEXT,
  "responsable_2" TEXT,
  "responsable_3" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "teams_pkey" PRIMARY KEY ("id")
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_indexes
    WHERE schemaname = current_schema()
      AND indexname = 'teams_crm_group_id_key'
  ) THEN
    CREATE UNIQUE INDEX "teams_crm_group_id_key" ON "teams"("crm_group_id");
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_indexes
    WHERE schemaname = current_schema()
      AND indexname = 'teams_crm_group_id_idx'
  ) THEN
    CREATE INDEX "teams_crm_group_id_idx" ON "teams"("crm_group_id");
  END IF;
END $$;

-- Team memberships (app users ↔ teams)
CREATE TABLE IF NOT EXISTS "user_teams" (
  "id" BIGSERIAL NOT NULL,
  "user_id" BIGINT NOT NULL,
  "team_id" BIGINT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "user_teams_pkey" PRIMARY KEY ("id")
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_indexes
    WHERE schemaname = current_schema()
      AND indexname = 'user_teams_user_id_team_id_key'
  ) THEN
    CREATE UNIQUE INDEX "user_teams_user_id_team_id_key" ON "user_teams"("user_id", "team_id");
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_indexes
    WHERE schemaname = current_schema()
      AND indexname = 'user_teams_user_id_idx'
  ) THEN
    CREATE INDEX "user_teams_user_id_idx" ON "user_teams"("user_id");
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_indexes
    WHERE schemaname = current_schema()
      AND indexname = 'user_teams_team_id_idx'
  ) THEN
    CREATE INDEX "user_teams_team_id_idx" ON "user_teams"("team_id");
  END IF;
END $$;

ALTER TABLE "user_teams"
  ADD CONSTRAINT "user_teams_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "user_teams"
  ADD CONSTRAINT "user_teams_team_id_fkey"
  FOREIGN KEY ("team_id") REFERENCES "teams"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Invite tokens (first-time password setup)
CREATE TABLE IF NOT EXISTS "user_invite_tokens" (
  "id" BIGSERIAL NOT NULL,
  "user_id" BIGINT NOT NULL,
  "token_hash" TEXT NOT NULL,
  "expires_at" TIMESTAMP(3) NOT NULL,
  "used_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "user_invite_tokens_pkey" PRIMARY KEY ("id")
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_indexes
    WHERE schemaname = current_schema()
      AND indexname = 'user_invite_tokens_token_hash_key'
  ) THEN
    CREATE UNIQUE INDEX "user_invite_tokens_token_hash_key" ON "user_invite_tokens"("token_hash");
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_indexes
    WHERE schemaname = current_schema()
      AND indexname = 'user_invite_tokens_user_id_idx'
  ) THEN
    CREATE INDEX "user_invite_tokens_user_id_idx" ON "user_invite_tokens"("user_id");
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_indexes
    WHERE schemaname = current_schema()
      AND indexname = 'user_invite_tokens_expires_at_idx'
  ) THEN
    CREATE INDEX "user_invite_tokens_expires_at_idx" ON "user_invite_tokens"("expires_at");
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_indexes
    WHERE schemaname = current_schema()
      AND indexname = 'user_invite_tokens_used_at_idx'
  ) THEN
    CREATE INDEX "user_invite_tokens_used_at_idx" ON "user_invite_tokens"("used_at");
  END IF;
END $$;

ALTER TABLE "user_invite_tokens"
  ADD CONSTRAINT "user_invite_tokens_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

