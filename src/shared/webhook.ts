import axios from "axios";
import crypto from "crypto";
import { logger } from "./logger.js";
import {
  publishRealtimeEvent,
  topicForAudit,
  topicForFiche,
  topicForJob,
} from "./realtime.js";

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

// Base webhook payload structure
export interface WebhookPayload {
  event: WebhookEventType;
  timestamp: string;
  source: string;
  data: Record<string, unknown>;
}

/**
 * Generate HMAC SHA256 signature for webhook payload
 */
function generateSignature(body: string, secret: string): string {
  const hmac = crypto.createHmac("sha256", secret);
  hmac.update(body);
  return `sha256=${hmac.digest("hex")}`;
}

function generateSignatureV2(body: string, secret: string, timestamp: string): string {
  const hmac = crypto.createHmac("sha256", secret);
  hmac.update(`${timestamp}.${body}`);
  return `sha256=${hmac.digest("hex")}`;
}

function calculateRetryDelay(attempt: number): number {
  // Exponential backoff: 2^attempt seconds (cap 30s)
  return Math.min(Math.pow(2, attempt) * 1000, 30000);
}

function safeUrlForLog(rawUrl: string): string {
  try {
    const u = new URL(rawUrl);
    return `${u.protocol}//${u.host}${u.pathname}`;
  } catch {
    return rawUrl;
  }
}

/**
 * Send a webhook event to the frontend
 */
