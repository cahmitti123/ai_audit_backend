/**
 * Transcriptions Routes
 * =====================
 * API endpoints for transcription operations
 */

import { type Request, type Response,Router } from "express";

import { inngest } from "../../inngest/client.js";
import { asyncHandler } from "../../middleware/async-handler.js";
import { logger } from "../../shared/logger.js";
import { getFicheTranscriptionStatus } from "./transcriptions.service.js";

export const transcriptionsRouter = Router();

function hasWordsArray(
  value: unknown
): value is { words: unknown[] } {
  return (
    typeof value === "object" &&
    value !== null &&
    Array.isArray((value as { words?: unknown }).words)
  );
}

/**
 * @swagger
 * /api/transcriptions/{fiche_id}:
 *   post:
 *     tags: [Transcriptions]
 *     summary: Queue transcription for a fiche (async with Inngest)
 *     description: Queues a transcription job to Inngest for async processing
 *     parameters:
 *       - in: path
 *         name: fiche_id
 *         required: true
 *         schema:
 *           type: string
 *       - in: query
 *         name: priority
 *         schema:
 *           type: string
 *           enum: [high, normal, low]
 *         description: Transcription priority level
 *         default: normal
 *     responses:
 *       200:
 *         description: Transcription job queued successfully
 */
transcriptionsRouter.post(
  "/:fiche_id(\\d+)",
  asyncHandler(async (req: Request, res: Response) => {
    const { fiche_id } = req.params;
    const priorityParam = req.query.priority as string | undefined;
    const priority: "high" | "normal" | "low" =
      priorityParam === "high" || priorityParam === "low"
        ? priorityParam
        : "normal";

    // Queue transcription job to Inngest
    const eventId = `transcribe-${fiche_id}-${Date.now()}`;
    const { ids } = await inngest.send({
      name: "fiche/transcribe",
      data: { fiche_id, priority, wait_for_completion: false },
      id: eventId,
    });

    logger.info("Queued transcription job", {
      fiche_id,
      event_id: ids[0],
      priority,
    });

    return res.json({
      success: true,
      message: "Transcription job queued",
      fiche_id,
      event_id: ids[0],
    });
  })
);

/**
 * @swagger
 * /api/transcriptions/{fiche_id}/status:
 *   get:
 *     tags: [Transcriptions]
 *     summary: Get transcription status for a fiche
 *     parameters:
 *       - in: path
 *         name: fiche_id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Transcription status
 */
transcriptionsRouter.get(
  "/:fiche_id/status",
  asyncHandler(async (req: Request, res: Response) => {
    const status = await getFicheTranscriptionStatus(req.params.fiche_id);
    return res.json({ success: true, data: status });
  })
);

/**
 * @swagger
 * /api/transcriptions/{fiche_id}/recordings/{call_id}:
 *   get:
 *     tags: [Transcriptions]
 *     summary: Get transcription for a specific recording
 *     parameters:
 *       - in: path
 *         name: fiche_id
 *         required: true
 *         schema:
 *           type: string
 *       - in: path
 *         name: call_id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Recording transcription data
 *       404:
 *         description: Recording or transcription not found
 */
transcriptionsRouter.get(
  "/:fiche_id/recordings/:call_id",
  asyncHandler(async (req: Request, res: Response) => {
    const { fiche_id, call_id } = req.params;

    const { prisma } = await import("../../shared/prisma.js");

    // Get recording from DB
    const recording = await prisma.recording.findFirst({
      where: {
        ficheCache: { ficheId: fiche_id },
        callId: call_id,
      },
    });

    if (!recording) {
      return res.status(404).json({
        success: false,
        error: "Recording not found",
      });
    }

    if (!recording.hasTranscription) {
      return res.status(404).json({
        success: false,
        error: "No transcription available for this recording",
      });
    }

    // Try DB first, then file cache fallback
    let transcriptionData;

    const dbPayload = recording.transcriptionData as unknown;
    if (
      dbPayload &&
      typeof dbPayload === "object" &&
      hasWordsArray(dbPayload) &&
      dbPayload.words.length > 0
    ) {
      transcriptionData = dbPayload;
    } else if (recording.transcriptionText) {
      transcriptionData = {
        text: recording.transcriptionText,
        language_code: recording.transcriptionLanguageCode || "fr",
        ...(typeof recording.transcriptionLanguageProbability === "number"
          ? { language_probability: recording.transcriptionLanguageProbability }
          : {}),
        words: [],
      };
    }

    if (!transcriptionData) {
      return res.status(404).json({
        success: false,
        error: "Transcription data not found in DB",
      });
    }

    return res.json({
      success: true,
      data: {
        call_id: recording.callId,
        recording_url: recording.recordingUrl,
        duration_seconds: recording.durationSeconds,
        transcription_id: recording.transcriptionId,
        transcription: transcriptionData,
        has_transcription: true,
      },
    });
  })
);

/**
 * @swagger
 * /api/transcriptions/batch:
 *   post:
 *     tags: [Transcriptions]
 *     summary: Batch transcribe multiple fiches (async with Inngest)
 *     description: Queues transcription jobs for multiple fiches to Inngest with batching
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - fiche_ids
 *             properties:
 *               fiche_ids:
 *                 type: array
 *                 items:
 *                   type: string
 *                 description: Array of fiche identifiers to transcribe
 *                 example: ["1762209", "1753254"]
 *               priority:
 *                 type: string
 *                 enum: [high, normal, low]
 *                 description: Transcription priority level
 *                 default: normal
 *     responses:
 *       200:
 *         description: Batch transcription jobs queued successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 message:
 *                   type: string
 *                 fiche_ids:
 *                   type: array
 *                   items:
 *                     type: string
 *                 event_ids:
 *                   type: array
 *                   items:
 *                     type: string
 *       400:
 *         description: Invalid request - fiche_ids array required
 *       500:
 *         description: Failed to queue transcriptions
 */
transcriptionsRouter.post(
  "/batch",
  asyncHandler(async (req: Request, res: Response) => {
    const { fiche_ids, priority = "normal" } = req.body;

    if (!fiche_ids || !Array.isArray(fiche_ids)) {
      return res.status(400).json({
        success: false,
        error: "Invalid request - fiche_ids array required",
      });
    }

    // Queue transcription for each fiche with event IDs
    const { ids } = await inngest.send(
      fiche_ids.map((fiche_id) => ({
        name: "fiche/transcribe",
        data: { fiche_id, priority, wait_for_completion: false },
        // Deduplication ID: prevent duplicate transcription requests within 24h
        id: `transcribe-${fiche_id}-${new Date().toISOString().split("T")[0]}`,
      }))
    );

    logger.info("Queued batch transcription jobs", {
      fiche_count: fiche_ids.length,
      priority,
      event_ids_count: ids.length,
    });

    return res.json({
      success: true,
      message: `${fiche_ids.length} transcription jobs queued`,
      fiche_ids,
      event_ids: ids,
    });
  })
);
