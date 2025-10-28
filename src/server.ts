/**
 * Server Entry Point
 * ==================
 * Starts the Express server
 */

import { createApp } from "./app.js";
import { disconnectDb } from "./shared/prisma.js";

const app = createApp();
const PORT = process.env.PORT || 3000;

// Graceful shutdown
process.on("SIGTERM", async () => {
  console.log("\n🛑 SIGTERM received, closing server...");
  await disconnectDb();
  process.exit(0);
});

process.on("SIGINT", async () => {
  console.log("\n🛑 SIGINT received, closing server...");
  await disconnectDb();
  process.exit(0);
});

// Start server
app.listen(PORT, () => {
  console.log("\n" + "=".repeat(80));
  console.log(`🚀 AI Audit API Server`);
  console.log("=".repeat(80));
  console.log(`📡 Server running on http://localhost:${PORT}`);
  console.log(`🏥 Health check: http://localhost:${PORT}/health`);
  console.log(`📚 Swagger UI: http://localhost:${PORT}/api-docs`);
  console.log(`📋 API Docs JSON: http://localhost:${PORT}/api-docs.json`);
  console.log(`⚡ Inngest endpoint: http://localhost:${PORT}/api/inngest`);
  console.log("=".repeat(80) + "\n");
});

export default app;
