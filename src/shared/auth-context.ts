export type UserAuthContext = {
  kind: "user";
  userId: string; // stringified BigInt
  email: string;
  roles: string[];
  permissions: string[];
};

export type ApiTokenAuthContext = {
  kind: "apiToken";
  token: string;
};

export type AuthContext = UserAuthContext | ApiTokenAuthContext;

export function isUserAuth(ctx: AuthContext | undefined | null): ctx is UserAuthContext {
  return Boolean(ctx && ctx.kind === "user");
}

export function isApiTokenAuth(ctx: AuthContext | undefined | null): ctx is ApiTokenAuthContext {
  return Boolean(ctx && ctx.kind === "apiToken");
}

/**
 * Accessors for storing auth context on Express `req` without relying on
 * global type augmentation (keeps TypeScript strict builds happy).
 */
export function getRequestAuth(req: unknown): AuthContext | undefined {
  const r = req as { auth?: AuthContext } | null | undefined;
  return r?.auth;
}

export function setRequestAuth(req: unknown, ctx: AuthContext | undefined): void {
  (req as { auth?: AuthContext }).auth = ctx;
}

