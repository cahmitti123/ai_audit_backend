/**
 * Auth Repository
 * ===============
 * DB access for users, roles/permissions, and refresh tokens.
 */

import type { UserStatus } from "@prisma/client";

import type { PermissionGrant, PermissionScope } from "../../shared/auth-context.js";
import { prisma } from "../../shared/prisma.js";

function uniqStrings(values: string[]): string[] {
  return Array.from(new Set(values.map((v) => v.trim()).filter(Boolean)));
}

type UserWithRbac = {
  id: bigint;
  email: string;
  status: UserStatus;
  passwordHash: string | null;
  crmUserId: string | null;
  roles: Array<{
    role: {
      key: string;
      permissions: Array<{
        permission: { key: string };
        canRead: boolean;
        canWrite: boolean;
        scope: PermissionScope;
      }>;
    };
  }>;
  teams: Array<{
    team: { name: string };
  }>;
};

function scopeRank(scope: PermissionScope): number {
  return scope === "ALL" ? 3 : scope === "GROUP" ? 2 : 1;
}

function maxScope(a: PermissionScope, b: PermissionScope): PermissionScope {
  return scopeRank(a) >= scopeRank(b) ? a : b;
}

function toUserAuthSnapshot(user: UserWithRbac) {
  const roleKeys = user.roles.map((r) => r.role.key);

  const grantByKey = new Map<string, PermissionGrant>();
  for (const r of user.roles) {
    for (const rp of r.role.permissions) {
      const key = rp.permission.key;
      if (!key) {continue;}
      if (!rp.canRead && !rp.canWrite) {continue;}

      const existing = grantByKey.get(key) || {
        key,
        read: false,
        write: false,
        read_scope: "SELF" as PermissionScope,
        write_scope: "SELF" as PermissionScope,
      };

      if (rp.canRead) {
        existing.read = true;
        existing.read_scope = maxScope(existing.read_scope, rp.scope);
      }
      if (rp.canWrite) {
        existing.write = true;
        existing.write_scope = maxScope(existing.write_scope, rp.scope);
      }

      grantByKey.set(key, existing);
    }
  }

  const permissions = Array.from(grantByKey.values()).sort((a, b) => a.key.localeCompare(b.key));
  const groupes = uniqStrings(user.teams.map((t) => t.team.name));

  return {
    user: {
      id: user.id,
      email: user.email,
      status: user.status,
      crmUserId: user.crmUserId,
    },
    passwordHash: user.passwordHash,
    roles: uniqStrings(roleKeys),
    groupes,
    permissions,
  };
}

export type UserAuthSnapshot = ReturnType<typeof toUserAuthSnapshot>;

export async function getUserAuthSnapshotByEmail(email: string): Promise<UserAuthSnapshot | null> {
  const normalized = String(email || "").trim().toLowerCase();
  if (!normalized) {return null;}

  const user = await prisma.user.findUnique({
    where: { email: normalized },
    include: {
      teams: { include: { team: true } },
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
      teams: { include: { team: true } },
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
          teams: { include: { team: true } },
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

export async function createUserInviteToken(params: {
  userId: bigint;
  tokenHash: string;
  expiresAt: Date;
}): Promise<{ id: bigint; tokenHash: string; expiresAt: Date; usedAt: Date | null; createdAt: Date }> {
  const row = await prisma.userInviteToken.create({
    data: {
      userId: params.userId,
      tokenHash: params.tokenHash,
      expiresAt: params.expiresAt,
    },
    select: {
      id: true,
      tokenHash: true,
      expiresAt: true,
      usedAt: true,
      createdAt: true,
    },
  });
  return row;
}

export async function getUserInviteTokenWithUserByHash(tokenHash: string): Promise<{
  token: { id: bigint; userId: bigint; tokenHash: string; expiresAt: Date; usedAt: Date | null; createdAt: Date };
  user: UserAuthSnapshot;
} | null> {
  const hash = String(tokenHash || "").trim();
  if (!hash) {return null;}

  const row = await prisma.userInviteToken.findUnique({
    where: { tokenHash: hash },
    include: {
      user: {
        include: {
          teams: { include: { team: true } },
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
      expiresAt: row.expiresAt,
      usedAt: row.usedAt,
      createdAt: row.createdAt,
    },
    user: toUserAuthSnapshot(user),
  };
}

export async function markUserInviteTokenUsed(params: { tokenId: bigint }): Promise<void> {
  await prisma.userInviteToken.update({
    where: { id: params.tokenId },
    data: { usedAt: new Date() },
  });
}
