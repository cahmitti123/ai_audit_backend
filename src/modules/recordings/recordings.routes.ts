/**
 * Recordings Routes
 * =================
 * API endpoints for recording operations
 */

import { Router, Request, Response } from "express";
import { asyncHandler } from "../../middleware/async-handler.js";
import { jsonResponse } from "../../shared/bigint-serializer.js";

export const recordingsRouter = Router();

/**
 * @swagger
 * /api/recordings/{fiche_id}:
 *   get:
 *     tags: [Recordings]
 *     summary: Get all recordings for a fiche
 *     description: Returns all audio recordings associated with a specific fiche
 *     parameters:
 *       - in: path
 *         name: fiche_id
 *         required: true
 *         schema:
 *           type: string
 *         description: The fiche ID to get recordings for
 *     responses:
 *       200:
 *         description: List of recordings with metadata
 *       500:
 *         description: Server error
 */
recordingsRouter.get(
  "/:fiche_id",
  asyncHandler(async (req: Request, res: Response) => {
    const { getRecordingsByFiche } = await import("./recordings.repository.js");
    const recordings = await getRecordingsByFiche(req.params.fiche_id);
    return jsonResponse(res, {
      success: true,
      data: recordings,
      count: recordings.length,
    });
  })
);
