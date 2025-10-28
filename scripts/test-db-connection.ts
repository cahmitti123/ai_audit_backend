/**
 * Test Database Connection Script
 * ================================
 * Tests connection to the audit config database
 */

import "dotenv/config";
import { prisma, disconnectDb } from "../src/shared/prisma.js";
import { getLatestActiveConfig } from "../src/modules/audit-configs/audit-configs.repository.js";

async function main() {
  console.log("\n" + "=".repeat(80));
  console.log("TEST AUDIT CONFIG DATABASE CONNECTION");
  console.log("=".repeat(80) + "\n");

  // Test connection
  console.log("🔌 Testing database connection...\n");
  try {
    await prisma.$connect();
    console.log("✓ Database connected successfully\n");
  } catch (error) {
    console.error("\n❌ Failed to connect to database");
    console.error("Check your DATABASE_URL in .env file");
    console.error(error);
    process.exit(1);
  }

  // Fetch latest config
  console.log("\n📋 Fetching latest audit configuration...\n");
  try {
    const config = await getLatestActiveConfig();

    if (!config) {
      console.error("❌ No active audit configuration found");
      process.exit(1);
    }

    console.log("✓ Successfully fetched audit config:");
    console.log(`  • ID: ${config.id}`);
    console.log(`  • Name: ${config.name}`);
    console.log(`  • Description: ${config.description || "N/A"}`);
    console.log(`  • Steps: ${config.steps.length}`);

    console.log("\n📊 Audit Steps:");
    config.steps.forEach((step, index) => {
      console.log(
        `  ${index + 1}. ${step.name} (${step.severityLevel}${
          step.isCritical ? " - CRITICAL" : ""
        })`
      );
    });

    console.log("\n" + "=".repeat(80));
    console.log("✅ ALL TESTS PASSED");
    console.log("=".repeat(80) + "\n");
  } catch (error) {
    console.error("\n❌ Error fetching audit config:", error);
    process.exit(1);
  } finally {
    await disconnectDb();
  }
}

main().catch(async (error) => {
  console.error("\n❌ Test failed:", error);
  await disconnectDb();
  process.exit(1);
});
