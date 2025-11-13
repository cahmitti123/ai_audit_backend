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
import type { ChatCitation } from "../../schemas.js";

export const chatRouter = Router();

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
  async (req: Request, res: Response) => {
    try {
      const auditId = BigInt(req.params.audit_id);

      // Get audit to find fiche_id
      const { getAuditById } = await import("../audits/audits.repository.js");
      const audit = await getAuditById(auditId);
      if (!audit) {
        return res.status(404).json({
          success: false,
          error: "Audit not found",
        });
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

      res.json({
        success: true,
        data: {
          conversationId: conversation.id.toString(),
          ficheId: conversation.ficheId,
          auditId: conversation.auditId?.toString() || null,
          messages: serializedMessages,
          messageCount: serializedMessages.length,
        },
      });
    } catch (error) {
      const err = error as Error;
      logger.error("Error fetching chat history", { error: err.message });
      res.status(500).json({
        success: false,
        error: "Failed to fetch chat history",
        message: err.message,
      });
    }
  }
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
  async (req: Request, res: Response) => {
    try {
      const auditId = BigInt(req.params.audit_id);
      const { message } = req.body;

      if (!message) {
        return res.status(400).json({ error: "Message required" });
      }

      // Get audit to find fiche_id
      const { getAuditById } = await import("../audits/audits.repository.js");
      const audit = await getAuditById(auditId);
      if (!audit) {
        return res.status(404).json({ error: "Audit not found" });
      }

      const ficheId = audit.ficheCache.ficheId;

      // Get or create conversation
      const conversation = await getOrCreateAuditConversation(auditId, ficheId);

      // Build context with timeline
      const { systemPrompt, timeline } = await buildAuditContext(
        auditId,
        ficheId
      );

      // Get message history
      const history = conversation.messages.map((m) => ({
        role: m.role,
        content: m.content,
      }));

      // Save user message
      await addMessage(conversation.id, "user", message);

      // Create AI stream
      const result = await createChatStream(
        systemPrompt,
        history,
        message,
        timeline
      );

      // Set headers for streaming
      res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
      res.setHeader("Cache-Control", "no-cache");
      res.setHeader("Connection", "keep-alive");
      res.setHeader("X-Accel-Buffering", "no");

      // Stream AI response and collect full text + citations
      let fullResponse = "";

      try {
        for await (const chunk of result.textStream) {
          fullResponse += chunk;
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
        const err = streamError as Error;
        logger.error("Streaming error", { error: err.message });
        res.write(`data: ${JSON.stringify({ error: err.message })}\n\n`);
        res.end();
      }
    } catch (error) {
      const err = error as Error;
      logger.error("Chat error", { error: err.message });
      if (!res.headersSent) {
        res.status(500).json({ error: err.message });
      }
    }
  }
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
  async (req: Request, res: Response) => {
    try {
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

      res.json({
        success: true,
        data: {
          conversationId: conversation.id.toString(),
          ficheId: conversation.ficheId,
          messages: serializedMessages,
          messageCount: serializedMessages.length,
        },
      });
    } catch (error) {
      const err = error as Error;
      logger.error("Error fetching chat history", { error: err.message });
      res.status(500).json({
        success: false,
        error: "Failed to fetch chat history",
        message: err.message,
      });
    }
  }
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
  async (req: Request, res: Response) => {
    try {
      const { fiche_id } = req.params;
      const { message } = req.body;

      if (!message) {
        return res.status(400).json({ error: "Message required" });
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
      const result = await createChatStream(
        systemPrompt,
        history,
        message,
        timeline
      );

      // Set headers for streaming
      res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
      res.setHeader("Cache-Control", "no-cache");
      res.setHeader("Connection", "keep-alive");
      res.setHeader("X-Accel-Buffering", "no");

      // Stream AI response and collect full text + citations
      let fullResponse = "";

      try {
        for await (const chunk of result.textStream) {
          fullResponse += chunk;
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
        const err = streamError as Error;
        logger.error("Streaming error", { error: err.message });
        res.write(`data: ${JSON.stringify({ error: err.message })}\n\n`);
        res.end();
      }
    } catch (error) {
      const err = error as Error;
      logger.error("Chat error", { error: err.message });
      if (!res.headersSent) {
        res.status(500).json({ error: err.message });
      }
    }
  }
);