export async function sendWebhook(
  eventType: WebhookEventType,
  data: Record<string, unknown>,
  source: string = "audit-service"
): Promise<boolean> {
  const webhookUrl = process.env.FRONTEND_WEBHOOK_URL;

  const topics = new Set<string>();
  try {
    if (typeof data?.audit_id === "string" && data.audit_id) {
      topics.add(topicForAudit(data.audit_id));
    }
    if (typeof data?.fiche_id === "string" && data.fiche_id) {
      topics.add(topicForFiche(data.fiche_id));
    }
    // Optional: some event payloads may contain jobId
    if (typeof data?.jobId === "string" && data.jobId) {
      topics.add(topicForJob(data.jobId));
    }
  } catch {
    // ignore
  }

  const payload: WebhookPayload = {
    event: eventType,
    timestamp: new Date().toISOString(),
    source,
    data,
  };

  const deliveryId = crypto.randomUUID();
  const body = JSON.stringify(payload);

  // If no webhook URL, still publish realtime event (SSE / internal subscribers)
  if (!webhookUrl) {
    logger.warn("FRONTEND_WEBHOOK_URL not configured, skipping webhook");
    await Promise.all(
      Array.from(topics).map((topic) =>
        publishRealtimeEvent({
          topic,
          type: eventType,
          source,
          data: {
            ...payload,
            delivery: { configured: false, deliveryId },
          },
        }).catch(() => null)
      )
    );
    return false;
  }

  const timeoutMs = parseInt(process.env.WEBHOOK_TIMEOUT || "10000");
  const maxAttemptsEnv = parseInt(process.env.WEBHOOK_MAX_ATTEMPTS || "3");
  const maxAttempts = eventType.endsWith(".progress") ? 1 : maxAttemptsEnv;

  const webhookSecret = process.env.WEBHOOK_SECRET;
  const signature = webhookSecret ? generateSignature(body, webhookSecret) : null;
  const signatureV2 =
    webhookSecret ? generateSignatureV2(body, webhookSecret, payload.timestamp) : null;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "User-Agent": "AI-Audit-Webhook/1.0",
      "X-Webhook-Event": eventType,
      "X-Webhook-Delivery-Id": deliveryId,
      "X-Webhook-Attempt": String(attempt),
      "X-Webhook-Timestamp": payload.timestamp,
      "X-Webhook-Source": source,
    };

    if (signature) headers["X-Webhook-Signature"] = signature;
    if (signatureV2) headers["X-Webhook-Signature-V2"] = signatureV2;

    try {
      const response = await axios.post(webhookUrl, body, {
        headers,
        timeout: timeoutMs,
        validateStatus: () => true,
      });

      const ok = response.status >= 200 && response.status < 300;

      if (ok) {
        logger.info("Webhook sent successfully", {
          event: eventType,
          status: response.status,
          deliveryId,
          attempt,
        });

        await Promise.all(
          Array.from(topics).map((topic) =>
            publishRealtimeEvent({
              topic,
              type: eventType,
              source,
              data: {
                ...payload,
                delivery: {
                  configured: true,
                  deliveryId,
                  attempt,
                  maxAttempts,
                  success: true,
                  status: response.status,
                },
              },
            }).catch(() => null)
          )
        );

        return true;
      }

      const retriable =
        response.status === 429 || (response.status >= 500 && response.status <= 599);
      const willRetry = retriable && attempt < maxAttempts;

      logger.warn("Webhook delivery failed", {
        event: eventType,
        status: response.status,
        deliveryId,
        attempt,
        maxAttempts,
        willRetry,
      });

      if (!willRetry) {
        await Promise.all(
          Array.from(topics).map((topic) =>
            publishRealtimeEvent({
              topic,
              type: eventType,
              source,
              data: {
                ...payload,
                delivery: {
                  configured: true,
                  deliveryId,
                  attempt,
                  maxAttempts,
                  success: false,
                  status: response.status,
                },
              },
            }).catch(() => null)
          )
        );
        return false;
      }
    } catch (error) {
      const willRetry = attempt < maxAttempts;

      if (axios.isAxiosError(error)) {
        const status = error.response?.status;
        const code = error.code;
        logger.error("Webhook delivery error", {
          event: eventType,
          error: error.message,
          code,
          status,
          url: safeUrlForLog(webhookUrl),
          deliveryId,
          attempt,
          maxAttempts,
          willRetry,
        });
      } else if (error instanceof Error) {
        logger.error("Webhook delivery error", {
          event: eventType,
          error: error.message,
          url: safeUrlForLog(webhookUrl),
          deliveryId,
          attempt,
          maxAttempts,
          willRetry,
        });
      } else {
        logger.error("Webhook delivery error", {
          event: eventType,
          error: String(error),
          url: safeUrlForLog(webhookUrl),
          deliveryId,
          attempt,
          maxAttempts,
          willRetry,
        });
      }

      const msg = axios.isAxiosError(error)
        ? error.message
        : error instanceof Error
          ? error.message
          : String(error);

      if (!willRetry) {
        await Promise.all(
          Array.from(topics).map((topic) =>
            publishRealtimeEvent({
              topic,
              type: eventType,
              source,
              data: {
                ...payload,
                delivery: {
                  configured: true,
                  deliveryId,
                  attempt,
                  maxAttempts,
                  success: false,
                  error: msg,
                },
              },
            }).catch(() => null)
          )
        );
        return false;
      }
    }

    const delay = calculateRetryDelay(attempt);
    await new Promise((resolve) => setTimeout(resolve, delay));
  }

  return false;
}

/**
 * Send webhook without blocking (fire and forget)
 */
