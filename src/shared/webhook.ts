import { logger } from "./logger.js";
import { publishPusherEvent } from "./pusher.js";

// Webhook event types matching the documentation
export type WebhookEventType =
  | "audit.started"
  | "audit.fiche_fetch_started"
  | "audit.fiche_fetch_completed"
  | "audit.config_loaded"
  | "audit.transcription_check"
  | "audit.timeline_generated"
  | "audit.analysis_started"
  | "audit.step_started"
  | "audit.step_completed"
  | "audit.step_failed"
  | "audit.progress"
  | "audit.compliance_calculated"
  | "audit.completed"
  | "audit.failed"
  | "transcription.started"
  | "transcription.status_check"
  | "transcription.recording_started"
  | "transcription.recording_completed"
  | "transcription.recording_failed"
  | "transcription.progress"
  | "transcription.completed"
  | "transcription.failed"
  | "batch.progress"
  | "batch.completed"
  | "notification";

/**
 * Publish a realtime domain event (Pusher).
 *
 * IMPORTANT:
 * - Event names match the legacy webhook event names exactly.
 * - Pusher payload is the domain payload object only (no wrapper).
 */
export async function sendWebhook(
  eventType: WebhookEventType,
  data: Record<string, unknown>,
  source: string = "audit-service"
): Promise<boolean> {
  const result = await publishPusherEvent({ event: eventType, payload: data });
  if (!result.ok) {
    logger.error("Realtime publish failed", {
      event: eventType,
      source,
      error: result.error,
    });
    return false;
  }
  return true;
}

/**
 * Send notification webhook
 */
export async function sendNotification(
  type: "success" | "error" | "info" | "warning",
  message: string,
  description?: string,
  duration?: number
): Promise<boolean> {
  return sendWebhook("notification", {
    type,
    message,
    description,
    duration: duration || 5000,
  });
}

/**
 * Webhook helper for audit events
 */
type AuditApproach = { use_rlm: boolean; transcript_mode: "prompt" | "tools" };
type AuditWebhookMeta = {
  /**
   * Database audit id (BigInt serialized as string).
   * This makes it easy to bridge realtime events → REST `GET /api/audits/:audit_id`.
   */
  audit_db_id?: string;
  /**
   * Inngest event id for the parent workflow/event that triggered this realtime message.
   */
  event_id?: string;
  /**
   * Long-context strategy for transcript evidence.
   */
  approach?: AuditApproach;
};

