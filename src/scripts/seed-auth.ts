/* eslint-disable no-console */
import { UserStatus } from "@prisma/client";

import { hashPassword } from "../shared/password.js";
import { prisma } from "../shared/prisma.js";

async function main() {
  console.log("🔐 Seeding auth roles/permissions...");

  // Base permissions (read/write + scope are set on role_permissions)
  const permissions: Array<{ key: string; description: string }> = [
    { key: "fiches", description: "Sales / fiches access" },
    { key: "audits", description: "Audits access" },
    { key: "audit-configs", description: "Audit configs access" },
    { key: "automation", description: "Automation schedules/runs access" },
    { key: "recordings", description: "Recordings access" },
    { key: "transcriptions", description: "Transcriptions access" },
    { key: "products", description: "Products access" },
    { key: "chat", description: "Chat access" },
    { key: "realtime", description: "Realtime (Pusher) access" },
    { key: "admin.users", description: "User management" },
    { key: "admin.roles", description: "Role management" },
    { key: "admin.permissions", description: "Permission management" },
  ];

  for (const p of permissions) {
    await prisma.permission.upsert({
      where: { key: p.key },
      update: { description: p.description },
      create: { key: p.key, description: p.description },
    });
  }

  type PermissionGrant = {
    key: string;
    read: boolean;
    write: boolean;
    scope: "SELF" | "GROUP" | "ALL";
  };

  const roleDefs: Array<{
    key: string;
    name: string;
    description?: string;
    grants: PermissionGrant[];
  }> = [
    {
      key: "admin",
      name: "Admin",
      description: "Full access",
      grants: permissions.map((p) => ({ key: p.key, read: true, write: true, scope: "ALL" })),
    },
    {
      key: "operator",
      name: "Operator",
      description: "Day-to-day operations",
      grants: [
        { key: "fiches", read: true, write: true, scope: "GROUP" },
        { key: "audits", read: true, write: true, scope: "GROUP" },
        { key: "audit-configs", read: true, write: false, scope: "ALL" },
        { key: "automation", read: true, write: true, scope: "GROUP" },
        { key: "recordings", read: true, write: false, scope: "GROUP" },
        { key: "transcriptions", read: true, write: true, scope: "GROUP" },
        { key: "products", read: true, write: false, scope: "ALL" },
        { key: "chat", read: true, write: true, scope: "GROUP" },
        { key: "realtime", read: true, write: true, scope: "GROUP" },
      ],
    },
    {
      key: "viewer",
      name: "Viewer",
      description: "Read-only access",
      grants: [
        { key: "fiches", read: true, write: false, scope: "GROUP" },
        { key: "audits", read: true, write: false, scope: "GROUP" },
        { key: "audit-configs", read: true, write: false, scope: "ALL" },
        { key: "automation", read: true, write: false, scope: "GROUP" },
        { key: "recordings", read: true, write: false, scope: "GROUP" },
        { key: "transcriptions", read: true, write: false, scope: "GROUP" },
        { key: "products", read: true, write: false, scope: "ALL" },
        { key: "chat", read: true, write: true, scope: "GROUP" },
        { key: "realtime", read: true, write: false, scope: "GROUP" },
      ],
    },
  ];

  for (const r of roleDefs) {
    await prisma.role.upsert({
      where: { key: r.key },
      update: { name: r.name, description: r.description ?? null },
      create: { key: r.key, name: r.name, description: r.description ?? null },
    });
  }

  for (const r of roleDefs) {
    const role = await prisma.role.findUnique({ where: { key: r.key }, select: { id: true } });
    if (!role) {continue;}

    // Don't override dynamic RBAC if the role already has any active grants.
    const existingGrants = await prisma.rolePermission.count({
      where: {
        roleId: role.id,
        OR: [{ canRead: true }, { canWrite: true }],
      },
    });
    if (existingGrants > 0) {
      console.log(`ℹ️ Skipping RBAC grants for role '${r.key}' (already configured)`);
      continue;
    }

    const keys = r.grants.map((g) => g.key);
    const dbPerms = await prisma.permission.findMany({
      where: { key: { in: keys } },
      select: { id: true, key: true },
    });
    const permIdByKey = new Map(dbPerms.map((p) => [p.key, p.id]));

    for (const g of r.grants) {
      const permissionId = permIdByKey.get(g.key);
      if (!permissionId) {continue;}

      await prisma.rolePermission.upsert({
        where: { roleId_permissionId: { roleId: role.id, permissionId } },
        update: {
          canRead: g.read,
          canWrite: g.write,
          scope: g.scope,
        },
        create: {
          roleId: role.id,
          permissionId,
          canRead: g.read,
          canWrite: g.write,
          scope: g.scope,
        },
      });
    }
  }

  const adminEmail = (process.env.AUTH_SEED_ADMIN_EMAIL || "").trim().toLowerCase();
  const adminPassword = (process.env.AUTH_SEED_ADMIN_PASSWORD || "").trim();
  if (adminEmail && adminPassword) {
    console.log(`👤 Seeding admin user: ${adminEmail}`);
    const existing = await prisma.user.findUnique({ where: { email: adminEmail }, select: { id: true } });
    const user = existing
      ? await prisma.user.findUniqueOrThrow({ where: { id: existing.id }, select: { id: true } })
      : await prisma.user.create({
          data: {
            email: adminEmail,
            passwordHash: await hashPassword(adminPassword),
            status: UserStatus.ACTIVE,
          },
          select: { id: true },
        });

    const adminRole = await prisma.role.findUnique({ where: { key: "admin" }, select: { id: true } });
    if (adminRole) {
      await prisma.userRole.upsert({
        where: { userId_roleId: { userId: user.id, roleId: adminRole.id } },
        update: {},
        create: { userId: user.id, roleId: adminRole.id },
      });
    }
  } else {
    console.log("ℹ️ Skipping admin user seed (set AUTH_SEED_ADMIN_EMAIL + AUTH_SEED_ADMIN_PASSWORD)");
  }

  console.log("✅ Auth seed complete.");
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (err) => {
    console.error("❌ Auth seed failed:", err);
    await prisma.$disconnect();
    process.exit(1);
  });

