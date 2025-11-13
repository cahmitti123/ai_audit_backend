/**
 * Audits Routes
 * =============
 * API endpoints for audit execution and results
 */

import { Router, Request, Response } from "express";
import { inngest } from "../../inngest/client.js";
import { runAudit } from "./audits.runner.js";
import {
  getAuditsByFiche,
  getAuditById,
  listAudits,
  getAuditsGroupedByFiches,
  ListAuditsFilters,
} from "./audits.repository.js";
import { jsonResponse } from "../../shared/bigint-serializer.js";

export const auditsRouter = Router();

/**
 * @swagger
 * /api/audits:
 *   get:
 *     tags: [Audits]
 *     summary: List all audits with advanced filtering and sorting
 *     description: |
 *       Retrieve audits across all fiches with comprehensive filtering options.
 *       Supports pagination, date ranges, status filtering, and multiple sort options.
 *     parameters:
 *       - in: query
 *         name: fiche_ids
 *         schema:
 *           type: string
 *         description: Comma-separated list of fiche IDs to filter by
 *         example: "1762209,1753254"
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *         description: Comma-separated list of statuses (pending, running, completed, failed)
 *         example: "completed,failed"
 *       - in: query
 *         name: is_compliant
 *         schema:
 *           type: boolean
 *         description: Filter by compliance status
 *         example: true
 *       - in: query
 *         name: date_from
 *         schema:
 *           type: string
 *           format: date
 *         description: Start date (ISO 8601)
 *         example: "2025-01-01"
 *       - in: query
 *         name: date_to
 *         schema:
 *           type: string
 *           format: date
 *         description: End date (ISO 8601)
 *         example: "2025-01-31"
 *       - in: query
 *         name: audit_config_ids
 *         schema:
 *           type: string
 *         description: Comma-separated list of audit config IDs
 *         example: "13,11"
 *       - in: query
 *         name: sort_by
 *         schema:
 *           type: string
 *           enum: [created_at, completed_at, score_percentage, duration_ms]
 *         description: Field to sort by
 *         example: "created_at"
 *       - in: query
 *         name: sort_order
 *         schema:
 *           type: string
 *           enum: [asc, desc]
 *         description: Sort order
 *         example: "desc"
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *         description: Number of results per page (max 500)
 *         example: 50
 *       - in: query
 *         name: offset
 *         schema:
 *           type: integer
 *         description: Number of results to skip for pagination
 *         example: 0
 *     responses:
 *       200:
 *         description: List of audits with pagination info
 *       400:
 *         description: Invalid query parameters
 *       500:
 *         description: Server error
 */