export const auditWebhooks = {
  /**
   * Sent when audit workflow starts
   */
  started: (
    auditId: string,
    ficheId: string,
    configId: string,
    configName: string,
    totalSteps: number,
    meta?: AuditWebhookMeta
  ) =>
    sendWebhook("audit.started", {
      audit_id: auditId,
      ...(meta?.event_id ? { event_id: meta.event_id } : {}),
      ...(meta?.audit_db_id ? { audit_db_id: meta.audit_db_id } : {}),
      fiche_id: ficheId,
      audit_config_id: configId,
      audit_config_name: configName,
      total_steps: totalSteps,
      started_at: new Date().toISOString(),
      status: "started",
      ...(meta?.approach ? { approach: meta.approach } : {}),
    }),

  /**
   * Sent when starting to fetch fiche data
   */
  ficheFetchStarted: (
    auditId: string,
    ficheId: string,
    fromCache: boolean,
    meta?: AuditWebhookMeta
  ) =>
    sendWebhook("audit.fiche_fetch_started", {
      audit_id: auditId,
      ...(meta?.event_id ? { event_id: meta.event_id } : {}),
      ...(meta?.audit_db_id ? { audit_db_id: meta.audit_db_id } : {}),
      fiche_id: ficheId,
      from_cache: fromCache,
      status: "fetching",
      ...(meta?.approach ? { approach: meta.approach } : {}),
    }),

  /**
   * Sent when fiche data is fetched
   */
  ficheFetchCompleted: (
    auditId: string,
    ficheId: string,
    recordingsCount: number,
    prospectName: string,
    fromCache: boolean,
    meta?: AuditWebhookMeta
  ) =>
    sendWebhook("audit.fiche_fetch_completed", {
      audit_id: auditId,
      ...(meta?.event_id ? { event_id: meta.event_id } : {}),
      ...(meta?.audit_db_id ? { audit_db_id: meta.audit_db_id } : {}),
      fiche_id: ficheId,
      recordings_count: recordingsCount,
      prospect_name: prospectName,
      from_cache: fromCache,
      status: "fetched",
      ...(meta?.approach ? { approach: meta.approach } : {}),
    }),

  /**
   * Sent when audit configuration is loaded
   */
  configLoaded: (
    auditId: string,
    ficheId: string,
    configId: string,
    configName: string,
    stepsCount: number,
    meta?: AuditWebhookMeta
  ) =>
    sendWebhook("audit.config_loaded", {
      audit_id: auditId,
      ...(meta?.event_id ? { event_id: meta.event_id } : {}),
      ...(meta?.audit_db_id ? { audit_db_id: meta.audit_db_id } : {}),
      fiche_id: ficheId,
      config_id: configId,
      config_name: configName,
      steps_count: stepsCount,
      status: "loaded",
      ...(meta?.approach ? { approach: meta.approach } : {}),
    }),

  /**
   * Sent when checking transcription status
   */
  transcriptionCheck: (
    auditId: string,
    ficheId: string,
    totalRecordings: number,
    transcribed: number,
    needsTranscription: number,
    meta?: AuditWebhookMeta
  ) =>
    sendWebhook("audit.transcription_check", {
      audit_id: auditId,
      ...(meta?.event_id ? { event_id: meta.event_id } : {}),
      ...(meta?.audit_db_id ? { audit_db_id: meta.audit_db_id } : {}),
      fiche_id: ficheId,
      total_recordings: totalRecordings,
      transcribed,
      needs_transcription: needsTranscription,
      status: "checked",
      ...(meta?.approach ? { approach: meta.approach } : {}),
    }),

  /**
   * Sent when timeline is generated
   */
  timelineGenerated: (
    auditId: string,
    ficheId: string,
    recordingsCount: number,
    totalChunks: number,
    meta?: AuditWebhookMeta
  ) =>
    sendWebhook("audit.timeline_generated", {
      audit_id: auditId,
      ...(meta?.event_id ? { event_id: meta.event_id } : {}),
      ...(meta?.audit_db_id ? { audit_db_id: meta.audit_db_id } : {}),
      fiche_id: ficheId,
      recordings_count: recordingsCount,
      total_chunks: totalChunks,
      status: "generated",
      ...(meta?.approach ? { approach: meta.approach } : {}),
    }),

  /**
   * Sent when audit analysis begins
   */
  analysisStarted: (
    auditId: string,
    ficheId: string,
    totalSteps: number,
    model: string,
    meta?: AuditWebhookMeta
  ) =>
    sendWebhook("audit.analysis_started", {
      audit_id: auditId,
      ...(meta?.event_id ? { event_id: meta.event_id } : {}),
      ...(meta?.audit_db_id ? { audit_db_id: meta.audit_db_id } : {}),
      fiche_id: ficheId,
      total_steps: totalSteps,
      model,
      status: "analyzing",
      ...(meta?.approach ? { approach: meta.approach } : {}),
    }),

  /**
   * Sent when starting to analyze an individual audit step
   */
  stepStarted: (
    auditId: string,
    ficheId: string,
    stepPosition: number,
    stepName: string,
    totalSteps: number,
    stepWeight: number,
    isCritical: boolean,
    meta?: AuditWebhookMeta
  ) =>
    sendWebhook("audit.step_started", {
      audit_id: auditId,
      ...(meta?.event_id ? { event_id: meta.event_id } : {}),
      ...(meta?.audit_db_id ? { audit_db_id: meta.audit_db_id } : {}),
      fiche_id: ficheId,
      step_position: stepPosition,
      step_name: stepName,
      total_steps: totalSteps,
      step_weight: stepWeight,
      is_critical: isCritical,
      status: "processing",
      ...(meta?.approach ? { approach: meta.approach } : {}),
    }),

  /**
   * Sent when an audit step completes successfully
   */
  stepCompleted: (
    auditId: string,
    ficheId: string,
    stepPosition: number,
    stepName: string,
    score: number,
    maxScore: number,
    conforme: boolean,
    totalCitations: number,
    tokensUsed: number,
    meta?: AuditWebhookMeta
  ) =>
    sendWebhook("audit.step_completed", {
      audit_id: auditId,
      ...(meta?.event_id ? { event_id: meta.event_id } : {}),
      ...(meta?.audit_db_id ? { audit_db_id: meta.audit_db_id } : {}),
      fiche_id: ficheId,
      step_position: stepPosition,
      step_name: stepName,
      score,
      max_score: maxScore,
      conforme,
      total_citations: totalCitations,
      tokens_used: tokensUsed,
      status: "completed",
      ...(meta?.approach ? { approach: meta.approach } : {}),
    }),

  /**
   * Sent when an audit step fails
   */
  stepFailed: (
    auditId: string,
    ficheId: string,
    stepPosition: number,
    stepName: string,
    error: string,
    meta?: AuditWebhookMeta
  ) =>
    sendWebhook("audit.step_failed", {
      audit_id: auditId,
      ...(meta?.event_id ? { event_id: meta.event_id } : {}),
      ...(meta?.audit_db_id ? { audit_db_id: meta.audit_db_id } : {}),
      fiche_id: ficheId,
      step_position: stepPosition,
      step_name: stepName,
      error,
      status: "failed",
      ...(meta?.approach ? { approach: meta.approach } : {}),
    }),

  /**
   * Sent after each step completes (success or failure)
   * Provides overall audit progress
   */
  progress: (
    auditId: string,
    ficheId: string,
    completedSteps: number,
    totalSteps: number,
    failedSteps: number,
    currentPhase: string,
    meta?: AuditWebhookMeta
  ) =>
    sendWebhook("audit.progress", {
      audit_id: auditId,
      ...(meta?.event_id ? { event_id: meta.event_id } : {}),
      ...(meta?.audit_db_id ? { audit_db_id: meta.audit_db_id } : {}),
      fiche_id: ficheId,
      completed_steps: completedSteps,
      total_steps: totalSteps,
      failed_steps: failedSteps,
      current_phase: currentPhase,
      progress_percentage:
        totalSteps > 0
          ? Math.max(0, Math.min(100, Math.round((completedSteps / totalSteps) * 100)))
          : 0,
      status: "in_progress",
      ...(meta?.approach ? { approach: meta.approach } : {}),
    }),

  /**
   * Sent when compliance score is calculated
   */
  complianceCalculated: (
    auditId: string,
    ficheId: string,
    score: string,
    scorePercentage: string,
    niveau: string,
    isCompliant: boolean,
    criticalIssues: string,
    meta?: AuditWebhookMeta
  ) =>
    sendWebhook("audit.compliance_calculated", {
      audit_id: auditId,
      ...(meta?.event_id ? { event_id: meta.event_id } : {}),
      ...(meta?.audit_db_id ? { audit_db_id: meta.audit_db_id } : {}),
      fiche_id: ficheId,
      overall_score: score,
      score_percentage: scorePercentage,
      niveau,
      is_compliant: isCompliant,
      critical_issues: criticalIssues,
      status: "calculated",
      ...(meta?.approach ? { approach: meta.approach } : {}),
    }),

  /**
   * Sent when audit completes successfully
   */
  completed: (
    auditId: string,
    ficheId: string,
    overallScore: string,
    scorePercentage: string,
    niveau: string,
    isCompliant: boolean,
    successfulSteps: number,
    failedSteps: number,
    totalTokens: number,
    durationSeconds: number,
    meta?: AuditWebhookMeta
  ) =>
    sendWebhook("audit.completed", {
      audit_id: auditId,
      ...(meta?.event_id ? { event_id: meta.event_id } : {}),
      ...(meta?.audit_db_id ? { audit_db_id: meta.audit_db_id } : {}),
      fiche_id: ficheId,
      overall_score: overallScore,
      score_percentage: scorePercentage,
      niveau,
      is_compliant: isCompliant,
      successful_steps: successfulSteps,
      failed_steps: failedSteps,
      total_tokens: totalTokens,
      duration_seconds: durationSeconds,
      completed_at: new Date().toISOString(),
      status: "completed",
      ...(meta?.approach ? { approach: meta.approach } : {}),
    }),

  /**
   * Sent when audit workflow fails
   */
  failed: (
    auditId: string,
    ficheId: string,
    error: string,
    failedPhase?: string,
    partialResults?: {
      completed_steps: number;
      total_steps: number;
      failed_steps: number;
    },
    meta?: AuditWebhookMeta
  ) =>
    sendWebhook("audit.failed", {
      audit_id: auditId,
      ...(meta?.event_id ? { event_id: meta.event_id } : {}),
      ...(meta?.audit_db_id ? { audit_db_id: meta.audit_db_id } : {}),
      fiche_id: ficheId,
      error,
      failed_phase: failedPhase,
      failed_at: new Date().toISOString(),
      status: "failed",
      ...(partialResults && {
        partial_results: partialResults,
      }),
      ...(meta?.approach ? { approach: meta.approach } : {}),
    }),

  stepRerunStarted: (rerunId: string, auditId: string, stepPosition: number) =>
    sendWebhook("audit.step_started", {
      rerun_id: rerunId,
      audit_id: auditId,
      step_position: stepPosition,
      started_at: new Date().toISOString(),
      status: "rerunning",
    }),

  stepRerunCompleted: (
    rerunId: string,
    auditId: string,
    stepPosition: number,
    originalStep: unknown,
    rerunStep: unknown,
    comparison: unknown
  ) =>
    sendWebhook("audit.step_completed", {
      rerun_id: rerunId,
      audit_id: auditId,
      step_position: stepPosition,
      original: originalStep,
      rerun: rerunStep,
      comparison,
      completed_at: new Date().toISOString(),
      status: "rerun_completed",
    }),

  /**
   * Control point (sub-step) rerun: use the same audit.step_started/audit.step_completed events
   * for compatibility, but include `rerun_scope` + `control_point_index` so consumers can distinguish.
   */
  stepControlPointRerunStarted: (
    rerunId: string,
    auditId: string,
    stepPosition: number,
    controlPointIndex: number
  ) =>
    sendWebhook("audit.step_started", {
      rerun_id: rerunId,
      rerun_scope: "control_point",
      audit_id: auditId,
      step_position: stepPosition,
      control_point_index: controlPointIndex,
      started_at: new Date().toISOString(),
      status: "rerunning",
    }),

  stepControlPointRerunCompleted: (
    rerunId: string,
    auditId: string,
    stepPosition: number,
    controlPointIndex: number,
    originalControlPoint: unknown,
    rerunControlPoint: unknown,
    comparison: unknown
  ) =>
    sendWebhook("audit.step_completed", {
      rerun_id: rerunId,
      rerun_scope: "control_point",
      audit_id: auditId,
      step_position: stepPosition,
      control_point_index: controlPointIndex,
      original: originalControlPoint,
      rerun: rerunControlPoint,
      comparison,
      completed_at: new Date().toISOString(),
      status: "rerun_completed",
    }),
};

