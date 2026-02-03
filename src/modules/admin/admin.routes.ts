/**
 * Admin Routes
 * ============
 * Minimal RBAC admin endpoints (users / roles / permissions).
 */

import { UserStatus } from "@prisma/client";
import { type Request, type Response, Router } from "express";

import { asyncHandler } from "../../middleware/async-handler.js";
import { requirePermission } from "../../middleware/authz.js";
import { generateOpaqueToken, hashOpaqueToken } from "../../shared/auth.js";
import { NotFoundError, ValidationError } from "../../shared/errors.js";
import { ok } from "../../shared/http.js";
import { hashPassword } from "../../shared/password.js";
import { prisma } from "../../shared/prisma.js";
import { fetchCrmGroups, fetchCrmUsers } from "../crm/crm.api.js";
import {
  validateCreateRoleInput,
  validateCreateUserFromCrmInput,
  validateCreateUserInput,
  validateUpdateRoleInput,
  validateUpdateUserInput,
} from "./admin.schemas.js";

export const adminRouter = Router();

function parseUserIdParam(value: string): bigint {
  try {
    return BigInt(value);
  } catch {
    throw new ValidationError("Invalid user id");
  }
}

type RolePermissionGrantInput = {
  key: string;
  read: boolean;
  write: boolean;
  scope: "SELF" | "GROUP" | "ALL";
};

function normalizeRolePermissionGrants(input: {
  permission_grants?: Array<{
    key: string;
    read?: boolean;
    write?: boolean;
    scope?: "SELF" | "GROUP" | "ALL";
  }>;
  permission_keys?: string[];
}): RolePermissionGrantInput[] {
  const explicit = Array.isArray(input.permission_grants) ? input.permission_grants : null;
  if (explicit) {
    const byKey = new Map<string, RolePermissionGrantInput>();
    for (const g of explicit) {
      const key = typeof g?.key === "string" ? g.key.trim() : "";
      if (!key) {continue;}
      const existing = byKey.get(key) || {
        key,
        read: false,
        write: false,
        scope: "SELF" as const,
      };
      existing.read = existing.read || Boolean(g.read);
      existing.write = existing.write || Boolean(g.write);

      const nextScope = g.scope === "ALL" ? "ALL" : g.scope === "GROUP" ? "GROUP" : "SELF";
      existing.scope =
        existing.scope === "ALL" || nextScope === "ALL"
          ? "ALL"
          : existing.scope === "GROUP" || nextScope === "GROUP"
            ? "GROUP"
            : "SELF";

      byKey.set(key, existing);
    }
    return Array.from(byKey.values())
      .filter((g) => g.read || g.write)
      .sort((a, b) => a.key.localeCompare(b.key));
  }

  // Back-compat: infer read/write from legacy permission keys, defaulting scope to GROUP.
  const legacyKeys = Array.isArray(input.permission_keys) ? input.permission_keys : [];
  const byKey = new Map<string, RolePermissionGrantInput>();
  for (const raw of legacyKeys) {
    const v = String(raw || "").trim();
    if (!v) {continue;}

    const m = /^(.+)\.(read|write|run|rerun|fetch|use|auth|test)$/i.exec(v);
    const key = m ? m[1] : v;
    const suffix = m ? m[2].toLowerCase() : null;

    const read = !suffix || suffix === "read" || suffix === "auth";
    const write =
      !suffix ||
      suffix === "write" ||
      suffix === "run" ||
      suffix === "rerun" ||
      suffix === "fetch" ||
      suffix === "use" ||
      suffix === "test";

    const existing = byKey.get(key) || { key, read: false, write: false, scope: "GROUP" as const };
    existing.read = existing.read || read;
    existing.write = existing.write || write;
    byKey.set(key, existing);
  }

  return Array.from(byKey.values())
    .filter((g) => g.read || g.write)
    .sort((a, b) => a.key.localeCompare(b.key));
}

