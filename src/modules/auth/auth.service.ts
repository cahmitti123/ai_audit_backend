/**
 * Auth Service
 * ============
 * Login / refresh / logout orchestration.
 */

import { UserStatus } from "@prisma/client";

import { generateOpaqueToken,getAuthConfig, hashOpaqueToken, signAccessToken } from "../../shared/auth.js";
import { AuthenticationError } from "../../shared/errors.js";
import { verifyPassword } from "../../shared/password.js";
import { prisma } from "../../shared/prisma.js";
import {
  createRefreshToken,
  getRefreshTokenWithUserByHash,
  getUserAuthSnapshotByEmail,
  revokeRefreshToken,
} from "./auth.repository.js";

function authFailed(): never {
  // Avoid user enumeration.
  throw new AuthenticationError("Invalid email or password");
}

export type LoginResult = {
  accessToken: string;
  accessTokenExpiresIn: number;
  refreshToken: string;
  user: {
    id: string;
    email: string;
    roles: string[];
    permissions: string[];
  };
};

export async function login(params: {
  email: string;
  password: string;
  ip?: string | null;
  userAgent?: string | null;
}): Promise<LoginResult> {
  const cfg = getAuthConfig();

  const email = String(params.email || "").trim().toLowerCase();
  const password = String(params.password || "");
  if (!email || !password) {authFailed();}

  const snapshot = await getUserAuthSnapshotByEmail(email);
  if (!snapshot) {authFailed();}
  if (snapshot.user.status !== UserStatus.ACTIVE) {authFailed();}

  const ok = await verifyPassword(password, snapshot.passwordHash);
  if (!ok) {authFailed();}

  // Record last login (best-effort).
  await prisma.user.update({
    where: { id: snapshot.user.id },
    data: { lastLoginAt: new Date() },
  });

  const accessToken = await signAccessToken({
    userId: snapshot.user.id.toString(),
    email: snapshot.user.email,
    roles: snapshot.roles,
    permissions: snapshot.permissions,
  });

  const refreshToken = generateOpaqueToken(48);
  const refreshHash = hashOpaqueToken(refreshToken);
  await createRefreshToken({
    userId: snapshot.user.id,
    tokenHash: refreshHash,
    expiresAt: new Date(Date.now() + cfg.refreshTtlSeconds * 1000),
    createdByIp: params.ip ?? null,
    userAgent: params.userAgent ?? null,
  });

  return {
    accessToken,
    accessTokenExpiresIn: cfg.accessTtlSeconds,
    refreshToken,
    user: {
      id: snapshot.user.id.toString(),
      email: snapshot.user.email,
      roles: snapshot.roles,
      permissions: snapshot.permissions,
    },
  };
}

export async function refresh(params: {
  refreshToken: string;
  ip?: string | null;
  userAgent?: string | null;
}): Promise<LoginResult> {
  const cfg = getAuthConfig();

  const raw = String(params.refreshToken || "").trim();
  if (!raw) {throw new AuthenticationError("Missing refresh token");}

  const hash = hashOpaqueToken(raw);
  const found = await getRefreshTokenWithUserByHash(hash);
  if (!found) {throw new AuthenticationError("Invalid refresh token");}

  const now = Date.now();
  if (found.token.revokedAt) {throw new AuthenticationError("Refresh token revoked");}
  if (found.token.expiresAt.getTime() <= now) {throw new AuthenticationError("Refresh token expired");}
  if (found.user.user.status !== UserStatus.ACTIVE) {
    throw new AuthenticationError("User is disabled");
  }

  // Rotate refresh token
  const newRefreshToken = generateOpaqueToken(48);
  const newRefreshHash = hashOpaqueToken(newRefreshToken);
  const created = await createRefreshToken({
    userId: found.token.userId,
    tokenHash: newRefreshHash,
    expiresAt: new Date(Date.now() + cfg.refreshTtlSeconds * 1000),
    createdByIp: params.ip ?? null,
    userAgent: params.userAgent ?? null,
  });

  await revokeRefreshToken({ tokenId: found.token.id, replacedById: created.id });

  const accessToken = await signAccessToken({
    userId: found.user.user.id.toString(),
    email: found.user.user.email,
    roles: found.user.roles,
    permissions: found.user.permissions,
  });

  return {
    accessToken,
    accessTokenExpiresIn: cfg.accessTtlSeconds,
    refreshToken: newRefreshToken,
    user: {
      id: found.user.user.id.toString(),
      email: found.user.user.email,
      roles: found.user.roles,
      permissions: found.user.permissions,
    },
  };
}

export async function logout(params: { refreshToken: string }): Promise<void> {
  const raw = String(params.refreshToken || "").trim();
  if (!raw) {return;}

  const hash = hashOpaqueToken(raw);
  const found = await getRefreshTokenWithUserByHash(hash);
  if (!found) {return;}
  if (found.token.revokedAt) {return;}

  await revokeRefreshToken({ tokenId: found.token.id, replacedById: null });
}

