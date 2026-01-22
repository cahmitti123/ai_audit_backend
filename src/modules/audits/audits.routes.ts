/**
 * Audits Routes
 * =============
 * RESPONSIBILITY: HTTP API endpoints
 * - Request/response handling
 * - Input validation
 * - Error handling
 * - Delegates to service layer
 *
 * LAYER: Presentation (HTTP)
 */

import { type Request, type Response,Router } from "express";

import { inngest } from "../../inngest/client.js";
import { asyncHandler } from "../../middleware/async-handler.js";
import { jsonResponse } from "../../shared/bigint-serializer.js";
import { AppError, ValidationError } from "../../shared/errors.js";
import { logger } from "../../shared/logger.js";
import { getRedisClient } from "../../shared/redis.js";
import {
  controlPointStatutEnum,
  type ListAuditsQuery,
  parseListAuditsQuery,
  validateBatchAuditInput,
  validateReviewAuditControlPointInput,
  validateReviewAuditStepResultInput,
  validateRunAuditInput,
  validateUpdateAuditInput,
} from "./audits.schemas.js";
import * as auditsService from "./audits.service.js";

export const auditsRouter = Router();

function parseBigIntParam(value: string, name = "id"): bigint {
  try {
    return BigInt(value);
  } catch {
    throw new ValidationError(`Invalid ${name}`);
  }
}

function parsePositiveIntParam(value: string, name = "value"): number {
  const n = Number.parseInt(value, 10);
  if (!Number.isFinite(n) || n <= 0) {
    throw new ValidationError(`Invalid ${name}`);
  }
  return n;
}

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
 *         name: sales_dates
 *         schema:
 *           type: string
 *         description: Comma-separated list of fiche sales dates (YYYY-MM-DD)
 *         example: "2025-01-03,2025-01-04"
 *       - in: query
 *         name: sales_date_from
 *         schema:
 *           type: string
 *         description: Fiche sales date start (YYYY-MM-DD)
 *         example: "2025-01-01"
 *       - in: query
 *         name: sales_date_to
 *         schema:
 *           type: string
 *         description: Fiche sales date end (YYYY-MM-DD)
 *         example: "2025-01-31"
 *       - in: query
 *         name: has_recordings
 *         schema:
 *           type: boolean
 *         description: Filter by fiche recording presence
 *         example: true
 *       - in: query
 *         name: recordings_count_min
 *         schema:
 *           type: integer
 *         description: Minimum number of recordings on the fiche
 *         example: 1
 *       - in: query
 *         name: recordings_count_max
 *         schema:
 *           type: integer
 *         description: Maximum number of recordings on the fiche
 *         example: 3
 *       - in: query
 *         name: fetched_at_from
 *         schema:
 *           type: string
 *           format: date-time
 *         description: Fiche fetchedAt start (ISO 8601)
 *         example: "2025-01-01T00:00:00Z"
 *       - in: query
 *         name: fetched_at_to
 *         schema:
 *           type: string
 *           format: date-time
 *         description: Fiche fetchedAt end (ISO 8601)
 *         example: "2025-01-31T23:59:59Z"
 *       - in: query
 *         name: last_revalidated_from
 *         schema:
 *           type: string
 *           format: date-time
 *         description: Fiche lastRevalidatedAt start (ISO 8601)
 *         example: "2025-01-01T00:00:00Z"
 *       - in: query
 *         name: last_revalidated_to
 *         schema:
 *           type: string
 *           format: date-time
 *         description: Fiche lastRevalidatedAt end (ISO 8601)
 *         example: "2025-01-31T23:59:59Z"
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
auditsRouter.get(
  "/",
  asyncHandler(async (req: Request, res: Response) => {
    // Parse and validate query parameters
    const filters = parseListAuditsQuery(req.query as unknown as ListAuditsQuery);

    // Execute query via service
    const result = await auditsService.listAudits(filters);

    // Calculate pagination info
    const totalPages = Math.ceil(result.pagination.total / result.pagination.limit);
    const currentPage =
      Math.floor(result.pagination.offset / result.pagination.limit) + 1;
    const hasNextPage = currentPage < totalPages;
    const hasPrevPage = currentPage > 1;

    return res.json({
      success: true,
      data: result.audits,
      pagination: {
        total: result.pagination.total,
        limit: result.pagination.limit,
        offset: result.pagination.offset,
        current_page: currentPage,
        total_pages: totalPages,
        has_next_page: hasNextPage,
        has_prev_page: hasPrevPage,
      },
    });
  })
);

