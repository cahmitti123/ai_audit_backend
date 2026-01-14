/**
 * Audit Step Re-Run Routes
 * =========================
 * API endpoints for re-running individual audit steps
 */

import { Router, type Request, type Response } from "express";
import { logger } from "../../shared/logger.js";
import { jsonResponse } from "../../shared/bigint-serializer.js";
import { inngest } from "../../inngest/client.js";
import { asyncHandler } from "../../middleware/async-handler.js";
import { ValidationError } from "../../shared/errors.js";

export const auditRerunRouter = Router();

/**
 * @swagger
 * /api/audits/{audit_id}/steps/{step_position}/rerun:
 *   post:
 *     tags: [Audits]
 *     summary: Re-run a single audit step
 *     description: |
 *       Queues async re-analysis of a specific audit step.
 *       Returns immediately with event_id for tracking.
 *       Results sent via webhook when complete.
 *       
 *       Process:
 *       1. Queues Inngest job
 *       2. Returns event_id immediately
 *       3. Job regenerates timeline from DB
 *       4. Re-links to product database
 *       5. Re-analyzes step with optional custom prompt
 *       6. Sends webhook with comparison results
 *     parameters:
 *       - in: path
 *         name: audit_id
 *         required: true
 *         schema:
 *           type: string
 *         description: The audit database ID
 *       - in: path
 *         name: step_position
 *         required: true
 *         schema:
 *           type: integer
 *         description: Step position (1-17)
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               customPrompt:
 *                 type: string
 *                 description: Additional instructions for the AI analyzer
 *                 example: "Focus specifically on whether the agent mentioned Bloctel compliance in the first 2 minutes"
 *               customInstructions:
 *                 type: string
 *                 description: Alternative field for custom instructions
 *           examples:
 *             basic:
 *               summary: Basic re-run
 *               value: {}
 *             with_guidance:
 *               summary: With custom instructions
 *               value:
 *                 customPrompt: "Please verify if the agent mentioned the cooling-off period, even if not explicitly using those words"
 *     responses:
 *       200:
 *         description: Re-run job queued successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 message:
 *                   type: string
 *                 event_id:
 *                   type: string
 *                   description: Inngest event ID for tracking
 *                 audit_id:
 *                   type: string
 *                 step_position:
 *                   type: integer
 *       404:
 *         description: Audit or step not found
 *       500:
 *         description: Re-run failed
 */
auditRerunRouter.post(
  "/:audit_id/steps/:step_position/rerun",
  asyncHandler(async (req: Request, res: Response) => {
    const auditId = req.params.audit_id;
    const stepPosition = Number.parseInt(req.params.step_position, 10);

    if (!Number.isFinite(stepPosition) || stepPosition <= 0) {
      throw new ValidationError("Invalid step_position");
    }

    const body = req.body as {
      customPrompt?: unknown;
      customInstructions?: unknown;
    };
    const custom_prompt =
      typeof body.customPrompt === "string" && body.customPrompt.trim().length > 0
        ? body.customPrompt
        : typeof body.customInstructions === "string" &&
            body.customInstructions.trim().length > 0
          ? body.customInstructions
          : undefined;

    logger.info("Queuing audit step re-run", {
      audit_id: auditId,
      step_position: stepPosition,
      has_custom_prompt: Boolean(custom_prompt),
    });

    // Send event to Inngest (async processing)
    const { ids } = await inngest.send({
      name: "audit/step-rerun",
      data: {
        audit_id: auditId,
        step_position: stepPosition,
        custom_prompt,
      },
      id: `step-rerun-${auditId}-${stepPosition}-${Date.now()}`,
    });

    logger.info("Step re-run queued", {
      audit_id: auditId,
      step_position: stepPosition,
      event_id: ids[0],
    });

    return jsonResponse(res, {
      success: true,
      message: "Step re-run queued",
      event_id: ids[0],
      audit_id: auditId,
      step_position: stepPosition,
    });
  })
);

/**
 * @swagger
 * /api/audits/{audit_id}/steps/{step_position}/control-points/{control_point_index}/rerun:
 *   post:
 *     tags: [Audits]
 *     summary: Re-run a single control point (sub-step) within an audit step
 *     description: |
 *       Queues async re-analysis of ONE control point (`points_controle[i]`) inside a step.
 *       This is useful for targeted retries with additional guidance, without rerunning the full step.
 *
 *       Contextualisation:
 *       - Rebuilds timeline from DB (authoritative transcript)
 *       - Uses the step definition from the audit config
 *       - Includes the previous control point result as context
 *       - Appends optional custom prompt/instructions from the request
 *     parameters:
 *       - in: path
 *         name: audit_id
 *         required: true
 *         schema:
 *           type: string
 *         description: The audit database ID
 *       - in: path
 *         name: step_position
 *         required: true
 *         schema:
 *           type: integer
 *         description: Step position (1-based)
 *       - in: path
 *         name: control_point_index
 *         required: true
 *         schema:
 *           type: integer
 *         description: 1-based index in the step's configured controlPoints array
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               customPrompt:
 *                 type: string
 *                 description: Additional instructions for the AI analyzer
 *               customInstructions:
 *                 type: string
 *                 description: Alias for customPrompt
 *     responses:
 *       200:
 *         description: Control point re-run job queued successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 message:
 *                   type: string
 *                 event_id:
 *                   type: string
 *                 audit_id:
 *                   type: string
 *                 step_position:
 *                   type: integer
 *                 control_point_index:
 *                   type: integer
 */
auditRerunRouter.post(
  "/:audit_id/steps/:step_position/control-points/:control_point_index/rerun",
  asyncHandler(async (req: Request, res: Response) => {
    const auditId = req.params.audit_id;
    const stepPosition = Number.parseInt(req.params.step_position, 10);
    const controlPointIndex = Number.parseInt(req.params.control_point_index, 10);

    if (!Number.isFinite(stepPosition) || stepPosition <= 0) {
      throw new ValidationError("Invalid step_position");
    }
    if (!Number.isFinite(controlPointIndex) || controlPointIndex <= 0) {
      throw new ValidationError("Invalid control_point_index");
    }

    const body = req.body as {
      customPrompt?: unknown;
      customInstructions?: unknown;
    };
    const custom_prompt =
      typeof body.customPrompt === "string" && body.customPrompt.trim().length > 0
        ? body.customPrompt
        : typeof body.customInstructions === "string" &&
            body.customInstructions.trim().length > 0
          ? body.customInstructions
          : undefined;

    logger.info("Queuing audit control point re-run", {
      audit_id: auditId,
      step_position: stepPosition,
      control_point_index: controlPointIndex,
      has_custom_prompt: Boolean(custom_prompt),
    });

    const { ids } = await inngest.send({
      name: "audit/step-control-point-rerun",
      data: {
        audit_id: auditId,
        step_position: stepPosition,
        control_point_index: controlPointIndex,
        custom_prompt,
      },
      id: `step-cp-rerun-${auditId}-${stepPosition}-${controlPointIndex}-${Date.now()}`,
    });

    logger.info("Control point re-run queued", {
      audit_id: auditId,
      step_position: stepPosition,
      control_point_index: controlPointIndex,
      event_id: ids[0],
    });

    return jsonResponse(res, {
      success: true,
      message: "Control point re-run queued",
      event_id: ids[0],
      audit_id: auditId,
      step_position: stepPosition,
      control_point_index: controlPointIndex,
    });
  })
);


