/**
 * Server Entry Point
 * ==================
 * Starts the Express server
 */

import { createApp } from "./app.js";
import { logger } from "./shared/logger.js";
import { disconnectDb } from "./shared/prisma.js";
import { disconnectRedis } from "./shared/redis.js";

const app = createApp();
// Default to 3002 to match README/Docker and the Inngest dev script URL
const PORT = process.env.PORT || 3002;

// Graceful shutdown
process.on("SIGTERM", async () => {
  logger.info("SIGTERM received, closing server...");
  await disconnectRedis();
  await disconnectDb();
  process.exit(0);
});

process.on("SIGINT", async () => {
  logger.info("SIGINT received, closing server...");
  await disconnectRedis();
  await disconnectDb();
  process.exit(0);
});

// Start server
app.listen(PORT, () => {
  logger.info("AI Audit API Server started", {
    port: PORT,
    server: `http://localhost:${PORT}`,
    health: `http://localhost:${PORT}/health`,
    swagger: `http://localhost:${PORT}/api-docs`,
    api_docs_json: `http://localhost:${PORT}/api-docs.json`,
    inngest: `http://localhost:${PORT}/api/inngest`,
  });
});

export default app;
