/**
 * Test All Audit Endpoints
 * =========================
 * Comprehensive test script for audit API endpoints
 */

const API_BASE_URL = process.env.API_BASE_URL || "http://localhost:3002/api";

interface TestResult {
  endpoint: string;
  method: string;
  status: "✅ PASS" | "❌ FAIL" | "⏭️  SKIP";
  statusCode?: number;
  data?: any;
  error?: string;
  duration?: number;
}

const results: TestResult[] = [];

/**
 * Helper to make API requests
 */
async function apiRequest(
  method: string,
  endpoint: string,
  body?: any
): Promise<{ status: number; data: any }> {
  const startTime = Date.now();
  const url = `${API_BASE_URL}${endpoint}`;

  console.log(`\n${method} ${endpoint}`);

  const options: RequestInit = {
    method,
    headers: {
      "Content-Type": "application/json",
    },
  };

  if (body) {
    options.body = JSON.stringify(body);
  }

  const response = await fetch(url, options);
  const data = await response.json();
  const duration = Date.now() - startTime;

  return { status: response.status, data };
}

/**
 * Test endpoint and record result
 */
async function testEndpoint(
  name: string,
  method: string,
  endpoint: string,
  expectedStatus: number,
  body?: any,
  validator?: (data: any) => boolean
): Promise<void> {
  try {
    const startTime = Date.now();
    const { status, data } = await apiRequest(method, endpoint, body);
    const duration = Date.now() - startTime;

    const isValidStatus = status === expectedStatus;
    const isValidData = validator ? validator(data) : true;
    const testStatus = isValidStatus && isValidData ? "✅ PASS" : "❌ FAIL";

    results.push({
      endpoint: `${method} ${endpoint}`,
      method,
      status: testStatus,
      statusCode: status,
      data,
      duration,
    });

    console.log(`  ${testStatus} - ${status} (${duration}ms)`);

    if (!isValidStatus) {
      console.log(`  Expected: ${expectedStatus}, Got: ${status}`);
    }

    if (validator && !isValidData) {
      console.log(`  ⚠️  Data validation failed`);
    }

    if (data.error) {
      console.log(`  Error: ${data.error}`);
    }
  } catch (error: any) {
    results.push({
      endpoint: `${method} ${endpoint}`,
      method,
      status: "❌ FAIL",
      error: error.message,
    });
    console.log(`  ❌ FAIL - ${error.message}`);
  }
}

/**
 * Main test suite
 */
