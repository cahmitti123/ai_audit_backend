/**
 * Automation Routes
 * =================
 * REST API endpoints for automation management
 */

import { Router, Request, Response } from "express";
import {
  AutomationScheduleCreateSchema,
  AutomationScheduleUpdateSchema,
  TriggerAutomationSchema,
} from "../../schemas.js";
import {
  createAutomationSchedule,
  getAllAutomationSchedules,
  getAutomationScheduleById,
  updateAutomationSchedule,
  deleteAutomationSchedule,
  getAutomationRuns,
  getAutomationRunById,
  getAutomationLogs,
} from "./automation.repository.js";
import { inngest } from "../../inngest/client.js";
import { logger } from "../../shared/logger.js";
import {
  serializeBigInt,
  jsonResponse,
} from "../../shared/bigint-serializer.js";

const router = Router();

/**
 * DEPRECATED: Use serializeBigInt from bigint-serializer.ts instead
 * These are kept for backward compatibility but now use the universal serializer
 */
function serializeSchedule(schedule: any) {
  return serializeBigInt(schedule);
}

function serializeRun(run: any) {
  return serializeBigInt(run);
}

function serializeLog(log: any) {
  return serializeBigInt(log);
}

/**
 * @swagger
 * /api/automation/schedules:
 *   post:
 *     summary: Create automation schedule
 *     tags: [Automation]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *     responses:
 *       201:
 *         description: Schedule created successfully
 */
