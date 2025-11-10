/**
 * Fiches Service
 * ==============
 * Business logic for fiche operations
 */

import axios from "axios";
import { logger } from "../../shared/logger.js";

// Types
export interface SalesResponse {
  success: boolean;
  fiches: any[];
  total: number;
}

const baseUrl =
  process.env.FICHE_API_BASE_URL || "https://api.devis-mutuelle-pas-cher.com";
const apiBase = `${baseUrl}/api`;
/**
 * Fetch sales list by date
 */
export async function fetchApiSales(date: string): Promise<SalesResponse> {
  const formattedDate = date.split("-").reverse().join("/");
  console.log("fetchApiSales - Starting fetch", { date, formattedDate });
  logger.info("Fetching sales list", { date, formatted_date: formattedDate });

  try {
    const params = new URLSearchParams({
      date: formattedDate,
      criteria_type: "1",
      force_new_session: "false",
    });

    console.log("fetchApiSales - Request params", {
      params: params.toString(),
    });
    console.log("fetchApiSales - API URL", {
      url: `${apiBase}/fiches/search/by-date?${params}`,
    });

    const response = await axios.get(
      `${apiBase}/fiches/search/by-date?${params}`,
      {
        timeout: 60000,
      }
    );

    console.log("fetchApiSales - Response received", {
      status: response.status,
      dataKeys: Object.keys(response.data || {}),
      fichesLength: response.data?.fiches?.length,
    });

    const fiches = response.data?.fiches || [];
    console.log("fetchApiSales - Fiches extracted", { count: fiches.length });
    logger.info("Sales list fetched", {
      date,
      fiches_count: fiches.length,
      total: fiches.length,
    });

    return {
      success: true,
      fiches,
      total: fiches.length,
    };
  } catch (error: any) {
    console.error("fetchApiSales - Error occurred", {
      date,
      status: error.response?.status,
      message: error.message,
      stack: error.stack,
    });
    logger.error("Failed to fetch sales", {
      date,
      status: error.response?.status,
      message: error.message,
    });
    throw error;
  }
}
/**
 * Fetch fiche details from API
 */
export async function fetchApiFicheDetails(
  ficheId: string,
  cle?: string
): Promise<any> {
  logger.info("Fetching fiche details", {
    fiche_id: ficheId,
    has_cle: Boolean(cle),
  });

  try {
    const params: any = {
      include_recordings: "true",
      include_transcriptions: "false",
    };
    if (cle) params.cle = cle;

    const query = new URLSearchParams(params);
    const response = await axios.get(
      `${apiBase}/fiches/by-id/${ficheId}?${query}`,
      {
        timeout: 30000,
      }
    );

    if (!response.data || !response.data.success) {
      throw new Error("Fiche not found");
    }

    const ficheData = response.data;
    logger.info("Fiche details fetched successfully", {
      fiche_id: ficheId,
      recordings_count: ficheData.recordings?.length || 0,
      has_prospect: Boolean(ficheData.prospect),
      groupe: ficheData.information?.groupe,
    });

    return ficheData;
  } catch (error: any) {
    logger.error("Failed to fetch fiche details", {
      fiche_id: ficheId,
      status: error.response?.status,
      message: error.message,
    });

    if (error.response?.status === 404) {
      throw new Error(`Fiche ${ficheId} not found`);
    }
    throw error;
  }
}

/**
 * Get fiche with auto-caching
 */
export async function getFicheWithCache(ficheId: string, cle?: string) {
  console.log("Getting fiche with cache", {
    fiche_id: ficheId,
    has_cle: Boolean(cle),
  });
  logger.info("Getting fiche with cache", {
    fiche_id: ficheId,
    has_cle: Boolean(cle),
  });

  console.log("Importing repository functions");
  const { getCachedFiche, cacheFiche } = await import("./fiches.repository.js");

  // Check cache
  console.log("Looking up fiche in cache", { fiche_id: ficheId });
  logger.debug("Looking up fiche in cache", { fiche_id: ficheId });
  const cached = await getCachedFiche(ficheId);

  if (cached && cached.expiresAt > new Date()) {
    console.log("Fiche retrieved from cache", {
      fiche_id: ficheId,
      cache_id: cached.id.toString(),
      recordings_count: cached.recordingsCount,
      cached_count: cached.recordingsCount,
    });
    logger.debug("Fiche retrieved from cache", {
      fiche_id: ficheId,
      cache_id: cached.id.toString(),
      recordings_count: cached.recordingsCount,
      cached_count: cached.recordingsCount,
    });
    return cached.rawData;
  }

  console.log("Fiche not found in cache or expired", { fiche_id: ficheId });
  logger.debug("Fiche not found in cache", { fiche_id: ficheId });
  console.log("Cache miss, fetching from API", { fiche_id: ficheId });
  logger.info("Cache miss, fetching from API", { fiche_id: ficheId });

  // Fetch and cache
  console.log("Fetching fiche details from API", { fiche_id: ficheId });
  const ficheData = await fetchApiFicheDetails(ficheId, cle);
  console.log("Caching fiche data", { fiche_id: ficheId });
  await cacheFiche(ficheData);

  console.log("Fiche cached successfully", {
    fiche_id: ficheId,
    recordings_count: ficheData.recordings?.length || 0,
  });
  logger.info("Fiche cached successfully", {
    fiche_id: ficheId,
    recordings_count: ficheData.recordings?.length || 0,
  });

  return ficheData;
}

