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

import type { Request, Response } from "express";
import { Router } from "express";

import { inngest } from "../../inngest/client.js";
import { asyncHandler } from "../../middleware/async-handler.js";
import { jsonResponse } from "../../shared/bigint-serializer.js";
import { ValidationError } from "../../shared/errors.js";
import { ok } from "../../shared/http.js";
import { logger } from "../../shared/logger.js";
import { prisma } from "../../shared/prisma.js";
import { validateOutgoingWebhookUrl } from "../../shared/webhook-security.js";
import * as fichesRepository from "./fiches.repository.js";
import * as fichesService from "./fiches.service.js";

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
fichesRouter.get(
  "/search",
  asyncHandler(async (req: Request, res: Response) => {
    const date = req.query.date;
    const includeStatus = req.query.includeStatus;

    if (typeof date !== "string" || date.length === 0) {
      throw new ValidationError(
        "Missing or invalid date parameter (YYYY-MM-DD required)"
      );
    }

    // Use same date for both start and end to search single day
    const shouldIncludeStatus =
      typeof includeStatus === "string" ? includeStatus !== "false" : true;

    const result = await fichesService.getSalesByDateRange(
      date,
      date,
      shouldIncludeStatus
    );

    return res.json(result);
  })
);

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
// Constrain fiche_id to digits to avoid collisions with static routes like `/jobs`
fichesRouter.get(
  "/:fiche_id(\\d+)",
  asyncHandler(async (req: Request, res: Response) => {
    const { fiche_id } = req.params;
    const refresh = req.query.refresh;
    const shouldRefresh = refresh === "true";
    const includeMailDevis = req.query.include_mail_devis === "true";

    const ficheDetails = await fichesService.getFiche(fiche_id, shouldRefresh, {
      includeMailDevis,
    });
    return jsonResponse(res, ficheDetails);
  })
);

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
fichesRouter.get(
  "/:fiche_id(\\d+)/cache",
  asyncHandler(async (req: Request, res: Response) => {
    const includeMailDevis = req.query.include_mail_devis === "true";
    const cached = await fichesRepository.getCachedFiche(req.params.fiche_id, {
      includeMailDevis,
    });

    if (!cached) {
      return res.status(404).json({
        success: false,
        error: "Fiche not cached",
      });
    }

    return ok(res, {
      ficheId: cached.ficheId,
      groupe: cached.groupe,
      prospectNom: cached.prospectNom,
      prospectPrenom: cached.prospectPrenom,
      recordingsCount: cached.recordingsCount,
      fetchedAt: cached.fetchedAt,
      expiresAt: cached.expiresAt,
    });
  })
);

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
fichesRouter.get(
  "/:fiche_id(\\d+)/status",
  asyncHandler(async (req: Request, res: Response) => {
    const status = await fichesService.getFicheStatus(req.params.fiche_id);

    if (!status) {
      return res.status(404).json({
        success: false,
        error: "Fiche not found in database",
        message:
          "This fiche has not been processed yet. Try fetching it first or run a transcription/audit.",
      });
    }

    return ok(res, status);
  })
);

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
fichesRouter.post(
  "/status/batch",
  asyncHandler(async (req: Request, res: Response) => {
    const body: unknown = req.body;
    const ficheIds =
      typeof body === "object" && body !== null && "ficheIds" in body
        ? (body as { ficheIds?: unknown }).ficheIds
        : undefined;

    if (!Array.isArray(ficheIds)) {
      throw new ValidationError("ficheIds must be an array");
    }

    const statusMap = await fichesService.getFichesStatus(ficheIds);
    return ok(res, statusMap);
  })
);

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
fichesRouter.get(
  "/status/by-date",
  asyncHandler(async (req: Request, res: Response) => {
    const date = req.query.date;

    if (typeof date !== "string") {
      throw new ValidationError(
        "Missing or invalid date parameter (YYYY-MM-DD required)"
      );
    }

    // Validate date format
    const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
    if (!dateRegex.test(date)) {
      throw new ValidationError("Invalid date format. Use YYYY-MM-DD");
    }

    const result = await fichesService.getFichesByDateWithStatus(date);
    return ok(res, result);
  })
);

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
 *       - in: query
 *         name: refresh
 *         required: false
 *         schema:
 *           type: string
 *         description: Set to "true" to force refetch sales from CRM and revalidate cache for the entire requested range (runs in background).
 *     responses:
 *       200:
 *         description: Progressive response with partial/complete data
 */
