/**
 * Chat Routes
 * ===========
 * API endpoints for AI chat with audits and fiches
 */

import { Router, Request, Response } from "express";
import {
  getOrCreateAuditConversation,
  getOrCreateFicheConversation,
  addMessage,
} from "./chat.repository.js";
import {
  buildAuditContext,
  buildFicheContext,
  createChatStream,
  removeCitationMarkers,
} from "./chat.service.js";
import { logger } from "../../shared/logger.js";
import { asyncHandler } from "../../middleware/async-handler.js";
import { NotFoundError, ValidationError } from "../../shared/errors.js";
import { ok } from "../../shared/http.js";

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
  asyncHandler(async (req: Request, res: Response) => {
    const auditId = parseBigIntParam(req.params.audit_id, "audit_id");

    // Get audit to find fiche_id
    const { getAuditById } = await import("../audits/audits.repository.js");
    const audit = await getAuditById(auditId);
    if (!audit) {
      throw new NotFoundError("Audit", req.params.audit_id);
    }

    const ficheId = audit.ficheCache.ficheId;

    // Get or create conversation
    const conversation = await getOrCreateAuditConversation(auditId, ficheId);

    // Serialize BigInt values
    const serializedMessages = conversation.messages.map((msg) => ({
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
  asyncHandler(async (req: Request, res: Response) => {
    const auditId = parseBigIntParam(req.params.audit_id, "audit_id");
    const body: unknown = req.body;
    const message =
      isRecord(body) && typeof body.message === "string" ? body.message : null;

    if (!message || message.trim().length === 0) {
      throw new ValidationError("Message required");
    }

    // Get audit to find fiche_id
    const { getAuditById } = await import("../audits/audits.repository.js");
    const audit = await getAuditById(auditId);
    if (!audit) {
      throw new NotFoundError("Audit", req.params.audit_id);
    }

    const ficheId = audit.ficheCache.ficheId;

    // Get or create conversation
    const conversation = await getOrCreateAuditConversation(auditId, ficheId);

    // Build context with timeline
    const { systemPrompt, timeline } = await buildAuditContext(auditId, ficheId);

    // Get message history
    const history = conversation.messages.map((m) => ({
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
      res.write(`data: ${JSON.stringify({ error: err.message })}\n\n`);
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
  asyncHandler(async (req: Request, res: Response) => {
    const { fiche_id } = req.params;

    // Get or create conversation
    const conversation = await getOrCreateFicheConversation(fiche_id);

    // Serialize BigInt values
    const serializedMessages = conversation.messages.map((msg) => ({
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
  asyncHandler(async (req: Request, res: Response) => {
    const { fiche_id } = req.params;
    const body: unknown = req.body;
    const message =
      isRecord(body) && typeof body.message === "string" ? body.message : null;

    if (!message || message.trim().length === 0) {
      throw new ValidationError("Message required");
    }

    // Get or create conversation
    const conversation = await getOrCreateFicheConversation(fiche_id);

    // Build context with timeline
    const { systemPrompt, timeline } = await buildFicheContext(fiche_id);

    // Get message history
    const history = conversation.messages.map((m) => ({
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
      res.write(`data: ${JSON.stringify({ error: err.message })}\n\n`);
      res.end();
    }
  })
);
