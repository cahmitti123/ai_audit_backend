/**
 * API Server for AI Audit System
 * ================================
 * Express server that exposes audit functionality via REST API
 */

import express, { Request, Response } from "express";
import cors from "cors";
import swaggerUi from "swagger-ui-express";
import { serve } from "inngest/express";
import "dotenv/config";
import { runAudit } from "./services/audit-runner.js";
import { inngest } from "./inngest/client.js";
import { functions } from "./inngest/functions.js";
import {
  fetchActiveAuditConfigs,
  fetchAuditConfigById,
  disconnectAuditConfigDb,
} from "./services/audit-config.js";
import {
  getAllAuditConfigs,
  getAuditConfigById,
  createAuditConfig,
  updateAuditConfig,
  deleteAuditConfig,
  addAuditStep,
  updateAuditStep,
  deleteAuditStep,
  getAuditsByFiche,
  getAuditById,
  getRecordingsByFiche,
  getCachedFiche,
  cacheFiche,
  disconnectDb,
} from "./services/database.js";
import { fetchApiSales, fetchApiFicheDetails } from "./services/fiche-api.js";
import {
  transcribeFicheRecordings,
  getFicheTranscriptionStatus,
  batchTranscribeFiches,
} from "./services/transcription-manager.js";
import { swaggerSpec } from "./config/swagger.js";

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(
  cors({
    origin: [
      "http://localhost:3000",
      "http://localhost:3001",
      "http://localhost:5173", // Vite default
      "http://localhost:5174",
    ],
    credentials: true,
  })
);
app.use(express.json());

// Inngest endpoint
app.use("/api/inngest", serve({ client: inngest, functions }));

// Swagger UI
app.use("/api-docs", swaggerUi.serve, swaggerUi.setup(swaggerSpec));
app.get("/api-docs.json", (req: Request, res: Response) => {
  res.json(swaggerSpec);
});

/**
 * @swagger
 * /health:
 *   get:
 *     tags: [Health]
 *     summary: Health check
 *     responses:
 *       200:
 *         description: Server is running
 */
app.get("/health", (req: Request, res: Response) => {
  res.json({
    status: "ok",
    timestamp: new Date().toISOString(),
    service: "ai-audit-system",
    version: "2.3.0",
  });
});

/**
 * @swagger
 * /api/audit-configs:
 *   get:
 *     tags: [Audit Configs]
 *     summary: List all audit configurations
 *     parameters:
 *       - in: query
 *         name: include_inactive
 *         schema:
 *           type: boolean
 *         description: Include inactive configs
 *       - in: query
 *         name: include_steps
 *         schema:
 *           type: boolean
 *         description: Include steps in response
 *     responses:
 *       200:
 *         description: List of audit configurations
 */
app.get("/api/audit-configs", async (req: Request, res: Response) => {
  try {
    const includeInactive = req.query.include_inactive === "true";
    const includeSteps = req.query.include_steps === "true";

    const configs = await getAllAuditConfigs(includeInactive);

    const data = configs.map((config) => ({
      id: config.id.toString(),
      name: config.name,
      description: config.description,
      systemPrompt: config.systemPrompt,
      isActive: config.isActive,
      stepsCount: config.steps.length,
      createdAt: config.createdAt,
      createdBy: config.createdBy,
      ...(includeSteps && {
        steps: config.steps.map((step) => ({
          id: step.id.toString(),
          name: step.name,
          position: step.position,
          severityLevel: step.severityLevel,
          isCritical: step.isCritical,
          weight: step.weight,
          chronologicalImportant: step.chronologicalImportant,
          verifyProductInfo: step.verifyProductInfo,
          controlPoints: step.controlPoints,
          keywords: step.keywords,
        })),
      }),
    }));

    res.json({
      success: true,
      data,
      count: data.length,
    });
  } catch (error: any) {
    console.error("Error fetching audit configs:", error);
    res.status(500).json({
      success: false,
      error: "Failed to fetch audit configurations",
      message: error.message,
    });
  }
});

