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

import type { Request, Response } from "express";
import { Router } from "express";

import { inngest } from "../../inngest/client.js";
import { asyncHandler } from "../../middleware/async-handler.js";
import { requirePermission } from "../../middleware/authz.js";
import { logger } from "../../shared/logger.js";
import {
  validateCreateAutomationScheduleInput,
  validateTriggerAutomationInput,
  validateUpdateAutomationScheduleInput,
} from "./automation.schemas.js";
import * as automationService from "./automation.service.js";

const router = Router();

// Require read access by default for automation routes.
// (Machine API tokens bypass permission checks in `requirePermission`.)
router.use(requirePermission("automation.read"));

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
router.post(
  "/schedules",
  requirePermission("automation.write"),
  asyncHandler(async (req: Request, res: Response) => {
    const input = validateCreateAutomationScheduleInput(req.body);
    const schedule = await automationService.createAutomationSchedule(input);

    return res.status(201).json({
      success: true,
      data: schedule,
    });
  })
);

/**
 * @swagger
 * /api/automation/schedules:
 *   get:
 *     summary: List all automation schedules
 *     tags: [Automation]
 */
router.get(
  "/schedules",
  asyncHandler(async (req: Request, res: Response) => {
    const includeInactive = req.query.include_inactive === "true";
    const schedules = await automationService.getAllAutomationSchedules(
      includeInactive
    );

    return res.json({
      success: true,
      data: schedules,
      count: schedules.length,
    });
  })
);

/**
 * @swagger
 * /api/automation/schedules/{id}:
 *   get:
 *     summary: Get automation schedule by ID
 *     tags: [Automation]
 */
router.get(
  "/schedules/:id",
  asyncHandler(async (req: Request, res: Response) => {
    const schedule = await automationService.getAutomationScheduleById(
      req.params.id
    );

    if (!schedule) {
      return res.status(404).json({
        success: false,
        error: "Schedule not found",
      });
    }

    return res.json({
      success: true,
      data: schedule,
    });
  })
);

/**
 * @swagger
 * /api/automation/schedules/{id}:
 *   patch:
 *     summary: Update automation schedule
 *     tags: [Automation]
 */
router.patch(
  "/schedules/:id",
  requirePermission("automation.write"),
  asyncHandler(async (req: Request, res: Response) => {
    const input = validateUpdateAutomationScheduleInput(req.body);
    const schedule = await automationService.updateAutomationSchedule(
      req.params.id,
      input
    );

    return res.json({
      success: true,
      data: schedule,
    });
  })
);

/**
 * @swagger
 * /api/automation/schedules/{id}:
 *   delete:
 *     summary: Delete automation schedule
 *     tags: [Automation]
 */