/**
 * Webhook helper for transcription events
 */
export const transcriptionWebhooks = {
  /**
   * Sent when transcription workflow starts
   */
  started: (
    ficheId: string,
    totalRecordings: number,
    priority: string = "normal"
  ) =>
    sendWebhook(
      "transcription.started",
      {
        fiche_id: ficheId,
        total_recordings: totalRecordings,
        priority,
        started_at: new Date().toISOString(),
        status: "started",
      },
      "transcription-service"
    ),

  /**
   * Sent when status check completes
   */
  statusCheck: (
    ficheId: string,
    totalRecordings: number,
    alreadyTranscribed: number,
    needsTranscription: number
  ) =>
    sendWebhook(
      "transcription.status_check",
      {
        fiche_id: ficheId,
        total_recordings: totalRecordings,
        already_transcribed: alreadyTranscribed,
        needs_transcription: needsTranscription,
        is_complete: needsTranscription === 0,
        status: "checked",
      },
      "transcription-service"
    ),

  /**
   * Sent when starting to transcribe an individual recording
   */
  recordingStarted: (
    ficheId: string,
    callId: string,
    recordingIndex: number,
    totalToTranscribe: number,
    recordingUrl?: string
  ) =>
    sendWebhook(
      "transcription.recording_started",
      {
        fiche_id: ficheId,
        call_id: callId,
        recording_index: recordingIndex,
        total_to_transcribe: totalToTranscribe,
        recording_url: recordingUrl,
        status: "processing",
      },
      "transcription-service"
    ),

  /**
   * Sent when an individual recording is successfully transcribed
   */
  recordingCompleted: (
    ficheId: string,
    callId: string,
    transcriptionId: string,
    recordingIndex: number,
    totalToTranscribe: number
  ) =>
    sendWebhook(
      "transcription.recording_completed",
      {
        fiche_id: ficheId,
        call_id: callId,
        transcription_id: transcriptionId,
        recording_index: recordingIndex,
        total_to_transcribe: totalToTranscribe,
        status: "completed",
      },
      "transcription-service"
    ),

  /**
   * Sent when an individual recording fails to transcribe
   */
  recordingFailed: (
    ficheId: string,
    callId: string,
    error: string,
    recordingIndex: number,
    totalToTranscribe: number
  ) =>
    sendWebhook(
      "transcription.recording_failed",
      {
        fiche_id: ficheId,
        call_id: callId,
        error,
        recording_index: recordingIndex,
        total_to_transcribe: totalToTranscribe,
        status: "failed",
      },
      "transcription-service"
    ),

  /**
   * Sent after each recording is processed (success or failure)
   * This provides overall progress
   */
  progress: (
    ficheId: string,
    totalRecordings: number,
    transcribed: number,
    pending: number,
    failed: number = 0
  ) =>
    sendWebhook(
      "transcription.progress",
      {
        fiche_id: ficheId,
        total_recordings: totalRecordings,
        transcribed,
        pending,
        failed,
        progress_percentage: Math.round((transcribed / totalRecordings) * 100),
        status: "in_progress",
      },
      "transcription-service"
    ),

  /**
   * Sent when all transcriptions complete successfully
   */
  completed: (
    ficheId: string,
    totalRecordings: number,
    transcribed: number,
    failed: number,
    durationSeconds: number
  ) =>
    sendWebhook(
      "transcription.completed",
      {
        fiche_id: ficheId,
        total_recordings: totalRecordings,
        transcribed,
        failed,
        duration_seconds: durationSeconds,
        completed_at: new Date().toISOString(),
        status: "completed",
      },
      "transcription-service"
    ),

  /**
   * Sent when transcription workflow fails
   */
  failed: (
    ficheId: string,
    error: string,
    partialResults?: {
      total: number;
      transcribed: number;
      failed: number;
    }
  ) =>
    sendWebhook(
      "transcription.failed",
      {
        fiche_id: ficheId,
        error,
        failed_at: new Date().toISOString(),
        status: "failed",
        ...(partialResults && {
          partial_results: partialResults,
        }),
      },
      "transcription-service"
    ),
};

/**
 * Webhook helper for batch events
 */
export const batchWebhooks = {
  progress: (
    batchId: string,
    operationType: "audit" | "transcription",
    total: number,
    completed: number,
    failed: number
  ) =>
    sendWebhook(
      "batch.progress",
      {
        batch_id: batchId,
        operation_type: operationType,
        total,
        completed,
        failed,
        progress_percentage:
          total > 0
            ? Math.max(0, Math.min(100, Math.round((completed / total) * 100)))
            : 0,
      },
      "batch-service"
    ),

  completed: (
    batchId: string,
    operationType: "audit" | "transcription",
    total: number,
    completed: number,
    failed: number,
    durationMs: number
  ) =>
    sendWebhook(
      "batch.completed",
      {
        batch_id: batchId,
        operation_type: operationType,
        total,
        completed,
        failed,
        duration_ms: durationMs,
      },
      "batch-service"
    ),
};