auditsRouter.get("/", async (req: Request, res: Response) => {
  try {
    // Parse query parameters
    const filters: ListAuditsFilters = {};

    // Fiche IDs filter
    if (req.query.fiche_ids && typeof req.query.fiche_ids === "string") {
      filters.ficheIds = req.query.fiche_ids.split(",").map((id) => id.trim());
    }

    // Status filter
    if (req.query.status && typeof req.query.status === "string") {
      filters.status = req.query.status.split(",").map((s) => s.trim());
    }

    // Compliance filter
    if (req.query.is_compliant !== undefined) {
      filters.isCompliant = req.query.is_compliant === "true";
    }

    // Date range filters
    if (req.query.date_from && typeof req.query.date_from === "string") {
      filters.dateFrom = new Date(req.query.date_from);
      if (isNaN(filters.dateFrom.getTime())) {
        return res.status(400).json({
          success: false,
          error: "Invalid date_from format. Use ISO 8601 (YYYY-MM-DD)",
        });
      }
    }

    if (req.query.date_to && typeof req.query.date_to === "string") {
      filters.dateTo = new Date(req.query.date_to);
      // Set to end of day
      filters.dateTo.setHours(23, 59, 59, 999);
      if (isNaN(filters.dateTo.getTime())) {
        return res.status(400).json({
          success: false,
          error: "Invalid date_to format. Use ISO 8601 (YYYY-MM-DD)",
        });
      }
    }

    // Audit config IDs filter
    if (
      req.query.audit_config_ids &&
      typeof req.query.audit_config_ids === "string"
    ) {
      filters.auditConfigIds = req.query.audit_config_ids
        .split(",")
        .map((id) => id.trim());
    }

    // Sorting
    if (req.query.sort_by && typeof req.query.sort_by === "string") {
      const validSortFields = [
        "created_at",
        "completed_at",
        "score_percentage",
        "duration_ms",
      ];
      if (validSortFields.includes(req.query.sort_by)) {
        filters.sortBy = req.query.sort_by as any;
      }
    }

    if (req.query.sort_order && typeof req.query.sort_order === "string") {
      if (["asc", "desc"].includes(req.query.sort_order)) {
        filters.sortOrder = req.query.sort_order as "asc" | "desc";
      }
    }

    // Pagination
    if (req.query.limit) {
      const limit = parseInt(req.query.limit as string);
      if (!isNaN(limit) && limit > 0) {
        filters.limit = Math.min(limit, 500); // Max 500
      }
    }

    if (req.query.offset) {
      const offset = parseInt(req.query.offset as string);
      if (!isNaN(offset) && offset >= 0) {
        filters.offset = offset;
      }
    }

    // Execute query
    const result = await listAudits(filters);

    // Convert BigInt to string for JSON serialization
    const serializable = JSON.parse(
      JSON.stringify(result, (key, value) =>
        typeof value === "bigint" ? value.toString() : value
      )
    );

    // Calculate pagination info
    const totalPages = Math.ceil(serializable.total / serializable.limit);
    const currentPage =
      Math.floor(serializable.offset / serializable.limit) + 1;
    const hasNextPage = currentPage < totalPages;
    const hasPrevPage = currentPage > 1;

    res.json({
      success: true,
      data: serializable.audits,
      pagination: {
        total: serializable.total,
        limit: serializable.limit,
        offset: serializable.offset,
        current_page: currentPage,
        total_pages: totalPages,
        has_next_page: hasNextPage,
        has_prev_page: hasPrevPage,
      },
    });
  } catch (error: any) {
    console.error("Error listing audits:", error);
    res.status(500).json({
      success: false,
      error: "Failed to list audits",
      message: error.message,
      stack: process.env.NODE_ENV === "development" ? error.stack : undefined,
    });
  }
});

/**
 * @swagger
 * /api/audits/grouped-by-fiches:
 *   get:
 *     tags: [Audits]
 *     summary: Get audits grouped by fiches
 *     description: |
 *       Retrieve audits organized by fiche with complete fiche information.
 *       Each entry contains fiche details, all associated audits, and summary statistics.
 *       Supports the same filtering options as the main audits list endpoint.
 *     parameters:
 *       - in: query
 *         name: fiche_ids
 *         schema:
 *           type: string
 *         description: Comma-separated list of fiche IDs to filter by
 *         example: "1762209,1753254"
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *         description: Comma-separated list of statuses (pending, running, completed, failed)
 *         example: "completed,failed"
 *       - in: query
 *         name: is_compliant
 *         schema:
 *           type: boolean
 *         description: Filter by compliance status
 *         example: true
 *       - in: query
 *         name: date_from
 *         schema:
 *           type: string
 *           format: date
 *         description: Start date (ISO 8601)
 *         example: "2025-01-01"
 *       - in: query
 *         name: date_to
 *         schema:
 *           type: string
 *           format: date
 *         description: End date (ISO 8601)
 *         example: "2025-01-31"
 *       - in: query
 *         name: audit_config_ids
 *         schema:
 *           type: string
 *         description: Comma-separated list of audit config IDs
 *         example: "13,11"
 *       - in: query
 *         name: sort_by
 *         schema:
 *           type: string
 *           enum: [created_at, completed_at, score_percentage, duration_ms]
 *         description: Field to sort audits by within each fiche
 *         example: "created_at"
 *       - in: query
 *         name: sort_order
 *         schema:
 *           type: string
 *           enum: [asc, desc]
 *         description: Sort order for audits
 *         example: "desc"
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *         description: Number of fiches per page (max 500)
 *         example: 50
 *       - in: query
 *         name: offset
 *         schema:
 *           type: integer
 *         description: Number of fiches to skip for pagination
 *         example: 0
 *     responses:
 *       200:
 *         description: Audits grouped by fiches with pagination info
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 data:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       fiche:
 *                         type: object
 *                         description: Fiche details
 *                       audits:
 *                         type: array
 *                         description: Array of audits for this fiche
 *                       summary:
 *                         type: object
 *                         properties:
 *                           totalAudits:
 *                             type: integer
 *                           compliantCount:
 *                             type: integer
 *                           averageScore:
 *                             type: number
 *                           latestAuditDate:
 *                             type: string
 *                             format: date-time
 *                 pagination:
 *                   type: object
 *                   properties:
 *                     total:
 *                       type: integer
 *                     limit:
 *                       type: integer
 *                     offset:
 *                       type: integer
 *                     current_page:
 *                       type: integer
 *                     total_pages:
 *                       type: integer
 *                     has_next_page:
 *                       type: boolean
 *                     has_prev_page:
 *                       type: boolean
 *       400:
 *         description: Invalid query parameters
 *       500:
 *         description: Server error
 */
