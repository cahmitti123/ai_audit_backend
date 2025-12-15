import { Router, type Request, type Response } from "express";
import {
  sendWebhook,
  sendNotification,
  auditWebhooks,
  transcriptionWebhooks,
  batchWebhooks,
  WebhookEventType,
} from "../../shared/webhook.js";
import { logger } from "../../shared/logger.js";
import { asyncHandler } from "../../middleware/async-handler.js";

const router = Router();

/**
 * @swagger
 * /api/webhooks/test:
 *   post:
 *     summary: Test webhook delivery
 *     description: Send test webhook events to the frontend for testing purposes
 *     tags:
 *       - Webhooks (Testing)
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               eventType:
 *                 type: string
 *                 enum:
 *                   - audit.started
 *                   - audit.progress
 *                   - audit.completed
 *                   - audit.failed
 *                   - transcription.progress
 *                   - transcription.completed
 *                   - batch.progress
 *                   - batch.completed
 *                   - notification
 *                   - all
 *                 description: Type of webhook event to send (or 'all' to send all types)
 *           examples:
 *             single:
 *               value:
 *                 eventType: "notification"
 *             all:
 *               value:
 *                 eventType: "all"
 *     responses:
 *       200:
 *         description: Webhook(s) sent successfully
 *       400:
 *         description: Invalid event type
 *       500:
 *         description: Webhook delivery failed
 */
router.post("/test", asyncHandler(async (req: Request, res: Response) => {
  const { eventType } = req.body as { eventType?: unknown };

  if (!eventType) {
    return res.status(400).json({
      success: false,
      error: "eventType is required",
    });
  }

  const results: Record<string, boolean> = {};

  // Send all event types for testing
  if (eventType === "all") {
    results["audit.started"] = await auditWebhooks.started(
      "test-audit-123",
      "1762209",
      "13",
      "Audit Rapide (5 étapes)",
      5 // totalSteps
    );

      results["audit.progress"] = await auditWebhooks.progress(
        "test-audit-123",
        "1762209",
        3, // completedSteps
        5, // totalSteps
        0, // failedSteps
        "analysis" // currentPhase
      );

      results["audit.completed"] = await auditWebhooks.completed(
        "test-audit-123",
        "1762209",
        "85/100", // overallScore
        "85.00%", // scorePercentage
        "BON",
        true, // isCompliant
        5, // successfulSteps
        0, // failedSteps
        245000, // totalTokens
        120 // durationSeconds
      );

      results["audit.failed"] = await auditWebhooks.failed(
        "test-audit-456",
        "1720487",
        "Transcription not available for this fiche",
        "transcription" // failedPhase
      );

      results["transcription.progress"] = await transcriptionWebhooks.progress(
        "1762209",
        5, // totalRecordings
        3, // transcribed
        2, // pending
        0 // failed
      );

      results["transcription.completed"] =
        await transcriptionWebhooks.completed(
          "1762209",
          5, // totalRecordings
          5, // transcribed
          0, // failed
          300 // durationSeconds
        );

      results["batch.progress"] = await batchWebhooks.progress(
        "batch-789",
        "audit",
        10,
        6,
        1
      );

      results["batch.completed"] = await batchWebhooks.completed(
        "batch-789",
        "audit",
        10,
        9,
        1,
        300000
      );

      results["notification"] = await sendNotification(
        "success",
        "Test Notification",
        "This is a test notification from the webhook test endpoint"
      );

    const successCount = Object.values(results).filter((r) => r).length;

    return res.json({
      success: true,
      message: `Sent ${successCount}/${Object.keys(results).length} test webhooks`,
      results,
    });
  }

  // Send specific event type
  let success = false;

  switch (eventType as WebhookEventType) {
    case "audit.started":
      success = await auditWebhooks.started(
        "test-audit-123",
        "1762209",
        "13",
        "Audit Rapide (5 étapes)",
        5 // totalSteps
      );
      break;

      case "audit.progress":
        success = await auditWebhooks.progress(
          "test-audit-123",
          "1762209",
          3, // completedSteps
          5, // totalSteps
          0, // failedSteps
          "analysis" // currentPhase
        );
        break;

      case "audit.completed":
        success = await auditWebhooks.completed(
          "test-audit-123",
          "1762209",
          "85/100", // overallScore
          "85.00%", // scorePercentage
          "BON",
          true, // isCompliant
          5, // successfulSteps
          0, // failedSteps
          245000, // totalTokens
          120 // durationSeconds
        );
        break;

      case "audit.failed":
        success = await auditWebhooks.failed(
          "test-audit-123",
          "1762209",
          "Transcription not available for this fiche",
          "transcription" // failedPhase
        );
        break;

      case "transcription.progress":
        success = await transcriptionWebhooks.progress(
          "1762209",
          5, // totalRecordings
          3, // transcribed
          2, // pending
          0 // failed
        );
        break;

      case "transcription.completed":
        success = await transcriptionWebhooks.completed(
          "1762209",
          5, // totalRecordings
          5, // transcribed
          0, // failed
          300 // durationSeconds
        );
        break;

      case "batch.progress":
        success = await batchWebhooks.progress("batch-789", "audit", 10, 6, 1);
        break;

      case "batch.completed":
        success = await batchWebhooks.completed(
          "batch-789",
          "audit",
          10,
          9,
          1,
          300000
        );
        break;

      case "notification":
        success = await sendNotification(
          "success",
          "Test Notification",
          "This is a test notification from the webhook test endpoint"
        );
        break;

    default:
      return res.status(400).json({
        success: false,
        error: `Unknown event type: ${eventType}`,
      });
  }

  return res.json({
    success: true,
    eventType,
    delivered: success,
    message: success
      ? `Webhook ${eventType} sent successfully`
      : `Webhook ${eventType} failed to send`,
  });
}));

