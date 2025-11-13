/**
 * Automation Entity Type Definitions
 * ===================================
 * TypeScript types for the Automation API
 *
 * Copy this file to your frontend project's types directory
 */

// ═══════════════════════════════════════════════════════════════════════════════
// ENUMS
// ═══════════════════════════════════════════════════════════════════════════════

export type ScheduleType = "MANUAL" | "DAILY" | "WEEKLY" | "MONTHLY" | "CRON";

export type RunStatus = "running" | "completed" | "partial" | "failed";

export type LogLevel = "info" | "warning" | "error" | "debug";

export type TranscriptionPriority = "low" | "normal" | "high";

export type FicheSelectionMode = "date_range" | "manual" | "filter";

export type DateRange =
  | "last_24h"
  | "yesterday"
  | "last_week"
  | "last_month"
  | "custom";

// ═══════════════════════════════════════════════════════════════════════════════
// CORE TYPES
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Fiche Selection Configuration
 * Defines how fiches are selected for processing
 */
export interface FicheSelection {
  mode: FicheSelectionMode;

  // For date_range mode
  dateRange?: DateRange;
  customStartDate?: string; // Format: "DD/MM/YYYY"
  customEndDate?: string; // Format: "DD/MM/YYYY"

  // Filters
  groupes?: string[];
  onlyWithRecordings?: boolean;
  onlyUnaudited?: boolean;
  maxFiches?: number;

  // For manual mode
  ficheIds?: string[];
}

/**
 * Automation Schedule Create Request
 * Schema for creating a new automation schedule
 */
export interface AutomationScheduleCreate {
  name: string;
  description?: string;
  isActive?: boolean;
  createdBy?: string;

  // Schedule Configuration
  scheduleType: ScheduleType;
  cronExpression?: string;
  timezone?: string;
  timeOfDay?: string; // Format: "HH:MM"
  dayOfWeek?: number; // 0-6 (Sunday-Saturday)
  dayOfMonth?: number; // 1-31

  // Fiche Selection
  ficheSelection: FicheSelection;

  // Transcription Configuration
  runTranscription?: boolean;
  skipIfTranscribed?: boolean;
  transcriptionPriority?: TranscriptionPriority;

  // Audit Configuration
  runAudits?: boolean;
  useAutomaticAudits?: boolean;
  specificAuditConfigs?: number[] | string[]; // Accepts both numbers and strings (BigInt serialization)

  // Error Handling
  continueOnError?: boolean;
  retryFailed?: boolean;
  maxRetries?: number;

  // Notifications
  notifyOnComplete?: boolean;
  notifyOnError?: boolean;
  webhookUrl?: string;
  notifyEmails?: string[];

  // External API
  externalApiKey?: string;
}

/**
 * Automation Schedule Update Request
 * All fields are optional (partial update)
 */
export type AutomationScheduleUpdate = Partial<AutomationScheduleCreate>;

/**
 * Automation Schedule Response
 * Complete schedule data returned by API
 */
export interface AutomationScheduleResponse {
  id: string;
  name: string;
  description: string | null;
  isActive: boolean;
  createdBy: string | null;
  createdAt: string; // ISO 8601
  updatedAt: string; // ISO 8601

  scheduleType: ScheduleType;
  cronExpression: string | null;
  timezone: string;
  timeOfDay: string | null;
  dayOfWeek: number | null;
  dayOfMonth: number | null;

  ficheSelection: FicheSelection;

  runTranscription: boolean;
  skipIfTranscribed: boolean;
  transcriptionPriority: string;

  runAudits: boolean;
  useAutomaticAudits: boolean;
  specificAuditConfigs: string[];

  continueOnError: boolean;
  retryFailed: boolean;
  maxRetries: number;

  notifyOnComplete: boolean;
  notifyOnError: boolean;
  webhookUrl: string | null;
  notifyEmails: string[];

  externalApiKey: string | null;

  lastRunAt: string | null; // ISO 8601
  lastRunStatus: string | null;
  totalRuns: number;
  successfulRuns: number;
  failedRuns: number;

  runs?: AutomationRunResponse[];
}

/**
 * Automation Run Response
 * Execution record for an automation
 */
export interface AutomationRunResponse {
  id: string;
  scheduleId: string;

  status: RunStatus;
  startedAt: string; // ISO 8601
  completedAt: string | null; // ISO 8601
  durationMs: number | null;

  totalFiches: number;
  successfulFiches: number;
  failedFiches: number;
  transcriptionsRun: number;
  auditsRun: number;

  errorMessage: string | null;
  errorDetails: any | null;

  configSnapshot: any;
  resultSummary: ResultSummary | null;

  logs?: AutomationLogResponse[];
}

/**
 * Result Summary
 * Detailed execution results
 */
export interface ResultSummary {
  successful: string[];
  failed: FailedFiche[];
  transcriptions: number;
  audits: number;
}

export interface FailedFiche {
  ficheId: string;
  error: string;
}

/**
 * Automation Log Response
 * Individual log entry
 */
export interface AutomationLogResponse {
  id: string;
  runId: string;

  level: LogLevel;
  message: string;
  metadata: any;
  timestamp: string; // ISO 8601
}

/**
 * Trigger Automation Request
 * Manually trigger an automation
 */
export interface TriggerAutomationRequest {
  scheduleId: number;
  overrideFicheSelection?: FicheSelection;
}

// ═══════════════════════════════════════════════════════════════════════════════
// API RESPONSE TYPES
// ═══════════════════════════════════════════════════════════════════════════════