/**
 * Create/queue an audit (CRUD "create" convenience endpoint).
 *
 * This is an alias of POST /api/audits/run (kept for backwards compatibility),
 * but uses a more REST-friendly path.
 */
auditsRouter.post(
  "/",
  asyncHandler(async (req: Request, res: Response) => {
    const body: unknown = req.body;
    const data =
      typeof body === "object" && body !== null
        ? (body as Record<string, unknown>)
        : {};

    const useRlmRaw = Object.prototype.hasOwnProperty.call(data, "use_rlm")
      ? data.use_rlm
      : Object.prototype.hasOwnProperty.call(data, "useRlm")
        ? data.useRlm
        : undefined;

    // Backwards-compatible: accept either `audit_id` (legacy) or `audit_config_id` (preferred)
    const auditConfigRaw = data.audit_config_id ?? data.audit_id;
    const ficheIdStrRaw =
      typeof data.fiche_id === "string" ? data.fiche_id : String(data.fiche_id ?? "");
    const auditConfigIdRaw = Number.parseInt(String(auditConfigRaw ?? ""), 10);
    const ficheIdStr = ficheIdStrRaw.trim();

    if (!Number.isFinite(auditConfigIdRaw) || auditConfigIdRaw <= 0 || !ficheIdStr) {
      return res.status(400).json({
        success: false,
        error: "Missing required parameters",
        message: "Both audit_config_id (or audit_id) and fiche_id are required",
      });
    }

    const parsed = validateRunAuditInput({
      fiche_id: ficheIdStr,
      audit_config_id: auditConfigIdRaw,
      user_id: data.user_id,
      use_rlm: typeof useRlmRaw === "boolean" ? useRlmRaw : undefined,
      automation_schedule_id: data.automation_schedule_id,
      automation_run_id: data.automation_run_id,
      trigger_source: data.trigger_source,
    });

    const ficheId = parsed.fiche_id;
    const auditConfigId = parsed.audit_config_id;
    const user_id = parsed.user_id;
    const use_rlm = parsed.use_rlm;
    const automation_schedule_id = parsed.automation_schedule_id;
    const automation_run_id = parsed.automation_run_id;
    const trigger_source = parsed.trigger_source;

    const now = Date.now();
    const eventId = `audit-${ficheId}-${auditConfigId}-${now}`;
    const { ids } = await inngest.send({
      name: "audit/run",
      data: {
        fiche_id: ficheId,
        audit_config_id: auditConfigId,
        ...(typeof user_id === "string" && user_id ? { user_id } : {}),
        ...(typeof use_rlm === "boolean" ? { use_rlm } : {}),
        ...(typeof automation_schedule_id === "string" && automation_schedule_id.trim()
          ? { automation_schedule_id: automation_schedule_id.trim() }
          : {}),
        ...(typeof automation_run_id === "string" && automation_run_id.trim()
          ? { automation_run_id: automation_run_id.trim() }
          : {}),
        ...(typeof trigger_source === "string" && trigger_source.trim()
          ? { trigger_source: trigger_source.trim() }
          : { trigger_source: "api" }),
      },
      id: eventId,
    });

    return res.json({
      success: true,
      message: "Audit queued for processing",
      event_id: ids[0],
      audit_id: eventId,
      fiche_id: ficheId,
      audit_config_id: auditConfigId,
      metadata: {
        timestamp: new Date().toISOString(),
        status: "queued",
      },
    });
  })
);

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
auditsRouter.get(
  "/grouped-by-fiches",
  asyncHandler(async (req: Request, res: Response) => {
    // Parse and validate query parameters
    const filters = parseListAuditsQuery(req.query as unknown as ListAuditsQuery);

    // Execute query via service
    const result = await auditsService.getAuditsGroupedByFiches(filters);

    // Calculate pagination info
    const totalPages = Math.ceil(result.pagination.total / result.pagination.limit);
    const currentPage =
      Math.floor(result.pagination.offset / result.pagination.limit) + 1;
    const hasNextPage = currentPage < totalPages;
    const hasPrevPage = currentPage > 1;

    return res.json({
      success: true,
      data: result.data,
      pagination: {
        total: result.pagination.total,
        limit: result.pagination.limit,
        offset: result.pagination.offset,
        current_page: currentPage,
        total_pages: totalPages,
        has_next_page: hasNextPage,
        has_prev_page: hasPrevPage,
      },
    });
  })
);