auditsRouter.get("/grouped-by-fiches", async (req: Request, res: Response) => {
  try {
    // Parse query parameters (same as main list endpoint)
    const filters: ListAuditsFilters = {};

    // Fiche IDs filter
    if (req.query.fiche_ids && typeof req.query.fiche_ids === "string") {
      filters.ficheIds = req.query.fiche_ids.split(",").map((id) => id.trim());
    }

    // Status filter
    if (req.query.status && typeof req.query.status === "string") {
      filters.status = req.query.status.split(",").map((s) => s.trim());
    }

    // Compliance filter
    if (req.query.is_compliant !== undefined) {
      filters.isCompliant = req.query.is_compliant === "true";
    }

    // Date range filters
    if (req.query.date_from && typeof req.query.date_from === "string") {
      filters.dateFrom = new Date(req.query.date_from);
      if (isNaN(filters.dateFrom.getTime())) {
        return res.status(400).json({
          success: false,
          error: "Invalid date_from format. Use ISO 8601 (YYYY-MM-DD)",
        });
      }
    }

    if (req.query.date_to && typeof req.query.date_to === "string") {
      filters.dateTo = new Date(req.query.date_to);
      // Set to end of day
      filters.dateTo.setHours(23, 59, 59, 999);
      if (isNaN(filters.dateTo.getTime())) {
        return res.status(400).json({
          success: false,
          error: "Invalid date_to format. Use ISO 8601 (YYYY-MM-DD)",
        });
      }
    }

    // Audit config IDs filter
    if (
      req.query.audit_config_ids &&
      typeof req.query.audit_config_ids === "string"
    ) {
      filters.auditConfigIds = req.query.audit_config_ids
        .split(",")
        .map((id) => id.trim());
    }

    // Sorting
    if (req.query.sort_by && typeof req.query.sort_by === "string") {
      const validSortFields = [
        "created_at",
        "completed_at",
        "score_percentage",
        "duration_ms",
      ];
      if (validSortFields.includes(req.query.sort_by)) {
        filters.sortBy = req.query.sort_by as any;
      }
    }

    if (req.query.sort_order && typeof req.query.sort_order === "string") {
      if (["asc", "desc"].includes(req.query.sort_order)) {
        filters.sortOrder = req.query.sort_order as "asc" | "desc";
      }
    }

    // Pagination
    if (req.query.limit) {
      const limit = parseInt(req.query.limit as string);
      if (!isNaN(limit) && limit > 0) {
        filters.limit = Math.min(limit, 500); // Max 500
      }
    }

    if (req.query.offset) {
      const offset = parseInt(req.query.offset as string);
      if (!isNaN(offset) && offset >= 0) {
        filters.offset = offset;
      }
    }

    // Execute query
    const result = await getAuditsGroupedByFiches(filters);

    // Convert BigInt to string for JSON serialization
    const serializable = JSON.parse(
      JSON.stringify(result, (key, value) =>
        typeof value === "bigint" ? value.toString() : value
      )
    );

    // Calculate pagination info
    const totalPages = Math.ceil(
      serializable.pagination.total / serializable.pagination.limit
    );
    const currentPage =
      Math.floor(
        serializable.pagination.offset / serializable.pagination.limit
      ) + 1;
    const hasNextPage = currentPage < totalPages;
    const hasPrevPage = currentPage > 1;

    res.json({
      success: true,
      data: serializable.data,
      pagination: {
        total: serializable.pagination.total,
        limit: serializable.pagination.limit,
        offset: serializable.pagination.offset,
        current_page: currentPage,
        total_pages: totalPages,
        has_next_page: hasNextPage,
        has_prev_page: hasPrevPage,
      },
    });
  } catch (error: any) {
    console.error("Error fetching audits grouped by fiches:", error);
    res.status(500).json({
      success: false,
      error: "Failed to fetch audits grouped by fiches",
      message: error.message,
      stack: process.env.NODE_ENV === "development" ? error.stack : undefined,
    });
  }
});

