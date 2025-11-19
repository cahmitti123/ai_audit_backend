/**
 * Payload Size Utilities
 * =======================
 * Calculate and format payload sizes for monitoring
 */

/**
 * Calculate the size of a JSON payload in bytes
 */
export function getPayloadSize(data: any): number {
  try {
    // Custom replacer to handle BigInt serialization
    const jsonString = JSON.stringify(data, (key, value) =>
      typeof value === "bigint" ? value.toString() : value
    );
    // Use Buffer.byteLength for accurate byte count (handles UTF-8)
    return Buffer.byteLength(jsonString, "utf8");
  } catch (error) {
    console.error("Error calculating payload size:", error);
    return 0;
  }
}

/**
 * Format bytes to human-readable size
 */
export function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 Bytes";

  const k = 1024;
  const sizes = ["Bytes", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));

  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`;
}

/**
 * Calculate percentage of a limit
 */
export function calculatePercentage(size: number, limit: number): number {
  return Math.round((size / limit) * 100);
}

/**
 * Check if size is approaching a limit (> 80%)
 */
export function isApproachingLimit(
  size: number,
  limit: number,
  threshold: number = 0.8
): boolean {
  return size / limit > threshold;
}

/**
 * Get payload size with warnings
 */
export interface PayloadSizeInfo {
  bytes: number;
  formatted: string;
  percentage: number;
  isWarning: boolean;
  isError: boolean;
}

export function getPayloadSizeInfo(
  data: any,
  limit: number = 50 * 1024 * 1024 // 50MB default
): PayloadSizeInfo {
  const bytes = getPayloadSize(data);
  const percentage = calculatePercentage(bytes, limit);

  return {
    bytes,
    formatted: formatBytes(bytes),
    percentage,
    isWarning: percentage > 60, // Warning at 60%
    isError: percentage > 80, // Error at 80%
  };
}

/**
 * Log payload size with appropriate log level
 */
export function logPayloadSize(
  label: string,
  data: any,
  limit: number = 50 * 1024 * 1024,
  logger?: any
): PayloadSizeInfo {
  const info = getPayloadSizeInfo(data, limit);

  const logMessage = `[Payload Size] ${label}: ${info.formatted} (${
    info.percentage
  }% of ${formatBytes(limit)} limit)`;

  if (logger) {
    if (info.isError) {
      logger.error(logMessage, {
        bytes: info.bytes,
        percentage: info.percentage,
      });
    } else if (info.isWarning) {
      logger.warn(logMessage, {
        bytes: info.bytes,
        percentage: info.percentage,
      });
    } else {
      logger.info(logMessage, {
        bytes: info.bytes,
        percentage: info.percentage,
      });
    }
  } else {
    if (info.isError) {
      console.error(`🚨 ${logMessage}`);
    } else if (info.isWarning) {
      console.warn(`⚠️  ${logMessage}`);
    } else {
      console.log(`📊 ${logMessage}`);
    }
  }

  return info;
}

/**
 * Constants for common limits
 */
export const PAYLOAD_LIMITS = {
  EXPRESS_DEFAULT: 50 * 1024 * 1024, // 50MB (your current setting)
  INNGEST_EVENT: 512 * 1024, // 512KB (Inngest event limit)
  INNGEST_STEP: 4 * 1024 * 1024, // 4MB (Inngest step data limit)
  MONGODB_DOCUMENT: 16 * 1024 * 1024, // 16MB (MongoDB document limit)
} as const;
