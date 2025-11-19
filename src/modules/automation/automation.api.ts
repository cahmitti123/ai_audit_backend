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
import { logger } from "../../shared/logger.js";

// ═══════════════════════════════════════════════════════════════════════════
// FICHE API CALLS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Fetch fiches for a single date from external CRM API
 * Note: This returns basic fiche data WITHOUT recordings
 * To get recordings, you must fetch each fiche individually
 * 
 * @param date - Date in DD/MM/YYYY format
 * @param onlyWithRecordings - Filter for fiches with recordings (not supported by API yet)
 * @param apiKey - Optional API key for authentication
 * @returns Array of basic fiche data
 */
export async function fetchFichesForDate(
  date: string,
  onlyWithRecordings: boolean,
  apiKey?: string
): Promise<any[]> {
  const baseUrl =
    process.env.FICHE_API_BASE_URL || "https://api.devis-mutuelle-pas-cher.com";
  const apiBase = `${baseUrl}/api`;

  // The /by-date endpoint only returns basic fiche data
  // It doesn't support include_recordings parameter
  const url = `${apiBase}/fiches/search/by-date`;

  const params = new URLSearchParams({
    date: date,
    criteria_type: "1",
    force_new_session: "false",
  });

  try {
    logger.debug(`Fetching fiches for ${date}`, {
      url,
      params: params.toString(),
    });

    const response = await axios.get(`${url}?${params}`, {
      timeout: 90000, // 90 seconds - external API can be slow
      headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : {},
    });

    const dateFiches = response.data?.fiches || [];

    logger.debug(`Fetched ${dateFiches.length} fiches for ${date}`, {
      status: response.status,
      count: dateFiches.length,
    });

    return dateFiches;
  } catch (error: any) {
    logger.error(`Failed to fetch fiches for ${date}`, {
      error: error.message,
      code: error.code,
      status: error.response?.status,
    });
    throw new Error(`Failed to fetch fiches for ${date}: ${error.message}`);
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
): Promise<any> {
  const baseUrl =
    process.env.FICHE_API_BASE_URL || "https://api.devis-mutuelle-pas-cher.com";
  const apiBase = `${baseUrl}/api`;

  const url = `${apiBase}/fiches/by-id/${ficheId}`;
  const params = new URLSearchParams();

  if (cle) {
    params.append("cle", cle);
  }

  try {
    logger.debug(`Fetching fiche details for ${ficheId}`, {
      url,
      hasCle: Boolean(cle),
    });

    const response = await axios.get(`${url}?${params}`, {
      timeout: 90000,
      headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : {},
    });

    logger.debug(`Fetched fiche details for ${ficheId}`, {
      status: response.status,
      hasRecordings: Boolean(response.data?.enregistrements),
    });

    return response.data;
  } catch (error: any) {
    logger.error(`Failed to fetch fiche details for ${ficheId}`, {
      error: error.message,
      code: error.code,
      status: error.response?.status,
    });
    throw new Error(
      `Failed to fetch fiche details for ${ficheId}: ${error.message}`
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
  payload: any
): Promise<void> {
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
  } catch (error: any) {
    logger.error("Failed to send webhook notification", {
      error: error.message,
      url: webhookUrl,
      status: error.response?.status,
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
  // TODO: Implement email sending
  // This would typically use a service like SendGrid, AWS SES, etc.
  logger.info("Email notification would be sent", {
    to: emails,
    subject,
    messageLength: message.length,
  });

  // Placeholder - log to console for now
  logger.debug("Email notification details", {
    emails,
    subject,
    message,
  });
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
  const baseUrl =
    process.env.FICHE_API_BASE_URL || "https://api.devis-mutuelle-pas-cher.com";

  try {
    const response = await axios.get(`${baseUrl}/health`, {
      timeout: 5000,
      headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : {},
    });

    return response.status === 200;
  } catch (error) {
    logger.warn("External API health check failed", { error });
    return false;
  }
}