fichesRouter.get(
  "/status/by-date-range",
  asyncHandler(async (req: Request, res: Response) => {
    const startDate = req.query.startDate;
    const endDate = req.query.endDate;
    const webhookUrl = req.query.webhookUrl;
    const webhookSecret = req.query.webhookSecret;
    const refresh = req.query.refresh;

    if (typeof startDate !== "string") {
      throw new ValidationError(
        "Missing or invalid startDate parameter (YYYY-MM-DD required)"
      );
    }
    if (typeof endDate !== "string") {
      throw new ValidationError(
        "Missing or invalid endDate parameter (YYYY-MM-DD required)"
      );
    }

    const webhookUrlStr = typeof webhookUrl === "string" ? webhookUrl : undefined;
    const webhookSecretStr =
      typeof webhookSecret === "string" ? webhookSecret : undefined;
    const shouldRefresh = refresh === "true";

    const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
    if (!dateRegex.test(startDate) || !dateRegex.test(endDate)) {
      throw new ValidationError("Invalid date format. Use YYYY-MM-DD");
    }

    // Validate date range
    if (new Date(startDate) > new Date(endDate)) {
      throw new ValidationError("startDate must be before or equal to endDate");
    }

    // Validate webhook URL if provided
    if (webhookUrlStr) {
      const validation = validateOutgoingWebhookUrl(webhookUrlStr);
      if (!validation.ok) {
        throw new ValidationError(validation.error);
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
        webhookConfigured: Boolean(webhookUrlStr),
      });

      try {
        await inngest.send({
          name: "fiches/progressive-fetch-continue",
          data: {
            jobId,
            startDate,
            endDate,
            datesAlreadyFetched: [], // Background will fetch ALL remaining dates
            webhookUrl: webhookUrlStr,
            webhookSecret: webhookSecretStr,
            force_refresh: shouldRefresh,
          },
          // Idempotency key prevents duplicate jobs for same job ID
          id: `progressive-fetch-${jobId}`,
        });
      } catch (error) {
        const err = error instanceof Error ? error : new Error(String(error));
        logger.error("Failed to trigger background fetch", {
          jobId,
          error: err.message,
        });
      }
    };

    // Use progressive fetch strategy
    const result = await fichesService.getFichesByDateRangeProgressive(
      startDate,
      endDate,
      {
        webhookUrl: webhookUrlStr,
        webhookSecret: webhookSecretStr,
        triggerBackgroundFetch,
        forceRefresh: shouldRefresh,
      }
    );

    return res.json({
      success: true,
      ...result,
    });
  })
);

/**
 * @swagger
 * /api/fiches/webhooks/fiches:
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
fichesRouter.get(
  "/webhooks/fiches",
  asyncHandler(async (req: Request, res: Response) => {
    const jobId = req.query.jobId;

    if (typeof jobId !== "string" || jobId.length === 0) {
      throw new ValidationError("Missing jobId parameter");
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

    // Derive final status defensively (in case a worker updated progress but the finalizer didn't run)
    const derivedStatus =
      job.status === "processing" &&
      job.progress === 100 &&
      (job.datesRemaining?.length || 0) === 0
        ? (job.datesFailed?.length || 0) > 0
          ? "failed"
          : "complete"
        : job.status;

    // Get current cached data if job is processing or complete
    let partialFiches: Array<{
      ficheId: string;
      groupe: string | null;
      prospectNom: string | null;
      prospectPrenom: string | null;
      recordingsCount: number;
      createdAt: Date;
    }> = [];

    if (
      derivedStatus === "processing" ||
      derivedStatus === "complete" ||
      derivedStatus === "failed"
    ) {
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
      event:
        derivedStatus === "complete"
          ? "complete"
          : derivedStatus === "failed"
            ? "failed"
            : "progress",
      timestamp: job.updatedAt.toISOString(),
      data: {
        status: derivedStatus,
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
          derivedStatus === "complete" || derivedStatus === "failed"
            ? `${
                process.env.API_BASE_URL || "http://localhost:3002"
              }/api/fiches/status/by-date-range?startDate=${
                job.startDate
              }&endDate=${job.endDate}`
            : undefined,
      },
    });
  })
);

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
fichesRouter.get(
  "/jobs/:jobId",
  asyncHandler(async (req: Request, res: Response) => {
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

    const derivedStatus =
      job.status === "processing" &&
      job.progress === 100 &&
      (job.datesRemaining?.length || 0) === 0
        ? (job.datesFailed?.length || 0) > 0
          ? "failed"
          : "complete"
        : job.status;

    return res.json({
      success: true,
      job: {
        id: job.id,
        status: derivedStatus,
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
  })
);

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
fichesRouter.get(
  "/jobs",
  asyncHandler(async (req: Request, res: Response) => {
    const status = typeof req.query.status === "string" ? req.query.status : undefined;
    const limitRaw = typeof req.query.limit === "string" ? req.query.limit : "20";

    const parsedLimit = Number.parseInt(limitRaw, 10);
    const take =
      Number.isFinite(parsedLimit) && parsedLimit > 0 ? parsedLimit : 20;

    const jobs = await prisma.progressiveFetchJob.findMany({
      where: status ? { status } : undefined,
      orderBy: { createdAt: "desc" },
      take,
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
  })
);
