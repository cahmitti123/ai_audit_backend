/**
 * BigInt Serialization Utilities
 * ===============================
 * Universal solution for BigInt serialization issues
 * 
 * Problem: JavaScript's JSON.stringify() cannot serialize BigInt values
 * Solution: Recursively convert all BigInt values to strings
 */

/**
 * Recursively serialize BigInt values to strings in any object/array
 */
export function serializeBigInt(obj: any): any {
  if (obj === null || obj === undefined) {
    return obj;
  }

  // Handle BigInt primitive
  if (typeof obj === 'bigint') {
    return String(obj);
  }

  // Handle Date objects
  if (obj instanceof Date) {
    return obj;
  }

  // Handle Arrays
  if (Array.isArray(obj)) {
    return obj.map(item => serializeBigInt(item));
  }

  // Handle Objects
  if (typeof obj === 'object') {
    const result: any = {};
    for (const key in obj) {
      if (obj.hasOwnProperty(key)) {
        result[key] = serializeBigInt(obj[key]);
      }
    }
    return result;
  }

  // Primitive types (string, number, boolean)
  return obj;
}

/**
 * Safe JSON.stringify that handles BigInt
 */
export function stringifyWithBigInt(obj: any, space?: number): string {
  return JSON.stringify(obj, (key, value) => 
    typeof value === 'bigint' ? String(value) : value
  , space);
}

/**
 * Safe res.json() that handles BigInt
 * Use this instead of res.json() in Express routes
 */
export function jsonResponse(res: any, data: any, statusCode: number = 200) {
  const serialized = serializeBigInt(data);
  return res.status(statusCode).json(serialized);
}

/**
 * Serialize Prisma model with BigInt fields
 * Handles common patterns in our schemas
 */
export function serializePrismaModel(model: any): any {
  if (!model) return model;
  
  return serializeBigInt(model);
}

/**
 * Batch serialize multiple models
 */
export function serializePrismaModels(models: any[]): any[] {
  return models.map(model => serializePrismaModel(model));
}

