import type { RequestHandler } from "express";

import { getRequestAuth, isApiTokenAuth, isUserAuth } from "../shared/auth-context.js";
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
  const required = String(permission || "").trim();
  return (req, _res, next) => {
    const auth = getRequestAuth(req);
    if (!auth) {return next(new AuthenticationError("Authentication required"));}

    // Machine tokens are treated as trusted callers.
    if (isApiTokenAuth(auth)) {return next();}

    if (!isUserAuth(auth)) {return next(new AuthenticationError("User authentication required"));}

    const allowed = auth.permissions.includes(required);
    if (!allowed) {return next(new AuthorizationError("Missing permission"));}
    return next();
  };
}

