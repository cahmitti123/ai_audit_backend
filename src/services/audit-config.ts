/**
 * Audit Config Service
 * =====================
 * Fetches audit configurations from the external database
 */

import { prisma } from "./database.js";

const DEFAULT_SYSTEM_PROMPT = `Tu es un auditeur qualité expert en vente de complémentaires santé.

Ta mission: analyser les conversations téléphoniques pour vérifier la conformité réglementaire et qualité.

OBJECTIF: Déterminer si chaque étape d'audit est CONFORME ou NON_CONFORME.

APPROCHE:
1. Lis attentivement la chronologie complète
2. Recherche les preuves pour CHAQUE point de contrôle
3. Cite les passages EXACTS avec métadonnées précises
4. Sois strict mais juste (tolère les variations phonétiques courantes)
5. Score objectif basé sur les preuves trouvées

IMPORTANT:
- Une citation = UNE preuve concrète avec minutage exact
- Pas de suppositions, uniquement ce qui est dit explicitement
- Respecte TOUTES les règles d'analyse ci-dessous`;

export interface AuditConfigWithSteps {
  id: string;
  name: string;
  description?: string;
  prompt?: string;
  systemPrompt?: string;
  auditSteps: Array<{
    name: string;
    description?: string;
    prompt: string;
    controlPoints: string[];
    keywords: string[];
    severityLevel: string;
    isCritical: boolean;
    position: number;
    chronologicalImportant: boolean;
    weight: number;
  }>;
}

/**
 * Fetch all active audit configurations
 */
export async function fetchActiveAuditConfigs() {
  try {
    const configs = await prisma.auditConfig.findMany({
      where: {
        isActive: true,
      },
      include: {
        steps: {
          orderBy: {
            position: "asc",
          },
        },
      },
      orderBy: {
        createdAt: "desc",
      },
    });

    return configs;
  } catch (error) {
    console.error("❌ Error fetching audit configs from database:", error);
    throw error;
  }
}

/**
 * Fetch a specific audit configuration by ID
 */
export async function fetchAuditConfigById(
  configId: bigint | number
): Promise<AuditConfigWithSteps> {
  try {
    const config = await prisma.auditConfig.findUnique({
      where: {
        id: BigInt(configId),
      },
      include: {
        steps: {
          orderBy: {
            position: "asc",
          },
        },
      },
    });

    if (!config) {
      throw new Error(`Audit config with ID ${configId} not found`);
    }

    // Convert to expected format
    return {
      id: config.id.toString(),
      name: config.name,
      description: config.description || undefined,
      prompt: config.systemPrompt || undefined,
      systemPrompt: config.systemPrompt || DEFAULT_SYSTEM_PROMPT,
      auditSteps: config.steps.map((step) => ({
        name: step.name,
        description: step.description || undefined,
        prompt: step.prompt,
        controlPoints: step.controlPoints,
        keywords: step.keywords,
        severityLevel: step.severityLevel,
        isCritical: step.isCritical,
        position: step.position,
        chronologicalImportant: step.chronologicalImportant,
        weight: step.weight,
        verifyProductInfo: false,
      })),
    };
  } catch (error) {
    console.error(`❌ Error fetching audit config ${configId}:`, error);
    throw error;
  }
}

/**
 * Fetch the latest active audit configuration
 */
export async function fetchLatestAuditConfig(): Promise<AuditConfigWithSteps> {
  try {
    const config = await prisma.auditConfig.findFirst({
      where: {
        isActive: true,
      },
      include: {
        steps: {
          orderBy: {
            position: "asc",
          },
        },
      },
      orderBy: {
        createdAt: "desc",
      },
    });

    if (!config) {
      throw new Error("No active audit configuration found in database");
    }

    // Convert to expected format
    return {
      id: config.id.toString(),
      name: config.name,
      description: config.description || undefined,
      prompt: config.systemPrompt || undefined,
      systemPrompt: config.systemPrompt || DEFAULT_SYSTEM_PROMPT,
      auditSteps: config.steps.map((step) => ({
        name: step.name,
        description: step.description || undefined,
        prompt: step.prompt,
        controlPoints: step.controlPoints,
        keywords: step.keywords,
        severityLevel: step.severityLevel,
        isCritical: step.isCritical,
        position: step.position,
        chronologicalImportant: step.chronologicalImportant,
        weight: step.weight,
        verifyProductInfo: false,
      })),
    };
  } catch (error) {
    console.error("❌ Error fetching latest audit config:", error);
    throw error;
  }
}

export async function disconnectAuditConfigDb() {
  // No-op - using shared prisma client
}

export async function testAuditConfigConnection() {
  try {
    const count = await prisma.auditConfig.count();
    console.log(`✓ Found ${count} audit configurations in database`);
    return true;
  } catch (error) {
    console.error("❌ Failed to connect to database:", error);
    return false;
  }
}