/**
 * Force refresh fiche from API and upsert to database
 * This bypasses the cache and always fetches fresh data
 */
export async function refreshFicheFromApi(ficheId: string, cle?: string) {
  console.log("Force refreshing fiche from API", {
    fiche_id: ficheId,
    has_cle: Boolean(cle),
  });
  logger.info("Force refreshing fiche from API", {
    fiche_id: ficheId,
    has_cle: Boolean(cle),
  });

  // Always fetch from API
  console.log("Fetching fresh fiche details from API", { fiche_id: ficheId });
  const ficheData = await fetchApiFicheDetails(ficheId, cle);

  // Import repository and upsert to database
  console.log("Importing repository functions");
  const { cacheFiche } = await import("./fiches.repository.js");

  console.log("Upserting fresh fiche data to database", { fiche_id: ficheId });
  await cacheFiche(ficheData);

  console.log("Fiche refreshed and upserted successfully", {
    fiche_id: ficheId,
    recordings_count: ficheData.recordings?.length || 0,
  });
  logger.info("Fiche refreshed and upserted successfully", {
    fiche_id: ficheId,
    recordings_count: ficheData.recordings?.length || 0,
  });

  return ficheData;
}

/**
 * Get fiche status from database (transcription and audit info)
 */
export async function getFicheStatus(ficheId: string) {
  const { prisma } = await import("../../shared/prisma.js");

  const ficheCache = await prisma.ficheCache.findUnique({
    where: { ficheId },
    include: {
      recordings: {
        select: {
          id: true,
          hasTranscription: true,
          transcribedAt: true,
        },
      },
      audits: {
        where: { isLatest: true },
        select: {
          id: true,
          overallScore: true,
          scorePercentage: true,
          niveau: true,
          isCompliant: true,
          status: true,
          completedAt: true,
          auditConfig: {
            select: {
              name: true,
            },
          },
        },
        orderBy: { createdAt: "desc" },
      },
    },
  });

  if (!ficheCache) {
    return null;
  }

  // Calculate transcription status
  const totalRecordings = ficheCache.recordings.length;
  const transcribedRecordings = ficheCache.recordings.filter(
    (r) => r.hasTranscription
  ).length;

  const transcriptionStatus = {
    total: totalRecordings,
    transcribed: transcribedRecordings,
    pending: totalRecordings - transcribedRecordings,
    percentage:
      totalRecordings > 0 ? (transcribedRecordings / totalRecordings) * 100 : 0,
    isComplete:
      totalRecordings > 0 && transcribedRecordings === totalRecordings,
    lastTranscribedAt:
      ficheCache.recordings
        .filter((r) => r.transcribedAt)
        .sort(
          (a, b) => b.transcribedAt!.getTime() - a.transcribedAt!.getTime()
        )[0]?.transcribedAt || null,
  };

  // Calculate audit status
  const completedAudits = ficheCache.audits.filter(
    (a) => a.status === "completed"
  );
  const compliantAudits = completedAudits.filter((a) => a.isCompliant);

  const auditStatus = {
    total: ficheCache.audits.length,
    completed: completedAudits.length,
    pending: ficheCache.audits.filter((a) => a.status === "pending").length,
    running: ficheCache.audits.filter((a) => a.status === "running").length,
    compliant: compliantAudits.length,
    nonCompliant: completedAudits.length - compliantAudits.length,
    averageScore:
      completedAudits.length > 0
        ? completedAudits.reduce(
            (sum, a) => sum + Number(a.scorePercentage),
            0
          ) / completedAudits.length
        : null,
    latestAudit: ficheCache.audits[0]
      ? {
          ...ficheCache.audits[0],
          id: ficheCache.audits[0].id.toString(),
          auditConfig: ficheCache.audits[0].auditConfig || null,
        }
      : null,
  };

  return {
    ficheId,
    hasData: true,
    transcription: transcriptionStatus,
    audit: auditStatus,
  };
}

