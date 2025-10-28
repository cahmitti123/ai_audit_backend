/**
 * Trigger Inngest Test Event
 * ===========================
 * Sends a test event directly to Inngest to verify workflow execution
 */

import { inngest } from "../src/inngest/client.js";
import "dotenv/config";

const FICHE_ID = process.argv[2] || "1762209";
const AUDIT_CONFIG_ID = process.argv[3] ? parseInt(process.argv[3]) : 13;

async function main() {
  console.log("\n" + "=".repeat(80));
  console.log("🧪 TRIGGER INNGEST TEST EVENT");
  console.log("=".repeat(80));
  console.log(`\nFiche ID: ${FICHE_ID}`);
  console.log(`Audit Config ID: ${AUDIT_CONFIG_ID}`);
  console.log(`\nSending event to Inngest...\n`);

  try {
    const { ids } = await inngest.send({
      name: "audit/run",
      data: {
        fiche_id: FICHE_ID,
        audit_config_id: AUDIT_CONFIG_ID,
      },
      id: `test-audit-${FICHE_ID}-${AUDIT_CONFIG_ID}-${Date.now()}`,
    });

    console.log("✅ Event sent successfully!");
    console.log(`Event ID: ${ids[0]}\n`);
    console.log("=".repeat(80));
    console.log("📊 NEXT STEPS");
    console.log("=".repeat(80));
    console.log(`\n1. Open Inngest Dev Server: http://localhost:8288`);
    console.log(`2. Click on "Runs" tab`);
    console.log(`3. You should see "Run AI Audit" function executing`);
    console.log(`4. Click on the run to see detailed step-by-step execution`);
    console.log(`\nExpected steps to see:`);
    console.log(`   • ensure-fiche`);
    console.log(`   • check-transcription-status`);
    console.log(`   • load-audit-config`);
    console.log(`   • generate-timeline`);
    console.log(`   • analyze-step-1 (parallel)`);
    console.log(`   • analyze-step-2 (parallel)`);
    console.log(`   • analyze-step-3 (parallel)`);
    console.log(`   • analyze-step-4 (parallel)`);
    console.log(`   • analyze-step-5 (parallel)`);
    console.log(`   • calculate-compliance`);
    console.log(`   • save-audit-results`);
    console.log(`   • emit-completion`);
    console.log("\n" + "=".repeat(80) + "\n");
  } catch (error: any) {
    console.error("\n❌ Failed to send event");
    console.error(`Error: ${error.message}`);
    console.error("\nMake sure:");
    console.error("  1. Server is running: npm run dev");
    console.error("  2. Inngest dev server is running: npm run inngest\n");
    process.exit(1);
  }
}

main();
