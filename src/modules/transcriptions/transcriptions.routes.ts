/**
 * Transcriptions Routes
 * =====================
 * API endpoints for transcription operations
 */

import { type Request, type Response,Router } from "express";

import { inngest } from "../../inngest/client.js";
import { asyncHandler } from "../../middleware/async-handler.js";
import { requirePermission } from "../../middleware/authz.js";
import { getRequestAuth, isUserAuth } from "../../shared/auth-context.js";
import { AuthorizationError } from "../../shared/errors.js";
import { logger } from "../../shared/logger.js";
import { prisma } from "../../shared/prisma.js";
import { getFicheTranscriptionStatus } from "./transcriptions.service.js";

export const transcriptionsRouter = Router();

type Scope = "ALL" | "GROUP" | "SELF";
type ScopeContext = { scope: Scope; groupes: string[]; crmUserId: string | null };

function getTranscriptionsScope(req: Request, action: "read" | "write"): ScopeContext {
  const auth = getRequestAuth(req);
  if (!auth || auth.kind === "apiToken") {
    return { scope: "ALL", groupes: [], crmUserId: null };
  }
  if (!isUserAuth(auth)) {
    return { scope: "SELF", groupes: [], crmUserId: null };
  }

  const grant = auth.permissions.find((p) => p.key === "transcriptions");
  const scope = action === "read" ? (grant?.read_scope ?? "SELF") : (grant?.write_scope ?? "SELF");
  return {
    scope,
    groupes: Array.isArray(auth.groupes) ? auth.groupes : [],
    crmUserId: auth.crmUserId ?? null,
  };
}

async function assertFicheIdsVisible(
  req: Request,
  ficheIds: string[],
  action: "read" | "write"
): Promise<void> {
  const scope = getTranscriptionsScope(req, action);
  if (scope.scope === "ALL") {return;}

  const uniqueIds = Array.from(new Set(ficheIds.map(String))).filter((id) => id.trim());
  if (!uniqueIds.length) {return;}

  const rows =
    scope.scope === "GROUP"
      ? await prisma.ficheCache.findMany({
          where: {
            ficheId: { in: uniqueIds },
            OR: [
              { groupe: { in: scope.groupes } },
              { information: { is: { groupe: { in: scope.groupes } } } },
            ],
          },
          select: { ficheId: true },
        })
      : await prisma.ficheCache.findMany({
          where: {
            ficheId: { in: uniqueIds },
            information: {
              is: { attributionUserId: scope.crmUserId ? scope.crmUserId : "__none__" },
            },
          },
          select: { ficheId: true },
        });

  const allowed = new Set(rows.map((r) => r.ficheId));
  const allAllowed = uniqueIds.every((id) => allowed.has(id));
  if (!allAllowed) {
    throw new AuthorizationError("Forbidden");
  }
}

async function assertFicheVisible(
  req: Request,
  ficheId: string,
  action: "read" | "write"
): Promise<void> {
  await assertFicheIdsVisible(req, [ficheId], action);
}

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
  requirePermission("transcriptions.write"),
  asyncHandler(async (req: Request, res: Response) => {
    const { fiche_id } = req.params;
    await assertFicheVisible(req, fiche_id, "write");
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
  requirePermission("transcriptions.read"),
  asyncHandler(async (req: Request, res: Response) => {
    await assertFicheVisible(req, req.params.fiche_id, "read");
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
  requirePermission("transcriptions.read"),
  asyncHandler(async (req: Request, res: Response) => {
    const { fiche_id, call_id } = req.params;
    await assertFicheVisible(req, fiche_id, "read");

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
  requirePermission("transcriptions.write"),
  asyncHandler(async (req: Request, res: Response) => {
    const { fiche_ids, priority = "normal" } = req.body;

    if (!fiche_ids || !Array.isArray(fiche_ids)) {
      return res.status(400).json({
        success: false,
        error: "Invalid request - fiche_ids array required",
      });
    }

    await assertFicheIdsVisible(req, fiche_ids, "write");

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
