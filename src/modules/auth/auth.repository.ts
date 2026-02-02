/**
 * Auth Repository
 * ===============
 * DB access for users, roles/permissions, and refresh tokens.
 */

import type { UserStatus } from "@prisma/client";

import { prisma } from "../../shared/prisma.js";

function uniqStrings(values: string[]): string[] {
  return Array.from(new Set(values.map((v) => v.trim()).filter(Boolean)));
}

type UserWithRbac = {
  id: bigint;
  email: string;
  status: UserStatus;
  passwordHash: string;
  roles: Array<{
    role: {
      key: string;
      permissions: Array<{ permission: { key: string } }>;
    };
  }>;
};

function toUserAuthSnapshot(user: UserWithRbac) {
  const roleKeys = user.roles.map((r) => r.role.key);
  const permKeys = user.roles.flatMap((r) => r.role.permissions.map((rp) => rp.permission.key));
  return {
    user: {
      id: user.id,
      email: user.email,
      status: user.status,
    },
    passwordHash: user.passwordHash,
    roles: uniqStrings(roleKeys),
    permissions: uniqStrings(permKeys),
  };
}

export type UserAuthSnapshot = ReturnType<typeof toUserAuthSnapshot>;

export async function getUserAuthSnapshotByEmail(email: string): Promise<UserAuthSnapshot | null> {
  const normalized = String(email || "").trim().toLowerCase();
  if (!normalized) {return null;}

  const user = await prisma.user.findUnique({
    where: { email: normalized },
    include: {
      roles: {
        include: {
          role: {
            include: {
              permissions: { include: { permission: true } },
            },
          },
        },
      },
    },
  });

  if (!user) {return null;}
  return toUserAuthSnapshot(user as unknown as UserWithRbac);
}

export async function getUserAuthSnapshotById(userId: bigint): Promise<UserAuthSnapshot | null> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: {
      roles: {
        include: {
          role: {
            include: {
              permissions: { include: { permission: true } },
            },
          },
        },
      },
    },
  });

  if (!user) {return null;}
  return toUserAuthSnapshot(user as unknown as UserWithRbac);
}

export async function createRefreshToken(params: {
  userId: bigint;
  tokenHash: string;
  expiresAt: Date;
  createdByIp?: string | null;
  userAgent?: string | null;
}): Promise<{ id: bigint; tokenHash: string; expiresAt: Date; createdAt: Date }> {
  const row = await prisma.refreshToken.create({
    data: {
      userId: params.userId,
      tokenHash: params.tokenHash,
      expiresAt: params.expiresAt,
      createdByIp: params.createdByIp ?? null,
      userAgent: params.userAgent ?? null,
    },
    select: {
      id: true,
      tokenHash: true,
      expiresAt: true,
      createdAt: true,
    },
  });
  return row;
}

export type RefreshTokenWithUser = {
  token: {
    id: bigint;
    userId: bigint;
    tokenHash: string;
    revokedAt: Date | null;
    replacedById: bigint | null;
    expiresAt: Date;
    createdAt: Date;
  };
  user: UserAuthSnapshot;
};

export async function getRefreshTokenWithUserByHash(tokenHash: string): Promise<RefreshTokenWithUser | null> {
  const hash = String(tokenHash || "").trim();
  if (!hash) {return null;}

  const row = await prisma.refreshToken.findUnique({
    where: { tokenHash: hash },
    include: {
      user: {
        include: {
          roles: {
            include: {
              role: {
                include: {
                  permissions: { include: { permission: true } },
                },
              },
            },
          },
        },
      },
    },
  });

  if (!row) {return null;}

  const user = row.user as unknown as UserWithRbac;
  return {
    token: {
      id: row.id,
      userId: row.userId,
      tokenHash: row.tokenHash,
      revokedAt: row.revokedAt,
      replacedById: row.replacedById,
      expiresAt: row.expiresAt,
      createdAt: row.createdAt,
    },
    user: toUserAuthSnapshot(user),
  };
}

export async function revokeRefreshToken(params: {
  tokenId: bigint;
  replacedById?: bigint | null;
}): Promise<void> {
  await prisma.refreshToken.update({
    where: { id: params.tokenId },
    data: {
      revokedAt: new Date(),
      replacedById: params.replacedById ?? undefined,
    },
  });
}