router.post("/schedules", async (req: Request, res: Response) => {
  try {
    const data = AutomationScheduleCreateSchema.parse(req.body);
    const schedule = await createAutomationSchedule(data);

    logger.info("Automation schedule created", {
      id: String(schedule.id),
      name: schedule.name,
    });

    return jsonResponse(
      res,
      {
        success: true,
        data: serializeSchedule(schedule),
      },
      201
    );
  } catch (error: any) {
    logger.error("Failed to create automation schedule", {
      error: error.message,
    });
    return res.status(400).json({
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
 *     parameters:
 *       - in: query
 *         name: include_inactive
 *         schema:
 *           type: boolean
 *     responses:
 *       200:
 *         description: List of schedules
 */
router.get("/schedules", async (req: Request, res: Response) => {
  try {
    const includeInactive = req.query.include_inactive === "true";
    const schedules = await getAllAutomationSchedules(includeInactive);

    return jsonResponse(res, {
      success: true,
      data: schedules.map(serializeSchedule),
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
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Schedule details
 */
router.get("/schedules/:id", async (req: Request, res: Response) => {
  try {
    const id = BigInt(req.params.id);
    const schedule = await getAutomationScheduleById(id);

    if (!schedule) {
      return res.status(404).json({
        success: false,
        error: "Schedule not found",
      });
    }

    // Enhanced response with diagnostic information
    const serialized = serializeSchedule(schedule);

    return jsonResponse(res, {
      success: true,
      data: {
        ...serialized,
        runs: schedule.runs?.map(serializeRun),
        // Add diagnostic info for troubleshooting
        _diagnostic: {
          specificAuditConfigsCount: schedule.specificAuditConfigs?.length || 0,
          specificAuditConfigsRaw: schedule.specificAuditConfigs
            ? schedule.specificAuditConfigs.map((id: bigint) => String(id))
            : [],
          useAutomaticAudits: schedule.useAutomaticAudits,
          runAudits: schedule.runAudits,
        },
      },
    });
  } catch (error: any) {
    logger.error("Failed to get automation schedule", { error: error.message });
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
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Schedule updated
 */
router.patch("/schedules/:id", async (req: Request, res: Response) => {
  try {
    const id = BigInt(req.params.id);
    const data = AutomationScheduleUpdateSchema.parse(req.body);
    const schedule = await updateAutomationSchedule(id, data);

    logger.info("Automation schedule updated", {
      id: String(schedule.id),
      name: schedule.name,
    });

    return jsonResponse(res, {
      success: true,
      data: serializeSchedule(schedule),
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
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Schedule deleted
 */
router.delete("/schedules/:id", async (req: Request, res: Response) => {
  try {
    const id = BigInt(req.params.id);
    await deleteAutomationSchedule(id);

    logger.info("Automation schedule deleted", { id: String(id) });

    return jsonResponse(res, {
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

/**
 * @swagger
 * /api/automation/trigger:
 *   post:
 *     summary: Trigger automation schedule manually
 *     tags: [Automation]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               scheduleId:
 *                 type: number
 *               overrideFicheSelection:
 *                 type: object
 *     responses:
 *       200:
 *         description: Automation triggered
 */
router.post("/trigger", async (req: Request, res: Response) => {
  try {
    const data = TriggerAutomationSchema.parse(req.body);

    logger.info("Triggering automation", {
      schedule_id: data.scheduleId,
      has_override: Boolean(data.overrideFicheSelection),
      inngest_config: {
        base_url: process.env.INNGEST_BASE_URL || "cloud",
        is_dev: process.env.INNGEST_DEV,
        has_event_key: Boolean(process.env.INNGEST_EVENT_KEY),
        node_env: process.env.NODE_ENV,
      },
    });

    // Send event to Inngest
    const result = await inngest.send({
      name: "automation/run" as "automation/run",
      data: {
        schedule_id: data.scheduleId,
        override_fiche_selection: data.overrideFicheSelection,
      },
    });

    logger.info("Automation triggered successfully", {
      schedule_id: data.scheduleId,
      event_ids: result.ids,
    });

    return jsonResponse(res, {
      success: true,
      message: "Automation triggered successfully",
      schedule_id: data.scheduleId,
      event_ids: result.ids,
    });
  } catch (error: any) {
    logger.error("Failed to trigger automation", {
      error: error.message,
      error_stack: error.stack,
      error_name: error.name,
      error_cause: error.cause,
      inngest_debug: {
        base_url: process.env.INNGEST_BASE_URL,
        is_dev: process.env.INNGEST_DEV,
        has_event_key: Boolean(process.env.INNGEST_EVENT_KEY),
        has_signing_key: Boolean(process.env.INNGEST_SIGNING_KEY),
      },
    });
    res.status(500).json({
      success: false,
      error: error.message,
      debug: {
        inngest_mode:
          process.env.INNGEST_DEV === "1" ? "development" : "production",
        inngest_configured: Boolean(
          process.env.INNGEST_DEV === "1" || process.env.INNGEST_BASE_URL
        ),
      },
    });
  }
});

/**
 * @swagger
 * /api/automation/diagnostic:
 *   get:
 *     summary: Get Inngest configuration diagnostic
 *     tags: [Automation]
 *     responses:
 *       200:
 *         description: Diagnostic information
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

    return jsonResponse(res, {
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

/**
 * @swagger
 * /api/automation/schedules/{id}/runs:
 *   get:
 *     summary: Get runs for a schedule
 *     tags: [Automation]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *       - in: query
 *         name: limit
 *         schema:
 *           type: number
 *       - in: query
 *         name: offset
 *         schema:
 *           type: number
 *     responses:
 *       200:
 *         description: List of runs
 */
router.get("/schedules/:id/runs", async (req: Request, res: Response) => {
  try {
    const id = BigInt(req.params.id);
    const limit = parseInt(req.query.limit as string) || 20;
    const offset = parseInt(req.query.offset as string) || 0;

    const runs = await getAutomationRuns(id, limit, offset);

    return jsonResponse(res, {
      success: true,
      data: runs.map(serializeRun),
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
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *     responses:
 *       200:
 *         description: Run details
 */
router.get("/runs/:id", async (req: Request, res: Response) => {
  try {
    const id = BigInt(req.params.id);
    const run = await getAutomationRunById(id);

    if (!run) {
      return res.status(404).json({
        success: false,
        error: "Run not found",
      });
    }

    return jsonResponse(res, {
      success: true,
      data: serializeRun(run),
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
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *       - in: query
 *         name: level
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Run logs
 */
router.get("/runs/:id/logs", async (req: Request, res: Response) => {
  try {
    const id = BigInt(req.params.id);
    const level = req.query.level as string | undefined;

    const logs = await getAutomationLogs(id, level);

    return jsonResponse(res, {
      success: true,
      data: logs.map(serializeLog),
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

export default router;
