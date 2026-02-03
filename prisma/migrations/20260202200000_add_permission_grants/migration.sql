-- Permission scopes for RBAC policies (self / group / all)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'PermissionScope') THEN
    CREATE TYPE "PermissionScope" AS ENUM ('SELF', 'GROUP', 'ALL');
  END IF;
END $$;

-- Extend role_permissions with read/write flags + scope
ALTER TABLE "role_permissions"
  ADD COLUMN IF NOT EXISTS "can_read" BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS "can_write" BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS "scope" "PermissionScope" NOT NULL DEFAULT 'SELF';