/**
 * @swagger
 * /api/webhooks/test/workflow:
 *   post:
 *     summary: Simulate a complete audit workflow
 *     description: Sends a sequence of webhooks simulating a full audit lifecycle
 *     tags:
 *       - Webhooks (Testing)
 *     requestBody:
 *       required: false
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               delay:
 *                 type: number
 *                 description: Delay in milliseconds between events (default 1000)
 *                 example: 2000
 *     responses:
 *       200:
 *         description: Workflow simulation completed
 */
router.post("/test/workflow", asyncHandler(async (req: Request, res: Response) => {
  const delayRaw = (req.body as { delay?: unknown })?.delay;
  const delay = typeof delayRaw === "number" ? delayRaw : 1000;
  const auditId = `test-audit-${Date.now()}`;
  const ficheId = "1762209";

  // Start workflow in background
  void (async () => {
    logger.info("Starting webhook workflow simulation", { auditId });

      // 1. Audit started
      await auditWebhooks.started(
        auditId,
        ficheId,
        "13",
        "Audit Rapide (5 étapes)",
        5 // totalSteps
      );
      await new Promise((resolve) => setTimeout(resolve, delay));

      // 2-6. Progress updates
      const steps = [
        "Vérification de l'identité",
        "Vérification des documents",
        "Analyse de la conformité",
        "Vérification finale",
        "Génération du rapport",
      ];

      for (let i = 0; i < steps.length; i++) {
        await auditWebhooks.progress(
          auditId,
          ficheId,
          i + 1, // completedSteps
          steps.length, // totalSteps
          0, // failedSteps
          "analysis" // currentPhase
        );
        await new Promise((resolve) => setTimeout(resolve, delay));
      }

      // 7. Completed
      await auditWebhooks.completed(
        auditId,
        ficheId,
        "85/100", // overallScore
        "85.00%", // scorePercentage
        "BON",
        true, // isCompliant
        5, // successfulSteps
        0, // failedSteps
        245000, // totalTokens
        Math.round((steps.length * delay) / 1000) // durationSeconds
      );

    logger.info("Webhook workflow simulation completed", { auditId });
  })().catch((error) => {
    const msg = error instanceof Error ? error.message : String(error);
    logger.error("Workflow simulation background error", { auditId, error: msg });
  });

  return res.json({
    success: true,
    message: "Workflow simulation started",
    auditId,
    steps: 7,
    estimatedDuration: `${(7 * delay) / 1000}s`,
  });
}));

/**
 * @swagger
 * /api/webhooks/test/custom:
 *   post:
 *     summary: Send custom webhook event
 *     description: Send a custom webhook with an arbitrary supported event type and data
 *     tags:
 *       - Webhooks (Testing)
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               event:
 *                 type: string
 *                 description: Event type
 *                 example: "audit.progress"
 *               data:
 *                 type: object
 *                 description: Event data
 *               source:
 *                 type: string
 *                 description: Source service name
 *                 example: "test-service"
 *     responses:
 *       200:
 *         description: Custom webhook sent
 */
router.post("/test/custom", asyncHandler(async (req: Request, res: Response) => {
  const { event, data, source } = req.body as {
    event?: unknown;
    data?: unknown;
    source?: unknown;
  };

  if (!event || !data) {
    return res.status(400).json({
      success: false,
      error: "event and data are required",
    });
  }

  if (typeof event !== "string") {
    return res.status(400).json({
      success: false,
      error: "event must be a string",
    });
  }
  if (typeof data !== "object" || data === null || Array.isArray(data)) {
    return res.status(400).json({
      success: false,
      error: "data must be an object",
    });
  }

  const success = await sendWebhook(
    event as WebhookEventType,
    data as Record<string, unknown>,
    typeof source === "string" && source.trim().length > 0 ? source : "custom-test"
  );

  return res.json({
    success: true,
    delivered: success,
    message: success ? "Custom webhook sent" : "Custom webhook failed",
  });
}));

export default router;
