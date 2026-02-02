import { signAccessToken } from "../src/shared/auth.js";

let cachedToken: string | null = null;

export async function getTestAccessToken(overrides?: {
  userId?: string;
  email?: string;
  roles?: string[];
  permissions?: string[];
}): Promise<string> {
  if (!overrides && cachedToken) {return cachedToken;}

  const token = await signAccessToken({
    userId: overrides?.userId || "1",
    email: overrides?.email || "test@example.com",
    roles: overrides?.roles || ["admin"],
    permissions:
      overrides?.permissions || [
        "realtime.auth",
        "realtime.test",
        "audits.read",
        "audits.run",
        "audits.rerun",
        "audit-configs.read",
        "audit-configs.write",
        "automation.read",
        "automation.run",
        "automation.write",
        "fiches.read",
        "fiches.fetch",
        "recordings.read",
        "transcriptions.read",
        "products.read",
        "products.write",
        "chat.use",
      ],
  });

  if (!overrides) {cachedToken = token;}
  return token;
}

