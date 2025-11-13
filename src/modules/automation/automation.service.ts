/**
 * Automation Service
 * ==================
 * Business logic for automation operations
 */

import type { FicheSelection } from "../../schemas.js";
import axios from "axios";

/**
 * Calculate dates to query based on selection criteria
 */
export function calculateDatesToQuery(
  selection: FicheSelection
): string[] {
  const { mode, dateRange, customStartDate, customEndDate, ficheIds } = selection;

  // Manual mode: no dates to query
  if (mode === "manual" && ficheIds) {
    return [];
  }

  // Calculate date range
  const { startDate, endDate } = calculateDateRange(dateRange, customStartDate, customEndDate);

  // Generate array of dates to query (API only accepts single date)
  const dates: string[] = [];
  if (startDate && endDate) {
    const start = parseDateDDMMYYYY(startDate);
    const end = parseDateDDMMYYYY(endDate);
    const current = new Date(start);
    
    while (current <= end) {
      dates.push(formatDate(current));
      current.setDate(current.getDate() + 1);
    }
  } else if (startDate) {
    dates.push(startDate);
  }

  return dates;
}

/**
 * Fetch fiches for a single date
 * Note: This returns basic fiche data WITHOUT recordings
 * To get recordings, you must fetch each fiche individually using fetchApiFicheDetails
 */
export async function fetchFichesForDate(
  date: string,
  onlyWithRecordings: boolean,
  apiKey?: string
): Promise<any[]> {
  const baseUrl = process.env.FICHE_API_BASE_URL || "https://api.devis-mutuelle-pas-cher.com";
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
    console.log(`Fetching fiches for ${date}:`, { url, params: params.toString() });
    
    const response = await axios.get(`${url}?${params}`, {
      timeout: 90000, // 90 seconds - external API can be slow
    });

    console.log(`API Response for ${date}:`, {
      status: response.status,
      fichesCount: response.data?.fiches?.length || 0,
      dataKeys: Object.keys(response.data || {}),
    });

    const dateFiches = response.data?.fiches || [];
    
    if (dateFiches.length > 0) {
      console.log(`Sample fiche from ${date}:`, {
        id: dateFiches[0].id || dateFiches[0].id_fiche,
        keys: Object.keys(dateFiches[0]),
        hasRecordings: Boolean(dateFiches[0].recordings || dateFiches[0].enregistrements),
        date_insertion: dateFiches[0].date_insertion,
        date_modification: dateFiches[0].date_modification,
        statut: dateFiches[0].statut,
      });
      
      // Analyze what dates are actually in the results
      const dateInsertions = new Set(dateFiches.map((f: any) => f.date_insertion).filter(Boolean));
      const dateModifications = new Set(dateFiches.map((f: any) => f.date_modification).filter(Boolean));
      
      console.log(`📊 Date analysis for ${date}:`, {
        requested_date: date,
        total_fiches: dateFiches.length,
        unique_insertion_dates: Array.from(dateInsertions),
        unique_modification_dates: Array.from(dateModifications),
        sample_fiches: dateFiches.slice(0, 5).map((f: any) => ({
          id: f.id,
          date_insertion: f.date_insertion,
          date_modification: f.date_modification,
          statut: f.statut,
        })),
      });
    } else {
      console.log(`No fiches returned for ${date}`);
    }
    
    return dateFiches;
  } catch (error: any) {
    console.error(`Error fetching fiches for ${date}:`, {
      message: error.message,
      code: error.code,
      status: error.response?.status,
    });
    throw new Error(`Failed to fetch fiches for ${date}: ${error.message}`);
  }
}

/**
 * Process and transform fiche data from /by-date endpoint
 * Note: /by-date returns basic data WITHOUT recordings
 * The data will be: { id, cle, nom, prenom, telephone, telephone_2, email, statut, date_insertion, date_modification }
 */
