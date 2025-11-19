/**
 * Audit Configs Routes
 * ====================
 * RESPONSIBILITY: HTTP API endpoints
 * - Request/response handling
 * - Input validation
 * - Error handling
 * - Delegates to service layer
 *
 * LAYER: Presentation (HTTP)
 */

import { Router, Request, Response } from "express";
import * as auditConfigsService from "./audit-configs.service.js";
import {
  validateCreateAuditConfigInput,
  validateUpdateAuditConfigInput,
  validateCreateAuditStepInput,
  validateUpdateAuditStepInput,
} from "./audit-configs.schemas.js";
import { logger } from "../../shared/logger.js";

export const auditConfigsRouter = Router();

/**
 * @swagger
 * /api/audit-configs:
 *   get:
 *     tags: [Audit Configs]
 *     summary: List all audit configurations
 *     parameters:
 *       - name: include_inactive
 *         in: query
 *         schema:
 *           type: boolean
 *       - name: include_steps
 *         in: query
 *         schema:
 *           type: boolean
 *       - name: include_stats
 *         in: query
 *         schema:
 *           type: boolean
 */
auditConfigsRouter.get("/", async (req: Request, res: Response) => {
  try {
    const includeInactive = req.query.include_inactive === "true";
    const includeSteps = req.query.include_steps === "true";
    const includeStats = req.query.include_stats === "true";

    if (includeStats) {
      const stats = await auditConfigsService.getAllAuditConfigsWithStats();
      return res.json({
        success: true,
        data: stats,
        count: stats.length,
      });
    }

    const data = await auditConfigsService.getAllAuditConfigs({
      includeInactive,
      includeSteps,
    });

    res.json({
      success: true,
      data,
      count: data.length,
    });
  } catch (error: any) {
    logger.error("Error fetching audit configs", { error: error.message });
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
 *       - name: id
 *         in: path
 *         required: true
 *         schema:
 *           type: string
 *       - name: include_stats
 *         in: query
 *         schema:
 *           type: boolean
 */
auditConfigsRouter.get("/:id", async (req: Request, res: Response) => {
  try {
    const includeStats = req.query.include_stats === "true";
    const config = await auditConfigsService.getAuditConfigById(req.params.id);

    if (!config) {
      return res.status(404).json({
        success: false,
        error: "Audit configuration not found",
      });
    }

    if (includeStats) {
      const stats = await auditConfigsService.getAuditConfigStats(
        req.params.id
      );
      return res.json({
        success: true,
        data: {
          ...config,
          stats,
        },
      });
    }

    res.json({
      success: true,
      data: config,
    });
  } catch (error: any) {
    logger.error("Error fetching audit config", {
      id: req.params.id,
      error: error.message,
    });
    res.status(500).json({
      success: false,
      error: "Failed to fetch audit configuration",
      message: error.message,
    });
  }
});

/**
 * @swagger
 * /api/audit-configs:
 *   post:
 *     tags: [Audit Configs]
 *     summary: Create new audit configuration (atomic transaction)
 *     description: Creates audit config with all steps in a single transaction. All or nothing.
 */
auditConfigsRouter.post("/", async (req: Request, res: Response) => {
  try {
    // Validate input structure first
    const input = validateCreateAuditConfigInput(req.body);

    // Create config (with transaction handling in service layer)
    const config = await auditConfigsService.createAuditConfig(input);

    res.status(201).json({
      success: true,
      data: config,
    });
  } catch (error: any) {
    logger.error("Error creating audit config", {
      error: error.message,
      stepCount: req.body.steps?.length || 0,
    });

    // Return appropriate status code
    const statusCode = error.message.includes("Validation failed") ? 400 : 500;

    res.status(statusCode).json({
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
 */
auditConfigsRouter.put("/:id", async (req: Request, res: Response) => {
  try {
    const input = validateUpdateAuditConfigInput(req.body);
    const config = await auditConfigsService.updateAuditConfig(
      req.params.id,
      input
    );
    res.json({
      success: true,
      data: config,
    });
  } catch (error: any) {
    logger.error("Error updating audit config", {
      id: req.params.id,
      error: error.message,
    });
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
 */
auditConfigsRouter.delete("/:id", async (req: Request, res: Response) => {
  try {
    await auditConfigsService.deleteAuditConfig(req.params.id);
    res.json({ success: true, message: "Audit config deleted" });
  } catch (error: any) {
    logger.error("Error deleting audit config", {
      id: req.params.id,
      error: error.message,
    });
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
 */
auditConfigsRouter.post(
  "/:config_id/steps",
  async (req: Request, res: Response) => {
    try {
      const input = validateCreateAuditStepInput(req.body);
      const step = await auditConfigsService.addAuditStep(
        req.params.config_id,
        input
      );
      res.status(201).json({
        success: true,
        data: step,
      });
    } catch (error: any) {
      logger.error("Error adding audit step", {
        configId: req.params.config_id,
        error: error.message,
      });
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
 */
auditConfigsRouter.put(
  "/steps/:step_id",
  async (req: Request, res: Response) => {
    try {
      const input = validateUpdateAuditStepInput(req.body);
      const step = await auditConfigsService.updateAuditStep(
        req.params.step_id,
        input
      );

      res.json({ success: true, data: step });
    } catch (error: any) {
      logger.error("Error updating audit step", {
        stepId: req.params.step_id,
        error: error.message,
      });
      res.status(400).json({
        success: false,
        error: "Failed to update step",
        message: error.message,
      });
    }
  }
);

/**
 * @swagger
 * /api/audit-steps/{step_id}:
 *   delete:
 *     tags: [Audit Configs]
 *     summary: Delete audit step
 */
auditConfigsRouter.delete(
  "/steps/:step_id",
  async (req: Request, res: Response) => {
    try {
      await auditConfigsService.deleteAuditStep(req.params.step_id);
      res.json({ success: true, message: "Step deleted" });
    } catch (error: any) {
      logger.error("Error deleting audit step", {
        stepId: req.params.step_id,
        error: error.message,
      });
      res.status(400).json({
        success: false,
        error: "Failed to delete step",
        message: error.message,
      });
    }
  }
);

/**
 * @swagger
 * /api/audit-configs/{config_id}/steps/reorder:
 *   put:
 *     tags: [Audit Configs]
 *     summary: Reorder steps in an audit configuration
 */
auditConfigsRouter.put(
  "/:config_id/steps/reorder",
  async (req: Request, res: Response) => {
    try {
      const { stepIds } = req.body;
      if (!Array.isArray(stepIds)) {
        return res.status(400).json({
          success: false,
          error: "stepIds must be an array",
        });
      }

      await auditConfigsService.reorderSteps(req.params.config_id, stepIds);
      res.json({
        success: true,
        message: "Steps reordered successfully",
      });
    } catch (error: any) {
      logger.error("Error reordering audit steps", {
        configId: req.params.config_id,
        error: error.message,
      });
      res.status(400).json({
        success: false,
        error: "Failed to reorder steps",
        message: error.message,
      });
    }
  }
);

/**
 * @swagger
 * /api/audit-configs/{config_id}/validate:
 *   get:
 *     tags: [Audit Configs]
 *     summary: Validate audit config for running
 */
auditConfigsRouter.get(
  "/:config_id/validate",
  async (req: Request, res: Response) => {
    try {
      const validation = await auditConfigsService.validateAuditConfigForRun(
        req.params.config_id
      );
      res.json({
        success: true,
        data: validation,
      });
    } catch (error: any) {
      logger.error("Error validating audit config", {
        configId: req.params.config_id,
        error: error.message,
      });
      res.status(500).json({
        success: false,
        error: "Failed to validate audit config",
        message: error.message,
      });
    }
  }
);

/**
 * @swagger
 * /api/audit-configs/{config_id}/stats:
 *   get:
 *     tags: [Audit Configs]
 *     summary: Get audit config usage statistics
 */
auditConfigsRouter.get(
  "/:config_id/stats",
  async (req: Request, res: Response) => {
    try {
      const stats = await auditConfigsService.getAuditConfigStats(
        req.params.config_id
      );
      res.json({
        success: true,
        data: stats,
      });
    } catch (error: any) {
      logger.error("Error fetching audit config stats", {
        configId: req.params.config_id,
        error: error.message,
      });
      res.status(500).json({
        success: false,
        error: "Failed to fetch audit config statistics",
        message: error.message,
      });
    }
  }
);