/**
 * @swagger
 * /api/audits/run:
 *   post:
 *     tags: [Audits]
 *     summary: Run audit with specific config (async via Inngest)
 *     description: Queues an audit job to Inngest for background processing
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - audit_id
 *               - fiche_id
 *             properties:
 *               audit_id:
 *                 type: integer
 *                 description: Audit configuration ID
 *                 example: 13
 *               fiche_id:
 *                 type: string
 *                 description: Fiche identifier
 *                 example: "1762209"
 *               user_id:
 *                 type: string
 *                 description: Optional user ID for tracking
 *                 example: "user_123"
 *     responses:
 *       200:
 *         description: Audit queued successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 message:
 *                   type: string
 *                   example: "Audit queued for processing"
 *                 event_id:
 *                   type: string
 *                   example: "01K860XNK05HRDNK6P9A44MTZX"
 *                 fiche_id:
 *                   type: string
 *                 audit_config_id:
 *                   type: integer
 *                 metadata:
 *                   type: object
 *                   properties:
 *                     timestamp:
 *                       type: string
 *                     status:
 *                       type: string
 *                       example: "queued"
 *       400:
 *         description: Missing required parameters
 *       500:
 *         description: Failed to queue audit
 */
auditsRouter.post("/run", async (req: Request, res: Response) => {
  try {
    const { audit_id, fiche_id, user_id } = req.body;

    // Validation
    if (!audit_id || !fiche_id) {
      return res.status(400).json({
        success: false,
        error: "Missing required parameters",
        message: "Both audit_id and fiche_id are required",
      });
    }

    console.log(
      `\n${"=".repeat(
        80
      )}\nQueuing audit: Config ID ${audit_id}, Fiche ID ${fiche_id}\n${"=".repeat(
        80
      )}\n`
    );

    // Send event to Inngest (async processing)
    const eventId = `audit-${fiche_id}-${audit_id}-${Date.now()}`;
    const { ids } = await inngest.send({
      name: "audit/run",
      data: {
        fiche_id: fiche_id.toString(),
        audit_config_id: parseInt(audit_id),
        user_id,
      },
      id: eventId,
    });

    res.json({
      success: true,
      message: "Audit queued for processing",
      event_id: ids[0],
      fiche_id,
      audit_config_id: audit_id,
      metadata: {
        timestamp: new Date().toISOString(),
        status: "queued",
      },
    });
  } catch (error: any) {
    console.error("Error queuing audit:", error);
    res.status(500).json({
      success: false,
      error: "Failed to queue audit",
      message: error.message,
      stack: process.env.NODE_ENV === "development" ? error.stack : undefined,
    });
  }
});

/**
 * @swagger
 * /api/audits/run-latest:
 *   post:
 *     tags: [Audits]
 *     summary: Run audit with latest active config (async via Inngest)
 *     description: Queues an audit job using the latest active configuration
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - fiche_id
 *             properties:
 *               fiche_id:
 *                 type: string
 *                 description: Fiche identifier
 *                 example: "1762209"
 *               user_id:
 *                 type: string
 *                 description: Optional user ID for tracking
 *                 example: "user_123"
 *     responses:
 *       200:
 *         description: Audit queued successfully
 *       400:
 *         description: Missing fiche_id parameter
 *       404:
 *         description: No active audit configuration found
 *       500:
 *         description: Failed to queue audit
 */
