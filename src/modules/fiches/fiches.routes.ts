/**
 * Fiches Routes
 * =============
 * API endpoints for fiche operations
 */

import { Router, Request, Response } from "express";
import { fetchApiSales, getFicheWithCache, refreshFicheFromApi } from "./fiches.service.js";
import { getCachedFiche } from "./fiches.repository.js";

export const fichesRouter = Router();

/**
 * @swagger
 * /api/fiches/search:
 *   get:
 *     tags: [Fiches]
 *     summary: Search fiches by date
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
 *         description: List of fiches
 */
fichesRouter.get("/search", async (req: Request, res: Response) => {
  try {
    const { date } = req.query;
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
    return res.json(sales);
  } catch (error: any) {
    console.error("Error fetching fiches:", error.message);
    res.status(500).json({
      success: false,
      error: "Failed to fetch fiches",
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

    // Serialize BigInt values to strings for JSON
    console.log("Serializing BigInt values for JSON response");
    const serializable = JSON.parse(
      JSON.stringify(ficheDetails, (key, value) =>
        typeof value === "bigint" ? value.toString() : value
      )
    );

    console.log("Successfully fetched fiche details, sending response", {
      fiche_id,
      refreshed: shouldRefresh,
    });
    return res.json(serializable);
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
