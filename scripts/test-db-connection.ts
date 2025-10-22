/**
 * Test Database Connection Script
 * ================================
 * Tests connection to the audit config database
 */

import "dotenv/config";
import {
  testAuditConfigConnection,
  fetchLatestAuditConfig,
  disconnectAuditConfigDb,
} from "../src/services/audit-config.js";

async function main() {
  console.log("\n" + "=".repeat(80));
  console.log("TEST AUDIT CONFIG DATABASE CONNECTION");
  console.log("=".repeat(80) + "\n");

  // Test connection
  console.log("🔌 Testing database connection...\n");
  const connected = await testAuditConfigConnection();

  if (!connected) {
    console.error("\n❌ Failed to connect to audit config database");
    console.error("Check your DATABASE_URL in .env file");
    process.exit(1);
  }

  // Fetch latest config
  console.log("\n📋 Fetching latest audit configuration...\n");
  try {
    const config = await fetchLatestAuditConfig();

    console.log("✓ Successfully fetched audit config:");
    console.log(`  • ID: ${config.id}`);
    console.log(`  • Name: ${config.name}`);
    console.log(`  • Description: ${config.description || "N/A"}`);
    console.log(`  • Steps: ${config.auditSteps.length}`);

    console.log("\n📊 Audit Steps:");
    config.auditSteps.forEach((step, index) => {
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
    await disconnectAuditConfigDb();
  }
}

main().catch(async (error) => {
  console.error("\n❌ Test failed:", error);
  await disconnectAuditConfigDb();
  process.exit(1);
});
