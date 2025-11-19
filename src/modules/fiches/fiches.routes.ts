/**
 * Fiches Routes
 * =============
 * RESPONSIBILITY: HTTP endpoints only
 * - Request/response handling
 * - Input validation
 * - Delegates to service layer
 * - No business logic
 *
 * LAYER: Presentation (HTTP)
 */

import { Router, Request, Response } from "express";
import * as fichesApi from "./fiches.api.js";
import * as fichesService from "./fiches.service.js";
import * as fichesRepository from "./fiches.repository.js";
import * as fichesRevalidation from "./fiches.revalidation.js";
import { jsonResponse } from "../../shared/bigint-serializer.js";
import { logger } from "../../shared/logger.js";
import { inngest } from "../../inngest/client.js";
import { prisma } from "../../shared/prisma.js";

export const fichesRouter = Router();

/**
 * @swagger
 * /api/fiches/search:
 *   get:
 *     tags: [Fiches]
 *     summary: Search fiches by date with status information
 *     parameters:
 *       - in: query
 *         name: date
 *         required: true
 *         schema:
 *           type: string
 *           format: date
 *         description: Date in YYYY-MM-DD format
 *       - in: query
 *         name: includeStatus
 *         schema:
 *           type: boolean
 *           default: true
 *         description: Include transcription and audit status
 *     responses:
 *       200:
 *         description: List of fiches with status information
 */
fichesRouter.get("/search", async (req: Request, res: Response) => {
  try {
    const { date, includeStatus } = req.query;

    if (!date || typeof date !== "string") {
      return res.status(400).json({
        success: false,
        error: "Missing or invalid date parameter (YYYY-MM-DD required)",
      });
    }

    // Use service layer for orchestration
    // Use same date for both start and end to search single day
    const shouldIncludeStatus = includeStatus !== "false";
    const result = await fichesService.getSalesByDateRange(
      date,
      date,
      shouldIncludeStatus
    );

    return res.json(result);
  } catch (error) {
    const err = error as Error;
    logger.error("Error fetching fiches", {
      error: err.message,
      date: req.query.date,
    });

    res.status(500).json({
      success: false,
      error: "Failed to fetch fiches",
      message: err.message,
    });
  }
});

/**
 * @swagger
 * /api/fiches/{fiche_id}:
 *   get:
 *     tags: [Fiches]
 *     summary: Get fiche details with recordings (auto-cached or force refresh)
 *     parameters:
 *       - in: path
 *         name: fiche_id
 *         required: true
 *         schema:
 *           type: string
 *       - in: query
 *         name: refresh
 *         schema:
 *           type: string
 *         description: Set to "true" to force refresh from external API and upsert to database
 *     responses:
 *       200:
 *         description: Fiche details
 */
fichesRouter.get("/:fiche_id", async (req: Request, res: Response) => {
  try {
    const { fiche_id } = req.params;
    const { refresh } = req.query;
    const shouldRefresh = refresh === "true";

    // Use service layer for orchestration
    const ficheDetails = await fichesService.getFiche(fiche_id, shouldRefresh);

    return jsonResponse(res, ficheDetails);
  } catch (error) {
    const err = error as Error;
    logger.error("Error fetching fiche details", {
      error: err.message,
      fiche_id: req.params.fiche_id,
      stack: err.stack,
    });
    return res.status(500).json({
      success: false,
      error: "Failed to fetch fiche details",
      message: err.message,
    });
  }
});

/**
 * @swagger
 * /api/fiches/{fiche_id}/cache:
 *   get:
 *     tags: [Fiches]
 *     summary: Get cached fiche data
 *     parameters:
 *       - in: path
 *         name: fiche_id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Cached fiche data
 *       404:
 *         description: Not cached
 */
fichesRouter.get("/:fiche_id/cache", async (req: Request, res: Response) => {
  try {
    const cached = await fichesRepository.getCachedFiche(req.params.fiche_id);

    if (!cached) {
      return res.status(404).json({
        success: false,
        error: "Fiche not cached",
      });
    }

    res.json({
      success: true,
      data: {
        ficheId: cached.ficheId,
        groupe: cached.groupe,
        prospectNom: cached.prospectNom,
        prospectPrenom: cached.prospectPrenom,
        recordingsCount: cached.recordingsCount,
        fetchedAt: cached.fetchedAt,
        expiresAt: cached.expiresAt,
      },
    });
  } catch (error) {
    const err = error as Error;
    res.status(500).json({
      success: false,
      error: "Failed to fetch cached fiche",
      message: err.message,
    });
  }
});

