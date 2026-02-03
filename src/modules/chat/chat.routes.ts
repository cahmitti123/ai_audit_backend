/**
 * Chat Routes
 * ===========
 * API endpoints for AI chat with audits and fiches
 */

import type { Request, Response } from "express";
import { Router } from "express";

import { asyncHandler } from "../../middleware/async-handler.js";
import { requirePermission } from "../../middleware/authz.js";
import { getRequestAuth, isUserAuth } from "../../shared/auth-context.js";
import { AuthorizationError, NotFoundError, ValidationError } from "../../shared/errors.js";
import { ok } from "../../shared/http.js";
import { logger } from "../../shared/logger.js";
import { prisma } from "../../shared/prisma.js";
import {
  addMessage,
  getOrCreateAuditConversation,
  getOrCreateFicheConversation,
} from "./chat.repository.js";
import {
  buildAuditContext,
  buildFicheContext,
  createChatStream,
  removeCitationMarkers,
} from "./chat.service.js";

export const chatRouter = Router();

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseBigIntParam(value: string, name = "id"): bigint {
  try {
    return BigInt(value);
  } catch {
    throw new ValidationError(`Invalid ${name}`);
  }
}

type Scope = "ALL" | "GROUP" | "SELF";
type ScopeContext = { scope: Scope; groupes: string[]; crmUserId: string | null };

function getScopeContext(req: Request, permissionKey: string, action: "read" | "write"): ScopeContext {
  const auth = getRequestAuth(req);
  if (!auth || auth.kind === "apiToken") {
    return { scope: "ALL", groupes: [], crmUserId: null };
  }
  if (!isUserAuth(auth)) {
    return { scope: "SELF", groupes: [], crmUserId: null };
  }

  const grant = auth.permissions.find((p) => p.key === permissionKey);
  const scope = action === "read" ? (grant?.read_scope ?? "SELF") : (grant?.write_scope ?? "SELF");
  return {
    scope,
    groupes: Array.isArray(auth.groupes) ? auth.groupes : [],
    crmUserId: auth.crmUserId ?? null,
  };
}

function isAllowedByScope(scope: ScopeContext, info: { groupe: string | null; attributionUserId: string | null }): boolean {
  if (scope.scope === "ALL") {return true;}
  if (scope.scope === "GROUP") {
    return Boolean(info.groupe && scope.groupes.includes(info.groupe));
  }
  return Boolean(info.attributionUserId && scope.crmUserId && info.attributionUserId === scope.crmUserId);
}

async function assertAuditVisible(req: Request, auditId: bigint): Promise<{ ficheId: string }> {
  const scope = getScopeContext(req, "audits", "read");
  if (scope.scope === "ALL") {
    const row = await prisma.audit.findUnique({
      where: { id: auditId },
      select: { ficheCache: { select: { ficheId: true } } },
    });
    if (!row) {throw new NotFoundError("Audit", auditId.toString());}
    return { ficheId: row.ficheCache.ficheId };
  }

  const row = await prisma.audit.findUnique({
    where: { id: auditId },
    select: {
      ficheCache: {
        select: {
          ficheId: true,
          groupe: true,
          information: {
            select: {
              groupe: true,
              attributionUserId: true,
            },
          },
        },
      },
    },
  });
  if (!row) {throw new NotFoundError("Audit", auditId.toString());}

  const info = {
    groupe: row.ficheCache.information?.groupe ?? row.ficheCache.groupe ?? null,
    attributionUserId: row.ficheCache.information?.attributionUserId ?? null,
  };
  if (!isAllowedByScope(scope, info)) {
    throw new AuthorizationError("Forbidden");
  }
  return { ficheId: row.ficheCache.ficheId };
}

async function assertFicheVisible(req: Request, ficheId: string): Promise<void> {
  const scope = getScopeContext(req, "fiches", "read");
  if (scope.scope === "ALL") {return;}

  const row = await prisma.ficheCache.findUnique({
    where: { ficheId },
    select: {
      groupe: true,
      information: {
        select: {
          groupe: true,
          attributionUserId: true,
        },
      },
    },
  });
  if (!row) {throw new AuthorizationError("Forbidden");}

  const info = {
    groupe: row.information?.groupe ?? row.groupe ?? null,
    attributionUserId: row.information?.attributionUserId ?? null,
  };
  if (!isAllowedByScope(scope, info)) {
    throw new AuthorizationError("Forbidden");
  }
}