/**
 * @swagger
 * /api/audit-configs/{id}:
 *   get:
 *     tags: [Audit Configs]
 *     summary: Get audit configuration details
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: Audit configuration details
 *       404:
 *         description: Config not found
 */
app.get("/api/audit-configs/:id", async (req: Request, res: Response) => {
  try {
    const configId = BigInt(req.params.id);
    const config = await getAuditConfigById(configId);

    if (!config) {
      return res.status(404).json({
        success: false,
        error: "Audit configuration not found",
      });
    }

    res.json({
      success: true,
      data: {
        id: config.id.toString(),
        name: config.name,
        description: config.description,
        systemPrompt: config.systemPrompt,
        isActive: config.isActive,
        createdBy: config.createdBy,
        createdAt: config.createdAt,
        updatedAt: config.updatedAt,
        steps: config.steps.map((step) => ({
          id: step.id.toString(),
          position: step.position,
          name: step.name,
          description: step.description,
          prompt: step.prompt,
          severityLevel: step.severityLevel,
          isCritical: step.isCritical,
          weight: step.weight,
          chronologicalImportant: step.chronologicalImportant,
          verifyProductInfo: step.verifyProductInfo,
          controlPoints: step.controlPoints,
          keywords: step.keywords,
        })),
      },
    });
  } catch (error: any) {
    console.error("Error fetching audit config:", error);
    res.status(500).json({
      success: false,
      error: "Failed to fetch audit configuration",
      message: error.message,
    });
  }
});

/**
 * @swagger
 * /api/audit/run:
 *   post:
 *     tags: [Audits]
 *     summary: Run audit with specific config
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [audit_id, fiche_id]
 *             properties:
 *               audit_id:
 *                 type: integer
 *               fiche_id:
 *                 type: string
 *     responses:
 *       200:
 *         description: Audit completed successfully
 *       400:
 *         description: Missing parameters
 *       500:
 *         description: Audit execution failed
 */
app.post("/api/audit/run", async (req: Request, res: Response) => {
  try {
    const { audit_id, fiche_id } = req.body;

    // Validation
    if (!audit_id || !fiche_id) {
      return res.status(400).json({
        success: false,
        error: "Missing required parameters",
        message: "Both audit_id and fiche_id are required",
      });
    }

    console.log(
      `\n${"=".repeat(
        80
      )}\nStarting audit: Config ID ${audit_id}, Fiche ID ${fiche_id}\n${"=".repeat(
        80
      )}\n`
    );

    // Run the audit
    const result = await runAudit({
      auditConfigId: parseInt(audit_id),
      ficheId: fiche_id.toString(),
    });

    res.json({
      success: true,
      data: result,
      metadata: {
        audit_id: audit_id,
        fiche_id: fiche_id,
        timestamp: new Date().toISOString(),
      },
    });
  } catch (error: any) {
    console.error("Error running audit:", error);
    res.status(500).json({
      success: false,
      error: "Audit execution failed",
      message: error.message,
      stack: process.env.NODE_ENV === "development" ? error.stack : undefined,
    });
  }
});

/**
 * @swagger
 * /api/audit/run-latest:
 *   post:
 *     tags: [Audits]
 *     summary: Run audit with latest active config
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [fiche_id]
 *             properties:
 *               fiche_id:
 *                 type: string
 *     responses:
 *       200:
 *         description: Audit completed
 *       400:
 *         description: Missing fiche_id
 */
