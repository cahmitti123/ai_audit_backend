/**
 * Audit Configs Routes
 * ====================
 * API endpoints for audit configuration management
 */

import { Router, Request, Response } from "express";
import {
  getAllAuditConfigs,
  getAuditConfigById,
  createAuditConfig,
  updateAuditConfig,
  deleteAuditConfig,
  addAuditStep,
  updateAuditStep,
  deleteAuditStep,
} from "./audit-configs.repository.js";

export const auditConfigsRouter = Router();

/**
 * @swagger
 * /api/audit-configs:
 *   get:
 *     tags: [Audit Configs]
 *     summary: List all audit configurations
 */
auditConfigsRouter.get("/", async (req: Request, res: Response) => {
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
 */
auditConfigsRouter.get("/:id", async (req: Request, res: Response) => {
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
 * /api/audit-configs:
 *   post:
 *     tags: [Audit Configs]
 *     summary: Create new audit configuration
 */
auditConfigsRouter.post("/", async (req: Request, res: Response) => {
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
 */
auditConfigsRouter.put("/:id", async (req: Request, res: Response) => {
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
 */
auditConfigsRouter.delete("/:id", async (req: Request, res: Response) => {
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
 */
auditConfigsRouter.post(
  "/:config_id/steps",
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
 */
auditConfigsRouter.put(
  "/steps/:step_id",
  async (req: Request, res: Response) => {
    try {
      const step = await updateAuditStep(BigInt(req.params.step_id), req.body);

      // Convert BigInt to string for JSON serialization
      const serializable = JSON.parse(
        JSON.stringify(step, (key, value) =>
          typeof value === "bigint" ? value.toString() : value
        )
      );

      res.json({ success: true, data: serializable });
    } catch (error: any) {
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
      await deleteAuditStep(BigInt(req.params.step_id));
      res.json({ success: true, message: "Step deleted" });
    } catch (error: any) {
      res.status(400).json({
        success: false,
        error: "Failed to delete step",
        message: error.message,
      });
    }
  }
);