/**
 * Get status for multiple fiches
 */
export async function getFichesStatus(ficheIds: string[]) {
  const { prisma } = await import("../../shared/prisma.js");

  const fichesCache = await prisma.ficheCache.findMany({
    where: { ficheId: { in: ficheIds } },
    include: {
      recordings: {
        select: {
          id: true,
          hasTranscription: true,
          transcribedAt: true,
        },
      },
      audits: {
        where: { isLatest: true },
        select: {
          id: true,
          overallScore: true,
          scorePercentage: true,
          niveau: true,
          isCompliant: true,
          status: true,
          completedAt: true,
          auditConfig: {
            select: {
              name: true,
            },
          },
        },
        orderBy: { createdAt: "desc" },
      },
    },
  });

  // Create a map of ficheId to status
  const statusMap: Record<string, any> = {};

  for (const ficheId of ficheIds) {
    const ficheCache = fichesCache.find((f) => f.ficheId === ficheId);

    if (!ficheCache) {
      statusMap[ficheId] = {
        ficheId,
        hasData: false,
        transcription: {
          total: 0,
          transcribed: 0,
          pending: 0,
          percentage: 0,
          isComplete: false,
          lastTranscribedAt: null,
        },
        audit: {
          total: 0,
          completed: 0,
          pending: 0,
          running: 0,
          compliant: 0,
          nonCompliant: 0,
          averageScore: null,
          latestAudit: null,
        },
      };
      continue;
    }

    // Calculate transcription status
    const totalRecordings = ficheCache.recordings.length;
    const transcribedRecordings = ficheCache.recordings.filter(
      (r) => r.hasTranscription
    ).length;

    const transcriptionStatus = {
      total: totalRecordings,
      transcribed: transcribedRecordings,
      pending: totalRecordings - transcribedRecordings,
      percentage:
        totalRecordings > 0
          ? (transcribedRecordings / totalRecordings) * 100
          : 0,
      isComplete:
        totalRecordings > 0 && transcribedRecordings === totalRecordings,
      lastTranscribedAt:
        ficheCache.recordings
          .filter((r) => r.transcribedAt)
          .sort(
            (a, b) => b.transcribedAt!.getTime() - a.transcribedAt!.getTime()
          )[0]?.transcribedAt || null,
    };

    // Calculate audit status
    const completedAudits = ficheCache.audits.filter(
      (a) => a.status === "completed"
    );
    const compliantAudits = completedAudits.filter((a) => a.isCompliant);

    const auditStatus = {
      total: ficheCache.audits.length,
      completed: completedAudits.length,
      pending: ficheCache.audits.filter((a) => a.status === "pending").length,
      running: ficheCache.audits.filter((a) => a.status === "running").length,
      compliant: compliantAudits.length,
      nonCompliant: completedAudits.length - compliantAudits.length,
      averageScore:
        completedAudits.length > 0
          ? completedAudits.reduce(
              (sum, a) => sum + Number(a.scorePercentage),
              0
            ) / completedAudits.length
          : null,
      latestAudit: ficheCache.audits[0]
        ? {
            ...ficheCache.audits[0],
            id: ficheCache.audits[0].id.toString(),
            auditConfig: ficheCache.audits[0].auditConfig || null,
          }
        : null,
    };

    statusMap[ficheId] = {
      ficheId,
      hasData: true,
      transcription: transcriptionStatus,
      audit: auditStatus,
    };
  }

  return statusMap;
}

/**
 * Get all fiches for a date with their statuses from database
 * This returns cached fiches with their processing status
 */
