/**
 * Database Service
 * ================
 * Main database operations for the backend
 */

import { PrismaClient } from "@prisma/client";

export const prisma = new PrismaClient();

// ═══════════════════════════════════════════════════════════════════════════
// AUDIT CONFIG CRUD
// ═══════════════════════════════════════════════════════════════════════════

export async function getAllAuditConfigs(includeInactive = false) {
  return await prisma.auditConfig.findMany({
    where: includeInactive ? {} : { isActive: true },
    include: {
      steps: {
        orderBy: { position: "asc" },
      },
    },
    orderBy: {
      createdAt: "desc",
    },
  });
}

export async function getAuditConfigById(id: bigint) {
  return await prisma.auditConfig.findUnique({
    where: { id },
    include: {
      steps: {
        orderBy: { position: "asc" },
      },
    },
  });
}

export async function createAuditConfig(data: {
  name: string;
  description?: string;
  systemPrompt?: string;
  steps: Array<{
    name: string;
    description?: string;
    prompt: string;
    controlPoints: string[];
    keywords: string[];
    severityLevel: string;
    isCritical: boolean;
    position: number;
    weight: number;
    chronologicalImportant?: boolean;
    verifyProductInfo?: boolean;
  }>;
  createdBy?: string;
}) {
  return await prisma.auditConfig.create({
    data: {
      name: data.name,
      description: data.description,
      systemPrompt: data.systemPrompt,
      createdBy: data.createdBy,
      steps: {
        create: data.steps.map((step) => ({
          name: step.name,
          description: step.description,
          prompt: step.prompt,
          controlPoints: step.controlPoints,
          keywords: step.keywords,
          severityLevel: step.severityLevel as any,
          isCritical: step.isCritical,
          position: step.position,
          weight: step.weight,
          chronologicalImportant: step.chronologicalImportant ?? false,
          verifyProductInfo: step.verifyProductInfo ?? false,
        })),
      },
    },
    include: {
      steps: {
        orderBy: { position: "asc" },
      },
    },
  });
}

export async function updateAuditConfig(
  id: bigint,
  data: Partial<{
    name: string;
    description: string;
    systemPrompt: string;
    isActive: boolean;
  }>
) {
  return await prisma.auditConfig.update({
    where: { id },
    data,
    include: {
      steps: {
        orderBy: { position: "asc" },
      },
    },
  });
}

export async function updateAuditStep(
  stepId: bigint,
  data: Partial<{
    name: string;
    description: string;
    prompt: string;
    controlPoints: string[];
    keywords: string[];
    severityLevel: string;
    isCritical: boolean;
    weight: number;
    chronologicalImportant: boolean;
    verifyProductInfo: boolean;
  }>
) {
  return await prisma.auditStep.update({
    where: { id: stepId },
    data: data as any,
  });
}

export async function deleteAuditStep(stepId: bigint) {
  return await prisma.auditStep.delete({
    where: { id: stepId },
  });
}

export async function addAuditStep(
  auditConfigId: bigint,
  stepData: {
    name: string;
    description?: string;
    prompt: string;
    controlPoints: string[];
    keywords: string[];
    severityLevel: string;
    isCritical: boolean;
    position: number;
    weight: number;
    chronologicalImportant?: boolean;
    verifyProductInfo?: boolean;
  }
) {
  return await prisma.auditStep.create({
    data: {
      auditConfigId,
      name: stepData.name,
      description: stepData.description,
      prompt: stepData.prompt,
      controlPoints: stepData.controlPoints,
      keywords: stepData.keywords,
      severityLevel: stepData.severityLevel as any,
      isCritical: stepData.isCritical,
      position: stepData.position,
      weight: stepData.weight,
      chronologicalImportant: stepData.chronologicalImportant ?? false,
      verifyProductInfo: stepData.verifyProductInfo ?? false,
    },
  });
}

