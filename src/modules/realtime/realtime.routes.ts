/**
 * Realtime Routes (SSE)
 * ====================
 * Server-Sent Events endpoints backed by Redis Streams when available.
 *
 * - Supports resume via `Last-Event-ID` header (Redis mode).
 * - Sends periodic heartbeats to keep connections alive behind proxies.
 */

import { Router, type Request, type Response } from "express";
import { logger } from "../../shared/logger.js";
import { asyncHandler } from "../../middleware/async-handler.js";
import {
  createRealtimeRedisStreamReader,
  subscribeLocal,
  topicForAudit,
  topicForFiche,
  topicForJob,
  type RealtimeEvent,
} from "../../shared/realtime.js";

export const realtimeRouter = Router();

function setSseHeaders(res: Response) {
  res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
}

function writeSseEvent(res: Response, evt: RealtimeEvent) {
  if (evt.id) res.write(`id: ${evt.id}\n`);
  res.write(`event: ${evt.type}\n`);
  res.write(`data: ${JSON.stringify(evt)}\n\n`);
}

async function streamTopic(req: Request, res: Response, topic: string) {
  setSseHeaders(res);
  // Immediately flush headers
  const flush = (res as { flushHeaders?: unknown }).flushHeaders;
  if (typeof flush === "function") {
    (flush as () => void).call(res);
  }

  res.write(`: connected topic=${topic}\n\n`);

  let closed = false;
  req.on("close", () => {
    closed = true;
  });

  const heartbeat = setInterval(() => {
    if (!closed && !res.writableEnded) {
      res.write(`: heartbeat ${Date.now()}\n\n`);
    }
  }, 15000);

  // Resume support (Redis mode)
  const headerLastId = req.header("Last-Event-ID");
  const queryLastId =
    typeof req.query.lastEventId === "string" ? req.query.lastEventId : undefined;
  let lastId = headerLastId || queryLastId || "$";

  const reader = await createRealtimeRedisStreamReader(topic);

  if (reader) {
    try {
      while (!closed && !res.writableEnded) {
        const { events, lastId: newLastId } = await reader.read({
          lastId,
          blockMs: 15000,
          count: 100,
        });

        if (events.length === 0) continue;

        for (const evt of events) {
          if (closed || res.writableEnded) break;
          writeSseEvent(res, evt);
        }
        lastId = newLastId;
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      // Client disconnects are normal for SSE (navigation, refresh, tab close).
      // Redis readers will often surface this as "The client is closed".
      const isClientClosed =
        closed ||
        res.writableEnded ||
        /client is closed/i.test(message) ||
        /The client is closed/i.test(message);

      if (!isClientClosed) {
        logger.error("Realtime SSE error", {
          topic,
          error: message,
        });
      }
    } finally {
      clearInterval(heartbeat);
      await reader.close();
      if (!res.writableEnded) res.end();
    }

    return;
  }

  // Fallback: in-process emitter only (no resume across reconnects)
  const unsubscribe = subscribeLocal(topic, (evt) => {
    if (closed || res.writableEnded) return;
    writeSseEvent(res, evt);
  });

  req.on("close", () => {
    clearInterval(heartbeat);
    unsubscribe();
  });
}

realtimeRouter.get(
  "/audits/:auditId",
  asyncHandler(async (req: Request, res: Response) => {
    const { auditId } = req.params;
    await streamTopic(req, res, topicForAudit(auditId));
  })
);

realtimeRouter.get(
  "/fiches/:ficheId",
  asyncHandler(async (req: Request, res: Response) => {
    const { ficheId } = req.params;
    await streamTopic(req, res, topicForFiche(ficheId));
  })
);

realtimeRouter.get(
  "/jobs/:jobId",
  asyncHandler(async (req: Request, res: Response) => {
    const { jobId } = req.params;
    await streamTopic(req, res, topicForJob(jobId));
  })
);



