/**
 * Test API Script (Node.js)
 * ==========================
 * Quick script to test the API endpoints with Node.js
 */

const API_URL = "http://localhost:3000";

async function testAPI() {
  console.log("================================");
  console.log("AI Audit System - API Test");
  console.log("================================\n");

  try {
    // 1. Health Check
    console.log("1. Health Check...");
    const health = await fetch(`${API_URL}/health`).then((r) => r.json());
    console.log(`   ✓ Status: ${health.status}`);
    console.log(`   ✓ Version: ${health.version}\n`);

    // 2. List Audit Configs
    console.log("2. List Audit Configurations...");
    const configs = await fetch(`${API_URL}/api/audit-configs`).then((r) =>
      r.json()
    );
    console.log(`   ✓ Found ${configs.count} configurations:`);
    configs.data.forEach((config) => {
      console.log(
        `      - ${config.name} (${config.stepsCount} steps) [ID: ${config.id}]`
      );
    });
    console.log();

    // 3. Get Specific Config
    const configId = configs.data[0].id;
    console.log(`3. Get Config Details (ID=${configId})...`);
    const configDetails = await fetch(
      `${API_URL}/api/audit-configs/${configId}`
    ).then((r) => r.json());
    console.log(`   ✓ Name: ${configDetails.data.name}`);
    console.log(`   ✓ Steps: ${configDetails.data.steps.length}\n`);

    // 4. Run Audit
    console.log("4. Running Audit...");
    console.log(`   Config ID: ${configId}`);
    console.log(`   Fiche ID: 1762209`);
    console.log("   This will take 30-120 seconds...\n");

    const startTime = Date.now();

    const auditResult = await fetch(`${API_URL}/api/audit/run`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        audit_id: parseInt(configId),
        fiche_id: "1762209",
      }),
    }).then((r) => r.json());

    const duration = ((Date.now() - startTime) / 1000).toFixed(1);

    if (auditResult.success) {
      console.log("   ✅ Audit Complete!\n");
      console.log("   Results:");
      console.log(`      Config: ${auditResult.data.audit.config.name}`);
      console.log(
        `      Prospect: ${auditResult.data.audit.fiche.prospect_name}`
      );
      console.log(`      Score: ${auditResult.data.audit.compliance.score}%`);
      console.log(`      Niveau: ${auditResult.data.audit.compliance.niveau}`);
      console.log(
        `      Points Critiques: ${auditResult.data.audit.compliance.points_critiques}`
      );
      console.log();
      console.log("   Statistics:");
      console.log(
        `      Recordings: ${auditResult.data.statistics.recordings_count}`
      );
      console.log(
        `      Steps Analyzed: ${auditResult.data.statistics.successful_steps}`
      );
      console.log(
        `      Tokens Used: ${auditResult.data.statistics.total_tokens.toLocaleString()}`
      );
      console.log(`      Duration: ${duration}s`);
    } else {
      console.log("   ❌ Audit Failed!");
      console.log(`      Error: ${auditResult.error}`);
      console.log(`      Message: ${auditResult.message}`);
    }

    console.log("\n================================");
    console.log("Test Complete!");
    console.log("================================");
  } catch (error) {
    console.error("\n❌ Error:", error.message);
    console.log("\nMake sure the server is running:");
    console.log("  npm start\n");
  }
}

// Run the test
testAPI();