auditsRouter.post("/run-latest", async (req: Request, res: Response) => {
  try {
    const { fiche_id, user_id } = req.body;

    if (!fiche_id) {
      return res.status(400).json({
        success: false,
        error: "Missing required parameter",
        message: "fiche_id is required",
      });
    }

    // Get latest config ID
    const { getLatestActiveConfig } = await import(
      "../audit-configs/audit-configs.repository.js"
    );
    const latestConfig = await getLatestActiveConfig();

    if (!latestConfig) {
      return res.status(404).json({
        success: false,
        error: "No active audit configuration found",
      });
    }

    console.log(
      `\n${"=".repeat(
        80
      )}\nQueuing audit with latest config: Fiche ID ${fiche_id}\n${"=".repeat(
        80
      )}\n`
    );

    // Send event to Inngest
    const eventId = `audit-${fiche_id}-${latestConfig.id}-${Date.now()}`;
    const { ids } = await inngest.send({
      name: "audit/run",
      data: {
        fiche_id: fiche_id.toString(),
        audit_config_id: Number(latestConfig.id),
        user_id,
      },
      id: eventId,
    });

    res.json({
      success: true,
      message: "Audit queued for processing",
      event_id: ids[0],
      fiche_id,
      audit_config_id: latestConfig.id.toString(),
      audit_config_name: latestConfig.name,
      metadata: {
        timestamp: new Date().toISOString(),
        status: "queued",
      },
    });
  } catch (error: any) {
    console.error("Error queuing audit:", error);
    res.status(500).json({
      success: false,
      error: "Failed to queue audit",
      message: error.message,
      stack: process.env.NODE_ENV === "development" ? error.stack : undefined,
    });
  }
});

/**
 * @swagger
 * /api/audits/batch:
 *   post:
 *     tags: [Audits]
 *     summary: Batch run audits for multiple fiches
 *     description: Queues multiple audit jobs in parallel using Inngest fan-out pattern
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
 *                 description: Array of fiche identifiers
 *                 example: ["1762209", "1753254"]
 *               audit_config_id:
 *                 type: integer
 *                 description: Audit configuration ID (defaults to 10 if not provided)
 *                 example: 13
 *               user_id:
 *                 type: string
 *                 description: Optional user ID for tracking
 *                 example: "user_123"
 *     responses:
 *       200:
 *         description: Batch audit queued successfully
 *       400:
 *         description: Invalid request - fiche_ids array required
 *       500:
 *         description: Failed to queue batch audit
 */
auditsRouter.post("/batch", async (req: Request, res: Response) => {
  try {
    const { fiche_ids, audit_config_id, user_id } = req.body;

    if (!fiche_ids || !Array.isArray(fiche_ids)) {
      return res.status(400).json({
        success: false,
        error: "Invalid request - fiche_ids array required",
      });
    }

    // Send batch event with deduplication ID
    const batchId = `batch-${Date.now()}-${fiche_ids.length}`;
    const { ids } = await inngest.send({
      name: "audit/batch",
      data: {
        fiche_ids,
        audit_config_id,
        user_id,
      },
      // Prevent duplicate batch runs
      id: batchId,
      // Add timestamp for tracking
      ts: Date.now(),
    });

    console.log(
      `✓ Queued batch audit for ${fiche_ids.length} fiches. Batch ID:`,
      batchId
    );

    res.json({
      success: true,
      message: `Batch audit queued for ${fiche_ids.length} fiches`,
      fiche_ids,
      audit_config_id,
      batch_id: batchId,
      event_ids: ids,
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      error: "Failed to queue batch audit",
      message: error.message,
    });
  }
});

/**
 * @swagger
 * /api/audits/by-fiche/{fiche_id}:
 *   get:
 *     tags: [Audits]
 *     summary: Get audit history for a fiche
 */
auditsRouter.get("/by-fiche/:fiche_id", async (req: Request, res: Response) => {
  try {
    const includeDetails = req.query.include_details === "true";
    const audits = await getAuditsByFiche(req.params.fiche_id, includeDetails);

    return jsonResponse(res, { 
      success: true, 
      data: audits, 
      count: audits.length 
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      error: "Failed to fetch audits",
      message: error.message,
    });
  }
});

/**
 * @swagger
 * /api/audits/{audit_id}:
 *   get:
 *     tags: [Audits]
 *     summary: Get detailed audit results
 */
auditsRouter.get("/:audit_id", async (req: Request, res: Response) => {
  try {
    const audit = await getAuditById(BigInt(req.params.audit_id));

    if (!audit) {
      return res.status(404).json({
        success: false,
        error: "Audit not found",
      });
    }

    return jsonResponse(res, { 
      success: true, 
      data: audit 
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      error: "Failed to fetch audit",
      message: error.message,
    });
  }
});