/**
 * Flexible grouped/aggregated audits endpoint.
 *
 * Examples:
 * - `/api/audits/grouped?group_by=automation_schedule`
 * - `/api/audits/grouped?group_by=fiche&groupes=NCA%20R1`
 * - `/api/audits/grouped?group_by=created_day&date_from=2025-12-01&date_to=2025-12-31`
 * - `/api/audits/grouped?group_by=score_bucket&bucket_size=10`
 */
auditsRouter.get(
  "/grouped",
  asyncHandler(async (req: Request, res: Response) => {
    const groupByRaw = typeof req.query.group_by === "string" ? req.query.group_by.trim() : "";
    if (!groupByRaw) {
      throw new ValidationError("group_by is required");
    }

    const allowed = [
      "fiche",
      "audit_config",
      "status",
      "niveau",
      "automation_schedule",
      "automation_run",
      "groupe",
      "created_day",
      "score_bucket",
    ] as const;
    if (!allowed.includes(groupByRaw as (typeof allowed)[number])) {
      throw new ValidationError(
        `Invalid group_by. Allowed: ${allowed.join(", ")}`
      );
    }

    const bucketSizeRaw = req.query.bucket_size;
    const bucketSize =
      typeof bucketSizeRaw === "string" && bucketSizeRaw.trim()
        ? Number.parseInt(bucketSizeRaw, 10)
        : undefined;

    const filters = parseListAuditsQuery(req.query as unknown as ListAuditsQuery);
    const result = await auditsService.groupAudits({
      filters,
      groupBy: groupByRaw as (typeof allowed)[number],
      bucketSize,
    });

    return res.json({
      success: true,
      data: result.groups,
      pagination: result.pagination,
      meta: result.meta,
    });
  })
);

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
auditsRouter.post(
  "/run",
  asyncHandler(async (req: Request, res: Response) => {
    const body: unknown = req.body;
    const data =
      typeof body === "object" && body !== null
        ? (body as Record<string, unknown>)
        : {};

    const useRlmRaw = Object.prototype.hasOwnProperty.call(data, "use_rlm")
      ? data.use_rlm
      : Object.prototype.hasOwnProperty.call(data, "useRlm")
        ? data.useRlm
        : undefined;

    const auditConfigRaw = data.audit_config_id ?? data.audit_id;
    const ficheIdStrRaw =
      typeof data.fiche_id === "string" ? data.fiche_id : String(data.fiche_id ?? "");
    const auditConfigIdRaw = Number.parseInt(String(auditConfigRaw ?? ""), 10);
    const ficheIdStr = ficheIdStrRaw.trim();

    // Preserve legacy error message contract (tests + clients rely on it)
    if (!Number.isFinite(auditConfigIdRaw) || auditConfigIdRaw <= 0 || !ficheIdStr) {
      return res.status(400).json({
        success: false,
        error: "Missing required parameters",
        message: "Both audit_config_id (or audit_id) and fiche_id are required",
      });
    }

    // Backwards-compatible: accept either `audit_id` (legacy) or `audit_config_id` (preferred)
    const parsed = validateRunAuditInput({
      fiche_id: ficheIdStr,
      audit_config_id: auditConfigIdRaw,
      user_id: data.user_id,
      use_rlm: typeof useRlmRaw === "boolean" ? useRlmRaw : undefined,
      // Keep schema-compatible optional fields (ignored by workflow if empty)
      trigger_source: "api",
    });

    const ficheId = parsed.fiche_id;
    const auditConfigId = parsed.audit_config_id;
    const user_id = parsed.user_id;
    const use_rlm = parsed.use_rlm;

    logger.info("Queuing audit", {
      fiche_id: ficheId,
      audit_config_id: auditConfigId,
      has_user_id: Boolean(user_id),
    });

    // Send event to Inngest (async processing)
    const now = Date.now();
    const eventId = `audit-${ficheId}-${auditConfigId}-${now}`;
    const { ids } = await inngest.send({
      name: "audit/run",
      data: {
        fiche_id: ficheId,
        audit_config_id: auditConfigId,
        ...(typeof user_id === "string" && user_id ? { user_id } : {}),
        ...(typeof use_rlm === "boolean" ? { use_rlm } : {}),
        trigger_source: "api",
      },
      id: eventId,
    });

    return res.json({
      success: true,
      message: "Audit queued for processing",
      event_id: ids[0],
      audit_id: eventId,
      fiche_id: ficheId,
      audit_config_id: auditConfigId,
      metadata: {
        timestamp: new Date().toISOString(),
        status: "queued",
      },
    });
  })
);

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
auditsRouter.post(
  "/run-latest",
  asyncHandler(async (req: Request, res: Response) => {
    const body: unknown = req.body;
    const data =
      typeof body === "object" && body !== null
        ? (body as Record<string, unknown>)
        : {};
    const fiche_id = data.fiche_id;
    const user_id = data.user_id;
    const useRlmRaw =
      Object.prototype.hasOwnProperty.call(data, "use_rlm")
        ? data.use_rlm
        : Object.prototype.hasOwnProperty.call(data, "useRlm")
          ? data.useRlm
          : undefined;
    const use_rlm = typeof useRlmRaw === "boolean" ? useRlmRaw : undefined;

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

    logger.info("Queuing audit with latest config", {
      fiche_id: String(fiche_id),
      audit_config_id: String(latestConfig.id),
      has_user_id: Boolean(user_id),
    });

    // Send event to Inngest
    const now = Date.now();
    const eventId = `audit-${fiche_id}-${latestConfig.id}-${now}`;
    const { ids } = await inngest.send({
      name: "audit/run",
      data: {
        fiche_id: fiche_id.toString(),
        audit_config_id: Number(latestConfig.id),
        ...(typeof user_id === "string" && user_id ? { user_id } : {}),
        ...(typeof use_rlm === "boolean" ? { use_rlm } : {}),
        trigger_source: "api",
      },
      id: eventId,
    });

    return res.json({
      success: true,
      message: "Audit queued for processing",
      event_id: ids[0],
      audit_id: eventId,
      fiche_id: fiche_id.toString(),
      audit_config_id: Number(latestConfig.id),
      audit_config_name: latestConfig.name,
      metadata: {
        timestamp: new Date().toISOString(),
        status: "queued",
      },
    });
  })
);

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
auditsRouter.post(
  "/batch",
  asyncHandler(async (req: Request, res: Response) => {
    const body: unknown = req.body;
    const data =
      typeof body === "object" && body !== null
        ? (body as Record<string, unknown>)
        : {};
    const useRlmRaw =
      Object.prototype.hasOwnProperty.call(data, "use_rlm")
        ? data.use_rlm
        : Object.prototype.hasOwnProperty.call(data, "useRlm")
          ? data.useRlm
          : undefined;
    const parsed = validateBatchAuditInput({
      fiche_ids: data.fiche_ids,
      audit_config_id: data.audit_config_id,
      user_id: data.user_id,
      use_rlm: typeof useRlmRaw === "boolean" ? useRlmRaw : undefined,
    });

    const ficheIds = parsed.fiche_ids;
    const audit_config_id = parsed.audit_config_id;
    const user_id = parsed.user_id;
    const use_rlm = parsed.use_rlm;

    // Batch progress/completion tracking requires Redis. Fail fast if not configured.
    let redisOk = false;
    try {
      const redis = await getRedisClient();
      redisOk = Boolean(redis);
    } catch {
      redisOk = false;
    }
    if (!redisOk) {
      throw new AppError(
        "Redis not configured (set REDIS_URL) — batch audits require Redis for progress/completion tracking.",
        503,
        "SERVICE_UNAVAILABLE"
      );
    }

    // Send batch event with deduplication ID
    const batchId = `batch-${Date.now()}-${ficheIds.length}`;
    const { ids } = await inngest.send({
      name: "audit/batch",
      data: {
        batch_id: batchId,
        fiche_ids: ficheIds,
        audit_config_id,
        user_id,
        ...(typeof use_rlm === "boolean" ? { use_rlm } : {}),
      },
      // Prevent duplicate batch runs
      id: batchId,
      // Add timestamp for tracking
      ts: Date.now(),
    });

    logger.info("Queued batch audit", {
      batch_id: batchId,
      fiche_count: ficheIds.length,
      audit_config_id: audit_config_id ?? null,
      has_user_id: Boolean(user_id),
    });

    return res.json({
      success: true,
      message: `Batch audit queued for ${ficheIds.length} fiches`,
      fiche_ids: ficheIds,
      audit_config_id,
      batch_id: batchId,
      event_ids: ids,
    });
  })
);