/**
 * @swagger
 * /api/fiches/{fiche_id}/status:
 *   get:
 *     tags: [Fiches]
 *     summary: Get fiche status (transcription and audit info)
 *     parameters:
 *       - in: path
 *         name: fiche_id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Fiche status information
 *       404:
 *         description: Fiche not found in database
 */
fichesRouter.get("/:fiche_id/status", async (req: Request, res: Response) => {
  try {
    const status = await fichesService.getFicheStatus(req.params.fiche_id);

    if (!status) {
      return res.status(404).json({
        success: false,
        error: "Fiche not found in database",
        message:
          "This fiche has not been processed yet. Try fetching it first or run a transcription/audit.",
      });
    }

    res.json({
      success: true,
      data: status,
    });
  } catch (error) {
    const err = error as Error;
    res.status(500).json({
      success: false,
      error: "Failed to fetch fiche status",
      message: err.message,
    });
  }
});

/**
 * @swagger
 * /api/fiches/status/batch:
 *   post:
 *     tags: [Fiches]
 *     summary: Get status for multiple fiches
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               ficheIds:
 *                 type: array
 *                 items:
 *                   type: string
 *     responses:
 *       200:
 *         description: Status information for multiple fiches
 */
fichesRouter.post("/status/batch", async (req: Request, res: Response) => {
  try {
    const { ficheIds } = req.body;

    if (!Array.isArray(ficheIds)) {
      return res.status(400).json({
        success: false,
        error: "ficheIds must be an array",
      });
    }

    const statusMap = await fichesService.getFichesStatus(ficheIds);

    res.json({
      success: true,
      data: statusMap,
    });
  } catch (error) {
    const err = error as Error;
    res.status(500).json({
      success: false,
      error: "Failed to fetch fiches status",
      message: err.message,
    });
  }
});

/**
 * @swagger
 * /api/fiches/status/by-date:
 *   get:
 *     tags: [Fiches]
 *     summary: Get all fiches for a specific date with complete status information
 *     description: Returns all processed fiches for a date with transcription status, audit results, and recording details. Only returns fiches that exist in the database.
 *     parameters:
 *       - in: query
 *         name: date
 *         required: true
 *         schema:
 *           type: string
 *           format: date
 *         description: Date in YYYY-MM-DD format
 *     responses:
 *       200:
 *         description: List of fiches with complete status information
 */
fichesRouter.get("/status/by-date", async (req: Request, res: Response) => {
  try {
    const { date } = req.query;

    if (!date || typeof date !== "string") {
      return res.status(400).json({
        success: false,
        error: "Missing or invalid date parameter (YYYY-MM-DD required)",
      });
    }

    // Validate date format
    const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
    if (!dateRegex.test(date)) {
      return res.status(400).json({
        success: false,
        error: "Invalid date format. Use YYYY-MM-DD",
      });
    }

    const result = await fichesService.getFichesByDateWithStatus(date);

    res.json({
      success: true,
      data: result,
    });
  } catch (error) {
    const err = error as Error;
    logger.error("Error fetching fiches by date with status", {
      error: err.message,
      date: req.query.date,
    });
    res.status(500).json({
      success: false,
      error: "Failed to fetch fiches by date",
      message: err.message,
    });
  }
});

/**
 * @swagger
 * /api/fiches/status/by-date-range:
 *   get:
 *     tags: [Fiches]
 *     summary: Progressive fetch - returns first available data immediately, continues in background
 *     description: |
 *       This endpoint uses a progressive loading strategy:
 *       1. Checks cache for all dates in range
 *       2. Returns cached data + first missing day immediately
 *       3. Fetches remaining days in background
 *       4. Sends webhook notification when complete (if webhookUrl provided)
 *     parameters:
 *       - in: query
 *         name: startDate
 *         required: true
 *         schema:
 *           type: string
 *           format: date
 *         description: Start date in YYYY-MM-DD format
 *       - in: query
 *         name: endDate
 *         required: true
 *         schema:
 *           type: string
 *           format: date
 *         description: End date in YYYY-MM-DD format
 *       - in: query
 *         name: webhookUrl
 *         required: false
 *         schema:
 *           type: string
 *           format: uri
 *         description: URL to receive completion notification
 *       - in: query
 *         name: webhookSecret
 *         required: false
 *         schema:
 *           type: string
 *         description: Secret for webhook HMAC signature
 *     responses:
 *       200:
 *         description: Progressive response with partial/complete data
 */
