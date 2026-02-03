import type { RequestHandler } from "express";

import { extractApiTokenFromRequest, isValidApiToken } from "../shared/api-tokens.js";
import { extractBearerToken, verifyAccessToken } from "../shared/auth.js";
import { type AuthContext,setRequestAuth } from "../shared/auth-context.js";
import { ConfigurationError } from "../shared/errors.js";

/**
 * Populates `req.auth` when the request includes valid credentials.
 *
 * Supported:
 * - User JWT access token: `Authorization: Bearer <jwt>`
 * - Machine API token (optional): `Authorization: Bearer <token>` or `X-API-Key: <token>`
 */
export const authContextMiddleware: RequestHandler = (req, _res, next) => {
  setRequestAuth(req, undefined);

  const apiCandidate = extractApiTokenFromRequest(req);
  if (apiCandidate && isValidApiToken(apiCandidate)) {
    setRequestAuth(req, { kind: "apiToken", token: apiCandidate } satisfies AuthContext);
    return next();
  }

  const bearer = extractBearerToken(req.headers.authorization);
  if (!bearer) {return next();}

  void verifyAccessToken(bearer)
    .then((claims) => {
      setRequestAuth(req, {
        kind: "user",
        userId: claims.sub,
        email: claims.email,
        crmUserId: claims.crmUserId,
        groupes: claims.groupes,
        roles: claims.roles,
        permissions: claims.permissions,
      } satisfies AuthContext);
      next();
    })
    .catch((err: unknown) => {
      // If the server is misconfigured, surface it; otherwise treat as unauthenticated.
      if (err instanceof ConfigurationError) {return next(err);}
      return next();
    });
};

