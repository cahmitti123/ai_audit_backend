/**
 * Express Application Factory
 * ============================
 * Creates and configures the Express app with all routes and middleware
 */

import "dotenv/config";

import cors from "cors";
import express from "express";
import { serve } from "inngest/express";
import swaggerUi from "swagger-ui-express";

// Middleware
// import {
//   payloadSizeLogger,
//   payloadSizeResponseLogger,
// } from "./middleware/payload-logger.js";
// Config
import { swaggerSpec } from "./config/swagger.js";
// Inngest
import { inngest } from "./inngest/client.js";
import { functions } from "./inngest/index.js";
import { apiAuthMiddleware } from "./middleware/api-auth.js";
// Optional API auth
import { authContextMiddleware } from "./middleware/auth-context.js";
import { requireAuth } from "./middleware/authz.js";
import { errorHandler } from "./middleware/error-handler.js";
// Error handling
import { notFoundHandler } from "./middleware/not-found.js";
import { adminRouter } from "./modules/admin/index.js";
import { auditConfigsRouter } from "./modules/audit-configs/index.js";
import { auditRerunRouter,auditsRouter } from "./modules/audits/index.js";
import { authRouter } from "./modules/auth/index.js";
import { automationRouter } from "./modules/automation/index.js";
import { chatRouter } from "./modules/chat/index.js";
// Module routers
import { fichesRouter } from "./modules/fiches/index.js";
import { productsRouter } from "./modules/products/index.js";
import { realtimeRouter } from "./modules/realtime/index.js";
import { recordingsRouter } from "./modules/recordings/index.js";
import { transcriptionsRouter } from "./modules/transcriptions/index.js";

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

  // Parse credentials (JWT/API token) into `req.auth`.
  app.use(authContextMiddleware);

  // Optional API authentication (disabled unless API_AUTH_TOKEN(S) is set)
  app.use(apiAuthMiddleware);

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
  app.use("/api/auth", authRouter);
  app.use("/api/admin", requireAuth(), adminRouter);
  app.use("/api/fiches", requireAuth(), fichesRouter);
  app.use("/api/recordings", requireAuth(), recordingsRouter);
  app.use("/api/transcriptions", requireAuth(), transcriptionsRouter);
  app.use("/api/audit-configs", requireAuth(), auditConfigsRouter);
  app.use("/api/audits", requireAuth(), auditsRouter);
  app.use("/api/audits", requireAuth(), auditRerunRouter); // Step re-run endpoints
  app.use("/api/automation", requireAuth(), automationRouter);
  app.use("/api/products", requireAuth(), productsRouter);
  app.use("/api/realtime", requireAuth(), realtimeRouter);
  app.use("/api", requireAuth(), chatRouter);

  // 404 + error handling (keep last)
  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
