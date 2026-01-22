/**
 * Automation Utility Functions
 * ============================
 * Helper functions and constants for working with automation types
 * 
 * NOTE: This file contains the implementations that correspond to the
 * declarations in automation.d.ts. Copy this to your frontend project.
 */

import type {
  AutomationRunResponse,
  AutomationScheduleCreate,
  FicheSelection,
  RunStatus,
  ScheduleType,
} from './automation';

// ═══════════════════════════════════════════════════════════════════════════════
// VALIDATION CONSTANTS
// ═══════════════════════════════════════════════════════════════════════════════

export const VALIDATION = {
  NAME_MIN_LENGTH: 1,
  NAME_MAX_LENGTH: 255,
  TIME_OF_DAY_PATTERN: /^\d{2}:\d{2}$/,
  DAY_OF_WEEK_MIN: 0,
  DAY_OF_WEEK_MAX: 6,
  DAY_OF_MONTH_MIN: 1,
  DAY_OF_MONTH_MAX: 31,
  MAX_RETRIES_MIN: 0,
  MAX_RETRIES_MAX: 5,
} as const;

// ═══════════════════════════════════════════════════════════════════════════════
// TYPE GUARDS
// ═══════════════════════════════════════════════════════════════════════════════

export function isRunning(status: RunStatus): boolean {
  return status === "running";
}

export function isCompleted(status: RunStatus): boolean {
  return ["completed", "partial", "failed"].includes(status);
}

export function hasErrors(status: RunStatus): boolean {
  return ["partial", "failed"].includes(status);
}

// ═══════════════════════════════════════════════════════════════════════════════
// UTILITY FUNCTIONS
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Format duration from milliseconds to human-readable string
 * @example formatDuration(65000) // "1m 5s"
 */
export function formatDuration(durationMs: number): string {
  const seconds = Math.floor(durationMs / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);

  if (hours > 0) {
    return `${hours}h ${minutes % 60}m`;
  } else if (minutes > 0) {
    return `${minutes}m ${seconds % 60}s`;
  } else {
    return `${seconds}s`;
  }
}

/**
 * Calculate success rate percentage
 * @example calculateSuccessRate({totalFiches: 10, successfulFiches: 8}) // 80
 */
export function calculateSuccessRate(run: AutomationRunResponse): number {
  if (run.totalFiches === 0) {return 0;}
  return Math.round((run.successfulFiches / run.totalFiches) * 100);
}

/**
 * Get status color for UI (for Tailwind, Material-UI, etc.)
 * @example getStatusColor("completed") // "success"
 */
export function getStatusColor(
  status: RunStatus
): "success" | "warning" | "error" | "info" {
  switch (status) {
    case "completed":
      return "success";
    case "partial":
      return "warning";
    case "failed":
      return "error";
    case "running":
      return "info";
    default:
      return "info";
  }
}

/**
 * Get schedule type display name
 * @example getScheduleTypeLabel("DAILY") // "Daily"
 */
export function getScheduleTypeLabel(type: ScheduleType): string {
  switch (type) {
    case "MANUAL":
      return "Manual";
    case "DAILY":
      return "Daily";
    case "WEEKLY":
      return "Weekly";
    case "MONTHLY":
      return "Monthly";
    case "CRON":
      return "Custom Cron";
    default:
      return type;
  }
}

/**
 * Validate time of day format (HH:MM)
 * @example isValidTimeOfDay("14:30") // true
 * @example isValidTimeOfDay("9:30") // false (should be 09:30)
 */
export function isValidTimeOfDay(time: string): boolean {
  return VALIDATION.TIME_OF_DAY_PATTERN.test(time);
}

/**
 * Create default fiche selection configuration
 */
export function createDefaultFicheSelection(): FicheSelection {
  return {
    mode: "date_range",
    dateRange: "yesterday",
    onlyWithRecordings: true,
  };
}

/**
 * Create default schedule data for form initialization
 */
export function createDefaultSchedule(): AutomationScheduleCreate {
  return {
    name: "",
    scheduleType: "MANUAL",
    timezone: "UTC",
    ficheSelection: createDefaultFicheSelection(),
    runTranscription: true,
    skipIfTranscribed: true,
    transcriptionPriority: "normal",
    runAudits: true,
    useAutomaticAudits: true,
    specificAuditConfigs: [], // Add specific audit config IDs here
    continueOnError: true,
    retryFailed: false,
    maxRetries: 0,
    notifyOnComplete: true,
    notifyOnError: true,
    notifyEmails: [],
  };
}

/**
 * Get day of week name from number (0-6)
 * @example getDayName(0) // "Sunday"
 */
export function getDayName(day: number): string {
  const days = [
    "Sunday",
    "Monday",
    "Tuesday",
    "Wednesday",
    "Thursday",
    "Friday",
    "Saturday",
  ];
  return days[day] || "Unknown";
}

/**
 * Get short day of week name from number (0-6)
 * @example getShortDayName(0) // "Sun"
 */
export function getShortDayName(day: number): string {
  const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  return days[day] || "?";
}

/**
 * Format next run time for display
 * @example formatNextRun(new Date("2024-01-15T14:30:00Z")) // "Today at 2:30 PM"
 */
export function formatNextRun(date: Date | string | null): string {
  if (!date) {return "Not scheduled";}

  const nextRun = typeof date === "string" ? new Date(date) : date;
  const now = new Date();
  const diffMs = nextRun.getTime() - now.getTime();
  const diffHours = diffMs / (1000 * 60 * 60);
  const diffDays = diffMs / (1000 * 60 * 60 * 24);

  // Format time
  const timeStr = nextRun.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });

  if (diffDays < 0) {
    return "Overdue";
  } else if (diffHours < 1) {
    const minutes = Math.floor(diffMs / (1000 * 60));
    return `In ${minutes} minute${minutes !== 1 ? "s" : ""}`;
  } else if (diffHours < 24) {
    return `Today at ${timeStr}`;
  } else if (diffDays < 2) {
    return `Tomorrow at ${timeStr}`;
  } else if (diffDays < 7) {
    return `${getDayName(nextRun.getDay())} at ${timeStr}`;
  } else {
    return nextRun.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  }
}

/**
 * Check if audit configs are properly configured
 */
export function hasValidAuditConfig(schedule: {
  runAudits: boolean;
  useAutomaticAudits: boolean;
  specificAuditConfigs: string[];
}): boolean {
  if (!schedule.runAudits) {return true;} // Not running audits is valid
  
  // Either automatic audits enabled OR specific configs provided
  return (
    schedule.useAutomaticAudits ||
    (schedule.specificAuditConfigs && schedule.specificAuditConfigs.length > 0)
  );
}

/**
 * Get warning message if audit config is invalid
 */
export function getAuditConfigWarning(schedule: {
  runAudits: boolean;
  useAutomaticAudits: boolean;
  specificAuditConfigs: string[];
}): string | null {
  if (!schedule.runAudits) {return null;}
  
  if (!hasValidAuditConfig(schedule)) {
    return "No audit configs selected. Either enable automatic audits or select specific audit configs.";
  }
  
  return null;
}

