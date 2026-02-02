/**
 * Admin Routes
 * ============
 * Minimal RBAC admin endpoints (users / roles / permissions).
 */

import { UserStatus } from "@prisma/client";
import { type Request, type Response, Router } from "express";

import { asyncHandler } from "../../middleware/async-handler.js";
import { requirePermission } from "../../middleware/authz.js";
import { NotFoundError, ValidationError } from "../../shared/errors.js";
import { ok } from "../../shared/http.js";
import { hashPassword } from "../../shared/password.js";
import { prisma } from "../../shared/prisma.js";
import { validateCreateUserInput, validateUpdateUserInput } from "./admin.schemas.js";

export const adminRouter = Router();

function parseUserIdParam(value: string): bigint {
  try {
    return BigInt(value);
  } catch {
    throw new ValidationError("Invalid user id");
  }
}

adminRouter.get(
  "/users",
  requirePermission("admin.users"),
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
  requirePermission("admin.users"),
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

adminRouter.patch(
  "/users/:userId",
  requirePermission("admin.users"),
  asyncHandler(async (req: Request, res: Response) => {
    const userId = parseUserIdParam(req.params.userId);
    const input = validateUpdateUserInput(req.body);

    const existing = await prisma.user.findUnique({ where: { id: userId }, select: { id: true } });
    if (!existing) {throw new NotFoundError("User", req.params.userId);}

    const updated = await prisma.$transaction(async (tx) => {
      const patch: { status?: UserStatus; passwordHash?: string } = {};

      if (input.status) {
        patch.status = input.status === "DISABLED" ? UserStatus.DISABLED : UserStatus.ACTIVE;
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
  "/roles",
  requirePermission("admin.roles"),
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
        permissions: r.permissions.map((rp) => rp.permission.key),
      })),
      count: roles.length,
    });
  })
);

adminRouter.get(
  "/permissions",
  requirePermission("admin.permissions"),
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