async function runTests() {
  console.log("=".repeat(80));
  console.log("AUDIT API ENDPOINT TESTS");
  console.log("=".repeat(80));
  console.log(`Base URL: ${API_BASE_URL}`);

  // ============================================================================
  // 1. AUDIT CONFIGS ENDPOINTS
  // ============================================================================
  console.log("\n" + "─".repeat(80));
  console.log("1. AUDIT CONFIGS ENDPOINTS");
  console.log("─".repeat(80));

  // List audit configs
  await testEndpoint(
    "List audit configs",
    "GET",
    "/audit-configs",
    200,
    undefined,
    (data) => data.success && Array.isArray(data.data)
  );

  // List audit configs with steps
  await testEndpoint(
    "List audit configs with steps",
    "GET",
    "/audit-configs?include_steps=true",
    200,
    undefined,
    (data) =>
      data.success &&
      Array.isArray(data.data) &&
      data.data.length > 0 &&
      Array.isArray(data.data[0].steps)
  );

  // Get specific audit config
  await testEndpoint(
    "Get audit config by ID",
    "GET",
    "/audit-configs/13",
    200,
    undefined,
    (data) =>
      data.success && data.data.id === "13" && Array.isArray(data.data.steps)
  );

  // Invalid ID
  await testEndpoint(
    "Get non-existent audit config",
    "GET",
    "/audit-configs/99999",
    404
  );

  // ============================================================================
  // 2. LIST AUDITS ENDPOINT (NEW)
  // ============================================================================
  console.log("\n" + "─".repeat(80));
  console.log("2. LIST AUDITS ENDPOINT");
  console.log("─".repeat(80));

  // List all audits
  await testEndpoint(
    "List all audits",
    "GET",
    "/audits",
    200,
    undefined,
    (data) =>
      data.success &&
      Array.isArray(data.data) &&
      data.pagination &&
      typeof data.pagination.total === "number"
  );

  // List audits with pagination
  await testEndpoint(
    "List audits with pagination",
    "GET",
    "/audits?limit=10&offset=0",
    200,
    undefined,
    (data) => data.success && data.pagination.limit === 10
  );

  // List completed audits
  await testEndpoint(
    "List completed audits",
    "GET",
    "/audits?status=completed",
    200,
    undefined,
    (data) =>
      data.success && data.data.every((a: any) => a.status === "completed")
  );

  // List compliant audits
  await testEndpoint(
    "List compliant audits",
    "GET",
    "/audits?is_compliant=true",
    200,
    undefined,
    (data) =>
      data.success && data.data.every((a: any) => a.is_compliant === true)
  );

  // List audits by date range
  const today = new Date().toISOString().split("T")[0];
  const oneWeekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
    .toISOString()
    .split("T")[0];
  await testEndpoint(
    "List audits by date range",
    "GET",
    `/audits?date_from=${oneWeekAgo}&date_to=${today}`,
    200,
    undefined,
    (data) => data.success
  );

  // List audits sorted by score
  await testEndpoint(
    "List audits sorted by score (desc)",
    "GET",
    "/audits?sort_by=score_percentage&sort_order=desc&limit=10",
    200,
    undefined,
    (data) => {
      if (!data.success || data.data.length < 2) return true;
      const scores = data.data.map((a: any) => parseFloat(a.score_percentage));
      return scores[0] >= scores[1]; // First should be >= second
    }
  );

  // List audits for specific fiche
  await testEndpoint(
    "List audits for specific fiche",
    "GET",
    "/audits?fiche_ids=1759940",
    200,
    undefined,
    (data) =>
      data.success &&
      data.data.every((a: any) => a.fiche_cache.fiche_id === "1759940")
  );

  // ============================================================================
  // 3. AUDIT BY FICHE ENDPOINTS
  // ============================================================================
  console.log("\n" + "─".repeat(80));
  console.log("3. AUDIT BY FICHE ENDPOINTS");
  console.log("─".repeat(80));

  // Get audits for fiche
  await testEndpoint(
    "Get audits by fiche",
    "GET",
    "/audits/by-fiche/1759940",
    200,
    undefined,
    (data) => data.success && Array.isArray(data.data)
  );

  // Get audits with details
  await testEndpoint(
    "Get audits by fiche with details",
    "GET",
    "/audits/by-fiche/1759940?include_details=true",
    200,
    undefined,
    (data) => {
      if (!data.success || !data.data[0]) return true;
      return Array.isArray(data.data[0].step_results);
    }
  );

  // Non-existent fiche
  await testEndpoint(
    "Get audits for non-existent fiche",
    "GET",
    "/audits/by-fiche/99999999",
    200,
    undefined,
    (data) => data.success && data.data.length === 0
  );

  // ============================================================================
  // 4. GET AUDIT DETAILS
  // ============================================================================
  console.log("\n" + "─".repeat(80));
  console.log("4. GET AUDIT DETAILS");
  console.log("─".repeat(80));

  // Get latest audit ID first
  const { data: auditsList } = await apiRequest(
    "GET",
    "/audits?limit=1&sort_by=created_at&sort_order=desc"
  );

  if (auditsList.success && auditsList.data.length > 0) {
    const latestAuditId = auditsList.data[0].id;

    await testEndpoint(
      "Get audit details",
      "GET",
      `/audits/${latestAuditId}`,
      200,
      undefined,
      (data) => {
        if (!data.success) return false;
        const audit = data.data;
        return (
          audit.id === latestAuditId &&
          Array.isArray(audit.step_results) &&
          audit.fiche_cache &&
          audit.audit_config
        );
      }
    );

    // Check if citations have proper metadata
    const { data: detailedAudit } = await apiRequest(
      "GET",
      `/audits/${latestAuditId}`
    );

    if (detailedAudit.success) {
      console.log("\n  📊 Checking citation metadata...");
      const audit = detailedAudit.data;
      let totalCitations = 0;
      let citationsWithNA = 0;
      let citationsWithURL = 0;

      for (const stepResult of audit.step_results || []) {
        for (const cp of stepResult.control_points || []) {
          for (const citation of cp.citations || []) {
            totalCitations++;
            if (
              citation.recording_date === "N/A" ||
              citation.recording_time === "N/A"
            ) {
              citationsWithNA++;
            }
            if (citation.recording_url && citation.recording_url.length > 0) {
              citationsWithURL++;
            }
          }
        }
      }

      console.log(`     Total citations: ${totalCitations}`);
      console.log(`     Citations with N/A: ${citationsWithNA}`);
      console.log(`     Citations with URL: ${citationsWithURL}`);

      if (totalCitations > 0 && citationsWithNA > 0) {
        console.log(
          `     ⚠️  Warning: ${citationsWithNA}/${totalCitations} citations have N/A metadata`
        );
      } else if (totalCitations > 0) {
        console.log(`     ✅ All citations have proper date/time metadata`);
      }

      if (totalCitations > 0 && citationsWithURL === totalCitations) {
        console.log(`     ✅ All citations have recording URLs`);
      } else if (totalCitations > 0 && citationsWithURL > 0) {
        console.log(
          `     ⚠️  Warning: ${citationsWithURL}/${totalCitations} citations have URLs`
        );
      }
    }
  } else {
    console.log("  ⏭️  SKIP - No audits found to test with");
  }

  // Non-existent audit
  await testEndpoint("Get non-existent audit", "GET", "/audits/99999999", 404);

  // ============================================================================
  // 5. RUN AUDIT (ASYNC)
  // ============================================================================
  console.log("\n" + "─".repeat(80));
  console.log("5. RUN AUDIT ENDPOINTS");
  console.log("─".repeat(80));

  // Test run audit endpoint
  await testEndpoint(
    "Queue audit run",
    "POST",
    "/audits/run",
    200,
    {
      audit_id: 13,
      fiche_id: "1759940",
      user_id: "test_user",
    },
    (data) => data.success && data.event_id && data.message.includes("queued")
  );

  // Test run latest audit
  await testEndpoint(
    "Queue audit with latest config",
    "POST",
    "/audits/run-latest",
    200,
    {
      fiche_id: "1759940",
    },
    (data) =>
      data.success && data.event_id && data.audit_config_name && data.message
  );

  // Test batch audit
  await testEndpoint(
    "Queue batch audit",
    "POST",
    "/audits/batch",
    200,
    {
      fiche_ids: ["1759940"],
      audit_config_id: 13,
    },
    (data) => data.success && data.batch_id && Array.isArray(data.event_ids)
  );

  // ============================================================================
  // SUMMARY
  // ============================================================================
  console.log("\n" + "=".repeat(80));
  console.log("TEST SUMMARY");
  console.log("=".repeat(80));

  const passed = results.filter((r) => r.status === "✅ PASS").length;
  const failed = results.filter((r) => r.status === "❌ FAIL").length;
  const skipped = results.filter((r) => r.status === "⏭️  SKIP").length;
  const total = results.length;

  console.log(`\nTotal Tests: ${total}`);
  console.log(`  ✅ Passed: ${passed}`);
  console.log(`  ❌ Failed: ${failed}`);
  console.log(`  ⏭️  Skipped: ${skipped}`);
  console.log(`\nSuccess Rate: ${((passed / total) * 100).toFixed(1)}%`);

  if (failed > 0) {
    console.log("\n❌ FAILED TESTS:");
    results
      .filter((r) => r.status === "❌ FAIL")
      .forEach((r) => {
        console.log(`  - ${r.endpoint}`);
        if (r.error) console.log(`    Error: ${r.error}`);
        if (r.data?.error) console.log(`    API Error: ${r.data.error}`);
      });
  }

  console.log("\n" + "=".repeat(80) + "\n");

  // Exit with appropriate code
  process.exit(failed > 0 ? 1 : 0);
}

// Run tests
runTests().catch((error) => {
  console.error("\n❌ Test suite error:", error);
  process.exit(1);
});