/**
 * @swagger
 * /api/audits/by-fiche/{fiche_id}:
 *   get:
 *     tags: [Audits]
 *     summary: Get audit history for a fiche
 */
auditsRouter.get(
  "/by-fiche/:fiche_id",
  asyncHandler(async (req: Request, res: Response) => {
    const includeDetails = req.query.include_details === "true";
    const audits = await auditsService.getAuditsByFiche(
      req.params.fiche_id,
      includeDetails
    );

    return jsonResponse(res, {
      success: true,
      data: audits,
      count: audits.length,
    });
  })
);

/**
 * @swagger
 * /api/audits/{audit_id}:
 *   get:
 *     tags: [Audits]
 *     summary: Get detailed audit results
 */
auditsRouter.get(
  "/:audit_id",
  asyncHandler(async (req: Request, res: Response) => {
    const audit = await auditsService.getAuditById(req.params.audit_id);

    if (!audit) {
      return res.status(404).json({
        success: false,
        error: "Audit not found",
      });
    }

    return jsonResponse(res, {
      success: true,
      data: audit,
    });
  })
);

/**
 * @swagger
 * /api/audits/control-points/statuses:
 *   get:
 *     tags: [Audits]
 *     summary: List available checkpoint (control point) statuses
 *     description: |
 *       Returns the allowed values for `points_controle[*].statut` ("checkpoint status").
 *       Useful for UI dropdowns when performing human overrides.
 *     responses:
 *       200:
 *         description: Status options
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 data:
 *                   type: object
 *                   properties:
 *                     statuses:
 *                       type: array
 *                       items:
 *                         type: string
 *                       example: [PRESENT, ABSENT, PARTIEL, NON_APPLICABLE]
 */