app.post("/api/audit/run-latest", async (req: Request, res: Response) => {
  try {
    const { fiche_id } = req.body;

    if (!fiche_id) {
      return res.status(400).json({
        success: false,
        error: "Missing required parameter",
        message: "fiche_id is required",
      });
    }

    console.log(
      `\n${"=".repeat(
        80
      )}\nStarting audit with latest config: Fiche ID ${fiche_id}\n${"=".repeat(
        80
      )}\n`
    );

    // Run the audit with latest config
    const result = await runAudit({
      ficheId: fiche_id.toString(),
      useLatest: true,
    });

    res.json({
      success: true,
      data: result,
      metadata: {
        fiche_id: fiche_id,
        timestamp: new Date().toISOString(),
      },
    });
  } catch (error: any) {
    console.error("Error running audit:", error);
    res.status(500).json({
      success: false,
      error: "Audit execution failed",
      message: error.message,
      stack: process.env.NODE_ENV === "development" ? error.stack : undefined,
    });
  }
});

/**
 * @swagger
 * /api/audit-configs:
 *   post:
 *     tags: [Audit Configs]
 *     summary: Create new audit configuration
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [name, steps]
 *             properties:
 *               name:
 *                 type: string
 *               description:
 *                 type: string
 *               systemPrompt:
 *                 type: string
 *               steps:
 *                 type: array
 *     responses:
 *       201:
 *         description: Config created
 */
app.post("/api/audit-configs", async (req: Request, res: Response) => {
  try {
    const config = await createAuditConfig(req.body);
    res.status(201).json({
      success: true,
      data: { id: config.id.toString(), name: config.name },
    });
  } catch (error: any) {
    res.status(400).json({
      success: false,
      error: "Failed to create audit config",
      message: error.message,
    });
  }
});

/**
 * @swagger
 * /api/audit-configs/{id}:
 *   put:
 *     tags: [Audit Configs]
 *     summary: Update audit configuration
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               name:
 *                 type: string
 *               description:
 *                 type: string
 *               systemPrompt:
 *                 type: string
 *               isActive:
 *                 type: boolean
 *     responses:
 *       200:
 *         description: Config updated
 */
app.put("/api/audit-configs/:id", async (req: Request, res: Response) => {
  try {
    const config = await updateAuditConfig(BigInt(req.params.id), req.body);
    res.json({
      success: true,
      data: {
        id: config.id.toString(),
        name: config.name,
        stepsCount: config.steps.length,
      },
    });
  } catch (error: any) {
    res.status(400).json({
      success: false,
      error: "Failed to update audit config",
      message: error.message,
    });
  }
});

/**
 * @swagger
 * /api/audit-configs/{id}:
 *   delete:
 *     tags: [Audit Configs]
 *     summary: Delete audit configuration
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: Config deleted
 */
app.delete("/api/audit-configs/:id", async (req: Request, res: Response) => {
  try {
    await deleteAuditConfig(BigInt(req.params.id));
    res.json({ success: true, message: "Audit config deleted" });
  } catch (error: any) {
    res.status(400).json({
      success: false,
      error: "Failed to delete audit config",
      message: error.message,
    });
  }
});

/**
 * @swagger
 * /api/audit-configs/{config_id}/steps:
 *   post:
 *     tags: [Audit Configs]
 *     summary: Add step to audit configuration
 *     parameters:
 *       - in: path
 *         name: config_id
 *         required: true
 *         schema:
 *           type: integer
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [name, prompt, position, weight]
 *     responses:
 *       201:
 *         description: Step added
 */
app.post(
  "/api/audit-configs/:config_id/steps",
  async (req: Request, res: Response) => {
    try {
      const step = await addAuditStep(BigInt(req.params.config_id), req.body);
      res.status(201).json({
        success: true,
        data: { id: step.id.toString(), name: step.name },
      });
    } catch (error: any) {
      res.status(400).json({
        success: false,
        error: "Failed to add step",
        message: error.message,
      });
    }
  }
);

/**
 * @swagger
 * /api/audit-steps/{step_id}:
 *   put:
 *     tags: [Audit Configs]
 *     summary: Update audit step
 *     parameters:
 *       - in: path
 *         name: step_id
 *         required: true
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: Step updated
 */
