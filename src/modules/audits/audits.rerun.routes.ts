/**
 * Audit Step Re-Run Routes
 * =========================
 * API endpoints for re-running individual audit steps
 */

import { Router, Request, Response } from "express";
import { logger } from "../../shared/logger.js";
import { jsonResponse } from "../../shared/bigint-serializer.js";
import { inngest } from "../../inngest/client.js";

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
  async (req: Request, res: Response) => {
    try {
      const auditId = req.params.audit_id;
      const stepPosition = parseInt(req.params.step_position);

      logger.info("Queuing audit step re-run", {
        audit_id: auditId,
        step_position: stepPosition,
        has_custom_prompt: Boolean(
          req.body.customPrompt || req.body.customInstructions
        ),
      });

      // Send event to Inngest (async processing)
      const { ids } = await inngest.send({
        name: "audit/step-rerun",
        data: {
          audit_id: auditId,
          step_position: stepPosition,
          custom_prompt: req.body.customPrompt || req.body.customInstructions,
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
    } catch (error: any) {
      logger.error("Failed to queue step re-run", {
        audit_id: req.params.audit_id,
        step_position: req.params.step_position,
        error: error.message,
      });

      return res.status(500).json({
        success: false,
        error: "Failed to queue step re-run",
        message: error.message,
      });
    }
  }
);