auditsRouter.get(
  "/control-points/statuses",
  asyncHandler(async (_req: Request, res: Response) => {
    return res.json({
      success: true,
      data: {
        statuses: controlPointStatutEnum.options,
      },
    });
  })
);

/**
 * @swagger
 * /api/audits/{audit_id}/steps/{step_position}/control-points/{control_point_index}:
 *   get:
 *     tags: [Audits]
 *     summary: Get a single checkpoint (control point) status + comment
 *     description: |
 *       Reads from the stored step `rawResult.points_controle[i]` and returns the current
 *       checkpoint status (`statut`) and comment (`commentaire`).
 *     parameters:
 *       - in: path
 *         name: audit_id
 *         required: true
 *         schema:
 *           type: string
 *       - in: path
 *         name: step_position
 *         required: true
 *         schema:
 *           type: integer
 *       - in: path
 *         name: control_point_index
 *         required: true
 *         schema:
 *           type: integer
 *         description: 1-based index in the step's `points_controle` array
 *     responses:
 *       200:
 *         description: Checkpoint status
 *       400:
 *         description: Invalid path params
 *       404:
 *         description: Step/control point not found or not available
 */
auditsRouter.get(
  "/:audit_id/steps/:step_position/control-points/:control_point_index",
  asyncHandler(async (req: Request, res: Response) => {
    const auditId = parseBigIntParam(req.params.audit_id, "audit_id");
    const stepPosition = parsePositiveIntParam(req.params.step_position, "step_position");
    const controlPointIndex = parsePositiveIntParam(
      req.params.control_point_index,
      "control_point_index"
    );

    const data = await auditsService.getAuditControlPointStatus(
      auditId,
      stepPosition,
      controlPointIndex
    );

    return jsonResponse(res, {
      success: true,
      data,
    });
  })
);

/**
 * @swagger
 * /api/audits/{audit_id}/steps/{step_position}/control-points/{control_point_index}/review:
 *   patch:
 *     tags: [Audits]
 *     summary: Override a checkpoint (control point) status/comment after human review
 *     description: |
 *       Allows a human reviewer to override the stored checkpoint status (`statut`) and/or
 *       comment (`commentaire`) for a single control point inside a step.
 *
 *       Behavior:
 *       - Updates `rawResult.points_controle[i].statut` and/or `.commentaire`
 *       - Appends an audit trail entry into `rawResult.human_review`
 *     parameters:
 *       - in: path
 *         name: audit_id
 *         required: true
 *         schema:
 *           type: string
 *       - in: path
 *         name: step_position
 *         required: true
 *         schema:
 *           type: integer
 *       - in: path
 *         name: control_point_index
 *         required: true
 *         schema:
 *           type: integer
 *         description: 1-based index in the step's `points_controle` array
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               statut:
 *                 type: string
 *                 enum: [PRESENT, ABSENT, PARTIEL, NON_APPLICABLE]
 *               commentaire:
 *                 type: string
 *               reviewer:
 *                 type: string
 *               reason:
 *                 type: string
 *     responses:
 *       200:
 *         description: Updated checkpoint status
 *       400:
 *         description: Invalid input
 *       404:
 *         description: Step/control point not found or not available
 */
