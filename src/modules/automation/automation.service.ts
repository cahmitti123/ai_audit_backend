/**
 * Automation Service
 * ==================
 * Business logic for automation operations
 */

import type { FicheSelection } from "../../schemas.js";
import axios from "axios";

/**
 * Fetch fiche IDs based on selection criteria
 */
export async function fetchFichesBySelection(
  selection: FicheSelection,
  apiKey?: string
): Promise<string[]> {
  const { mode, dateRange, customStartDate, customEndDate, groupes, onlyWithRecordings, onlyUnaudited, maxFiches, ficheIds } = selection;

  // Manual mode: return provided fiche IDs
  if (mode === "manual" && ficheIds) {
    return ficheIds.slice(0, maxFiches || ficheIds.length);
  }

  // Date range or filter mode: fetch from external API
  const url = process.env.VITE_API_URL_SALES || process.env.API_URL_SALES;
  if (!url) {
    throw new Error("Sales API URL not configured");
  }

  const finalApiKey = apiKey || process.env.VITE_API_CLE || process.env.API_CLE;
  if (!finalApiKey) {
    throw new Error("API key not configured");
  }

  // Calculate date range
  const { startDate, endDate } = calculateDateRange(dateRange, customStartDate, customEndDate);

  // Prepare API parameters
  const params: any = {
    cle: finalApiKey,
  };

  if (startDate) params.date_debut = startDate;
  if (endDate) params.date_fin = endDate;
  if (groupes && groupes.length > 0) {
    params.groupe = groupes.join(",");
  }

  // Fetch from API
  try {
    const response = await axios.get(url, {
      params,
      timeout: 60000, // 60 seconds
    });

    let fiches = response.data?.fiches || response.data || [];

    // Ensure it's an array
    if (!Array.isArray(fiches)) {
      console.warn("API response is not an array:", typeof fiches);
      return [];
    }

    // Apply filters
    if (onlyWithRecordings) {
      fiches = fiches.filter((fiche: any) => {
        const recordings = fiche.enregistrements || fiche.recordings || [];
        return recordings.length > 0;
      });
    }

    if (onlyUnaudited) {
      // This would require checking the database for existing audits
      // For now, we'll skip this filter and let the workflow handle it
      console.warn("onlyUnaudited filter not yet implemented in service");
    }

    // Extract fiche IDs
    const ficheIdList = fiches
      .map((fiche: any) => fiche.id_fiche || fiche.ficheId || fiche.id)
      .filter(Boolean);

    // Apply max limit
    return ficheIdList.slice(0, maxFiches || ficheIdList.length);
  } catch (error: any) {
    console.error("Error fetching fiches from API:", error.message);
    throw new Error(`Failed to fetch fiches: ${error.message}`);
  }
}

/**
 * Calculate date range based on selection
 */
function calculateDateRange(
  dateRange?: string,
  customStartDate?: string,
  customEndDate?: string
): { startDate: string | null; endDate: string | null } {
  if (dateRange === "custom") {
    return {
      startDate: customStartDate || null,
      endDate: customEndDate || null,
    };
  }

  const now = new Date();
  let startDate: Date | null = null;
  let endDate: Date = now;

  switch (dateRange) {
    case "last_24h":
      startDate = new Date(now.getTime() - 24 * 60 * 60 * 1000);
      break;
    case "yesterday":
      startDate = new Date(now);
      startDate.setDate(startDate.getDate() - 1);
      startDate.setHours(0, 0, 0, 0);
      endDate = new Date(startDate);
      endDate.setHours(23, 59, 59, 999);
      break;
    case "last_week":
      startDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
      break;
    case "last_month":
      startDate = new Date(now);
      startDate.setMonth(startDate.getMonth() - 1);
      break;
    default:
      return { startDate: null, endDate: null };
  }

  return {
    startDate: startDate ? formatDate(startDate) : null,
    endDate: formatDate(endDate),
  };
}

/**
 * Format date as DD/MM/YYYY
 */
function formatDate(date: Date): string {
  const day = String(date.getDate()).padStart(2, "0");
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const year = date.getFullYear();
  return `${day}/${month}/${year}`;
}

/**
 * Parse cron expression to determine next run time
 */
export function getNextRunTime(
  scheduleType: string,
  cronExpression?: string,
  timeOfDay?: string,
  dayOfWeek?: number,
  dayOfMonth?: number,
  timezone = "UTC"
): Date | null {
  // This is a simplified implementation
  // In production, you'd use a library like 'cron-parser'
  
  const now = new Date();

  if (scheduleType === "DAILY" && timeOfDay) {
    const [hours, minutes] = timeOfDay.split(":").map(Number);
    const nextRun = new Date(now);
    nextRun.setHours(hours, minutes, 0, 0);
    
    if (nextRun <= now) {
      nextRun.setDate(nextRun.getDate() + 1);
    }
    
    return nextRun;
  }

  if (scheduleType === "WEEKLY" && dayOfWeek !== undefined && timeOfDay) {
    const [hours, minutes] = timeOfDay.split(":").map(Number);
    const nextRun = new Date(now);
    nextRun.setHours(hours, minutes, 0, 0);
    
    const currentDay = nextRun.getDay();
    const daysUntilTarget = (dayOfWeek - currentDay + 7) % 7;
    
    if (daysUntilTarget === 0 && nextRun <= now) {
      nextRun.setDate(nextRun.getDate() + 7);
    } else {
      nextRun.setDate(nextRun.getDate() + daysUntilTarget);
    }
    
    return nextRun;
  }

  if (scheduleType === "MONTHLY" && dayOfMonth !== undefined && timeOfDay) {
    const [hours, minutes] = timeOfDay.split(":").map(Number);
    const nextRun = new Date(now);
    nextRun.setDate(dayOfMonth);
    nextRun.setHours(hours, minutes, 0, 0);
    
    if (nextRun <= now) {
      nextRun.setMonth(nextRun.getMonth() + 1);
    }
    
    return nextRun;
  }

  // For CRON type, you'd need to parse the cron expression
  // For now, return null
  return null;
}

/**
 * Send notification webhook
 */
export async function sendNotificationWebhook(
  webhookUrl: string,
  payload: any
): Promise<void> {
  try {
    await axios.post(webhookUrl, payload, {
      timeout: 10000,
      headers: {
        "Content-Type": "application/json",
      },
    });
  } catch (error: any) {
    console.error("Failed to send webhook notification:", error.message);
    // Don't throw - notifications are best-effort
  }
}

/**
 * Send email notification (placeholder)
 */
export async function sendEmailNotification(
  emails: string[],
  subject: string,
  message: string
): Promise<void> {
  // TODO: Implement email sending
  // This would typically use a service like SendGrid, AWS SES, etc.
  console.log("Email notification would be sent to:", emails);
  console.log("Subject:", subject);
  console.log("Message:", message);
}

