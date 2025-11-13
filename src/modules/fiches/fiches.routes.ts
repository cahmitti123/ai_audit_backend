/**
 * Fiches Routes
 * =============
 * API endpoints for fiche operations
 */

import { Router, Request, Response } from "express";
import {
  fetchApiSales,
  getFicheWithCache,
  refreshFicheFromApi,
  getFicheStatus,
  getFichesStatus,
  getFichesByDateWithStatus,
  getFichesByDateRangeWithStatus,
} from "./fiches.service.js";
import { getCachedFiche } from "./fiches.repository.js";
import { jsonResponse } from "../../shared/bigint-serializer.js";
import type {
  SalesFiche,
  SalesResponseWithStatus,
  FicheStatus,
} from "./fiches.schemas.js";

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
    console.log("Received search request with date:", date);

    if (!date || typeof date !== "string") {
      console.log("Invalid date parameter received");
      return res.status(400).json({
        success: false,
        error: "Missing or invalid date parameter (YYYY-MM-DD required)",
      });
    }

    console.log("Fetching sales for date:", date);

    const sales = await fetchApiSales(date);
    console.log(
      "Successfully fetched sales, count:",
      sales?.fiches?.length || 0
    );

    // Include status information if requested (default: true)
    const shouldIncludeStatus = includeStatus !== "false";

    if (shouldIncludeStatus && sales.fiches && sales.fiches.length > 0) {
      console.log("Fetching status information for fiches");

      // Extract fiche IDs from the sales data
      const ficheIds = sales.fiches
        .map((fiche: SalesFiche) => fiche.id)
        .filter((id): id is string => Boolean(id));

      if (ficheIds.length > 0) {
        const statusMap = await getFichesStatus(ficheIds);

        // Create default status for missing entries
        const defaultStatus: FicheStatus = {
          hasData: false,
          transcription: {
            total: 0,
            transcribed: 0,
            pending: 0,
            percentage: 0,
            isComplete: false,
          },
          audit: {
            total: 0,
            completed: 0,
            pending: 0,
            running: 0,
            compliant: 0,
            nonCompliant: 0,
            averageScore: null,
          },
        };

        // Enrich fiches with status information
        const enrichedResponse: SalesResponseWithStatus = {
          fiches: sales.fiches.map((fiche: SalesFiche) => {
            const ficheId = fiche.id;
            const status = ficheId ? statusMap[ficheId] : null;

            return {
              ...fiche,
              status: status || defaultStatus,
            };
          }),
          total: sales.total,
        };

        console.log("Status information added to fiches");
        return res.json(enrichedResponse);
      }
    }

    return res.json(sales);
  } catch (error: any) {
    console.error("Error fetching fiches:", error.message);

    // Check if it's a validation error (date format)
    const isValidationError = error.message?.includes("Invalid date format");
    const statusCode = isValidationError ? 400 : 500;

    res.status(statusCode).json({
      success: false,
      error: isValidationError
        ? "Invalid date format"
        : "Failed to fetch fiches",
      message: error.message,
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
 *         name: cle
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
    const { cle, refresh } = req.query;
    const shouldRefresh = refresh === "true";

    console.log("Received fiche details request", {
      fiche_id,
      has_cle: Boolean(cle),
      refresh: shouldRefresh,
    });

    let ficheDetails;

    if (shouldRefresh) {
      // Force refresh from external API and upsert to database
      console.log("Force refreshing fiche from API", { fiche_id });
      ficheDetails = await refreshFicheFromApi(
        fiche_id,
        cle as string | undefined
      );
      console.log("Fiche details refreshed from API and upserted to DB", {
        fiche_id,
        has_data: Boolean(ficheDetails),
      });
    } else {
      // Use cache (or fetch and cache if not cached)
      console.log("Fetching fiche with cache", { fiche_id });
      ficheDetails = await getFicheWithCache(
        fiche_id,
        cle as string | undefined
      );
      console.log("Fiche details fetched from cache/API", {
        fiche_id,
        has_data: Boolean(ficheDetails),
      });
    }

    console.log("Successfully fetched fiche details, sending response", {
      fiche_id,
      refreshed: shouldRefresh,
    });
    return jsonResponse(res, ficheDetails);
  } catch (error: any) {
    console.error("Error fetching fiche details:", error.message, {
      fiche_id: req.params.fiche_id,
      stack: error.stack,
    });
    return res.status(500).json({
      success: false,
      error: "Failed to fetch fiche details",
      message: error.message,
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
    const cached = await getCachedFiche(req.params.fiche_id);

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
  } catch (error: any) {
    res.status(500).json({
      success: false,
      error: "Failed to fetch cached fiche",
      message: error.message,
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
    const status = await getFicheStatus(req.params.fiche_id);

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
  } catch (error: any) {
    res.status(500).json({
      success: false,
      error: "Failed to fetch fiche status",
      message: error.message,
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

    const statusMap = await getFichesStatus(ficheIds);

    res.json({
      success: true,
      data: statusMap,
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      error: "Failed to fetch fiches status",
      message: error.message,
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
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   type: object
 *                   properties:
 *                     date:
 *                       type: string
 *                     total:
 *                       type: integer
 *                     fiches:
 *                       type: array
 *                       items:
 *                         type: object
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

    console.log("Fetching fiches with status for date:", date);
    const result = await getFichesByDateWithStatus(date);

    console.log(`Found ${result.total} fiches for date ${date}`);

    res.json({
      success: true,
      data: result,
    });
  } catch (error: any) {
    console.error("Error fetching fiches by date with status:", error);
    res.status(500).json({
      success: false,
      error: "Failed to fetch fiches by date",
      message: error.message,
    });
  }
});

/**
 * @swagger
 * /api/fiches/status/by-date-range:
 *   get:
 *     tags: [Fiches]
 *     summary: Get all fiches for a date range with complete status information
 *     parameters:
 *       - in: query
 *         name: startDate
 *         required: true
 *         schema:
 *           type: string
 *           format: date
 *       - in: query
 *         name: endDate
 *         required: true
 *         schema:
 *           type: string
 *           format: date
 *     responses:
 *       200:
 *         description: List of fiches with complete status information
 */
fichesRouter.get(
  "/status/by-date-range",
  async (req: Request, res: Response) => {
    try {
      const { startDate, endDate } = req.query;

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

      console.log("Fetching fiches with status for date range:", {
        startDate,
        endDate,
      });
      const result = await getFichesByDateRangeWithStatus(startDate, endDate);

      console.log(
        `Found ${result.total} fiches for date range ${startDate} to ${endDate}`
      );

      res.json({
        success: true,
        data: result,
      });
    } catch (error: any) {
      console.error("Error fetching fiches by date range with status:", error);
      res.status(500).json({
        success: false,
        error: "Failed to fetch fiches by date range",
        message: error.message,
      });
    }
  }
);
