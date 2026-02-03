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
  validateAddTeamMemberInput,
  validateCreateRoleInput,
  validateCreateTeamInput,
  validateCreateUserFromCrmInput,
  validateCreateUserInput,
  validateUpdateRoleInput,
  validateUpdateTeamInput,
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

function parseIdParam(value: string, label: string): bigint {
  try {
    return BigInt(value);
  } catch {
    throw new ValidationError(`Invalid ${label}`);
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

// -----------------------------------------------------------------------------
// Teams (groupes) management (app-side representation used for scope)
// -----------------------------------------------------------------------------

adminRouter.post(
  "/teams/sync-from-crm",
  requirePermission("admin.users.write"),
  asyncHandler(async (req: Request, res: Response) => {
    const syncMembers = String(req.query.sync_members || "").toLowerCase() === "true";
    const crmGroups = await fetchCrmGroups({ includeUsers: syncMembers });

    let teamsUpserted = 0;
    let membersAdded = 0;

    // Small N (dozens). Keep logic simple and deterministic.
    for (const g of crmGroups) {
      const crmGroupId = String(g.id).trim();
      if (!crmGroupId) {continue;}

      const name = String(g.nom || "").trim() || `CRM Group ${crmGroupId}`;

      const team = await prisma.team.upsert({
        where: { crmGroupId },
        update: {
          name,
          responsable1: g.responsable_1 ?? null,
          responsable2: g.responsable_2 ?? null,
          responsable3: g.responsable_3 ?? null,
        },
        create: {
          crmGroupId,
          name,
          responsable1: g.responsable_1 ?? null,
          responsable2: g.responsable_2 ?? null,
          responsable3: g.responsable_3 ?? null,
        },
        select: { id: true, crmGroupId: true },
      });
      teamsUpserted += 1;

      if (syncMembers && Array.isArray(g.user_ids) && g.user_ids.length > 0) {
        const crmUserIds = g.user_ids.map(String).filter(Boolean);
        const users = await prisma.user.findMany({
          where: { crmUserId: { in: crmUserIds } },
          select: { id: true },
        });

        if (users.length > 0) {
          const created = await prisma.userTeam.createMany({
            data: users.map((u) => ({ userId: u.id, teamId: team.id })),
            skipDuplicates: true,
          });
          membersAdded += created.count ?? 0;
        }
      }
    }

    return ok(res, {
      synced: true,
      teams_upserted: teamsUpserted,
      members_added: membersAdded,
      note: syncMembers
        ? "Membership sync only ADDS missing memberships for linked users; it does not remove existing memberships."
        : "Pass ?sync_members=true to also add missing memberships for linked users.",
    });
  }),
);

adminRouter.get(
  "/teams",
  requirePermission("admin.users.read"),
  asyncHandler(async (req: Request, res: Response) => {
    const includeUsers = String(req.query.include_users || "").toLowerCase() === "true";

    if (!includeUsers) {
      const teams = await prisma.team.findMany({
        orderBy: [{ name: "asc" }, { id: "asc" }],
        include: { _count: { select: { members: true } } },
      });

      return ok(res, {
        teams: teams.map((t) => ({
          id: t.id.toString(),
          crm_group_id: t.crmGroupId,
          name: t.name,
          responsable_1: t.responsable1,
          responsable_2: t.responsable2,
          responsable_3: t.responsable3,
          membres_count: t._count.members,
        })),
        count: teams.length,
      });
    }

    const teams = await prisma.team.findMany({
      orderBy: [{ name: "asc" }, { id: "asc" }],
      include: {
        _count: { select: { members: true } },
        members: {
          orderBy: { id: "asc" },
          include: { user: { select: { id: true, email: true, status: true, crmUserId: true } } },
        },
      },
    });

    return ok(res, {
      teams: teams.map((t) => ({
        id: t.id.toString(),
        crm_group_id: t.crmGroupId,
        name: t.name,
        responsable_1: t.responsable1,
        responsable_2: t.responsable2,
        responsable_3: t.responsable3,
        membres_count: t._count.members,
        members: t.members.map((m) => ({
          user_id: m.user.id.toString(),
          email: m.user.email,
          status: m.user.status,
          crm_user_id: m.user.crmUserId,
        })),
        // Convenience: CRM user ids list (mirrors CRM "user_ids" when possible)
        user_ids: t.members.map((m) => m.user.crmUserId).filter((v): v is string => Boolean(v)),
      })),
      count: teams.length,
    });
  }),
);

adminRouter.post(
  "/teams",
  requirePermission("admin.users.write"),
  asyncHandler(async (req: Request, res: Response) => {
    const input = validateCreateTeamInput(req.body);
    const crmGroupId = input.crm_group_id.trim();
    const name = input.name.trim();

    const existing = await prisma.team.findUnique({ where: { crmGroupId }, select: { id: true } });
    const created = await prisma.team.upsert({
      where: { crmGroupId },
      update: {
        name,
        responsable1: input.responsable_1 ?? null,
        responsable2: input.responsable_2 ?? null,
        responsable3: input.responsable_3 ?? null,
      },
      create: {
        crmGroupId,
        name,
        responsable1: input.responsable_1 ?? null,
        responsable2: input.responsable_2 ?? null,
        responsable3: input.responsable_3 ?? null,
      },
      include: { _count: { select: { members: true } } },
    });

    return ok(
      res,
      {
        team: {
          id: created.id.toString(),
          crm_group_id: created.crmGroupId,
          name: created.name,
          responsable_1: created.responsable1,
          responsable_2: created.responsable2,
          responsable_3: created.responsable3,
          membres_count: created._count.members,
        },
      },
      existing ? 200 : 201,
    );
  }),
);

adminRouter.patch(
  "/teams/:teamId",
  requirePermission("admin.users.write"),
  asyncHandler(async (req: Request, res: Response) => {
    const teamId = parseIdParam(req.params.teamId, "team id");
    const input = validateUpdateTeamInput(req.body);

    const existing = await prisma.team.findUnique({ where: { id: teamId }, select: { id: true } });
    if (!existing) {throw new NotFoundError("Team", req.params.teamId);}

    const updated = await prisma.team.update({
      where: { id: teamId },
      data: {
        ...(input.name ? { name: input.name.trim() } : {}),
        ...(input.responsable_1 !== undefined ? { responsable1: input.responsable_1 } : {}),
        ...(input.responsable_2 !== undefined ? { responsable2: input.responsable_2 } : {}),
        ...(input.responsable_3 !== undefined ? { responsable3: input.responsable_3 } : {}),
      },
      include: { _count: { select: { members: true } } },
    });

    return ok(res, {
      team: {
        id: updated.id.toString(),
        crm_group_id: updated.crmGroupId,
        name: updated.name,
        responsable_1: updated.responsable1,
        responsable_2: updated.responsable2,
        responsable_3: updated.responsable3,
        membres_count: updated._count.members,
      },
    });
  }),
);

adminRouter.delete(
  "/teams/:teamId",
  requirePermission("admin.users.write"),
  asyncHandler(async (req: Request, res: Response) => {
    const teamId = parseIdParam(req.params.teamId, "team id");
    const force = String(req.query.force || "").toLowerCase() === "true";

    const existing = await prisma.team.findUnique({
      where: { id: teamId },
      select: { id: true, crmGroupId: true, name: true, _count: { select: { members: true } } },
    });
    if (!existing) {throw new NotFoundError("Team", req.params.teamId);}

    if (!force && existing._count.members > 0) {
      throw new ValidationError("Team has members; remove members first or pass ?force=true");
    }

    await prisma.team.delete({ where: { id: teamId } });

    return ok(res, {
      deleted: true,
      team: {
        id: existing.id.toString(),
        crm_group_id: existing.crmGroupId,
        name: existing.name,
      },
    });
  }),
);

adminRouter.post(
  "/teams/:teamId/members",
  requirePermission("admin.users.write"),
  asyncHandler(async (req: Request, res: Response) => {
    const teamId = parseIdParam(req.params.teamId, "team id");
    const input = validateAddTeamMemberInput(req.body);
    const userId = parseIdParam(input.user_id, "user id");

    const [team, user] = await Promise.all([
      prisma.team.findUnique({ where: { id: teamId }, select: { id: true, crmGroupId: true, name: true } }),
      prisma.user.findUnique({ where: { id: userId }, select: { id: true, email: true, status: true, crmUserId: true } }),
    ]);
    if (!team) {throw new NotFoundError("Team", req.params.teamId);}
    if (!user) {throw new NotFoundError("User", input.user_id);}

    await prisma.userTeam.upsert({
      where: { userId_teamId: { userId, teamId } },
      update: {},
      create: { userId, teamId },
    });

    return ok(res, {
      added: true,
      team: { id: team.id.toString(), crm_group_id: team.crmGroupId, name: team.name },
      user: { id: user.id.toString(), email: user.email, status: user.status, crm_user_id: user.crmUserId },
    });
  }),
);

adminRouter.delete(
  "/teams/:teamId/members/:userId",
  requirePermission("admin.users.write"),
  asyncHandler(async (req: Request, res: Response) => {
    const teamId = parseIdParam(req.params.teamId, "team id");
    const userId = parseIdParam(req.params.userId, "user id");

    // Idempotent removal
    await prisma.userTeam.deleteMany({ where: { userId, teamId } });

    return ok(res, { removed: true });
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

adminRouter.get(
  "/roles/:roleId",
  requirePermission("admin.roles.read"),
  asyncHandler(async (req: Request, res: Response) => {
    const roleId = parseIdParam(req.params.roleId, "role id");

    const role = await prisma.role.findUnique({
      where: { id: roleId },
      include: { permissions: { include: { permission: true } } },
    });
    if (!role) {throw new NotFoundError("Role", req.params.roleId);}

    return ok(res, {
      role: {
        id: role.id.toString(),
        key: role.key,
        name: role.name,
        description: role.description,
        permissions: role.permissions.filter((rp) => rp.canRead || rp.canWrite).map((rp) => rp.permission.key),
        permission_grants: role.permissions
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
    const roleId = parseIdParam(req.params.roleId, "role id");
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

adminRouter.delete(
  "/roles/:roleId",
  requirePermission("admin.roles.write"),
  asyncHandler(async (req: Request, res: Response) => {
    const roleId = parseIdParam(req.params.roleId, "role id");

    const role = await prisma.role.findUnique({
      where: { id: roleId },
      select: { id: true, key: true },
    });
    if (!role) {throw new NotFoundError("Role", req.params.roleId);}

    // Protect baseline roles that are reseeded by `seed:auth` / container startup.
    if (role.key === "admin" || role.key === "operator" || role.key === "viewer") {
      throw new ValidationError("Cannot delete protected role");
    }

    const assigned = await prisma.userRole.count({ where: { roleId } });
    if (assigned > 0) {
      throw new ValidationError(`Role is assigned to ${assigned} user(s); remove it from users first`);
    }

    await prisma.role.delete({ where: { id: roleId } });
    return ok(res, { deleted: true });
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

