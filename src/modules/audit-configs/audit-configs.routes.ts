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

import { type Request, type Response,Router } from "express";

import { asyncHandler } from "../../middleware/async-handler.js";
import { jsonResponse } from "../../shared/bigint-serializer.js";
import { NotFoundError, ValidationError } from "../../shared/errors.js";
import {
  validateCreateAuditConfigInput,
  validateCreateAuditStepInput,
  validateUpdateAuditConfigInput,
  validateUpdateAuditStepInput,
} from "./audit-configs.schemas.js";
import * as auditConfigsService from "./audit-configs.service.js";

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
auditConfigsRouter.get(
  "/",
  asyncHandler(async (req: Request, res: Response) => {
    const includeInactive = req.query.include_inactive === "true";
    const includeSteps = req.query.include_steps === "true";
    const includeStats = req.query.include_stats === "true";

    if (includeStats) {
      const stats = await auditConfigsService.getAllAuditConfigsWithStats();
      return jsonResponse(res, {
        success: true,
        data: stats,
        count: stats.length,
      });
    }

    const data = await auditConfigsService.getAllAuditConfigs({
      includeInactive,
      includeSteps,
    });

    return jsonResponse(res, {
      success: true,
      data,
      count: data.length,
    });
  })
);

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
auditConfigsRouter.get(
  "/:id",
  asyncHandler(async (req: Request, res: Response) => {
    const includeStats = req.query.include_stats === "true";
    const config = await auditConfigsService.getAuditConfigById(req.params.id);

    if (!config) {
      throw new NotFoundError("Audit config", req.params.id);
    }

    if (includeStats) {
      const stats = await auditConfigsService.getAuditConfigStats(req.params.id);
      return jsonResponse(res, {
        success: true,
        data: {
          ...config,
          stats,
        },
      });
    }

    return jsonResponse(res, {
      success: true,
      data: config,
    });
  })
);

/**
 * @swagger
 * /api/audit-configs:
 *   post:
 *     tags: [Audit Configs]
 *     summary: Create new audit configuration (atomic transaction)
 *     description: Creates audit config with all steps in a single transaction. All or nothing.
 */
auditConfigsRouter.post(
  "/",
  asyncHandler(async (req: Request, res: Response) => {
    // Validate input structure first
    const input = validateCreateAuditConfigInput(req.body);

    // Create config (with transaction handling in service layer)
    const config = await auditConfigsService.createAuditConfig(input);

    return jsonResponse(
      res,
      {
        success: true,
        data: config,
      },
      201
    );
  })
);

/**
 * @swagger
 * /api/audit-configs/{id}:
 *   put:
 *     tags: [Audit Configs]
 *     summary: Update audit configuration
 */
auditConfigsRouter.put(
  "/:id",
  asyncHandler(async (req: Request, res: Response) => {
    const input = validateUpdateAuditConfigInput(req.body);
    const config = await auditConfigsService.updateAuditConfig(req.params.id, input);
    return jsonResponse(res, {
      success: true,
      data: config,
    });
  })
);

/**
 * @swagger
 * /api/audit-configs/{id}:
 *   delete:
 *     tags: [Audit Configs]
 *     summary: Delete audit configuration
 */
auditConfigsRouter.delete(
  "/:id",
  asyncHandler(async (req: Request, res: Response) => {
    await auditConfigsService.deleteAuditConfig(req.params.id);
    return jsonResponse(res, { success: true, message: "Audit config deleted" });
  })
);

/**
 * @swagger
 * /api/audit-configs/{config_id}/steps:
 *   post:
 *     tags: [Audit Configs]
 *     summary: Add step to audit configuration
 */
auditConfigsRouter.post(
  "/:config_id/steps",
  asyncHandler(async (req: Request, res: Response) => {
    const input = validateCreateAuditStepInput(req.body);
    const step = await auditConfigsService.addAuditStep(req.params.config_id, input);
    return jsonResponse(
      res,
      {
        success: true,
        data: step,
      },
      201
    );
  })
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
  asyncHandler(async (req: Request, res: Response) => {
    const input = validateUpdateAuditStepInput(req.body);
    const step = await auditConfigsService.updateAuditStep(req.params.step_id, input);
    return jsonResponse(res, { success: true, data: step });
  })
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
  asyncHandler(async (req: Request, res: Response) => {
    await auditConfigsService.deleteAuditStep(req.params.step_id);
    return jsonResponse(res, { success: true, message: "Step deleted" });
  })
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
  asyncHandler(async (req: Request, res: Response) => {
    const { stepIds } = req.body;
    if (!Array.isArray(stepIds)) {
      throw new ValidationError("stepIds must be an array");
    }

    await auditConfigsService.reorderSteps(req.params.config_id, stepIds);
    return jsonResponse(res, {
      success: true,
      message: "Steps reordered successfully",
    });
  })
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
  asyncHandler(async (req: Request, res: Response) => {
    const validation = await auditConfigsService.validateAuditConfigForRun(
      req.params.config_id
    );
    return jsonResponse(res, {
      success: true,
      data: validation,
    });
  })
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
  asyncHandler(async (req: Request, res: Response) => {
    const stats = await auditConfigsService.getAuditConfigStats(req.params.config_id);
    return jsonResponse(res, {
      success: true,
      data: stats,
    });
  })
);
