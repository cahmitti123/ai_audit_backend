/**
 * BigInt Serialization Utilities
 * ===============================
 * Universal solution for BigInt serialization issues
 * 
 * Problem: JavaScript's JSON.stringify() cannot serialize BigInt values
 * Solution: Recursively convert all BigInt values to strings
 */

import type { Response } from "express";

/**
 * Recursively serialize BigInt values to strings in arbitrary object/array values
 */
export function serializeBigInt(value: unknown): unknown {
  if (value === null || value === undefined) {return value;}

  // Handle BigInt primitive
  if (typeof value === "bigint") {return String(value);}

  // Keep Date objects intact (Express will serialize via toJSON)
  if (value instanceof Date) {return value;}

  // Handle Arrays
  if (Array.isArray(value)) {return value.map((item) => serializeBigInt(item));}

  // Handle Objects (plain or otherwise; only enumerable own props are serialized)
  if (typeof value === "object") {
    const obj = value as Record<string, unknown>;
    const result: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(obj)) {
      result[key] = serializeBigInt(val);
    }
    return result;
  }

  // Primitive types (string, number, boolean, symbol, function)
  return value;
}

/**
 * Safe JSON.stringify that handles BigInt
 */
export function stringifyWithBigInt(value: unknown, space?: number): string {
  return JSON.stringify(
    value,
    (_key, v) => (typeof v === "bigint" ? String(v) : v),
    space
  );
}

/**
 * Safe res.json() that handles BigInt
 * Use this instead of res.json() in Express routes
 */
export function jsonResponse(res: Response, data: unknown, statusCode = 200) {
  const serialized = serializeBigInt(data);
  return res.status(statusCode).json(serialized);
}

/**
 * Serialize Prisma model with BigInt fields
 * Handles common patterns in our schemas
 */
export function serializePrismaModel(model: unknown): unknown {
  return serializeBigInt(model);
}

/**
 * Batch serialize multiple models
 */
export function serializePrismaModels(models: readonly unknown[]): unknown[] {
  return models.map((model) => serializePrismaModel(model));
}

