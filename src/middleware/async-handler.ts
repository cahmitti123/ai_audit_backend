/**
 * Async Handler
 * =============
 * Express does not automatically catch rejected promises from async handlers.
 * Wrap your async route handlers with this helper so errors reach the central error middleware.
 */

import type { RequestHandler } from "express";

export function asyncHandler<T extends RequestHandler>(handler: T): T {
  return ((req, res, next) => {
    Promise.resolve(handler(req, res, next)).catch(next);
  }) as T;
}