adminRouter.get(
  "/users",
  requirePermission("admin.users.read"),
  asyncHandler(async (_req: Request, res: Response) => {
    const users = await prisma.user.findMany({
      orderBy: { id: "asc" },
      include: { roles: { include: { role: true } } },
    });

    return ok(res, {
      users: users.map((u) => ({
        id: u.id.toString(),
        email: u.email,
        status: u.status,
        roles: u.roles.map((ur) => ur.role.key),
      })),
      count: users.length,
    });
  })
);

adminRouter.post(
  "/users",
  requirePermission("admin.users.write"),
  asyncHandler(async (req: Request, res: Response) => {
    const input = validateCreateUserInput(req.body);

    const email = input.email.trim().toLowerCase();
    const roleKeys = input.role_keys?.length ? input.role_keys : ["viewer"];
    const passwordHash = await hashPassword(input.password);

    const created = await prisma.$transaction(async (tx) => {
      const roles = await tx.role.findMany({
        where: { key: { in: roleKeys } },
        select: { id: true, key: true },
      });

      if (roles.length !== roleKeys.length) {
        throw new ValidationError("Unknown role key(s)");
      }

      const user = await tx.user.create({
        data: {
          email,
          passwordHash,
          status: UserStatus.ACTIVE,
        },
      });

      await tx.userRole.createMany({
        data: roles.map((r) => ({ userId: user.id, roleId: r.id })),
        skipDuplicates: true,
      });

      return { user, roleKeys: roles.map((r) => r.key) };
    });

    return ok(
      res,
      {
        user: {
          id: created.user.id.toString(),
          email: created.user.email,
          status: created.user.status,
          roles: created.roleKeys,
        },
      },
      201
    );
  })
);

