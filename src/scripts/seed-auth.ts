/* eslint-disable no-console */
import { UserStatus } from "@prisma/client";

import { hashPassword } from "../shared/password.js";
import { prisma } from "../shared/prisma.js";

async function main() {
  console.log("🔐 Seeding auth roles/permissions...");

  const permissions: Array<{ key: string; description: string }> = [
    { key: "audits.read", description: "Read audits" },
    { key: "audits.run", description: "Run audits" },
    { key: "audits.rerun", description: "Rerun audit steps/control points" },
    { key: "audit-configs.read", description: "Read audit configs" },
    { key: "audit-configs.write", description: "Create/update audit configs" },
    { key: "automation.read", description: "Read automation schedules/runs" },
    { key: "automation.run", description: "Trigger automation runs" },
    { key: "automation.write", description: "Create/update automation schedules" },
    { key: "fiches.read", description: "Read fiches and fiche cache" },
    { key: "fiches.fetch", description: "Trigger fiche fetch/refresh jobs" },
    { key: "recordings.read", description: "Read recordings" },
    { key: "transcriptions.read", description: "Read transcriptions" },
    { key: "products.read", description: "Read insurance products" },
    { key: "products.write", description: "Manage insurance products" },
    { key: "chat.use", description: "Use chat endpoints" },
    { key: "realtime.auth", description: "Authorize realtime (Pusher) subscriptions" },
    { key: "realtime.test", description: "Use realtime test endpoint" },
    { key: "admin.users", description: "Manage users" },
    { key: "admin.roles", description: "Manage roles" },
    { key: "admin.permissions", description: "Manage permissions" },
  ];

  for (const p of permissions) {
    await prisma.permission.upsert({
      where: { key: p.key },
      update: { description: p.description },
      create: { key: p.key, description: p.description },
    });
  }

  const allPermKeys = permissions.map((p) => p.key);
  const roleDefs: Array<{
    key: string;
    name: string;
    description?: string;
    permissionKeys: string[];
  }> = [
    {
      key: "admin",
      name: "Admin",
      description: "Full access",
      permissionKeys: allPermKeys,
    },
    {
      key: "operator",
      name: "Operator",
      description: "Day-to-day operations",
      permissionKeys: [
        "audits.read",
        "audits.run",
        "audits.rerun",
        "audit-configs.read",
        "automation.read",
        "automation.run",
        "fiches.read",
        "fiches.fetch",
        "recordings.read",
        "transcriptions.read",
        "products.read",
        "chat.use",
        "realtime.auth",
        "realtime.test",
      ],
    },
    {
      key: "viewer",
      name: "Viewer",
      description: "Read-only access",
      permissionKeys: [
        "audits.read",
        "audit-configs.read",
        "automation.read",
        "fiches.read",
        "recordings.read",
        "transcriptions.read",
        "products.read",
        "chat.use",
        "realtime.auth",
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

  const dbPerms = await prisma.permission.findMany({
    where: { key: { in: allPermKeys } },
    select: { id: true, key: true },
  });
  const permIdByKey = new Map(dbPerms.map((p) => [p.key, p.id]));

  for (const r of roleDefs) {
    const role = await prisma.role.findUnique({ where: { key: r.key }, select: { id: true } });
    if (!role) {
      continue;
    }

    for (const key of r.permissionKeys) {
      const permissionId = permIdByKey.get(key);
      if (!permissionId) {
        continue;
      }

      await prisma.rolePermission.upsert({
        where: { roleId_permissionId: { roleId: role.id, permissionId } },
        update: {},
        create: { roleId: role.id, permissionId },
      });
    }
  }

  const adminEmail = (process.env.AUTH_SEED_ADMIN_EMAIL || "").trim().toLowerCase();
  const adminPassword = (process.env.AUTH_SEED_ADMIN_PASSWORD || "").trim();
  if (adminEmail && adminPassword) {
    console.log(`👤 Seeding admin user: ${adminEmail}`);
    const passwordHash = await hashPassword(adminPassword);

    const user = await prisma.user.upsert({
      where: { email: adminEmail },
      update: { passwordHash, status: UserStatus.ACTIVE },
      create: { email: adminEmail, passwordHash, status: UserStatus.ACTIVE },
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

