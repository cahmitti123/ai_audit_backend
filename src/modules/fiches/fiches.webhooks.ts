/**
 * Fiches Webhooks
 * ================
 * RESPONSIBILITY: Webhook notification delivery
 * - Send webhook notifications to clients
 * - HMAC signature generation
 * - Retry logic with exponential backoff
 * - Delivery tracking
 *
 * LAYER: Integration
 */

import type { Prisma } from "@prisma/client";
import axios from "axios";
import crypto from "crypto";

import { logger } from "../../shared/logger.js";
import { prisma } from "../../shared/prisma.js";
import { validateOutgoingWebhookUrl } from "../../shared/webhook-security.js";

/**
 * Webhook payload types
 */
export type WebhookEvent = "complete" | "progress" | "failed";

export type WebhookPayload = {
  event: WebhookEvent;
  jobId: string;
  timestamp: string;
  data: {
    status: string;
    progress?: number;
    completedDays?: number;
    totalDays?: number;
    totalFiches?: number;
    currentFichesCount?: number;
    latestDate?: string;
    error?: string;
    dataUrl?: string;
    partialData?: Array<{
      ficheId: string;
      groupe: string | null;
      prospectNom: string | null;
      prospectPrenom: string | null;
      recordingsCount: number;
      createdAt: string;
    }>;
  };
};

function toPrismaJsonValue(value: unknown): Prisma.InputJsonValue {
  const json: unknown = JSON.parse(JSON.stringify(value));
  return json as Prisma.InputJsonValue;
}

/**
 * Generate HMAC signature for webhook payload
 */
function generateSignature(payload: string, secret: string): string {
  return crypto.createHmac("sha256", secret).update(payload).digest("hex");
}

function generateSignatureV2(payload: string, secret: string, timestamp: string): string {
  return crypto
    .createHmac("sha256", secret)
    .update(`${timestamp}.${payload}`)
    .digest("hex");
}

/**
 * Calculate exponential backoff delay
 */
function calculateRetryDelay(attempt: number): number {
  // Exponential backoff: 2^attempt seconds
  // Attempt 1: 2 seconds
  // Attempt 2: 4 seconds
  // Attempt 3: 8 seconds
  return Math.min(Math.pow(2, attempt) * 1000, 30000); // Max 30 seconds
}

/**
 * Send webhook notification with retries and database tracking
 */
export async function sendWebhook(
  webhookUrl: string,
  event: WebhookEvent,
  jobId: string,
  data: WebhookPayload["data"],
  options?: {
    secret?: string;
    maxAttempts?: number;
  }
): Promise<void> {
  const maxAttempts = options?.maxAttempts || 3;

  const payload: WebhookPayload = {
    event,
    jobId,
    timestamp: new Date().toISOString(),
    data,
  };

  // Validate URL to reduce SSRF risk (defense in depth; route should validate too)
  const validation = validateOutgoingWebhookUrl(webhookUrl);
  if (!validation.ok) {
    const delivery = await prisma.webhookDelivery.create({
      data: {
        jobId,
        event,
        url: webhookUrl,
        payload: toPrismaJsonValue(payload),
        status: "failed",
        attempt: 1,
        maxAttempts,
        responseBody: validation.error,
        sentAt: new Date(),
      },
    });

    await prisma.progressiveFetchJob.update({
      where: { id: jobId },
      data: {
        lastWebhookSentAt: new Date(),
        webhookAttempts: { increment: 1 },
        webhookLastError: validation.error,
      },
    });

    logger.warn("Rejected unsafe webhookUrl", {
      deliveryId: delivery.id,
      jobId,
      url: webhookUrl,
      error: validation.error,
    });

    return;
  }

  // Create webhook delivery record
  const delivery = await prisma.webhookDelivery.create({
    data: {
      jobId,
      event,
      url: webhookUrl,
      payload: toPrismaJsonValue(payload),
      status: "pending",
      attempt: 1,
      maxAttempts,
    },
  });

  logger.info("Webhook delivery created", {
    deliveryId: delivery.id,
    jobId,
    event,
  });

  // Attempt delivery
  await attemptWebhookDelivery(delivery.id, options?.secret);
}