adminRouter.post(
  "/users/from-crm",
  requirePermission("admin.users.write"),
  asyncHandler(async (req: Request, res: Response) => {
    const input = validateCreateUserFromCrmInput(req.body);
    const crmUserId = input.crm_user_id.trim();

    const crmUsers = await fetchCrmUsers();
    const crmUser = crmUsers.find((u) => String(u.id) === crmUserId);
    if (!crmUser) {
      throw new ValidationError("Unknown CRM user id");
    }

    const email = String(crmUser.email || "").trim().toLowerCase();
    if (!email) {
      throw new ValidationError("CRM user has no email");
    }

    const roleKeys = input.role_keys?.length ? input.role_keys : ["viewer"];

    // Fetch CRM groups once (used for team membership + metadata).
    const groups = await fetchCrmGroups({ includeUsers: true });
    const forcedGroupId = input.crm_group_id ? input.crm_group_id.trim() : null;
    const group =
      (forcedGroupId ? groups.find((g) => g.id === forcedGroupId) : null) ||
      groups.find((g) => Array.isArray(g.user_ids) && g.user_ids.includes(crmUserId)) ||
      null;

    const crmGroupId = group ? group.id : null;

    const created = await prisma.$transaction(async (tx) => {
      const roles = await tx.role.findMany({
        where: { key: { in: roleKeys } },
        select: { id: true, key: true },
      });

      if (roles.length !== roleKeys.length) {
        throw new ValidationError("Unknown role key(s)");
      }

      const userByCrm = await tx.user.findUnique({
        where: { crmUserId },
        select: { id: true, email: true, crmUserId: true, status: true, passwordHash: true },
      });
      const userByEmail = await tx.user.findUnique({
        where: { email },
        select: { id: true, email: true, crmUserId: true, status: true, passwordHash: true },
      });

      if (userByCrm && userByEmail && userByCrm.id !== userByEmail.id) {
        throw new ValidationError("CRM user is already linked to a different app user");
      }

      const existing = userByEmail || userByCrm;

      if (existing?.crmUserId && existing.crmUserId !== crmUserId) {
        throw new ValidationError("App user is already linked to a different CRM user");
      }

      const user = existing
        ? await tx.user.update({
            where: { id: existing.id },
            data: {
              ...(existing.email !== email ? { email } : {}),
              crmUserId,
              // Never reset ACTIVE users here.
              ...(existing.status === UserStatus.INVITED ? { passwordHash: null } : {}),
            },
          })
        : await tx.user.create({
            data: {
              email,
              crmUserId,
              status: UserStatus.INVITED,
              passwordHash: null,
            },
          });

      await tx.userRole.deleteMany({ where: { userId: user.id } });
      await tx.userRole.createMany({
        data: roles.map((r) => ({ userId: user.id, roleId: r.id })),
        skipDuplicates: true,
      });

      // Upsert team + membership when we can infer a CRM group id.
      let team: { id: bigint; crmGroupId: string; name: string } | null = null;
      if (crmGroupId) {
        const name = group?.nom || `CRM Group ${crmGroupId}`;

        team = await tx.team.upsert({
          where: { crmGroupId },
          update: {
            name,
            responsable1: group?.responsable_1 ?? null,
            responsable2: group?.responsable_2 ?? null,
            responsable3: group?.responsable_3 ?? null,
          },
          create: {
            crmGroupId,
            name,
            responsable1: group?.responsable_1 ?? null,
            responsable2: group?.responsable_2 ?? null,
            responsable3: group?.responsable_3 ?? null,
          },
          select: { id: true, crmGroupId: true, name: true },
        });

        await tx.userTeam.upsert({
          where: { userId_teamId: { userId: user.id, teamId: team.id } },
          update: {},
          create: { userId: user.id, teamId: team.id },
        });
      }

      let inviteToken: string | null = null;
      if (!user.passwordHash) {
        inviteToken = generateOpaqueToken(48);
        const inviteHash = hashOpaqueToken(inviteToken);

        // Store invite token hash (one-time password setup token)
        await tx.userInviteToken.create({
          data: {
            userId: user.id,
            tokenHash: inviteHash,
            // 7 days
            expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
          },
        });
      }

      return {
        user,
        roles: roles.map((r) => r.key),
        team,
        inviteToken,
      };
    });

    return ok(
      res,
      {
        user: {
          id: created.user.id.toString(),
          email: created.user.email,
          status: created.user.status,
          roles: created.roles,
          crm_user_id: created.user.crmUserId,
        },
        // Back-compat: "team" == CRM "groupe"
        team: created.team
          ? {
              id: created.team.id.toString(),
              crm_group_id: created.team.crmGroupId,
              name: created.team.name,
            }
          : null,
        groupe: created.team
          ? {
              id: created.team.id.toString(),
              crm_group_id: created.team.crmGroupId,
              name: created.team.name,
            }
          : null,
        invite_token: created.inviteToken,
      },
      201,
    );
  }),
);

adminRouter.patch(
  "/users/:userId",
  requirePermission("admin.users.write"),
  asyncHandler(async (req: Request, res: Response) => {
    const userId = parseUserIdParam(req.params.userId);
    const input = validateUpdateUserInput(req.body);

    const existing = await prisma.user.findUnique({ where: { id: userId }, select: { id: true } });
    if (!existing) {throw new NotFoundError("User", req.params.userId);}

    const updated = await prisma.$transaction(async (tx) => {
      const patch: { status?: UserStatus; passwordHash?: string } = {};

      if (input.status) {
        patch.status =
          input.status === "DISABLED"
            ? UserStatus.DISABLED
            : input.status === "INVITED"
              ? UserStatus.INVITED
              : UserStatus.ACTIVE;
      }

      if (input.password) {
        patch.passwordHash = await hashPassword(input.password);
      }

      const user = await tx.user.update({
        where: { id: userId },
        data: patch,
      });

      let roleKeys: string[] | undefined;
      if (input.role_keys) {
        const roles = await tx.role.findMany({
          where: { key: { in: input.role_keys } },
          select: { id: true, key: true },
        });

        if (roles.length !== input.role_keys.length) {
          throw new ValidationError("Unknown role key(s)");
        }

        await tx.userRole.deleteMany({ where: { userId } });
        await tx.userRole.createMany({
          data: roles.map((r) => ({ userId, roleId: r.id })),
          skipDuplicates: true,
        });
        roleKeys = roles.map((r) => r.key);
      }

      const roles = roleKeys
        ? roleKeys
        : (
            await tx.userRole.findMany({
              where: { userId },
              include: { role: true },
            })
          ).map((ur) => ur.role.key);

      return { user, roles };
    });

    return ok(res, {
      user: {
        id: updated.user.id.toString(),
        email: updated.user.email,
        status: updated.user.status,
        roles: updated.roles,
      },
    });
  })
);