/**
 * @swagger
 * /api/audits/{audit_id}/chat/history:
 *   get:
 *     tags: [Chat]
 *     summary: Get chat conversation history for an audit
 *     parameters:
 *       - in: path
 *         name: audit_id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Chat conversation history
 *       404:
 *         description: Audit not found
 */
chatRouter.get(
  "/audits/:audit_id/chat/history",
  requirePermission("chat.read"),
  requirePermission("audits.read"),
  asyncHandler(async (req: Request, res: Response) => {
    const auditId = parseBigIntParam(req.params.audit_id, "audit_id");

    const { ficheId } = await assertAuditVisible(req, auditId);

    // Get or create conversation
    const conversation = await getOrCreateAuditConversation(auditId, ficheId);

    // Serialize BigInt values
    // Repository fetches newest-first; reverse for chronological display.
    const serializedMessages = [...conversation.messages].reverse().map((msg) => ({
      id: msg.id.toString(),
      conversationId: msg.conversationId.toString(),
      role: msg.role,
      content: msg.content,
      timestamp: msg.timestamp.toISOString(),
    }));

    return ok(res, {
      conversationId: conversation.id.toString(),
      ficheId: conversation.ficheId,
      auditId: conversation.auditId?.toString() || null,
      messages: serializedMessages,
      messageCount: serializedMessages.length,
    });
  })
);

/**
 * @swagger
 * /api/audits/{audit_id}/chat:
 *   post:
 *     tags: [Chat]
 *     summary: Chat about a specific audit (streaming)
 *     parameters:
 *       - in: path
 *         name: audit_id
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - message
 *             properties:
 *               message:
 *                 type: string
 *     responses:
 *       200:
 *         description: SSE stream of AI response
 *         content:
 *           text/event-stream: {}
 */
chatRouter.post(
  "/audits/:audit_id/chat",
  requirePermission("chat.use"),
  requirePermission("audits.read"),
  asyncHandler(async (req: Request, res: Response) => {
    const auditId = parseBigIntParam(req.params.audit_id, "audit_id");
    const body: unknown = req.body;
    const message =
      isRecord(body) && typeof body.message === "string" ? body.message : null;

    if (!message || message.trim().length === 0) {
      throw new ValidationError("Message required");
    }

    const { ficheId } = await assertAuditVisible(req, auditId);

    // Get or create conversation
    const conversation = await getOrCreateAuditConversation(auditId, ficheId);

    // Build context with timeline
    const { systemPrompt, timeline } = await buildAuditContext(auditId, ficheId);

    // Get message history
    // Repository fetches newest-first; reverse for chronological prompting.
    const history = [...conversation.messages].reverse().map((m) => ({
      role: m.role,
      content: m.content,
    }));

    // Save user message
    await addMessage(conversation.id, "user", message);

    // Create AI stream
    const result = await createChatStream(systemPrompt, history, message, timeline);

    // Set headers for streaming
    res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");

    try {
      for await (const chunk of result.textStream) {
        // Send chunk without citation markers to frontend
        const cleanChunk = removeCitationMarkers(chunk);
        if (cleanChunk) {
          res.write(`data: ${JSON.stringify({ text: cleanChunk })}\n\n`);
        }
      }

      // Extract citations from full response
      const [fullText, citations] = await Promise.all([
        result.fullText,
        result.citations,
      ]);

      // Send citations as final event
      if (citations.length > 0) {
        res.write(`data: ${JSON.stringify({ citations })}\n\n`);
      }

      // Save complete assistant response (without citation markers)
      const cleanResponse = removeCitationMarkers(fullText);
      await addMessage(conversation.id, "assistant", cleanResponse);

      // Send done event
      res.write(`data: [DONE]\n\n`);
      res.end();
    } catch (streamError) {
      const err =
        streamError instanceof Error ? streamError : new Error(String(streamError));
      logger.error("Streaming error", { error: err.message });
      // Streaming fallback (can't rely on central error handler once headers are sent)
      res.write(
        `data: ${JSON.stringify({ type: "error", error: err.message, code: "STREAM_ERROR" })}\n\n`
      );
      res.write(`data: [DONE]\n\n`);
      res.end();
    }
  })
);