fichesRouter.get(
  "/status/by-date-range",
  async (req: Request, res: Response) => {
    try {
      const { startDate, endDate, webhookUrl, webhookSecret } = req.query;

      // Validate input
      if (!startDate || typeof startDate !== "string") {
        return res.status(400).json({
          success: false,
          error: "Missing or invalid startDate parameter (YYYY-MM-DD required)",
        });
      }

      if (!endDate || typeof endDate !== "string") {
        return res.status(400).json({
          success: false,
          error: "Missing or invalid endDate parameter (YYYY-MM-DD required)",
        });
      }

      const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
      if (!dateRegex.test(startDate) || !dateRegex.test(endDate)) {
        return res.status(400).json({
          success: false,
          error: "Invalid date format. Use YYYY-MM-DD",
        });
      }

      // Validate date range
      if (new Date(startDate) > new Date(endDate)) {
        return res.status(400).json({
          success: false,
          error: "startDate must be before or equal to endDate",
        });
      }

      // Validate webhook URL if provided
      if (webhookUrl && typeof webhookUrl === "string") {
        try {
          const url = new URL(webhookUrl);
          if (!["http:", "https:"].includes(url.protocol)) {
            return res.status(400).json({
              success: false,
              error: "webhookUrl must use http or https protocol",
            });
          }
        } catch {
          return res.status(400).json({
            success: false,
            error: "Invalid webhookUrl format",
          });
        }
      }

      // Helper to trigger background continuation
      const triggerBackgroundFetch = async (
        jobId: string,
        remainingDates: string[],
        _firstFetchedDate: string | null // Not used anymore
      ) => {
        logger.info("Triggering background fetch continuation", {
          jobId,
          remainingDatesCount: remainingDates.length,
          webhookConfigured: Boolean(webhookUrl),
        });

        await inngest
          .send({
            name: "fiches/progressive-fetch-continue",
            data: {
              jobId,
              startDate,
              endDate,
              datesAlreadyFetched: [], // Background will fetch ALL remaining dates
              webhookUrl: webhookUrl as string | undefined,
              webhookSecret: webhookSecret as string | undefined,
            },
            // Idempotency key prevents duplicate jobs for same job ID
            id: `progressive-fetch-${jobId}`,
          })
          .catch((error) => {
            const err = error as Error;
            logger.error("Failed to trigger background fetch", {
              jobId,
              error: err.message,
            });
          });
      };

      // Use progressive fetch strategy
      const result = await fichesService.getFichesByDateRangeProgressive(
        startDate,
        endDate,
        {
          webhookUrl: webhookUrl as string | undefined,
          webhookSecret: webhookSecret as string | undefined,
          triggerBackgroundFetch,
        }
      );

      res.json({
        success: true,
        ...result,
      });
    } catch (error) {
      const err = error as Error;
      logger.error("Error fetching fiches by date range with status", {
        error: err.message,
        startDate: req.query.startDate,
        endDate: req.query.endDate,
        stack: err.stack,
      });
      res.status(500).json({
        success: false,
        error: "Failed to fetch fiches by date range",
        message: err.message,
      });
    }
  }
);

/**
 * @swagger
 * /api/webhooks/fiches:
 *   get:
 *     tags: [Fiches]
 *     summary: Poll for job updates (used by frontend)
 *     description: Alternative to webhooks - frontend can poll this endpoint for progress
 *     parameters:
 *       - in: query
 *         name: jobId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Job status with partial data
 */
fichesRouter.get("/webhooks/fiches", async (req: Request, res: Response) => {
  try {
    const { jobId } = req.query;

    if (!jobId || typeof jobId !== "string") {
      return res.status(400).json({
        success: false,
        error: "Missing jobId parameter",
      });
    }

    const job = await prisma.progressiveFetchJob.findUnique({
      where: { id: jobId },
    });

    if (!job) {
      return res.status(404).json({
        success: false,
        error: "Notification not found",
        jobId,
      });
    }

    // Get current cached data if job is processing or complete
    let partialFiches: Array<{
      ficheId: string;
      groupe: string | null;
      prospectNom: string | null;
      prospectPrenom: string | null;
      recordingsCount: number;
      createdAt: Date;
    }> = [];

    if (job.status === "processing" || job.status === "complete") {
      const startOfRange = new Date(job.startDate);
      startOfRange.setHours(0, 0, 0, 0);
      const endOfRange = new Date(job.endDate);
      endOfRange.setHours(23, 59, 59, 999);

      const cachedData = await fichesRepository.getFichesByDateRange(
        startOfRange,
        endOfRange
      );

      partialFiches = cachedData.map((fc) => ({
        ficheId: fc.ficheId,
        groupe: fc.groupe,
        prospectNom: fc.prospectNom,
        prospectPrenom: fc.prospectPrenom,
        recordingsCount: fc.recordings.length,
        createdAt: fc.createdAt,
      }));
    }

    return res.json({
      success: true,
      jobId: job.id,
      event: job.status === "complete" ? "complete" : "progress",
      timestamp: job.updatedAt.toISOString(),
      data: {
        status: job.status,
        progress: job.progress,
        completedDays: job.completedDays,
        totalDays: job.totalDays,
        totalFiches: job.totalFiches,
        currentFichesCount: partialFiches.length,
        datesCompleted: job.datesAlreadyFetched,
        datesRemaining: job.datesRemaining,
        datesFailed: job.datesFailed,
        error: job.error,
        partialData: partialFiches,
        dataUrl:
          job.status === "complete"
            ? `${
                process.env.API_BASE_URL || "http://localhost:3002"
              }/api/fiches/status/by-date-range?startDate=${
                job.startDate
              }&endDate=${job.endDate}`
            : undefined,
      },
    });
  } catch (error) {
    const err = error as Error;
    logger.error("Error polling job status", {
      error: err.message,
      jobId: req.query.jobId,
    });
    return res.status(500).json({
      success: false,
      error: "Failed to fetch job status",
      message: err.message,
    });
  }
});

