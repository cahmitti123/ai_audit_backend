/**
 * Payload Size Logging Middleware
 * =================================
 * Logs incoming request payload sizes for monitoring
 */

import type { NextFunction,Request, Response } from "express";

import { logger } from "../shared/logger.js";
import { logPayloadSize, PAYLOAD_LIMITS } from "../utils/payload-size.js";

/**
 * Middleware to log request payload sizes
 */
export function payloadSizeLogger(
  req: Request,
  res: Response,
  next: NextFunction
) {
  // Only log for requests with bodies (POST, PUT, PATCH)
  if (!req.body || Object.keys(req.body).length === 0) {
    return next();
  }

  const route = `${req.method} ${req.path}`;

  try {
    logPayloadSize(
      `Request: ${route}`,
      req.body,
      PAYLOAD_LIMITS.EXPRESS_DEFAULT,
      logger
    );
  } catch (error) {
    logger.error("Error logging payload size", {
      route,
      error: error instanceof Error ? error.message : String(error),
    });
  }

  next();
}

/**
 * Log response payload size (attach to res.json)
 */
export function payloadSizeResponseLogger(
  req: Request,
  res: Response,
  next: NextFunction
) {
  const originalJson = res.json.bind(res);

  res.json = function (body: unknown) {
    const route = `${req.method} ${req.path}`;

    try {
      logPayloadSize(
        `Response: ${route}`,
        body,
        PAYLOAD_LIMITS.EXPRESS_DEFAULT,
        logger
      );
    } catch (error) {
      logger.error("Error logging response payload size", {
        route,
        error: error instanceof Error ? error.message : String(error),
      });
    }

    return originalJson(body);
  };

  next();
}