/**
 * Attempt webhook delivery (used for initial send and retries)
 */
async function attemptWebhookDelivery(
  deliveryId: string,
  secret?: string
): Promise<void> {
  const delivery = await prisma.webhookDelivery.findUnique({
    where: { id: deliveryId },
    include: { job: true },
  });

  if (!delivery) {
    logger.error("Webhook delivery not found", { deliveryId });
    return;
  }

  const { job, payload, url, attempt, maxAttempts } = delivery;
  const webhookPayload = payload as unknown as WebhookPayload;

  const attemptDelivery = async (): Promise<boolean> => {
    try {
      logger.info("Sending webhook", {
        deliveryId,
        jobId: job.id,
        event: webhookPayload.event,
        url,
        attempt,
        maxAttempts,
      });

      // Prepare request body
      const body = JSON.stringify(webhookPayload);

      // Prepare headers
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
        "User-Agent": "AI-Audit-Webhook/1.0",
        "X-Webhook-Event": webhookPayload.event,
        "X-Webhook-Job-Id": job.id,
        "X-Webhook-Delivery-Id": deliveryId,
        "X-Webhook-Attempt": String(attempt),
        "X-Webhook-Timestamp": webhookPayload.timestamp,
      };

      // Add HMAC signature if secret provided
      if (secret || job.webhookSecret) {
        const webhookSecret = secret || job.webhookSecret;
        if (webhookSecret) {
          const signature = generateSignature(body, webhookSecret);
          headers["X-Webhook-Signature"] = `sha256=${signature}`;

          // v2 signature includes timestamp to reduce replay risk
          const signatureV2 = generateSignatureV2(
            body,
            webhookSecret,
            webhookPayload.timestamp
          );
          headers["X-Webhook-Signature-V2"] = `sha256=${signatureV2}`;
        }
      }

      // Send webhook
      const startTime = Date.now();
      const response = await axios.post(url, body, {
        headers,
        timeout: 10000, // 10 second timeout
        validateStatus: () => true, // Don't throw on any status
      });
      const duration = Date.now() - startTime;

      const success = response.status >= 200 && response.status < 300;

      // Update delivery record
      await prisma.webhookDelivery.update({
        where: { id: deliveryId },
        data: {
          status: success ? "sent" : "failed",
          statusCode: response.status,
          responseBody: JSON.stringify(response.data).substring(0, 1000),
          sentAt: new Date(),
        },
      });

      // Update job webhook tracking
      await prisma.progressiveFetchJob.update({
        where: { id: job.id },
        data: {
          lastWebhookSentAt: new Date(),
          webhookAttempts: { increment: 1 },
          webhookLastError: success ? null : `HTTP ${response.status}`,
        },
      });

      if (success) {
        logger.info("Webhook delivered successfully", {
          deliveryId,
          jobId: job.id,
          event: webhookPayload.event,
          statusCode: response.status,
          duration,
          attempt,
        });
        return true;
      } else {
        logger.warn("Webhook delivery failed", {
          deliveryId,
          jobId: job.id,
          event: webhookPayload.event,
          statusCode: response.status,
          attempt,
          maxAttempts,
        });
        return false;
      }
    } catch (error: unknown) {
      const errMsg = error instanceof Error ? error.message : String(error);
      logger.error("Webhook delivery error", {
        deliveryId,
        jobId: job.id,
        event: webhookPayload.event,
        error: errMsg,
        attempt,
        maxAttempts,
      });

      // Update delivery with error
      await prisma.webhookDelivery.update({
        where: { id: deliveryId },
        data: {
          status: "failed",
          responseBody: errMsg.substring(0, 1000),
        },
      });

      return false;
    }
  };

  // Attempt delivery with retries
  let success = await attemptDelivery();

  if (success) {
    return; // Successfully delivered
  }

  // Retry logic
  let currentAttempt = attempt;
  while (currentAttempt < maxAttempts) {
    const delay = calculateRetryDelay(currentAttempt);
    const nextRetryAt = new Date(Date.now() + delay);

    logger.info("Scheduling webhook retry", {
      deliveryId,
      jobId: job.id,
      event: webhookPayload.event,
      nextAttempt: currentAttempt + 1,
      delayMs: delay,
      nextRetryAt,
    });

    // Update delivery for next attempt
    await prisma.webhookDelivery.update({
      where: { id: deliveryId },
      data: {
        attempt: { increment: 1 },
        nextRetryAt,
        status: "pending",
      },
    });

    // Wait and retry
    await new Promise((resolve) => setTimeout(resolve, delay));
    currentAttempt++;

    success = await attemptDelivery();
    if (success) {
      return; // Successfully delivered
    }
  }

  logger.error("Webhook delivery failed after all attempts", {
    deliveryId,
    jobId: job.id,
    event: webhookPayload.event,
    attempts: maxAttempts,
  });

  // No return needed - function returns void
}

