/**
 * Test Fiche Script
 * ==================
 * Tests complete audit flow for a specific fiche
 */

import "dotenv/config";
import { runAudit } from "../src/modules/audits/audits.runner.js";
import { disconnectDb } from "../src/shared/prisma.js";

const FICHE_ID = process.argv[2] || "1762209"; // Known working fiche
const AUDIT_CONFIG_ID = process.argv[3] ? parseInt(process.argv[3]) : undefined;

async function main() {
  console.log("\n" + "=".repeat(80));
  console.log("🧪 TEST FICHE AUDIT");
  console.log("=".repeat(80));
  console.log(`\nFiche ID: ${FICHE_ID}`);
  console.log(`Audit Config: ${AUDIT_CONFIG_ID || "Latest Active Config"}\n`);

  try {
    const result = await runAudit({
      ficheId: FICHE_ID,
      auditConfigId: AUDIT_CONFIG_ID,
      useLatest: !AUDIT_CONFIG_ID,
      saveToFile: true,
    });

    console.log("\n" + "=".repeat(80));
    console.log("✅ AUDIT COMPLETED SUCCESSFULLY");
    console.log("=".repeat(80));
    console.log(`\n📊 Results:`);
    console.log(`   Config: ${result.audit.config.name}`);
    console.log(`   Fiche: ${result.audit.fiche.fiche_id}`);
    console.log(`   Prospect: ${result.audit.fiche.prospect_name}`);
    console.log(`   Score: ${result.audit.compliance.score}%`);
    console.log(`   Niveau: ${result.audit.compliance.niveau}`);
    console.log(
      `   Points Critiques: ${result.audit.compliance.points_critiques}`
    );
    console.log(`\n📈 Statistics:`);
    console.log(`   Recordings: ${result.statistics.recordings_count}`);
    console.log(`   Successful Steps: ${result.statistics.successful_steps}`);
    console.log(`   Failed Steps: ${result.statistics.failed_steps}`);
    console.log(
      `   Total Tokens: ${result.statistics.total_tokens.toLocaleString()}`
    );
    console.log(
      `   Duration: ${(result.metadata.duration_ms / 1000).toFixed(1)}s`
    );
    console.log(`\n   Audit ID: ${result.audit.id}`);
    console.log("=".repeat(80) + "\n");
  } catch (error: any) {
    console.error("\n" + "=".repeat(80));
    console.error("❌ AUDIT FAILED");
    console.error("=".repeat(80));
    console.error(`\nError: ${error.message}`);
    if (error.stack) {
      console.error(`\nStack Trace:\n${error.stack}`);
    }
    console.error("\n" + "=".repeat(80) + "\n");
    process.exit(1);
  } finally {
    await disconnectDb();
  }
}

main();