export async function sendWebhookAsync(
  eventType: WebhookEventType,
  data: Record<string, unknown>,
  source?: string
): Promise<void> {
  // Don't await - fire and forget
  sendWebhook(eventType, data, source).catch((error) => {
    const msg = error instanceof Error ? error.message : String(error);
    logger.error("Async webhook failed", { event: eventType, error: msg });
  });
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
export const auditWebhooks = {
  /**
   * Sent when audit workflow starts
   */
  started: (
    auditId: string,
    ficheId: string,
    configId: string,
    configName: string,
    totalSteps: number
  ) =>
    sendWebhook("audit.started", {
      audit_id: auditId,
      fiche_id: ficheId,
      audit_config_id: configId,
      audit_config_name: configName,
      total_steps: totalSteps,
      started_at: new Date().toISOString(),
      status: "started",
    }),

  /**
   * Sent when starting to fetch fiche data
   */
  ficheFetchStarted: (ficheId: string, fromCache: boolean) =>
    sendWebhook("audit.fiche_fetch_started", {
      fiche_id: ficheId,
      from_cache: fromCache,
      status: "fetching",
    }),

  /**
   * Sent when fiche data is fetched
   */
  ficheFetchCompleted: (
    ficheId: string,
    recordingsCount: number,
    prospectName: string,
    fromCache: boolean
  ) =>
    sendWebhook("audit.fiche_fetch_completed", {
      fiche_id: ficheId,
      recordings_count: recordingsCount,
      prospect_name: prospectName,
      from_cache: fromCache,
      status: "fetched",
    }),

  /**
   * Sent when audit configuration is loaded
   */
  configLoaded: (configId: string, configName: string, stepsCount: number) =>
    sendWebhook("audit.config_loaded", {
      config_id: configId,
      config_name: configName,
      steps_count: stepsCount,
      status: "loaded",
    }),

  /**
   * Sent when checking transcription status
   */
  transcriptionCheck: (
    ficheId: string,
    totalRecordings: number,
    transcribed: number,
    needsTranscription: number
  ) =>
    sendWebhook("audit.transcription_check", {
      fiche_id: ficheId,
      total_recordings: totalRecordings,
      transcribed,
      needs_transcription: needsTranscription,
      status: "checked",
    }),

  /**
   * Sent when timeline is generated
   */
  timelineGenerated: (
    ficheId: string,
    recordingsCount: number,
    totalChunks: number
  ) =>
    sendWebhook("audit.timeline_generated", {
      fiche_id: ficheId,
      recordings_count: recordingsCount,
      total_chunks: totalChunks,
      status: "generated",
    }),

  /**
   * Sent when audit analysis begins
   */
  analysisStarted: (
    auditId: string,
    ficheId: string,
    totalSteps: number,
    model: string
  ) =>
    sendWebhook("audit.analysis_started", {
      audit_id: auditId,
      fiche_id: ficheId,
      total_steps: totalSteps,
      model,
      status: "analyzing",
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
    isCritical: boolean
  ) =>
    sendWebhook("audit.step_started", {
      audit_id: auditId,
      fiche_id: ficheId,
      step_position: stepPosition,
      step_name: stepName,
      total_steps: totalSteps,
      step_weight: stepWeight,
      is_critical: isCritical,
      status: "processing",
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
    tokensUsed: number
  ) =>
    sendWebhook("audit.step_completed", {
      audit_id: auditId,
      fiche_id: ficheId,
      step_position: stepPosition,
      step_name: stepName,
      score,
      max_score: maxScore,
      conforme,
      total_citations: totalCitations,
      tokens_used: tokensUsed,
      status: "completed",
    }),

  /**
   * Sent when an audit step fails
   */
  stepFailed: (
    auditId: string,
    ficheId: string,
    stepPosition: number,
    stepName: string,
    error: string
  ) =>
    sendWebhook("audit.step_failed", {
      audit_id: auditId,
      fiche_id: ficheId,
      step_position: stepPosition,
      step_name: stepName,
      error,
      status: "failed",
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
    currentPhase: string
  ) =>
    sendWebhook("audit.progress", {
      audit_id: auditId,
      fiche_id: ficheId,
      completed_steps: completedSteps,
      total_steps: totalSteps,
      failed_steps: failedSteps,
      current_phase: currentPhase,
      progress_percentage: Math.round((completedSteps / totalSteps) * 100),
      status: "in_progress",
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
    criticalIssues: string
  ) =>
    sendWebhook("audit.compliance_calculated", {
      audit_id: auditId,
      fiche_id: ficheId,
      overall_score: score,
      score_percentage: scorePercentage,
      niveau,
      is_compliant: isCompliant,
      critical_issues: criticalIssues,
      status: "calculated",
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
    durationSeconds: number
  ) =>
    sendWebhook("audit.completed", {
      audit_id: auditId,
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
    }
  ) =>
    sendWebhook("audit.failed", {
      audit_id: auditId,
      fiche_id: ficheId,
      error,
      failed_phase: failedPhase,
      failed_at: new Date().toISOString(),
      status: "failed",
      ...(partialResults && {
        partial_results: partialResults,
      }),
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
        progress_percentage: Math.round((completed / total) * 100),
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