export async function deleteAuditConfig(id: bigint) {
  return await prisma.auditConfig.delete({
    where: { id },
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// FICHE CACHE
// ═══════════════════════════════════════════════════════════════════════════

export async function cacheFiche(ficheData: any, expirationHours: number = 24) {
  const expiresAt = new Date();
  expiresAt.setHours(expiresAt.getHours() + expirationHours);

  // Enrich recordings with parsed metadata
  const { enrichRecording } = await import("../utils/recording-parser.js");
  if (ficheData.recordings) {
    ficheData.recordings = ficheData.recordings.map(enrichRecording);
  }

  const ficheCache = await prisma.ficheCache.upsert({
    where: { ficheId: ficheData.information.fiche_id },
    create: {
      ficheId: ficheData.information.fiche_id,
      groupe: ficheData.information.groupe,
      agenceNom: ficheData.information.agence_nom,
      prospectNom: ficheData.prospect?.nom,
      prospectPrenom: ficheData.prospect?.prenom,
      prospectEmail: ficheData.prospect?.mail,
      prospectTel: ficheData.prospect?.telephone || ficheData.prospect?.mobile,
      rawData: ficheData,
      hasRecordings: ficheData.recordings?.length > 0,
      recordingsCount: ficheData.recordings?.length || 0,
      expiresAt,
    },
    update: {
      groupe: ficheData.information.groupe,
      agenceNom: ficheData.information.agence_nom,
      prospectNom: ficheData.prospect?.nom,
      prospectPrenom: ficheData.prospect?.prenom,
      prospectEmail: ficheData.prospect?.mail,
      prospectTel: ficheData.prospect?.telephone || ficheData.prospect?.mobile,
      rawData: ficheData,
      hasRecordings: ficheData.recordings?.length > 0,
      recordingsCount: ficheData.recordings?.length || 0,
      fetchedAt: new Date(),
      expiresAt,
    },
  });

  // Store recordings
  if (ficheData.recordings?.length > 0) {
    await storeRecordings(ficheCache.id, ficheData.recordings);
  }

  return ficheCache;
}

async function storeRecordings(ficheCacheId: bigint, recordings: any[]) {
  for (const rec of recordings) {
    const parsed = (rec as any).parsed;

    await prisma.recording.upsert({
      where: {
        ficheCacheId_callId: {
          ficheCacheId,
          callId: rec.call_id,
        },
      },
      create: {
        ficheCacheId,
        callId: rec.call_id,
        recordingUrl: rec.recording_url,
        recordingDate: parsed?.date,
        recordingTime: parsed?.time,
        fromNumber: parsed?.from_number,
        toNumber: parsed?.to_number,
        uuid: parsed?.uuid,
        direction: rec.direction,
        answered: rec.answered,
        startTime: rec.start_time ? new Date(rec.start_time) : null,
        durationSeconds: rec.duration_seconds,
        hasTranscription: false,
      },
      update: {
        recordingUrl: rec.recording_url,
        recordingDate: parsed?.date,
        recordingTime: parsed?.time,
        fromNumber: parsed?.from_number,
        toNumber: parsed?.to_number,
        uuid: parsed?.uuid,
        direction: rec.direction,
        answered: rec.answered,
        startTime: rec.start_time ? new Date(rec.start_time) : null,
        durationSeconds: rec.duration_seconds,
      },
    });
  }
}

export async function updateRecordingTranscription(
  ficheCacheId: bigint,
  callId: string,
  transcriptionId: string
) {
  return await prisma.recording.update({
    where: {
      ficheCacheId_callId: {
        ficheCacheId,
        callId,
      },
    },
    data: {
      transcriptionId,
      hasTranscription: true,
      transcribedAt: new Date(),
    },
  });
}

export async function getRecordingByCallId(
  ficheCacheId: bigint,
  callId: string
) {
  return await prisma.recording.findUnique({
    where: {
      ficheCacheId_callId: {
        ficheCacheId,
        callId,
      },
    },
  });
}

export async function getUntranscribedRecordings(ficheId: string) {
  return await prisma.recording.findMany({
    where: {
      ficheCache: {
        ficheId,
      },
      hasTranscription: false,
    },
    include: {
      ficheCache: true,
    },
  });
}

export async function getCachedFiche(ficheId: string) {
  const cached = await prisma.ficheCache.findUnique({
    where: { ficheId },
    include: {
      recordings: {
        orderBy: { startTime: "desc" },
      },
    },
  });

  if (!cached) return null;

  // Check if expired
  if (cached.expiresAt < new Date()) {
    return null;
  }

  return cached;
}

export async function getRecordingsByFiche(ficheId: string) {
  const fiche = await prisma.ficheCache.findUnique({
    where: { ficheId },
    include: {
      recordings: {
        orderBy: { startTime: "desc" },
      },
    },
  });

  return fiche?.recordings || [];
}

// ═══════════════════════════════════════════════════════════════════════════
// AUDIT CRUD
// ═══════════════════════════════════════════════════════════════════════════

export async function saveAuditResult(auditResult: any, ficheCacheId: bigint) {
  return await prisma.audit.create({
    data: {
      ficheCacheId,
      auditConfigId: BigInt(auditResult.audit.config.id),
      overallScore: auditResult.audit.compliance.poids_obtenu,
      scorePercentage: auditResult.audit.compliance.score,
      niveau: auditResult.audit.compliance.niveau,
      isCompliant: auditResult.audit.compliance.niveau !== "REJET",
      criticalPassed: parseInt(
        auditResult.audit.compliance.points_critiques.split("/")[0]
      ),
      criticalTotal: parseInt(
        auditResult.audit.compliance.points_critiques.split("/")[1]
      ),
      status: "completed",
      startedAt: new Date(auditResult.metadata.started_at),
      completedAt: new Date(auditResult.metadata.completed_at),
      durationMs: auditResult.metadata.duration_ms,
      totalTokens: auditResult.statistics.total_tokens,
      successfulSteps: auditResult.statistics.successful_steps,
      failedSteps: auditResult.statistics.failed_steps,
      recordingsCount: auditResult.statistics.recordings_count,
      timelineChunks: auditResult.statistics.timeline_chunks,
      resultData: auditResult,
      stepResults: {
        create: auditResult.audit.results.steps.map(
          (step: any, index: number) => ({
            stepPosition: step.step_metadata?.position || index + 1,
            stepName: step.step_metadata?.name || "",
            severityLevel: step.step_metadata?.severity || "MEDIUM",
            isCritical: step.step_metadata?.is_critical || false,
            weight: step.step_metadata?.weight || 5,
            traite: step.traite,
            conforme: step.conforme,
            score: step.score,
            niveauConformite: step.niveau_conformite,
            commentaireGlobal: step.commentaire_global,
            motsClesTrouves: step.mots_cles_trouves || [],
            minutages: step.minutages || [],
            erreursTranscriptionTolerees:
              step.erreurs_transcription_tolerees || 0,
            totalCitations:
              step.points_controle?.reduce(
                (sum: number, pc: any) => sum + (pc.citations?.length || 0),
                0
              ) || 0,
            totalTokens: step.usage?.total_tokens || 0,
          })
        ),
      },
    },
    include: {
      stepResults: true,
    },
  });
}

export async function getAuditsByFiche(
  ficheId: string,
  includeDetails = false
) {
  return await prisma.audit.findMany({
    where: {
      ficheCache: { ficheId },
      isLatest: true,
    },
    include: {
      auditConfig: {
        select: {
          id: true,
          name: true,
          description: true,
        },
      },
      stepResults: includeDetails
        ? {
            include: {
              controlPoints: {
                include: {
                  citations: true,
                },
              },
            },
          }
        : true,
    },
    orderBy: {
      createdAt: "desc",
    },
  });
}

export async function getAuditById(auditId: bigint) {
  return await prisma.audit.findUnique({
    where: { id: auditId },
    include: {
      ficheCache: true,
      auditConfig: {
        include: {
          steps: {
            orderBy: { position: "asc" },
          },
        },
      },
      stepResults: {
        include: {
          controlPoints: {
            include: {
              citations: true,
            },
          },
        },
        orderBy: {
          stepPosition: "asc",
        },
      },
    },
  });
}

export async function disconnectDb() {
  await prisma.$disconnect();
}