/**
 * @swagger
 * /api/fiches/{fiche_id}/chat/history:
 *   get:
 *     tags: [Chat]
 *     summary: Get chat conversation history for a fiche
 *     parameters:
 *       - in: path
 *         name: fiche_id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Chat conversation history
 *       404:
 *         description: No conversation found
 */
chatRouter.get(
  "/fiches/:fiche_id/chat/history",
  requirePermission("chat.read"),
  requirePermission("fiches.read"),
  asyncHandler(async (req: Request, res: Response) => {
    const { fiche_id } = req.params;

    await assertFicheVisible(req, fiche_id);

    // Get or create conversation
    const conversation = await getOrCreateFicheConversation(fiche_id);

    // Serialize BigInt values
    // Repository fetches newest-first; reverse for chronological display.
    const serializedMessages = [...conversation.messages].reverse().map((msg) => ({
      id: msg.id.toString(),
      conversationId: msg.conversationId.toString(),
      role: msg.role,
      content: msg.content,
      timestamp: msg.timestamp.toISOString(),
    }));

    return ok(res, {
      conversationId: conversation.id.toString(),
      ficheId: conversation.ficheId,
      messages: serializedMessages,
      messageCount: serializedMessages.length,
    });
  })
);

/**
 * @swagger
 * /api/fiches/{fiche_id}/chat:
 *   post:
 *     tags: [Chat]
 *     summary: Chat about a fiche and all its audits (streaming)
 *     parameters:
 *       - in: path
 *         name: fiche_id
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - message
 *             properties:
 *               message:
 *                 type: string
 *     responses:
 *       200:
 *         description: SSE stream of AI response with citations
 */
chatRouter.post(
  "/fiches/:fiche_id/chat",
  requirePermission("chat.use"),
  requirePermission("fiches.read"),
  asyncHandler(async (req: Request, res: Response) => {
    const { fiche_id } = req.params;
    const body: unknown = req.body;
    const message =
      isRecord(body) && typeof body.message === "string" ? body.message : null;

    if (!message || message.trim().length === 0) {
      throw new ValidationError("Message required");
    }

    await assertFicheVisible(req, fiche_id);

    // Get or create conversation
    const conversation = await getOrCreateFicheConversation(fiche_id);

    // Build context with timeline
    const { systemPrompt, timeline } = await buildFicheContext(fiche_id);

    // Get message history
    // Repository fetches newest-first; reverse for chronological prompting.
    const history = [...conversation.messages].reverse().map((m) => ({
      role: m.role,
      content: m.content,
    }));

    // Save user message
    await addMessage(conversation.id, "user", message);

    // Create AI stream
    const result = await createChatStream(systemPrompt, history, message, timeline);

    // Set headers for streaming
    res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");

    try {
      for await (const chunk of result.textStream) {
        // Send chunk without citation markers to frontend
        const cleanChunk = removeCitationMarkers(chunk);
        if (cleanChunk) {
          res.write(`data: ${JSON.stringify({ text: cleanChunk })}\n\n`);
        }
      }

      // Extract citations from full response
      const [fullText, citations] = await Promise.all([
        result.fullText,
        result.citations,
      ]);

      // Send citations as final event
      if (citations.length > 0) {
        res.write(`data: ${JSON.stringify({ citations })}\n\n`);
      }

      // Save complete assistant response (without citation markers)
      const cleanResponse = removeCitationMarkers(fullText);
      await addMessage(conversation.id, "assistant", cleanResponse);

      // Send done event
      res.write(`data: [DONE]\n\n`);
      res.end();
    } catch (streamError) {
      const err =
        streamError instanceof Error ? streamError : new Error(String(streamError));
      logger.error("Streaming error", { error: err.message });
      // Streaming fallback (can't rely on central error handler once headers are sent)
      res.write(
        `data: ${JSON.stringify({ type: "error", error: err.message, code: "STREAM_ERROR" })}\n\n`
      );
      res.write(`data: [DONE]\n\n`);
      res.end();
    }
  })
);
