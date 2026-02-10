/**
 * Automation API Client
 * =====================
 * RESPONSIBILITY: External API calls
 * - Fetch fiches from external CRM API
 * - Send webhook notifications
 * - Send email notifications
 * - No business logic
 * - No database operations
 *
 * LAYER: Data (External API calls)
 */

import axios from "axios";
import type { Transporter } from "nodemailer";
import nodemailer from "nodemailer";

import { gateway } from "../../shared/gateway-client.js";
import { logger } from "../../shared/logger.js";
import { validateOutgoingWebhookUrl } from "../../shared/webhook-security.js";

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function getAxiosMeta(error: unknown): { code?: string; status?: number } {
  if (!axios.isAxiosError(error)) {return {};}
  return {
    code: typeof error.code === "string" ? error.code : undefined,
    status: typeof error.response?.status === "number" ? error.response.status : undefined,
  };
}

function normalizeEnv(value: string | undefined): string | null {
  if (!value) {return null;}
  const trimmed = value.trim();
  if (!trimmed) {return null;}
  // Strip surrounding quotes when users copy/paste values into env files.
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    const inner = trimmed.slice(1, -1).trim();
    return inner || null;
  }
  return trimmed;
}

type SmtpConfig = {
  host: string;
  port: number;
  secure: boolean;
  timeoutMs: number;
  user?: string;
  pass?: string;
  from: string;
};

let cachedTransport: Transporter | null = null;
let cachedTransportKey: string | null = null;
let cachedFrom: string | null = null;

function getSmtpConfig(): SmtpConfig | null {
  const host = normalizeEnv(process.env.SMTP_HOST);
  if (!host) {return null;}

  const portRaw = normalizeEnv(process.env.SMTP_PORT);
  const port = Number.isFinite(Number(portRaw)) ? Number(portRaw) : 587;

  const secure =
    normalizeEnv(process.env.SMTP_SECURE) === "1" || port === 465;

  const user = normalizeEnv(process.env.SMTP_USER) || undefined;
  const pass = normalizeEnv(process.env.SMTP_PASS) || undefined;
  const from = normalizeEnv(process.env.SMTP_FROM) || user;
  if (!from) {return null;}

  const timeoutRaw = normalizeEnv(process.env.SMTP_TIMEOUT_MS);
  const timeoutMs = Number.isFinite(Number(timeoutRaw))
    ? Math.max(1000, Number(timeoutRaw))
    : 10_000;

  return {
    host,
    port,
    secure,
    timeoutMs,
    ...(user ? { user } : {}),
    ...(pass ? { pass } : {}),
    from,
  };
}

function getEmailTransport(): { transporter: Transporter; from: string } | null {
  const cfg = getSmtpConfig();
  if (!cfg) {return null;}

  const key = JSON.stringify({
    host: cfg.host,
    port: cfg.port,
    secure: cfg.secure,
    user: cfg.user || null,
  });

  if (!cachedTransport || cachedTransportKey !== key) {
    cachedTransportKey = key;
    cachedFrom = cfg.from;

    cachedTransport = nodemailer.createTransport({
      host: cfg.host,
      port: cfg.port,
      secure: cfg.secure,
      connectionTimeout: cfg.timeoutMs,
      greetingTimeout: cfg.timeoutMs,
      socketTimeout: cfg.timeoutMs,
      ...(cfg.user && cfg.pass ? { auth: { user: cfg.user, pass: cfg.pass } } : {}),
    });
  } else if (cachedFrom !== cfg.from) {
    cachedFrom = cfg.from;
  }

  return cachedTransport && cachedFrom ? { transporter: cachedTransport, from: cachedFrom } : null;
}

// ═══════════════════════════════════════════════════════════════════════════
// FICHE API CALLS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Convert DD/MM/YYYY to YYYY-MM-DD for the sales-with-calls endpoint.
 */