export function processFichesData(
  fiches: any[],
  maxFiches?: number,
  onlyWithRecordings?: boolean
): { ficheIds: string[]; fichesData: any[]; cles: Record<string, string> } {
  // Ensure it's an array
  if (!Array.isArray(fiches)) {
    console.warn("Fiches is not an array:", typeof fiches);
    return { ficheIds: [], fichesData: [], cles: {} };
  }

  console.log("Processing fiches data:", { 
    total: fiches.length,
    onlyWithRecordings,
    sampleKeys: fiches[0] ? Object.keys(fiches[0]) : []
  });

  // Extract fiche IDs and cles (needed for detailed fetch later)
  const fichesWithIds = fiches
    .filter((fiche: any) => fiche.id) // Must have an ID
    .map((fiche: any) => ({
      id: fiche.id,
      cle: fiche.cle,
      statut: fiche.statut,
      nom: fiche.nom,
      prenom: fiche.prenom,
      email: fiche.email,
      telephone: fiche.telephone,
      telephone_2: fiche.telephone_2,
    }));

  console.log("Extracted fiche IDs:", { 
    total: fichesWithIds.length, 
    maxFiches, 
    returning: Math.min(fichesWithIds.length, maxFiches || fichesWithIds.length),
    sample: fichesWithIds.slice(0, 3).map(f => ({ id: f.id, statut: f.statut })),
  });

  // Apply max limit
  const limitedFiches = fichesWithIds.slice(0, maxFiches || fichesWithIds.length);
  const ficheIds = limitedFiches.map(f => f.id);
  
  // Create a map of ficheId -> cle for later detailed fetching
  const cles: Record<string, string> = {};
  limitedFiches.forEach(f => {
    if (f.cle) {
      cles[f.id] = f.cle;
    }
  });
  
  // Store basic data (will be used if we can't fetch detailed later)
  const fichesData = limitedFiches.map((fiche: any) => ({
    id: fiche.id,
    cle: fiche.cle,
    statut: fiche.statut,
    nom: fiche.nom,
    prenom: fiche.prenom,
    email: fiche.email,
    telephone: fiche.telephone,
    telephone_2: fiche.telephone_2,
  }));
  
  console.log("Processed fiche data:", {
    ficheIdsCount: ficheIds.length,
    hasCles: Object.keys(cles).length,
  });
  
  return { 
    ficheIds, 
    fichesData,
    cles,
  };
}

/**
 * Fetch fiche IDs based on selection criteria (LEGACY - kept for compatibility)
 * @deprecated Use calculateDatesToQuery + fetchFichesForDate in workflows instead
 */
export async function fetchFichesBySelection(
  selection: FicheSelection,
  apiKey?: string
): Promise<{ ficheIds: string[]; fichesData: any[]; cles: Record<string, string> }> {
  const { mode, onlyWithRecordings, maxFiches, ficheIds } = selection;

  // Manual mode: return provided fiche IDs (no full data available)
  if (mode === "manual" && ficheIds) {
    const limitedIds = ficheIds.slice(0, maxFiches || ficheIds.length);
    return { ficheIds: limitedIds, fichesData: [], cles: {} };
  }

  // Calculate dates to query
  const dates = calculateDatesToQuery(selection);

  console.log("Fetching fiches from API (LEGACY):", { 
    totalDays: dates.length,
    onlyWithRecordings 
  });

  // Fetch from API for each date in parallel and combine results
  console.log(`Fetching fiches for ${dates.length} dates in parallel (LEGACY function)...`);
  
  const fetchPromises = dates.map(async (date) => {
    try {
      const dateFiches = await fetchFichesForDate(date, onlyWithRecordings || false, apiKey);
      console.log(`  ✓ ${date}: ${dateFiches.length} fiches`);
      return dateFiches;
    } catch (error: any) {
      console.error(`  ✗ ${date}: ${error.message}`);
      return [];
    }
  });
  
  const dateResults = await Promise.all(fetchPromises);
  const allFiches = dateResults.flat();

  console.log("Total fiches fetched:", { total: allFiches.length, days: dates.length });

  return processFichesData(allFiches, maxFiches, onlyWithRecordings);
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
 * Parse DD/MM/YYYY date string to Date object
 */
function parseDateDDMMYYYY(dateStr: string): Date {
  const [day, month, year] = dateStr.split("/").map(Number);
  return new Date(year, month - 1, day);
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