export async function getFichesByDateWithStatus(date: string) {
  const { prisma } = await import("../../shared/prisma.js");

  // Convert date to start and end of day
  const startDate = new Date(date);
  startDate.setHours(0, 0, 0, 0);

  const endDate = new Date(date);
  endDate.setHours(23, 59, 59, 999);

  const fichesCache = await prisma.ficheCache.findMany({
    where: {
      createdAt: {
        gte: startDate,
        lte: endDate,
      },
    },
    include: {
      recordings: {
        select: {
          id: true,
          hasTranscription: true,
          transcribedAt: true,
          callId: true,
          startTime: true,
          durationSeconds: true,
        },
        orderBy: { startTime: "desc" },
      },
      audits: {
        where: { isLatest: true },
        select: {
          id: true,
          overallScore: true,
          scorePercentage: true,
          niveau: true,
          isCompliant: true,
          status: true,
          completedAt: true,
          createdAt: true,
          auditConfig: {
            select: {
              id: true,
              name: true,
            },
          },
        },
        orderBy: { createdAt: "desc" },
      },
    },
    orderBy: { createdAt: "desc" },
  });

  // Transform to status-focused format
  const fichesWithStatus = fichesCache.map((ficheCache) => {
    // Calculate transcription status
    const totalRecordings = ficheCache.recordings.length;
    const transcribedRecordings = ficheCache.recordings.filter(
      (r) => r.hasTranscription
    ).length;

    const transcriptionStatus = {
      total: totalRecordings,
      transcribed: transcribedRecordings,
      pending: totalRecordings - transcribedRecordings,
      percentage:
        totalRecordings > 0
          ? (transcribedRecordings / totalRecordings) * 100
          : 0,
      isComplete:
        totalRecordings > 0 && transcribedRecordings === totalRecordings,
      lastTranscribedAt:
        ficheCache.recordings
          .filter((r) => r.transcribedAt)
          .sort(
            (a, b) => b.transcribedAt!.getTime() - a.transcribedAt!.getTime()
          )[0]?.transcribedAt || null,
    };

    // Calculate audit status
    const completedAudits = ficheCache.audits.filter(
      (a) => a.status === "completed"
    );
    const compliantAudits = completedAudits.filter((a) => a.isCompliant);

    const auditStatus = {
      total: ficheCache.audits.length,
      completed: completedAudits.length,
      pending: ficheCache.audits.filter((a) => a.status === "pending").length,
      running: ficheCache.audits.filter((a) => a.status === "running").length,
      compliant: compliantAudits.length,
      nonCompliant: completedAudits.length - compliantAudits.length,
      averageScore:
        completedAudits.length > 0
          ? completedAudits.reduce(
              (sum, a) => sum + Number(a.scorePercentage),
              0
            ) / completedAudits.length
          : null,
      latestAudit: ficheCache.audits[0]
        ? {
            ...ficheCache.audits[0],
            id: ficheCache.audits[0].id.toString(),
            auditConfig: ficheCache.audits[0].auditConfig
              ? {
                  id: ficheCache.audits[0].auditConfig.id.toString(),
                  name: ficheCache.audits[0].auditConfig.name,
                }
              : null,
          }
        : null,
      audits: ficheCache.audits.map((audit) => ({
        id: audit.id.toString(),
        overallScore: audit.overallScore.toString(),
        scorePercentage: audit.scorePercentage.toString(),
        niveau: audit.niveau,
        isCompliant: audit.isCompliant,
        status: audit.status,
        completedAt: audit.completedAt,
        createdAt: audit.createdAt,
        auditConfig: audit.auditConfig
          ? {
              id: audit.auditConfig.id.toString(),
              name: audit.auditConfig.name,
            }
          : null,
      })),
    };

    return {
      ficheId: ficheCache.ficheId,
      groupe: ficheCache.groupe,
      agenceNom: ficheCache.agenceNom,
      prospectNom: ficheCache.prospectNom,
      prospectPrenom: ficheCache.prospectPrenom,
      prospectEmail: ficheCache.prospectEmail,
      prospectTel: ficheCache.prospectTel,
      fetchedAt: ficheCache.fetchedAt,
      createdAt: ficheCache.createdAt,
      transcription: transcriptionStatus,
      audit: auditStatus,
      recordings: ficheCache.recordings.map((r) => ({
        id: r.id.toString(),
        callId: r.callId,
        hasTranscription: r.hasTranscription,
        transcribedAt: r.transcribedAt,
        startTime: r.startTime,
        durationSeconds: r.durationSeconds,
      })),
    };
  });

  return {
    date,
    total: fichesWithStatus.length,
    fiches: fichesWithStatus,
  };
}

/**
 * Get all fiches for a date range with their statuses from database
 */
