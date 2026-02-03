/**
 * Auth Routes
 * ===========
 * JWT login/refresh/logout and "me" endpoint.
 */

import { type Request, type Response,Router } from "express";

import { asyncHandler } from "../../middleware/async-handler.js";
import {
  extractBearerToken,
  getAuthConfig,
  getCookieValue,
  verifyAccessToken,
} from "../../shared/auth.js";
import { AuthenticationError } from "../../shared/errors.js";
import { ok } from "../../shared/http.js";
import { getUserAuthSnapshotById } from "./auth.repository.js";
import { validateAcceptInviteInput, validateLoginInput, validateRefreshInput } from "./auth.schemas.js";
import * as authService from "./auth.service.js";

export const authRouter = Router();

function setRefreshCookie(res: Response, refreshToken: string) {
  const cfg = getAuthConfig();
  res.cookie(cfg.refreshCookieName, refreshToken, {
    httpOnly: true,
    secure: cfg.cookieSecure,
    sameSite: cfg.cookieSameSite,
    path: "/api/auth",
    maxAge: cfg.refreshTtlSeconds * 1000,
  });
}

function clearRefreshCookie(res: Response) {
  const cfg = getAuthConfig();
  res.clearCookie(cfg.refreshCookieName, {
    httpOnly: true,
    secure: cfg.cookieSecure,
    sameSite: cfg.cookieSameSite,
    path: "/api/auth",
  });
}

/**
 * POST /api/auth/login
 */
authRouter.post(
  "/login",
  asyncHandler(async (req: Request, res: Response) => {
    const input = validateLoginInput(req.body);

    const result = await authService.login({
      email: input.email,
      password: input.password,
      ip: req.ip,
      userAgent: req.get("user-agent"),
    });

    setRefreshCookie(res, result.refreshToken);

    return ok(res, {
      access_token: result.accessToken,
      token_type: "Bearer",
      expires_in: result.accessTokenExpiresIn,
      user: result.user,
    });
  })
);

/**
 * POST /api/auth/refresh
 */
authRouter.post(
  "/refresh",
  asyncHandler(async (req: Request, res: Response) => {
    const cfg = getAuthConfig();
    const input = validateRefreshInput(req.body);

    const cookieToken = getCookieValue(req.headers.cookie, cfg.refreshCookieName);
    const refreshToken = cookieToken || input.refresh_token || "";

    const result = await authService.refresh({
      refreshToken,
      ip: req.ip,
      userAgent: req.get("user-agent"),
    });

    setRefreshCookie(res, result.refreshToken);

    return ok(res, {
      access_token: result.accessToken,
      token_type: "Bearer",
      expires_in: result.accessTokenExpiresIn,
      user: result.user,
    });
  })
);

/**
 * POST /api/auth/logout
 */
authRouter.post(
  "/logout",
  asyncHandler(async (req: Request, res: Response) => {
    const cfg = getAuthConfig();
    const input = validateRefreshInput(req.body);

    const cookieToken = getCookieValue(req.headers.cookie, cfg.refreshCookieName);
    const refreshToken = cookieToken || input.refresh_token || "";

    await authService.logout({ refreshToken });
    clearRefreshCookie(res);

    return ok(res, { logged_out: true });
  })
);

/**
 * POST /api/auth/invite/accept
 *
 * Consumes a one-time invite token and sets the user's password.
 * Returns access token + refresh cookie (same response shape as /login).
 */
authRouter.post(
  "/invite/accept",
  asyncHandler(async (req: Request, res: Response) => {
    const input = validateAcceptInviteInput(req.body);

    const result = await authService.acceptInvite({
      inviteToken: input.invite_token,
      password: input.password,
      ip: req.ip,
      userAgent: req.get("user-agent"),
    });

    setRefreshCookie(res, result.refreshToken);

    return ok(res, {
      access_token: result.accessToken,
      token_type: "Bearer",
      expires_in: result.accessTokenExpiresIn,
      user: result.user,
    });
  })
);

/**
 * GET /api/auth/me
 */
authRouter.get(
  "/me",
  asyncHandler(async (req: Request, res: Response) => {
    const token = extractBearerToken(req.headers.authorization);
    if (!token) {throw new AuthenticationError("Missing access token");}

    const claims = await verifyAccessToken(token);

    // Prefer DB for latest roles/permissions + disabled check.
    const userIdStr = claims.sub;
    if (!/^\d+$/.test(userIdStr)) {throw new AuthenticationError("Invalid access token");}
    const snapshot = await getUserAuthSnapshotById(BigInt(userIdStr));
    if (!snapshot) {throw new AuthenticationError("User not found");}

    return ok(res, {
      user: {
        id: snapshot.user.id.toString(),
        email: snapshot.user.email,
        crm_user_id: snapshot.user.crmUserId,
        groupes: snapshot.groupes,
        roles: snapshot.roles,
        permissions: snapshot.permissions,
      },
    });
  })
);

