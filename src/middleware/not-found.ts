/**
 * Not Found Middleware
 * ====================
 * Converts unknown API routes into a structured 404 error.
 */

import type { RequestHandler } from "express";

import { NotFoundError } from "../shared/errors.js";

export const notFoundHandler: RequestHandler = (req, _res, next) => {
  // Keep non-API paths on Express' default final handler (useful for simple debugging).
  if (!req.path.startsWith("/api")) {return next();}

  return next(new NotFoundError("Route", req.originalUrl));
};





