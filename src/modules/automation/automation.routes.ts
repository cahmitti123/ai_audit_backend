/**
 * Automation Routes
 * =================
 * RESPONSIBILITY: HTTP endpoints
 * - Define routes
 * - Request/response handling
 * - Input validation using schema validators
 * - Delegate to service layer
 * - No business logic
 * - No direct database calls
 * - No direct repository calls
 *
 * LAYER: Presentation (HTTP endpoints)
 */

import { Router, Request, Response } from "express";
import {
  validateCreateAutomationScheduleInput,
  validateUpdateAutomationScheduleInput,
  validateTriggerAutomationInput,
} from "./automation.schemas.js";
import * as automationService from "./automation.service.js";
import { inngest } from "../../inngest/client.js";
import { logger } from "../../shared/logger.js";

const router = Router();

// ═══════════════════════════════════════════════════════════════════════════
// SCHEDULE ENDPOINTS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * @swagger
 * /api/automation/schedules:
 *   post:
 *     summary: Create automation schedule
 *     tags: [Automation]
 */
router.post("/schedules", async (req: Request, res: Response) => {
  try {
    const input = validateCreateAutomationScheduleInput(req.body);
    const schedule = await automationService.createAutomationSchedule(input);

    res.status(201).json({
      success: true,
      data: schedule,
    });
  } catch (error: any) {
    logger.error("Failed to create automation schedule", {
      error: error.message,
    });
    res.status(400).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * @swagger
 * /api/automation/schedules:
 *   get:
 *     summary: List all automation schedules
 *     tags: [Automation]
 */
router.get("/schedules", async (req: Request, res: Response) => {
  try {
    const includeInactive = req.query.include_inactive === "true";
    const schedules = await automationService.getAllAutomationSchedules(
      includeInactive
    );

    res.json({
      success: true,
      data: schedules,
      count: schedules.length,
    });
  } catch (error: any) {
    logger.error("Failed to list automation schedules", {
      error: error.message,
    });
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * @swagger
 * /api/automation/schedules/{id}:
 *   get:
 *     summary: Get automation schedule by ID
 *     tags: [Automation]
 */
router.get("/schedules/:id", async (req: Request, res: Response) => {
  try {
    const schedule = await automationService.getAutomationScheduleById(
      req.params.id
    );

    if (!schedule) {
      return res.status(404).json({
        success: false,
        error: "Schedule not found",
      });
    }

    res.json({
      success: true,
      data: schedule,
    });
  } catch (error: any) {
    logger.error("Failed to get automation schedule", {
      error: error.message,
    });
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * @swagger
 * /api/automation/schedules/{id}:
 *   patch:
 *     summary: Update automation schedule
 *     tags: [Automation]
 */
router.patch("/schedules/:id", async (req: Request, res: Response) => {
  try {
    const input = validateUpdateAutomationScheduleInput(req.body);
    const schedule = await automationService.updateAutomationSchedule(
      req.params.id,
      input
    );

    res.json({
      success: true,
      data: schedule,
    });
  } catch (error: any) {
    logger.error("Failed to update automation schedule", {
      error: error.message,
    });
    res.status(400).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * @swagger
 * /api/automation/schedules/{id}:
 *   delete:
 *     summary: Delete automation schedule
 *     tags: [Automation]
 */
router.delete("/schedules/:id", async (req: Request, res: Response) => {
  try {
    await automationService.deleteAutomationSchedule(req.params.id);

    res.json({
      success: true,
      message: "Schedule deleted successfully",
    });
  } catch (error: any) {
    logger.error("Failed to delete automation schedule", {
      error: error.message,
    });
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// TRIGGER ENDPOINT
// ═══════════════════════════════════════════════════════════════════════════

/**
 * @swagger
 * /api/automation/trigger:
 *   post:
 *     summary: Trigger automation schedule manually
 *     tags: [Automation]
 */
router.post("/trigger", async (req: Request, res: Response) => {
  try {
    const input = validateTriggerAutomationInput(req.body);

    logger.info("Triggering automation", {
      schedule_id: input.scheduleId,
      has_override: Boolean(input.overrideFicheSelection),
    });

    // Send event to Inngest
    const result = await inngest.send({
      name: "automation/run" as "automation/run",
      data: {
        schedule_id: input.scheduleId,
        override_fiche_selection: input.overrideFicheSelection,
      },
    });

    logger.info("Automation triggered successfully", {
      schedule_id: input.scheduleId,
      event_ids: result.ids,
    });

    res.json({
      success: true,
      message: "Automation triggered successfully",
      schedule_id: input.scheduleId,
      event_ids: result.ids,
    });
  } catch (error: any) {
    logger.error("Failed to trigger automation", {
      error: error.message,
      stack: error.stack,
    });
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// DIAGNOSTIC ENDPOINT
// ═══════════════════════════════════════════════════════════════════════════

/**
 * @swagger
 * /api/automation/diagnostic:
 *   get:
 *     summary: Get Inngest configuration diagnostic
 *     tags: [Automation]
 */
router.get("/diagnostic", async (req: Request, res: Response) => {
  try {
    const isDev =
      process.env.INNGEST_DEV === "1" || process.env.NODE_ENV === "development";
    const hasBaseUrl = Boolean(process.env.INNGEST_BASE_URL);
    const hasEventKey = Boolean(process.env.INNGEST_EVENT_KEY);
    const hasSigningKey = Boolean(process.env.INNGEST_SIGNING_KEY);

    const mode = isDev ? "DEVELOPMENT" : hasBaseUrl ? "SELF-HOSTED" : "CLOUD";

    let recommendations: string[] = [];
    let warnings: string[] = [];

    if (!isDev && !hasBaseUrl && !hasEventKey) {
      warnings.push("⚠️ No Inngest configuration detected. Events will fail.");
      recommendations.push(
        "Set INNGEST_DEV=1 for local development (recommended)"
      );
      recommendations.push("OR set INNGEST_BASE_URL and keys for self-hosted");
      recommendations.push("OR set INNGEST_EVENT_KEY for cloud");
    }

    if (mode === "DEVELOPMENT") {
      recommendations.push(
        "✅ Development mode enabled - Inngest works locally without external server"
      );
      recommendations.push("View dev UI at: http://localhost:3002/api/inngest");
    }

    if (mode === "SELF-HOSTED" && !hasSigningKey) {
      warnings.push(
        "⚠️ INNGEST_SIGNING_KEY not set (required for self-hosted)"
      );
      recommendations.push("Generate with: openssl rand -hex 32");
    }

    if (mode === "CLOUD" && !hasEventKey) {
      warnings.push("⚠️ INNGEST_EVENT_KEY not set (required for cloud)");
    }

    res.json({
      success: true,
      inngest: {
        mode,
        status: warnings.length === 0 ? "✅ CONFIGURED" : "⚠️ NEEDS ATTENTION",
        configuration: {
          isDev,
          nodeEnv: process.env.NODE_ENV,
          baseUrl: process.env.INNGEST_BASE_URL || null,
          hasEventKey,
          hasSigningKey,
        },
        recommendations,
        warnings,
      },
      endpoints: {
        inngest_ui: isDev ? "http://localhost:3002/api/inngest" : null,
        trigger: "POST /api/automation/trigger",
      },
    });
  } catch (error: any) {
    logger.error("Failed to get diagnostic info", { error: error.message });
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// RUN ENDPOINTS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * @swagger
 * /api/automation/schedules/{id}/runs:
 *   get:
 *     summary: Get runs for a schedule
 *     tags: [Automation]
 */
router.get("/schedules/:id/runs", async (req: Request, res: Response) => {
  try {
    const limit = parseInt(req.query.limit as string) || 20;
    const offset = parseInt(req.query.offset as string) || 0;

    const runs = await automationService.getAutomationRuns(
      req.params.id,
      limit,
      offset
    );

    res.json({
      success: true,
      data: runs,
      count: runs.length,
      limit,
      offset,
    });
  } catch (error: any) {
    logger.error("Failed to get automation runs", { error: error.message });
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * @swagger
 * /api/automation/runs/{id}:
 *   get:
 *     summary: Get automation run by ID
 *     tags: [Automation]
 */
router.get("/runs/:id", async (req: Request, res: Response) => {
  try {
    const run = await automationService.getAutomationRunById(req.params.id);

    if (!run) {
      return res.status(404).json({
        success: false,
        error: "Run not found",
      });
    }

    res.json({
      success: true,
      data: run,
    });
  } catch (error: any) {
    logger.error("Failed to get automation run", { error: error.message });
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * @swagger
 * /api/automation/runs/{id}/logs:
 *   get:
 *     summary: Get logs for an automation run
 *     tags: [Automation]
 */
router.get("/runs/:id/logs", async (req: Request, res: Response) => {
  try {
    const level = req.query.level as string | undefined;
    const logs = await automationService.getAutomationLogs(
      req.params.id,
      level
    );

    res.json({
      success: true,
      data: logs,
      count: logs.length,
    });
  } catch (error: any) {
    logger.error("Failed to get automation logs", { error: error.message });
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// EXPORTS
// ═══════════════════════════════════════════════════════════════════════════

export const automationRouter = router;