app.put("/api/audit-steps/:step_id", async (req: Request, res: Response) => {
  try {
    const step = await updateAuditStep(BigInt(req.params.step_id), req.body);
    res.json({ success: true, data: step });
  } catch (error: any) {
    res.status(400).json({
      success: false,
      error: "Failed to update step",
      message: error.message,
    });
  }
});

/**
 * @swagger
 * /api/audit-steps/{step_id}:
 *   delete:
 *     tags: [Audit Configs]
 *     summary: Delete audit step
 *     parameters:
 *       - in: path
 *         name: step_id
 *         required: true
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: Step deleted
 */
app.delete("/api/audit-steps/:step_id", async (req: Request, res: Response) => {
  try {
    await deleteAuditStep(BigInt(req.params.step_id));
    res.json({ success: true, message: "Step deleted" });
  } catch (error: any) {
    res.status(400).json({
      success: false,
      error: "Failed to delete step",
      message: error.message,
    });
  }
});

/**
 * @swagger
 * /api/fiches/search:
 *   get:
 *     tags: [Fiches]
 *     summary: Search fiches by date
 *     parameters:
 *       - in: query
 *         name: date
 *         required: true
 *         schema:
 *           type: string
 *           format: date
 *         description: Date in YYYY-MM-DD format
 *     responses:
 *       200:
 *         description: List of fiches
 */
app.get("/api/fiches/search", async (req: Request, res: Response) => {
  try {
    const { date } = req.query;

    if (!date || typeof date !== "string") {
      return res.status(400).json({
        success: false,
        error: "Missing or invalid date parameter (YYYY-MM-DD required)",
      });
    }

    const sales = await fetchApiSales(date);
    res.json(sales);
  } catch (error: any) {
    res.status(500).json({
      success: false,
      error: "Failed to fetch fiches",
      message: error.message,
    });
  }
});

/**
 * @swagger
 * /api/fiches/{fiche_id}:
 *   get:
 *     tags: [Fiches]
 *     summary: Get fiche details with recordings (auto-cached)
 *     parameters:
 *       - in: path
 *         name: fiche_id
 *         required: true
 *         schema:
 *           type: string
 *       - in: query
 *         name: cle
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Fiche details
 */
app.get("/api/fiches/:fiche_id", async (req: Request, res: Response) => {
  try {
    const { fiche_id } = req.params;
    const { cle } = req.query;

    // Check cache first
    const cached = await getCachedFiche(fiche_id).catch(() => null);

    let ficheDetails;
    if (cached && cached.expiresAt > new Date()) {
      console.log(`✓ Using cached fiche ${fiche_id}`);
      ficheDetails = cached.rawData;
    } else {
      console.log(`📡 Fetching fiche ${fiche_id} from API`);
      ficheDetails = await fetchApiFicheDetails(
        fiche_id,
        cle as string | undefined
      );

      // Cache in database
      try {
        await cacheFiche(ficheDetails);
        console.log(
          `✓ Cached fiche ${fiche_id} in database with ${ficheDetails.recordings.length} recordings`
        );
      } catch (dbErr) {
        console.warn(`⚠️  Could not cache fiche in DB, but API call succeeded`);
      }
    }

    res.json(ficheDetails);
  } catch (error: any) {
    res.status(500).json({
      success: false,
      error: "Failed to fetch fiche details",
      message: error.message,
    });
  }
});

/**
 * @swagger
 * /api/fiches/{fiche_id}/cache:
 *   get:
 *     tags: [Fiches]
 *     summary: Get cached fiche data
 *     parameters:
 *       - in: path
 *         name: fiche_id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Cached fiche data
 *       404:
 *         description: Not cached
 */