/**
 * Send completion webhook
 */
export async function sendCompletionWebhook(
  webhookUrl: string,
  jobId: string,
  data: {
    totalDays: number;
    totalFiches: number;
    dataUrl: string;
  },
  secret?: string
): Promise<void> {
  await sendWebhook(
    webhookUrl,
    "complete",
    jobId,
    {
      status: "complete",
      progress: 100,
      completedDays: data.totalDays,
      totalDays: data.totalDays,
      totalFiches: data.totalFiches,
      dataUrl: data.dataUrl,
    },
    { secret }
  );
}

/**
 * Send progress webhook with partial fiche data
 */
export async function sendProgressWebhookWithData(
  webhookUrl: string,
  jobId: string,
  data: {
    completedDays: number;
    totalDays: number;
    totalFiches: number;
    progress: number;
    currentFichesCount: number;
    latestDate: string;
    fiches: Array<{
      ficheId: string;
      groupe: string | null;
      prospectNom: string | null;
      prospectPrenom: string | null;
      recordingsCount: number;
      createdAt: Date;
    }>;
  },
  secret?: string
): Promise<void> {
  const payload: WebhookPayload = {
    event: "progress",
    jobId,
    timestamp: new Date().toISOString(),
    data: {
      status: "processing",
      progress: data.progress,
      completedDays: data.completedDays,
      totalDays: data.totalDays,
      totalFiches: data.totalFiches,
      currentFichesCount: data.currentFichesCount,
      latestDate: data.latestDate,
      partialData: data.fiches.map((f) => ({
        ficheId: f.ficheId,
        groupe: f.groupe,
        prospectNom: f.prospectNom,
        prospectPrenom: f.prospectPrenom,
        recordingsCount: f.recordingsCount,
        createdAt: f.createdAt.toISOString(),
      })),
    },
  };

  // Create webhook delivery record
  const delivery = await prisma.webhookDelivery.create({
    data: {
      jobId,
      event: "progress",
      url: webhookUrl,
      payload: toPrismaJsonValue(payload),
      status: "pending",
      attempt: 1,
      maxAttempts: 3,
    },
  });

  // Attempt delivery
  await attemptWebhookDelivery(delivery.id, secret);
}

/**
 * Send progress webhook (simple version without data)
 */
export async function sendProgressWebhook(
  webhookUrl: string,
  jobId: string,
  data: {
    completedDays: number;
    totalDays: number;
    totalFiches: number;
    progress: number;
  },
  secret?: string
): Promise<void> {
  await sendWebhook(
    webhookUrl,
    "progress",
    jobId,
    {
      status: "processing",
      progress: data.progress,
      completedDays: data.completedDays,
      totalDays: data.totalDays,
      totalFiches: data.totalFiches,
    },
    { secret }
  );
}

/**
 * Send failure webhook
 */
export async function sendFailureWebhook(
  webhookUrl: string,
  jobId: string,
  error: string,
  secret?: string
): Promise<void> {
  await sendWebhook(
    webhookUrl,
    "failed",
    jobId,
    {
      status: "failed",
      error,
    },
    { secret }
  );
}
