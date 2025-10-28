/**
 * API Endpoints Test Script
 * ==========================
 * Tests the audit flow using HTTP API endpoints
 */

import axios from "axios";
import "dotenv/config";

const API_BASE = process.env.API_BASE_URL || "http://localhost:3002";
const FICHE_ID = process.argv[2] || "1762209"; // Known working fiche
const AUDIT_CONFIG_ID = process.argv[3] ? parseInt(process.argv[3]) : 13;

async function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  console.log("\n" + "=".repeat(80));
  console.log("🧪 API ENDPOINTS TEST");
  console.log("=".repeat(80));
  console.log(`\nAPI Base: ${API_BASE}`);
  console.log(`Fiche ID: ${FICHE_ID}`);
  console.log(`Audit Config ID: ${AUDIT_CONFIG_ID}\n`);

  try {
    // 1. Health Check
    console.log("1️⃣ Health Check...");
    const health = await axios.get(`${API_BASE}/health`);
    console.log(`   ✅ Status: ${health.data.status}`);
    console.log(`   ✅ Version: ${health.data.version}\n`);

    // 2. Get Audit Configs
    console.log("2️⃣ List Audit Configurations...");
    const configs = await axios.get(`${API_BASE}/api/audit-configs`);
    console.log(`   ✅ Found ${configs.data.count} configurations`);
    configs.data.data.forEach((config: any) => {
      console.log(
        `      • ${config.name} [ID: ${config.id}] - ${config.stepsCount} steps`
      );
    });
    console.log();

    // 3. Get Fiche Details (with auto-caching)
    console.log("3️⃣ Get Fiche Details...");
    let fiche;
    try {
      fiche = await axios.get(`${API_BASE}/api/fiches/${FICHE_ID}`);
    } catch (err: any) {
      console.log(
        `   ⚠️  Fiche fetch failed: ${err.response?.status || err.message}`
      );
      console.log(`   💡 Trying with cache check instead...\n`);

      const cached = await axios.get(
        `${API_BASE}/api/fiches/${FICHE_ID}/cache`
      );
      if (cached.data.success) {
        console.log(`   ✅ Found in cache: ${cached.data.data.ficheId}`);
        console.log(`   ✅ Recordings: ${cached.data.data.recordingsCount}\n`);
        // Continue with test using cached data
        fiche = { data: { recordings: [] } }; // Placeholder
      } else {
        throw new Error(
          `Fiche ${FICHE_ID} not available (not cached and API failed)`
        );
      }
    }

    if (fiche.data.prospect) {
      console.log(
        `   ✅ Fiche: ${fiche.data.prospect?.prenom} ${fiche.data.prospect?.nom}`
      );
      console.log(`   ✅ Groupe: ${fiche.data.information?.groupe}`);
      console.log(`   ✅ Recordings: ${fiche.data.recordings?.length || 0}\n`);
    }

    // 4. Check Transcription Status
    console.log("4️⃣ Check Transcription Status...");
    const transStatus = await axios.get(
      `${API_BASE}/api/transcriptions/${FICHE_ID}/status`
    );
    console.log(`   ✅ Total: ${transStatus.data.data.total}`);
    console.log(`   ✅ Transcribed: ${transStatus.data.data.transcribed}`);
    console.log(`   ✅ Pending: ${transStatus.data.data.pending}`);
    console.log(`   ✅ Progress: ${transStatus.data.data.percentage}%\n`);

    // 5. Transcribe if needed
    if (transStatus.data.data.pending > 0) {
      console.log("5️⃣ Transcribing Recordings...");
      console.log("   ⏳ This may take a few minutes...");
      const transcribe = await axios.post(
        `${API_BASE}/api/transcriptions/${FICHE_ID}`
      );
      console.log(
        `   ✅ Transcribed: ${transcribe.data.data.newTranscriptions || 0} new`
      );
      console.log(
        `   ✅ Cached: ${transcribe.data.data.transcribed || 0} total\n`
      );
    } else {
      console.log("5️⃣ All recordings already transcribed ✅\n");
    }

    // 6. Queue Audit (Async via Inngest)
    console.log("6️⃣ Queueing Audit via Inngest...");

    const auditResult = await axios.post(`${API_BASE}/api/audits/run`, {
      audit_id: AUDIT_CONFIG_ID,
      fiche_id: FICHE_ID,
    });

    if (auditResult.data.success) {
      console.log(`   ✅ Audit queued successfully`);
      console.log(`   ✅ Event ID: ${auditResult.data.event_id}`);
      console.log(`   ✅ Status: ${auditResult.data.metadata.status}`);
      console.log(`\n   💡 Audit is processing in background via Inngest`);
      console.log(`   💡 Check Inngest Dev Server: http://localhost:8288\n`);
    } else {
      console.log("   ❌ Failed to queue audit!");
      console.log(`      Error: ${auditResult.data.error}`);
    }

    // 7. Get Audit History
    console.log("7️⃣ Get Audit History for Fiche...");
    const history = await axios.get(
      `${API_BASE}/api/audits/by-fiche/${FICHE_ID}`
    );
    console.log(`   ✅ Total Audits: ${history.data.count}`);

    if (history.data.data && history.data.data.length > 0) {
      console.log(`\n   📋 Recent Audits:`);
      history.data.data.slice(0, 3).forEach((audit: any) => {
        console.log(
          `      • ${audit.niveau} (${audit.scorePercentage}%) - ${new Date(
            audit.createdAt
          ).toLocaleString()}`
        );
      });
    }

    console.log("\n" + "=".repeat(80));
    console.log("✅ API TEST COMPLETED");
    console.log("=".repeat(80));
    console.log(`\n💡 Next Steps:`);
    console.log(`   1. Check Inngest Dev Server: http://localhost:8288`);
    console.log(`   2. Monitor the "audit/run" event execution`);
    console.log(`   3. View results in database when complete`);
    console.log(`   4. Or re-run: npm run test:api`);
    console.log("=".repeat(80) + "\n");
  } catch (error: any) {
    console.error("\n" + "=".repeat(80));
    console.error("❌ TEST FAILED");
    console.error("=".repeat(80));

    if (error.response) {
      console.error(`\nHTTP Error ${error.response.status}:`);
      console.error(
        `Message: ${error.response.data?.message || error.response.statusText}`
      );
      if (error.response.data?.error) {
        console.error(`Error: ${error.response.data.error}`);
      }
    } else if (error.request) {
      console.error("\nNo response from server");
      console.error("Make sure the server is running: npm run dev");
    } else {
      console.error(`\nError: ${error.message}`);
    }

    console.error("\n" + "=".repeat(80) + "\n");
    process.exit(1);
  }
}

main();