app.get("/api/fiches/:fiche_id/cache", async (req: Request, res: Response) => {
  try {
    const cached = await getCachedFiche(req.params.fiche_id);

    if (!cached) {
      return res.status(404).json({
        success: false,
        error: "Fiche not cached",
      });
    }

    res.json({
      success: true,
      data: {
        ficheId: cached.ficheId,
        groupe: cached.groupe,
        prospectNom: cached.prospectNom,
        prospectPrenom: cached.prospectPrenom,
        recordingsCount: cached.recordingsCount,
        fetchedAt: cached.fetchedAt,
        expiresAt: cached.expiresAt,
      },
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      error: "Failed to fetch cached fiche",
      message: error.message,
    });
  }
});

/**
 * @swagger
 * /api/fiches/{fiche_id}/recordings:
 *   get:
 *     tags: [Fiches]
 *     summary: Get recordings for a fiche
 *     parameters:
 *       - in: path
 *         name: fiche_id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: List of recordings
 */
app.get(
  "/api/fiches/:fiche_id/recordings",
  async (req: Request, res: Response) => {
    try {
      const recordings = await getRecordingsByFiche(req.params.fiche_id);
      res.json({ success: true, data: recordings, count: recordings.length });
    } catch (error: any) {
      res.status(500).json({
        success: false,
        error: "Failed to fetch recordings",
        message: error.message,
      });
    }
  }
);

/**
 * @swagger
 * /api/fiches/{fiche_id}/transcribe:
 *   post:
 *     tags: [Fiches]
 *     summary: Transcribe all recordings for a fiche
 *     parameters:
 *       - in: path
 *         name: fiche_id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Transcription completed
 */
app.post(
  "/api/fiches/:fiche_id/transcribe",
  async (req: Request, res: Response) => {
    try {
      const apiKey = process.env.ELEVENLABS_API_KEY;
      if (!apiKey) {
        return res.status(500).json({
          success: false,
          error: "ElevenLabs API key not configured",
        });
      }

      const result = await transcribeFicheRecordings(
        req.params.fiche_id,
        apiKey
      );
      res.json({ success: true, data: result });
    } catch (error: any) {
      res.status(500).json({
        success: false,
        error: "Transcription failed",
        message: error.message,
      });
    }
  }
);

/**
 * @swagger
 * /api/fiches/{fiche_id}/transcription-status:
 *   get:
 *     tags: [Fiches]
 *     summary: Get transcription status for a fiche
 *     parameters:
 *       - in: path
 *         name: fiche_id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Transcription status
 */
app.get(
  "/api/fiches/:fiche_id/transcription-status",
  async (req: Request, res: Response) => {
    try {
      const status = await getFicheTranscriptionStatus(req.params.fiche_id);
      res.json({ success: true, data: status });
    } catch (error: any) {
      res.status(500).json({
        success: false,
        error: "Failed to get transcription status",
        message: error.message,
      });
    }
  }
);

/**
 * @swagger
 * /api/transcribe/batch:
 *   post:
 *     tags: [Fiches]
 *     summary: Batch transcribe multiple fiches (async with Inngest)
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [fiche_ids]
 *             properties:
 *               fiche_ids:
 *                 type: array
 *                 items:
 *                   type: string
 *               priority:
 *                 type: string
 *                 enum: [high, normal, low]
 *     responses:
 *       200:
 *         description: Batch job queued
 */
app.post("/api/transcribe/batch", async (req: Request, res: Response) => {
  try {
    const { fiche_ids, priority = "normal" } = req.body;

    if (!fiche_ids || !Array.isArray(fiche_ids)) {
      return res.status(400).json({
        success: false,
        error: "Invalid request - fiche_ids array required",
      });
    }

    // Queue transcription for each fiche with event IDs
    const { ids } = await inngest.send(
      fiche_ids.map((fiche_id) => ({
        name: "fiche/transcribe",
        data: { fiche_id, priority },
        // Deduplication ID: prevent duplicate transcription requests within 24h
        id: `transcribe-${fiche_id}-${new Date().toISOString().split("T")[0]}`,
      }))
    );

    console.log(
      `✓ Queued ${fiche_ids.length} transcription jobs. Event IDs:`,
      ids
    );

    res.json({
      success: true,
      message: `${fiche_ids.length} transcription jobs queued`,
      fiche_ids,
      event_ids: ids,
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      error: "Failed to queue transcriptions",
      message: error.message,
    });
  }
});

