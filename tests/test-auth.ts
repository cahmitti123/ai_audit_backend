import { signAccessToken } from "../src/shared/auth.js";
import type { PermissionGrant } from "../src/shared/auth-context.js";

let cachedToken: string | null = null;

export async function getTestAccessToken(overrides?: {
  userId?: string;
  email?: string;
  roles?: string[];
  permissions?: PermissionGrant[];
  crmUserId?: string | null;
  groupes?: string[];
}): Promise<string> {
  if (!overrides && cachedToken) {return cachedToken;}

  const all: PermissionGrant[] = [
    "admin.users",
    "admin.roles",
    "admin.permissions",
    "fiches",
    "audits",
    "audit-configs",
    "automation",
    "recordings",
    "transcriptions",
    "products",
    "chat",
    "realtime",
  ].map((key) => ({
    key,
    read: true,
    write: true,
    read_scope: "ALL" as const,
    write_scope: "ALL" as const,
  }));

  const token = await signAccessToken({
    userId: overrides?.userId || "1",
    email: overrides?.email || "test@example.com",
    roles: overrides?.roles || ["admin"],
    crmUserId: overrides?.crmUserId ?? "1",
    groupes: overrides?.groupes ?? ["NCA R1"],
    permissions: overrides?.permissions || all,
  });

  if (!overrides) {cachedToken = token;}
  return token;
}