adminRouter.get(
  "/crm/users",
  requirePermission("admin.users.read"),
  asyncHandler(async (_req: Request, res: Response) => {
    const crmUsers = await fetchCrmUsers();
    const linked = await prisma.user.findMany({
      select: { id: true, email: true, crmUserId: true, status: true },
    });

    const byCrmId = new Map(linked.filter((u) => u.crmUserId).map((u) => [u.crmUserId as string, u]));
    const byEmail = new Map(linked.map((u) => [u.email, u]));

    return ok(res, {
      utilisateurs: crmUsers.map((u) => {
        const email = String(u.email || "").trim().toLowerCase();
        const existing = byCrmId.get(u.id) || (email ? byEmail.get(email) : undefined);
        return {
          ...u,
          app_user: existing
            ? {
                id: existing.id.toString(),
                email: existing.email,
                status: existing.status,
                crm_user_id: existing.crmUserId,
              }
            : null,
        };
      }),
      count: crmUsers.length,
    });
  }),
);

adminRouter.get(
  "/crm/teams",
  requirePermission("admin.users.read"),
  asyncHandler(async (req: Request, res: Response) => {
    const includeUsers = String(req.query.include_users || "").toLowerCase() === "true";
    const groupes = await fetchCrmGroups({ includeUsers });

    return ok(res, {
      groupes,
      count: groupes.length,
    });
  }),
);

adminRouter.get(
  "/roles",
  requirePermission("admin.roles.read"),
  asyncHandler(async (_req: Request, res: Response) => {
    const roles = await prisma.role.findMany({
      orderBy: { key: "asc" },
      include: { permissions: { include: { permission: true } } },
    });

    return ok(res, {
      roles: roles.map((r) => ({
        id: r.id.toString(),
        key: r.key,
        name: r.name,
        description: r.description,
        permissions: r.permissions
          .filter((rp) => rp.canRead || rp.canWrite)
          .map((rp) => rp.permission.key),
        permission_grants: r.permissions
          .filter((rp) => rp.canRead || rp.canWrite)
          .map((rp) => ({
            key: rp.permission.key,
            read: rp.canRead,
            write: rp.canWrite,
            scope: rp.scope,
          })),
      })),
      count: roles.length,
    });
  })
);