/**
 * @swagger
 * /api/audit/batch:
 *   post:
 *     tags: [Audits]
 *     summary: Batch run audits for multiple fiches
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [fiche_ids]
 *             properties:
 *               fiche_ids:
 *                 type: array
 *                 items:
 *                   type: string
 *               audit_config_id:
 *                 type: integer
 *               user_id:
 *                 type: string
 *     responses:
 *       200:
 *         description: Batch audit queued
 */
app.post("/api/audit/batch", async (req: Request, res: Response) => {
  try {
    const { fiche_ids, audit_config_id, user_id } = req.body;

    if (!fiche_ids || !Array.isArray(fiche_ids)) {
      return res.status(400).json({
        success: false,
        error: "Invalid request - fiche_ids array required",
      });
    }

    // Send batch event with deduplication ID
    const batchId = `batch-${Date.now()}-${fiche_ids.length}`;
    const { ids } = await inngest.send({
      name: "audit/batch",
      data: {
        fiche_ids,
        audit_config_id,
        user_id,
      },
      // Prevent duplicate batch runs
      id: batchId,
      // Add timestamp for tracking
      ts: Date.now(),
    });

    console.log(
      `✓ Queued batch audit for ${fiche_ids.length} fiches. Batch ID:`,
      batchId
    );

    res.json({
      success: true,
      message: `Batch audit queued for ${fiche_ids.length} fiches`,
      fiche_ids,
      audit_config_id,
      batch_id: batchId,
      event_ids: ids,
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      error: "Failed to queue batch audit",
      message: error.message,
    });
  }
});

/**
 * @swagger
 * /api/fiches/{fiche_id}/audits:
 *   get:
 *     tags: [Fiches]
 *     summary: Get audit history for a fiche
 *     parameters:
 *       - in: path
 *         name: fiche_id
 *         required: true
 *         schema:
 *           type: string
 *       - in: query
 *         name: include_details
 *         schema:
 *           type: boolean
 *         description: Include full step results and citations
 *     responses:
 *       200:
 *         description: List of audits
 */
app.get("/api/fiches/:fiche_id/audits", async (req: Request, res: Response) => {
  try {
    const includeDetails = req.query.include_details === "true";
    const audits = await getAuditsByFiche(req.params.fiche_id, includeDetails);

    // Convert BigInt to string for JSON serialization
    const serializable = JSON.parse(
      JSON.stringify(audits, (key, value) =>
        typeof value === "bigint" ? value.toString() : value
      )
    );

    res.json({ success: true, data: serializable, count: audits.length });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      error: "Failed to fetch audits",
      message: error.message,
    });
  }
});

/**
 * @swagger
 * /api/audits/{audit_id}:
 *   get:
 *     tags: [Audits]
 *     summary: Get detailed audit results
 *     parameters:
 *       - in: path
 *         name: audit_id
 *         required: true
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: Full audit details with citations
 *       404:
 *         description: Audit not found
 */
app.get("/api/audits/:audit_id", async (req: Request, res: Response) => {
  try {
    const audit = await getAuditById(BigInt(req.params.audit_id));

    if (!audit) {
      return res.status(404).json({
        success: false,
        error: "Audit not found",
      });
    }

    // Convert BigInt to string for JSON serialization
    const serializable = JSON.parse(
      JSON.stringify(audit, (key, value) =>
        typeof value === "bigint" ? value.toString() : value
      )
    );

    res.json({ success: true, data: serializable });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      error: "Failed to fetch audit",
      message: error.message,
    });
  }
});

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