auditsRouter.patch(
  "/:audit_id/steps/:step_position/control-points/:control_point_index/review",
  asyncHandler(async (req: Request, res: Response) => {
    const auditId = parseBigIntParam(req.params.audit_id, "audit_id");
    const stepPosition = parsePositiveIntParam(req.params.step_position, "step_position");
    const controlPointIndex = parsePositiveIntParam(
      req.params.control_point_index,
      "control_point_index"
    );

    const input = validateReviewAuditControlPointInput(req.body);
    const data = await auditsService.reviewAuditControlPoint(
      auditId,
      stepPosition,
      controlPointIndex,
      input
    );

    return jsonResponse(res, {
      success: true,
      data,
    });
  })
);

/**
 * @swagger
 * /api/audits/{audit_id}/steps/{step_position}/review:
 *   patch:
 *     tags: [Audits]
 *     summary: Override an audit step result after human review
 *     description: |
 *       Allows a human reviewer to override the AI decision for a specific step.
 *       This updates the step summary fields (conforme/score/etc) and stores an audit trail
 *       entry in `rawResult.human_review` for traceability.
 *     parameters:
 *       - in: path
 *         name: audit_id
 *         required: true
 *         schema:
 *           type: string
 *       - in: path
 *         name: step_position
 *         required: true
 *         schema:
 *           type: integer
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [conforme]
 *             properties:
 *               conforme:
 *                 type: string
 *                 enum: [CONFORME, NON_CONFORME, PARTIEL]
 *               traite:
 *                 type: boolean
 *               score:
 *                 type: integer
 *               niveauConformite:
 *                 type: string
 *                 enum: [EXCELLENT, BON, ACCEPTABLE, INSUFFISANT, REJET]
 *               reviewer:
 *                 type: string
 *               reason:
 *                 type: string
 *     responses:
 *       200:
 *         description: Updated step result
 *       400:
 *         description: Invalid input
 *       404:
 *         description: Step result not found
 */
auditsRouter.patch(
  "/:audit_id/steps/:step_position/review",
  asyncHandler(async (req: Request, res: Response) => {
    const auditId = parseBigIntParam(req.params.audit_id, "audit_id");
    const stepPosition = parsePositiveIntParam(req.params.step_position, "step_position");
    const input = validateReviewAuditStepResultInput(req.body);

    const updated = await auditsService.reviewAuditStepResult(
      auditId,
      stepPosition,
      input
    );

    return jsonResponse(res, {
      success: true,
      data: updated,
    });
  })
);

/**
 * Update audit metadata (CRUD "update" + soft delete/restore).
 */
auditsRouter.patch(
  "/:audit_id",
  asyncHandler(async (req: Request, res: Response) => {
    const auditId = parseBigIntParam(req.params.audit_id, "audit_id");
    const input = validateUpdateAuditInput(req.body);

    const updated = await auditsService.updateAuditMetadata(auditId, input);
    if (!updated) {
      return res.status(404).json({
        success: false,
        error: "Audit not found",
      });
    }

    return jsonResponse(res, {
      success: true,
      data: updated,
    });
  })
);

/**
 * Soft-delete an audit (CRUD "delete").
 * This does NOT remove DB rows; it sets `deletedAt` and hides the audit from list endpoints by default.
 */
auditsRouter.delete(
  "/:audit_id",
  asyncHandler(async (req: Request, res: Response) => {
    const auditId = parseBigIntParam(req.params.audit_id, "audit_id");

    const updated = await auditsService.updateAuditMetadata(auditId, { deleted: true });
    if (!updated) {
      return res.status(404).json({
        success: false,
        error: "Audit not found",
      });
    }

    return jsonResponse(res, {
      success: true,
      data: updated,
    });
  })
);