function convertToIsoDate(ddmmyyyy: string): string {
  const [day, month, year] = ddmmyyyy.split("/");
  return `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
}

/**
 * Fetch fiches for a single date from external CRM API
 * Uses the `/fiches/sales-with-calls` endpoint which applies a proper
 * sales-status filter (status_id=53) server-side.
 * 
 * @param date - Date in DD/MM/YYYY format (converted to YYYY-MM-DD for the API)
 * @param onlyWithRecordings - Filter for fiches with recordings (best-effort client-side)
 * @param apiKey - Optional API key for authentication
 * @returns Array of basic fiche data
 */
export async function fetchFichesForDate(
  date: string,
  onlyWithRecordings: boolean,
  apiKey?: string
): Promise<unknown[]> {
  const isoDate = convertToIsoDate(date);

  const params = new URLSearchParams({
    start_date: isoDate,
    end_date: isoDate,
    status_id: "53",
    include_recordings: "true",
    include_transcriptions: "false",
  });

  const url = gateway.url("/fiches/sales-with-calls", params);

  try {
    logger.debug(`Fetching fiches for ${date}`, {
      url,
      isoDate,
      params: params.toString(),
    });

    const response = await axios.get(url, {
      timeout: 90000, // 90 seconds - external API can be slow
      headers: gateway.authHeaders(apiKey),
    });

    const dateFiches: unknown[] = Array.isArray(response.data?.fiches)
      ? (response.data.fiches as unknown[])
      : [];

    // Best-effort filtering: only apply when the upstream provides an explicit signal.
    // If the response doesn't include any recordings metadata, DO NOT drop fiches here
    // (the workflow enforces `onlyWithRecordings` after fetching full fiche details).
    const shouldFilter = Boolean(onlyWithRecordings);
    const filteredFiches = shouldFilter
      ? dateFiches.filter((f) => {
          if (typeof f !== "object" || f === null) {return true;}
          const rec = f as Record<string, unknown>;

          const recordings = rec.recordings;
          if (Array.isArray(recordings)) {return recordings.length > 0;}

          const recordingsCount = rec.recordings_count ?? rec.recordingsCount;
          if (typeof recordingsCount === "number" && Number.isFinite(recordingsCount)) {
            return recordingsCount > 0;
          }

          const hasRecordings = rec.has_recordings ?? rec.hasRecordings;
          if (typeof hasRecordings === "boolean") {return hasRecordings;}

          return true;
        })
      : dateFiches;

    logger.debug(`Fetched ${dateFiches.length} fiches for ${date}`, {
      status: response.status,
      count: dateFiches.length,
      ...(shouldFilter
        ? { filtered: filteredFiches.length, onlyWithRecordings: true }
        : {}),
    });

    return filteredFiches;
  } catch (error: unknown) {
    logger.error(`Failed to fetch fiches for ${date}`, {
      error: getErrorMessage(error),
      ...getAxiosMeta(error),
    });
    throw new Error(`Failed to fetch fiches for ${date}: ${getErrorMessage(error)}`);
  }
}

/**
 * Fetch detailed fiche data including recordings
 * 
 * @param ficheId - Fiche ID
 * @param cle - Fiche key (cle) for authentication
 * @param apiKey - Optional API key
 * @returns Detailed fiche data with recordings
 */
export async function fetchFicheDetails(
  ficheId: string,
  cle?: string,
  apiKey?: string
): Promise<unknown> {
  const params = new URLSearchParams();

  if (cle) {
    params.append("cle", cle);
  }

  const url = gateway.url(`/fiches/by-id/${ficheId}`, params);

  try {
    logger.debug(`Fetching fiche details for ${ficheId}`, {
      url,
      hasCle: Boolean(cle),
    });

    const response = await axios.get(url, {
      timeout: 90000,
      headers: gateway.authHeaders(apiKey),
    });

    logger.debug(`Fetched fiche details for ${ficheId}`, {
      status: response.status,
      hasRecordings: Boolean(response.data?.enregistrements),
    });

    return response.data;
  } catch (error: unknown) {
    logger.error(`Failed to fetch fiche details for ${ficheId}`, {
      error: getErrorMessage(error),
      ...getAxiosMeta(error),
    });
    throw new Error(
      `Failed to fetch fiche details for ${ficheId}: ${getErrorMessage(error)}`
    );
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// NOTIFICATION API CALLS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Send notification webhook
 * 
 * @param webhookUrl - Webhook URL to send notification to
 * @param payload - Notification payload (will be JSON-serialized)
 */
export async function sendNotificationWebhook(
  webhookUrl: string,
  payload: unknown
): Promise<void> {
  const validation = validateOutgoingWebhookUrl(webhookUrl);
  if (!validation.ok) {
    logger.warn("Rejected unsafe webhookUrl (automation notification)", {
      url: webhookUrl,
      error: validation.error,
    });
    return;
  }

  try {
    logger.debug("Sending webhook notification", {
      url: webhookUrl,
      payload,
    });

    await axios.post(webhookUrl, payload, {
      timeout: 10000, // 10 seconds
      headers: {
        "Content-Type": "application/json",
      },
    });

    logger.info("Webhook notification sent successfully", {
      url: webhookUrl,
    });
  } catch (error: unknown) {
    logger.error("Failed to send webhook notification", {
      error: getErrorMessage(error),
      url: webhookUrl,
      ...getAxiosMeta(error),
    });
    // Don't throw - notifications are best-effort
  }
}

/**
 * Send email notification (placeholder)
 * 
 * TODO: Implement email sending using a service like SendGrid, AWS SES, etc.
 * 
 * @param emails - Array of email addresses
 * @param subject - Email subject
 * @param message - Email message body
 */
export async function sendEmailNotification(
  emails: string[],
  subject: string,
  message: string
): Promise<void> {
  const to = Array.isArray(emails) ? emails.filter((e) => typeof e === "string" && e.trim()) : [];
  if (to.length === 0) {return;}

  const transport = getEmailTransport();
  if (!transport) {
    logger.info("Email notification skipped (SMTP not configured)", {
      toCount: to.length,
      subject,
      messageLength: message.length,
    });
    return;
  }

  try {
    const result = await transport.transporter.sendMail({
      from: transport.from,
      to,
      subject,
      text: message,
    });

    logger.info("Email notification sent", {
      toCount: to.length,
      subject,
      messageId: (result as { messageId?: unknown }).messageId,
    });
  } catch (error: unknown) {
    logger.error("Failed to send email notification", {
      error: getErrorMessage(error),
      toCount: to.length,
      subject,
    });
    // Don't throw - notifications are best-effort
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// HEALTH CHECK
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Check if external CRM API is reachable
 * 
 * @param apiKey - Optional API key
 * @returns true if API is healthy, false otherwise
 */
export async function checkApiHealth(apiKey?: string): Promise<boolean> {
  try {
    // /health lives at the domain root, not under /api
    const response = await axios.get(gateway.rootUrl("/health"), {
      timeout: 5000,
      headers: gateway.authHeaders(apiKey),
    });

    return response.status === 200;
  } catch (error) {
    logger.warn("External API health check failed", { error });
    return false;
  }
}





