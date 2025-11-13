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

const router = Router();

/**
 * Helper function to serialize BigInt fields to strings
 */
function serializeSchedule(schedule: any) {
  const { id, scheduleId, specificAuditConfigs, ...rest } = schedule;
  return {
    ...(id && { id: String(id) }),
    ...(scheduleId && { scheduleId: String(scheduleId) }),
    // Always include specificAuditConfigs, even if it's an empty array
    specificAuditConfigs: specificAuditConfigs
      ? specificAuditConfigs.map((configId: any) => String(configId))
      : [],
    ...rest,
  };
}

function serializeRun(run: any) {
  const { id, scheduleId, ...rest } = run;
  return {
    id: String(id),
    scheduleId: String(scheduleId),
    ...rest,
    ...(run.logs && {
      logs: run.logs.map((log: any) => ({
        id: String(log.id),
        runId: String(log.runId),
        ...log,
      })),
    }),
  };
}

function serializeLog(log: any) {
  const { id, runId, ...rest } = log;
  return {
    id: String(id),
    runId: String(runId),
    ...rest,
  };
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

    res.status(201).json({
      success: true,
      data: serializeSchedule(schedule),
    });
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

    res.json({
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
    
    res.json({
      success: true,
      data: {
        ...serialized,
        runs: schedule.runs?.map(serializeRun),
        // Add diagnostic info for troubleshooting
        _diagnostic: {
          specificAuditConfigsCount: schedule.specificAuditConfigs?.length || 0,
          specificAuditConfigsRaw: schedule.specificAuditConfigs,
          useAutomaticAudits: schedule.useAutomaticAudits,
          runAudits: schedule.runAudits,
        }
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

    res.json({
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

    // Send event to Inngest
    await inngest.send({
      name: "automation/run" as "automation/run",
      data: {
        schedule_id: data.scheduleId,
        override_fiche_selection: data.overrideFicheSelection,
      },
    });

    logger.info("Automation triggered", {
      schedule_id: data.scheduleId,
      has_override: Boolean(data.overrideFicheSelection),
    });

    res.json({
      success: true,
      message: "Automation triggered successfully",
      schedule_id: data.scheduleId,
    });
  } catch (error: any) {
    logger.error("Failed to trigger automation", { error: error.message });
    res.status(400).json({
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

    res.json({
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

    res.json({
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

    res.json({
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
