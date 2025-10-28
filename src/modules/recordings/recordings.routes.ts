/**
 * Recordings Routes
 * =================
 * API endpoints for recording operations
 */

import { Router, Request, Response } from "express";
import { inngest } from "../../inngest/client.js";

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
recordingsRouter.get("/:fiche_id", async (req: Request, res: Response) => {
  try {
    const { getRecordingsByFiche } = await import("./recordings.repository.js");
    const recordings = await getRecordingsByFiche(req.params.fiche_id);
    res.json({ success: true, data: recordings, count: recordings.length });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      error: "Failed to fetch recordings",
      message: error.message,
    });
  }
});
