import type { RequestHandler } from "express";

import { getRequestAuth, isApiTokenAuth, isUserAuth, type PermissionGrant } from "../shared/auth-context.js";
import { AuthenticationError, AuthorizationError } from "../shared/errors.js";

export function requireAuth(): RequestHandler {
  return (req, _res, next) => {
    if (!getRequestAuth(req)) {return next(new AuthenticationError("Authentication required"));}
    return next();
  };
}

export function requireUserAuth(): RequestHandler {
  return (req, _res, next) => {
    if (!isUserAuth(getRequestAuth(req))) {
      return next(new AuthenticationError("User authentication required"));
    }
    return next();
  };
}

export function requirePermission(permission: string): RequestHandler {
  const raw = String(permission || "").trim();
  return (req, _res, next) => {
    const auth = getRequestAuth(req);
    if (!auth) {return next(new AuthenticationError("Authentication required"));}

    // Machine tokens are treated as trusted callers.
    if (isApiTokenAuth(auth)) {return next();}

    if (!isUserAuth(auth)) {return next(new AuthenticationError("User authentication required"));}

    // Back-compat: allow passing "audits.read" etc by mapping to base permission + action.
    const m = /^(.+)\.(read|write|run|rerun|fetch|use|auth|test)$/i.exec(raw);
    const key = m ? m[1] : raw;
    const suffix = m ? m[2].toLowerCase() : null;
    const action: "read" | "write" =
      suffix === "write" || suffix === "run" || suffix === "rerun" || suffix === "fetch" || suffix === "use" || suffix === "test"
        ? "write"
        : "read";

    const grant: PermissionGrant | undefined = auth.permissions.find((p) => p.key === key);
    const allowed = grant ? (action === "read" ? grant.read : grant.write) : false;

    if (!allowed) {return next(new AuthorizationError("Missing permission"));}
    return next();
  };
}