router.delete(
  "/schedules/:id",
  requirePermission("automation.write"),
  asyncHandler(async (req: Request, res: Response) => {
    await automationService.deleteAutomationSchedule(req.params.id);

    return res.json({
      success: true,
      message: "Schedule deleted successfully",
    });
  })
);

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
router.post(
  "/trigger",
  requirePermission("automation.write"),
  asyncHandler(async (req: Request, res: Response) => {
    const input = validateTriggerAutomationInput(req.body);

    logger.info("Triggering automation", {
      schedule_id: input.scheduleId,
      has_override: Boolean(input.overrideFicheSelection),
    });

    // Send event to Inngest
    const result = await inngest.send({
      name: "automation/run" as const,
      data: {
        schedule_id: input.scheduleId,
        override_fiche_selection: input.overrideFicheSelection,
      },
    });

    logger.info("Automation triggered successfully", {
      schedule_id: input.scheduleId,
      event_ids: result.ids,
    });

    return res.json({
      success: true,
      message: "Automation triggered successfully",
      schedule_id: input.scheduleId,
      event_ids: result.ids,
    });
  })
);

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
router.get(
  "/diagnostic",
  asyncHandler(async (_req: Request, res: Response) => {
    const isDev =
      process.env.INNGEST_DEV === "1" || process.env.NODE_ENV === "development";
    const hasBaseUrl = Boolean(process.env.INNGEST_BASE_URL);
    const hasEventKey = Boolean(process.env.INNGEST_EVENT_KEY);
    const hasSigningKey = Boolean(process.env.INNGEST_SIGNING_KEY);

    const mode = isDev ? "DEVELOPMENT" : hasBaseUrl ? "SELF-HOSTED" : "CLOUD";

    const recommendations: string[] = [];
    const warnings: string[] = [];

    if (!isDev && !hasBaseUrl && !hasEventKey) {
      warnings.push("⚠️ No Inngest configuration detected. Events will fail.");
      recommendations.push("Set INNGEST_DEV=1 for local development (recommended)");
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
      warnings.push("⚠️ INNGEST_SIGNING_KEY not set (required for self-hosted)");
      recommendations.push("Generate with: openssl rand -hex 32");
    }

    if (mode === "CLOUD" && !hasEventKey) {
      warnings.push("⚠️ INNGEST_EVENT_KEY not set (required for cloud)");
    }

    return res.json({
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
  })
);

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
router.get(
  "/schedules/:id/runs",
  asyncHandler(async (req: Request, res: Response) => {
    const limitRaw = req.query.limit;
    const offsetRaw = req.query.offset;
    const limitParsed =
      typeof limitRaw === "string" ? Number.parseInt(limitRaw, 10) : NaN;
    const offsetParsed =
      typeof offsetRaw === "string" ? Number.parseInt(offsetRaw, 10) : NaN;

    const limit = Number.isFinite(limitParsed) ? limitParsed : 20;
    const offset = Number.isFinite(offsetParsed) ? offsetParsed : 0;

    const runs = await automationService.getAutomationRuns(
      req.params.id,
      limit,
      offset
    );

    return res.json({
      success: true,
      data: runs,
      count: runs.length,
      limit,
      offset,
    });
  })
);

/**
 * @swagger
 * /api/automation/runs:
 *   get:
 *     summary: List automation runs (all schedules)
 *     tags: [Automation]
 */
router.get(
  "/runs",
  asyncHandler(async (req: Request, res: Response) => {
    const limitRaw = req.query.limit;
    const offsetRaw = req.query.offset;
    const limitParsed =
      typeof limitRaw === "string" ? Number.parseInt(limitRaw, 10) : NaN;
    const offsetParsed =
      typeof offsetRaw === "string" ? Number.parseInt(offsetRaw, 10) : NaN;

    const limit = Number.isFinite(limitParsed) ? limitParsed : 20;
    const offset = Number.isFinite(offsetParsed) ? offsetParsed : 0;

    const runs = await automationService.getAllAutomationRuns(limit, offset);

    return res.json({
      success: true,
      data: runs,
      count: runs.length,
      limit,
      offset,
    });
  })
);

/**
 * @swagger
 * /api/automation/runs/{id}:
 *   get:
 *     summary: Get automation run by ID
 *     tags: [Automation]
 */
router.get(
  "/runs/:id",
  asyncHandler(async (req: Request, res: Response) => {
    const run = await automationService.getAutomationRunById(req.params.id);

    if (!run) {
      return res.status(404).json({
        success: false,
        error: "Run not found",
      });
    }

    return res.json({
      success: true,
      data: run,
    });
  })
);

/**
 * @swagger
 * /api/automation/runs/{id}/logs:
 *   get:
 *     summary: Get logs for an automation run
 *     tags: [Automation]
 */
router.get(
  "/runs/:id/logs",
  asyncHandler(async (req: Request, res: Response) => {
    const level =
      typeof req.query.level === "string" ? req.query.level : undefined;

    const logs = await automationService.getAutomationLogs(req.params.id, level);

    return res.json({
      success: true,
      data: logs,
      count: logs.length,
    });
  })
);

// ═══════════════════════════════════════════════════════════════════════════
// EXPORTS
// ═══════════════════════════════════════════════════════════════════════════

export const automationRouter = router;