export interface ApiSuccessResponse<T = any> {
  success: true;
  data: T;
}

export interface ApiErrorResponse {
  success: false;
  error: string;
}

export type ApiResponse<T = any> = ApiSuccessResponse<T> | ApiErrorResponse;

/**
 * List Schedules Response
 */
export interface ListSchedulesResponse {
  success: true;
  data: AutomationScheduleResponse[];
  count: number;
}

/**
 * Get Schedule Response
 */
export interface GetScheduleResponse {
  success: true;
  data: AutomationScheduleResponse & {
    runs: AutomationRunResponse[];
    _diagnostic?: {
      specificAuditConfigsCount: number;
      specificAuditConfigsRaw: string[];
      useAutomaticAudits: boolean;
      runAudits: boolean;
    };
  };
}

/**
 * List Runs Response
 */
export interface ListRunsResponse {
  success: true;
  data: AutomationRunResponse[];
  count: number;
  limit: number;
  offset: number;
}

/**
 * Get Run Response
 */
export interface GetRunResponse {
  success: true;
  data: AutomationRunResponse & {
    logs: AutomationLogResponse[];
  };
}

/**
 * List Logs Response
 */
export interface ListLogsResponse {
  success: true;
  data: AutomationLogResponse[];
  count: number;
}

/**
 * Trigger Automation Response
 */
export interface TriggerAutomationResponse {
  success: true;
  message: string;
  schedule_id: number;
}

/**
 * Delete Schedule Response
 */
export interface DeleteScheduleResponse {
  success: true;
  message: string;
}

// ═══════════════════════════════════════════════════════════════════════════════
// WEBHOOK NOTIFICATION TYPES
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Webhook notification payload sent on automation completion/error
 */
export interface WebhookNotificationPayload {
  schedule_id: number;
  schedule_name: string;
  run_id: string;
  status: RunStatus;
  duration_seconds?: number;
  total_fiches?: number;
  successful_fiches?: number;
  failed_fiches?: number;
  transcriptions_run?: number;
  audits_run?: number;
  failures?: FailedFiche[];
  error?: string;
}

// ═══════════════════════════════════════════════════════════════════════════════
// HELPER TYPES FOR FRONTEND STATE MANAGEMENT
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * UI State for Schedule List
 */
export interface SchedulesState {
  schedules: AutomationScheduleResponse[];
  isLoading: boolean;
  error: string | null;
  selectedScheduleId: string | null;
}

/**
 * UI State for Schedule Details
 */
export interface ScheduleDetailsState {
  schedule: AutomationScheduleResponse | null;
  runs: AutomationRunResponse[];
  isLoading: boolean;
  error: string | null;
}

/**
 * UI State for Run Details
 */
export interface RunDetailsState {
  run: AutomationRunResponse | null;
  logs: AutomationLogResponse[];
  isLoading: boolean;
  error: string | null;
}

/**
 * Form State for Create/Update Schedule
 */
export interface ScheduleFormState {
  data: AutomationScheduleCreate;
  errors: Partial<Record<keyof AutomationScheduleCreate, string>>;
  isSubmitting: boolean;
  isDirty: boolean;
}

// ═══════════════════════════════════════════════════════════════════════════════
// VALIDATION CONSTANTS
// ═══════════════════════════════════════════════════════════════════════════════

export interface ValidationConstants {
  NAME_MIN_LENGTH: 1;
  NAME_MAX_LENGTH: 255;
  TIME_OF_DAY_PATTERN: RegExp;
  DAY_OF_WEEK_MIN: 0;
  DAY_OF_WEEK_MAX: 6;
  DAY_OF_MONTH_MIN: 1;
  DAY_OF_MONTH_MAX: 31;
  MAX_RETRIES_MIN: 0;
  MAX_RETRIES_MAX: 5;
}

export declare const VALIDATION: ValidationConstants;

// ═══════════════════════════════════════════════════════════════════════════════
// TYPE GUARDS
// ═══════════════════════════════════════════════════════════════════════════════

export function isApiSuccess<T>(
  response: ApiResponse<T>
): response is ApiSuccessResponse<T>;

export function isApiError(response: ApiResponse): response is ApiErrorResponse;

export function isRunning(status: RunStatus): boolean;

export function isCompleted(status: RunStatus): boolean;

export function hasErrors(status: RunStatus): boolean;

// ═══════════════════════════════════════════════════════════════════════════════
// UTILITY FUNCTIONS (Declare - implement in your frontend)
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Format duration from milliseconds to human-readable string
 * @example formatDuration(65000) // "1m 5s"
 */
export function formatDuration(durationMs: number): string;

/**
 * Calculate success rate percentage
 * @example calculateSuccessRate({totalFiches: 10, successfulFiches: 8}) // 80
 */
export function calculateSuccessRate(run: AutomationRunResponse): number;

/**
 * Get status color for UI
 * @example getStatusColor("completed") // "success"
 */
export function getStatusColor(
  status: RunStatus
): "success" | "warning" | "error" | "info";

/**
 * Get schedule type display name
 * @example getScheduleTypeLabel("DAILY") // "Daily"
 */
export function getScheduleTypeLabel(type: ScheduleType): string;

/**
 * Validate time of day format (HH:MM)
 * @example isValidTimeOfDay("14:30") // true
 */
export function isValidTimeOfDay(time: string): boolean;

/**
 * Create default fiche selection
 */
export function createDefaultFicheSelection(): FicheSelection;

/**
 * Create default schedule data
 */
export function createDefaultSchedule(): AutomationScheduleCreate;