/**
 * @swagger
 * /api/fiches/jobs/{jobId}:
 *   get:
 *     tags: [Fiches]
 *     summary: Get progressive fetch job status
 *     parameters:
 *       - in: path
 *         name: jobId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Job status and progress
 */
fichesRouter.get("/jobs/:jobId", async (req: Request, res: Response) => {
  try {
    const { jobId } = req.params;

    const job = await prisma.progressiveFetchJob.findUnique({
      where: { id: jobId },
      include: {
        webhookDeliveries: {
          orderBy: { createdAt: "desc" },
          take: 10, // Last 10 deliveries
        },
      },
    });

    if (!job) {
      return res.status(404).json({
        success: false,
        error: "Job not found",
      });
    }

    return res.json({
      success: true,
      job: {
        id: job.id,
        status: job.status,
        progress: job.progress,
        completedDays: job.completedDays,
        totalDays: job.totalDays,
        totalFiches: job.totalFiches,
        startDate: job.startDate,
        endDate: job.endDate,
        datesAlreadyFetched: job.datesAlreadyFetched,
        datesRemaining: job.datesRemaining,
        datesFailed: job.datesFailed,
        error: job.error,
        createdAt: job.createdAt,
        updatedAt: job.updatedAt,
        completedAt: job.completedAt,
        webhookDeliveries: job.webhookDeliveries.map((d) => ({
          id: d.id,
          event: d.event,
          status: d.status,
          statusCode: d.statusCode,
          attempt: d.attempt,
          sentAt: d.sentAt,
          createdAt: d.createdAt,
        })),
      },
    });
  } catch (error) {
    const err = error as Error;
    logger.error("Error fetching job status", {
      error: err.message,
      jobId: req.params.jobId,
    });
    return res.status(500).json({
      success: false,
      error: "Failed to fetch job status",
      message: err.message,
    });
  }
});

/**
 * @swagger
 * /api/fiches/jobs:
 *   get:
 *     tags: [Fiches]
 *     summary: List progressive fetch jobs
 *     parameters:
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *           enum: [pending, processing, complete, failed]
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 20
 *     responses:
 *       200:
 *         description: List of jobs
 */
fichesRouter.get("/jobs", async (req: Request, res: Response) => {
  try {
    const { status, limit = "20" } = req.query;

    const jobs = await prisma.progressiveFetchJob.findMany({
      where: status ? { status: status as string } : undefined,
      orderBy: { createdAt: "desc" },
      take: parseInt(limit as string, 10),
      include: {
        _count: {
          select: { webhookDeliveries: true },
        },
      },
    });

    return res.json({
      success: true,
      jobs: jobs.map((job) => ({
        id: job.id,
        status: job.status,
        progress: job.progress,
        startDate: job.startDate,
        endDate: job.endDate,
        completedDays: job.completedDays,
        totalDays: job.totalDays,
        totalFiches: job.totalFiches,
        datesFailed: job.datesFailed,
        createdAt: job.createdAt,
        completedAt: job.completedAt,
        webhookDeliveriesCount: job._count.webhookDeliveries,
      })),
      total: jobs.length,
    });
  } catch (error) {
    const err = error as Error;
    logger.error("Error listing jobs", {
      error: err.message,
    });
    return res.status(500).json({
      success: false,
      error: "Failed to list jobs",
      message: err.message,
    });
  }
});
