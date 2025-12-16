/**
 * Express Application Factory
 * ============================
 * Creates and configures the Express app with all routes and middleware
 */

import express from "express";
import cors from "cors";
import swaggerUi from "swagger-ui-express";
import { serve } from "inngest/express";
import "dotenv/config";

// Inngest
import { inngest } from "./inngest/client.js";
import { functions } from "./inngest/index.js";

// Module routers
import { fichesRouter } from "./modules/fiches/index.js";
import { recordingsRouter } from "./modules/recordings/index.js";
import { transcriptionsRouter } from "./modules/transcriptions/index.js";
import { auditConfigsRouter } from "./modules/audit-configs/index.js";
import { auditsRouter, auditRerunRouter } from "./modules/audits/index.js";
import { automationRouter } from "./modules/automation/index.js";
import { chatRouter } from "./modules/chat/index.js";
import { productsRouter } from "./modules/products/index.js";
import { realtimeRouter } from "./modules/realtime/index.js";

// Error handling
import { notFoundHandler } from "./middleware/not-found.js";
import { errorHandler } from "./middleware/error-handler.js";

// Middleware
// import {
//   payloadSizeLogger,
//   payloadSizeResponseLogger,
// } from "./middleware/payload-logger.js";

// Config
import { swaggerSpec } from "./config/swagger.js";

export function createApp() {
  const app = express();

  // Middleware
  // Add instance marker so you can see which replica served each request.
  // Visible in browser devtools / curl response headers.
  app.use((req, res, next) => {
    res.setHeader("X-Backend-Instance", process.env.HOSTNAME || `pid-${process.pid}`);
    next();
  });

  app.use(
    cors({
      origin: [
        "http://localhost:3000",
        "http://localhost:3001",
        "http://localhost:5173", // Vite default
        "http://localhost:5174",
        "https://qa-nca-latest.vercel.app", // Production frontend
      ],
      credentials: true,
    })
  );
  app.use(express.json({ limit: "50mb" })); // Increase limit for Inngest workflows with large timelines

  // Payload size monitoring middleware (logs request/response sizes)
  // Disabled for performance
  // app.use(payloadSizeLogger);
  // app.use(payloadSizeResponseLogger);

  // Inngest endpoint
  app.use(
    "/api/inngest",
    serve({
      client: inngest,
      functions,
      servePath: "/api/inngest",
    })
  );

  // Swagger UI
  app.use("/api-docs", swaggerUi.serve, swaggerUi.setup(swaggerSpec));
  app.get("/api-docs.json", (req, res) => {
    res.json(swaggerSpec);
  });

  // Health check
  app.get("/health", (req, res) => {
    res.json({
      status: "ok",
      timestamp: new Date().toISOString(),
      service: "ai-audit-system",
      version: "2.3.0",
      instance: process.env.HOSTNAME || `pid-${process.pid}`,
    });
  });

  // Register module routes
  app.use("/api/fiches", fichesRouter);
  app.use("/api/recordings", recordingsRouter);
  app.use("/api/transcriptions", transcriptionsRouter);
  app.use("/api/audit-configs", auditConfigsRouter);
  app.use("/api/audits", auditsRouter);
  app.use("/api/audits", auditRerunRouter); // Step re-run endpoints
  app.use("/api/automation", automationRouter);
  app.use("/api/products", productsRouter);
  app.use("/api/realtime", realtimeRouter);
  app.use("/api", chatRouter);

  // 404 + error handling (keep last)
  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