adminRouter.post(
  "/roles",
  requirePermission("admin.roles.write"),
  asyncHandler(async (req: Request, res: Response) => {
    const input = validateCreateRoleInput(req.body);

    const key = input.key.trim();
    const grants = normalizeRolePermissionGrants(input);

    const created = await prisma.$transaction(async (tx) => {
      const role = await tx.role.create({
        data: {
          key,
          name: input.name.trim(),
          description: input.description?.trim() ?? null,
        },
      });

      if (grants.length) {
        const permKeys = grants.map((g) => g.key);
        const perms = await tx.permission.findMany({
          where: { key: { in: permKeys } },
          select: { id: true, key: true },
        });
        if (perms.length !== permKeys.length) {throw new ValidationError("Unknown permission key(s)");}

        const permIdByKey = new Map(perms.map((p) => [p.key, p.id]));
        await tx.rolePermission.createMany({
          data: grants.map((g) => ({
            roleId: role.id,
            permissionId: permIdByKey.get(g.key)!,
            canRead: g.read,
            canWrite: g.write,
            scope: g.scope,
          })),
          skipDuplicates: true,
        });
      }

      const reloaded = await tx.role.findUnique({
        where: { id: role.id },
        include: { permissions: { include: { permission: true } } },
      });

      return reloaded!;
    });

    return ok(
      res,
      {
        role: {
          id: created.id.toString(),
          key: created.key,
          name: created.name,
          description: created.description,
          permissions: created.permissions
            .filter((rp) => rp.canRead || rp.canWrite)
            .map((rp) => rp.permission.key),
          permission_grants: created.permissions
            .filter((rp) => rp.canRead || rp.canWrite)
            .map((rp) => ({
              key: rp.permission.key,
              read: rp.canRead,
              write: rp.canWrite,
              scope: rp.scope,
            })),
        },
      },
      201,
    );
  }),
);

adminRouter.patch(
  "/roles/:roleId",
  requirePermission("admin.roles.write"),
  asyncHandler(async (req: Request, res: Response) => {
    const roleId = parseUserIdParam(req.params.roleId);
    const input = validateUpdateRoleInput(req.body);

    const updated = await prisma.$transaction(async (tx) => {
      const existing = await tx.role.findUnique({ where: { id: roleId }, select: { id: true } });
      if (!existing) {
        throw new NotFoundError("Role", req.params.roleId);
      }

      await tx.role.update({
        where: { id: roleId },
        data: {
          ...(input.name ? { name: input.name.trim() } : {}),
          ...(input.description !== undefined ? { description: input.description } : {}),
        },
      });

      if (input.permission_keys || input.permission_grants) {
        const grants = normalizeRolePermissionGrants(input);
        const permKeys = grants.map((g) => g.key);
        const perms = permKeys.length
          ? await tx.permission.findMany({
              where: { key: { in: permKeys } },
              select: { id: true, key: true },
            })
          : [];
        if (perms.length !== permKeys.length) {throw new ValidationError("Unknown permission key(s)");}

        await tx.rolePermission.deleteMany({ where: { roleId } });
        if (grants.length) {
          const permIdByKey = new Map(perms.map((p) => [p.key, p.id]));
          await tx.rolePermission.createMany({
            data: grants.map((g) => ({
              roleId,
              permissionId: permIdByKey.get(g.key)!,
              canRead: g.read,
              canWrite: g.write,
              scope: g.scope,
            })),
            skipDuplicates: true,
          });
        }
      }

      const reloaded = await tx.role.findUnique({
        where: { id: roleId },
        include: { permissions: { include: { permission: true } } },
      });
      return reloaded!;
    });

    return ok(res, {
      role: {
        id: updated.id.toString(),
        key: updated.key,
        name: updated.name,
        description: updated.description,
        permissions: updated.permissions
          .filter((rp) => rp.canRead || rp.canWrite)
          .map((rp) => rp.permission.key),
        permission_grants: updated.permissions
          .filter((rp) => rp.canRead || rp.canWrite)
          .map((rp) => ({
            key: rp.permission.key,
            read: rp.canRead,
            write: rp.canWrite,
            scope: rp.scope,
          })),
      },
    });
  }),
);

adminRouter.get(
  "/permissions",
  requirePermission("admin.permissions.read"),
  asyncHandler(async (_req: Request, res: Response) => {
    const permissions = await prisma.permission.findMany({
      orderBy: { key: "asc" },
    });

    return ok(res, {
      permissions: permissions.map((p) => ({
        id: p.id.toString(),
        key: p.key,
        description: p.description,
      })),
      count: permissions.length,
    });
  })
);

