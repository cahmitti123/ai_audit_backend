/**
 * Seed Database
 * ==============
 * Seeds audit configurations
 */

import { AuditSeverity } from "@prisma/client";
import { prisma } from "../src/services/database.js";
import "dotenv/config";

async function main() {
  console.log("🌱 Starting database seed...\n");

  // Clear existing data
  console.log("🗑️  Clearing existing data...");
  await prisma.auditStep.deleteMany();
  await prisma.auditConfig.deleteMany();
  console.log("✅ Cleared\n");

  // Import full seed data
  const seedData = await import("../seed.ts");

  console.log("✅ Database seeded successfully!");
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
