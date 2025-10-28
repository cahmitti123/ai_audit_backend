/**
 * Test Product Verification System
 * ==================================
 * Tests the vector store integration for product information verification
 */

import "dotenv/config";
import {
  searchVectorStore,
  getProductVerificationContext,
  formatVerificationContextForPrompt,
} from "../src/modules/audits/audits.vector-store.js";

async function testVectorStoreSearch() {
  console.log("═══════════════════════════════════════════════════════");
  console.log("Test 1: Basic Vector Store Search");
  console.log("═══════════════════════════════════════════════════════\n");

  const query =
    "Quelles sont les garanties pour l'hospitalisation en chambre particulière?";

  const results = await searchVectorStore(query, 3);

  console.log(`\n✅ Results found: ${results.length}\n`);

  for (const result of results) {
    console.log("─────────────────────────────────────────────────");
    console.log(`📄 Source: ${result.file_name || "Unknown"}`);
    console.log(`📝 Content: ${result.content.substring(0, 200)}...`);
    if (result.metadata) {
      console.log(`🔍 Metadata:`, result.metadata);
    }
    console.log();
  }
}

async function testProductVerificationContext() {
  console.log("\n═══════════════════════════════════════════════════════");
  console.log("Test 2: Product Verification Context");
  console.log("═══════════════════════════════════════════════════════\n");

  // Simulate an audit step with product verification enabled
  const testStep = {
    position: 13,
    name: "Devoir de conseil (garanties détaillées)",
    verifyProductInfo: true,
    controlPoints: [
      "Garanties hospitalisation expliquées",
      "Garanties dentaire détaillées",
      "Garanties optique présentées",
    ],
    keywords: [
      "garanties",
      "hospitalisation",
      "dentaire",
      "optique",
      "remboursement",
    ],
  };

  console.log("Step configuration:");
  console.log(JSON.stringify(testStep, null, 2));
  console.log("\nFetching verification context...\n");

  const contexts = await getProductVerificationContext(testStep);

  console.log(`\n✅ Contexts retrieved: ${contexts.length}\n`);

  for (const context of contexts) {
    console.log("─────────────────────────────────────────────────");
    console.log(`📋 Checkpoint: ${context.checkpointName}`);
    console.log(`🔍 Search Query: ${context.searchQuery}`);
    console.log(
      `📄 Documents Found: ${context.relevantDocumentation.length}\n`
    );

    for (const doc of context.relevantDocumentation) {
      console.log(`  • Source: ${doc.file_name || "Unknown"}`);
      console.log(`  • Preview: ${doc.content.substring(0, 150)}...\n`);
    }
  }
}

async function testFormattedPromptContext() {
  console.log("\n═══════════════════════════════════════════════════════");
  console.log("Test 3: Formatted Prompt Context");
  console.log("═══════════════════════════════════════════════════════\n");

  const testStep = {
    position: 14,
    name: "Explication RAC0 (100% Santé)",
    verifyProductInfo: true,
    controlPoints: [
      "Concept 100% Santé/RAC0 expliqué",
      "Optique RAC0 mentionné",
    ],
    keywords: ["100% Santé", "RAC0", "reste à charge zéro"],
  };

  console.log("Fetching and formatting context...\n");

  const contexts = await getProductVerificationContext(testStep);
  const formattedContext = formatVerificationContextForPrompt(contexts);

  console.log("─────────────────────────────────────────────────");
  console.log("Formatted Context for Prompt:");
  console.log("─────────────────────────────────────────────────\n");
  console.log(formattedContext);
}

async function testErrorHandling() {
  console.log("\n═══════════════════════════════════════════════════════");
  console.log("Test 4: Error Handling");
  console.log("═══════════════════════════════════════════════════════\n");

  // Test with empty query
  console.log("Testing with empty query...");
  const emptyResults = await searchVectorStore("", 1);
  console.log(`✅ Empty query handled: ${emptyResults.length} results\n`);

  // Test with very specific query
  console.log("Testing with very specific query...");
  const specificResults = await searchVectorStore(
    "Plafond remboursement implant dentaire formule excellence 2025",
    2
  );
  console.log(`✅ Specific query: ${specificResults.length} results\n`);
}

async function main() {
  console.log("\n🧪 Starting Product Verification System Tests\n");

  // Check environment variables
  if (!process.env.OPENAI_API_KEY) {
    console.error("❌ Error: OPENAI_API_KEY not found in environment");
    console.error("Please set OPENAI_API_KEY in your .env file");
    process.exit(1);
  }

  if (!process.env.VECTOR_STORE_ID) {
    console.warn("⚠️  Warning: VECTOR_STORE_ID not set, using default value");
  }

  console.log("✅ Environment configured");
  console.log(
    `📁 Vector Store ID: ${process.env.VECTOR_STORE_ID || "default"}`
  );
  console.log(
    `🔢 Max Results: ${process.env.VECTOR_STORE_MAX_RESULTS || "5"}\n`
  );

  try {
    // Run all tests
    await testVectorStoreSearch();
    await testProductVerificationContext();
    await testFormattedPromptContext();
    await testErrorHandling();

    console.log("\n═══════════════════════════════════════════════════════");
    console.log("✅ All Tests Completed Successfully!");
    console.log("═══════════════════════════════════════════════════════\n");
  } catch (error) {
    console.error("\n❌ Test failed with error:");
    console.error(error);
    process.exit(1);
  }
}

main();