export async function getFichesByDateRangeWithStatus(
  startDate: string,
  endDate: string
) {
  const { prisma } = await import("../../shared/prisma.js");

  const start = new Date(startDate);
  start.setHours(0, 0, 0, 0);

  const end = new Date(endDate);
  end.setHours(23, 59, 59, 999);

  const fichesCache = await prisma.ficheCache.findMany({
    where: {
      createdAt: {
        gte: start,
        lte: end,
      },
    },
    include: {
      recordings: {
        select: {
          id: true,
          hasTranscription: true,
          transcribedAt: true,
          callId: true,
          startTime: true,
          durationSeconds: true,
        },
        orderBy: { startTime: "desc" },
      },
      audits: {
        where: { isLatest: true },
        select: {
          id: true,
          overallScore: true,
          scorePercentage: true,
          niveau: true,
          isCompliant: true,
          status: true,
          completedAt: true,
          createdAt: true,
          auditConfig: {
            select: {
              id: true,
              name: true,
            },
          },
        },
        orderBy: { createdAt: "desc" },
      },
    },
    orderBy: { createdAt: "desc" },
  });

  const fichesWithStatus = fichesCache.map((ficheCache) => {
    const totalRecordings = ficheCache.recordings.length;
    const transcribedRecordings = ficheCache.recordings.filter(
      (r) => r.hasTranscription
    ).length;

    const transcriptionStatus = {
      total: totalRecordings,
      transcribed: transcribedRecordings,
      pending: totalRecordings - transcribedRecordings,
      percentage:
        totalRecordings > 0
          ? (transcribedRecordings / totalRecordings) * 100
          : 0,
      isComplete:
        totalRecordings > 0 && transcribedRecordings === totalRecordings,
      lastTranscribedAt:
        ficheCache.recordings
          .filter((r) => r.transcribedAt)
          .sort(
            (a, b) => b.transcribedAt!.getTime() - a.transcribedAt!.getTime()
          )[0]?.transcribedAt || null,
    };

    const completedAudits = ficheCache.audits.filter(
      (a) => a.status === "completed"
    );
    const compliantAudits = completedAudits.filter((a) => a.isCompliant);

    const auditStatus = {
      total: ficheCache.audits.length,
      completed: completedAudits.length,
      pending: ficheCache.audits.filter((a) => a.status === "pending").length,
      running: ficheCache.audits.filter((a) => a.status === "running").length,
      compliant: compliantAudits.length,
      nonCompliant: completedAudits.length - compliantAudits.length,
      averageScore:
        completedAudits.length > 0
          ? completedAudits.reduce(
              (sum, a) => sum + Number(a.scorePercentage),
              0
            ) / completedAudits.length
          : null,
      latestAudit: ficheCache.audits[0]
        ? {
            ...ficheCache.audits[0],
            id: ficheCache.audits[0].id.toString(),
            auditConfig: ficheCache.audits[0].auditConfig
              ? {
                  id: ficheCache.audits[0].auditConfig.id.toString(),
                  name: ficheCache.audits[0].auditConfig.name,
                }
              : null,
          }
        : null,
      audits: ficheCache.audits.map((audit) => ({
        id: audit.id.toString(),
        overallScore: audit.overallScore.toString(),
        scorePercentage: audit.scorePercentage.toString(),
        niveau: audit.niveau,
        isCompliant: audit.isCompliant,
        status: audit.status,
        completedAt: audit.completedAt,
        createdAt: audit.createdAt,
        auditConfig: audit.auditConfig
          ? {
              id: audit.auditConfig.id.toString(),
              name: audit.auditConfig.name,
            }
          : null,
      })),
    };

    return {
      ficheId: ficheCache.ficheId,
      groupe: ficheCache.groupe,
      agenceNom: ficheCache.agenceNom,
      prospectNom: ficheCache.prospectNom,
      prospectPrenom: ficheCache.prospectPrenom,
      prospectEmail: ficheCache.prospectEmail,
      prospectTel: ficheCache.prospectTel,
      fetchedAt: ficheCache.fetchedAt,
      createdAt: ficheCache.createdAt,
      transcription: transcriptionStatus,
      audit: auditStatus,
      recordings: ficheCache.recordings.map((r) => ({
        id: r.id.toString(),
        callId: r.callId,
        hasTranscription: r.hasTranscription,
        transcribedAt: r.transcribedAt,
        startTime: r.startTime,
        durationSeconds: r.durationSeconds,
      })),
    };
  });

  return {
    startDate,
    endDate,
    total: fichesWithStatus.length,
    fiches: fichesWithStatus,
  };
}

export const FichesService = {
  fetchApiSales,
  fetchApiFicheDetails,
  getFicheWithCache,
  refreshFicheFromApi,
  getFicheStatus,
  getFichesStatus,
  getFichesByDateWithStatus,
  getFichesByDateRangeWithStatus,
};
