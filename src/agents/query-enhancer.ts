/**
 * Query Enhancer Agent
 * =====================
 * Optimise les queries pour chaque checkpoint
 */

import { openai } from "@ai-sdk/openai";
import { generateObject } from "ai";
import { EnhancedQuerySchema, EnhancedQuery } from "../schemas.js";
import { AuditStep } from "../types.js";

export async function enhanceCheckpointQuery(
  checkpoint: string,
  step: AuditStep,
  timelineContext: string
): Promise<EnhancedQuery> {
  const prompt = `Tu es un expert en formulation de queries de recherche.

CONTEXTE:
Étape d'audit: ${step.name}
Checkpoint: ${checkpoint}
Mots-clés disponibles: ${step.keywords.join(", ")}

TIMELINE (extrait):
${timelineContext.substring(0, 2000)}...

MISSION:
Créer une query optimale pour trouver les preuves que "${checkpoint}" dans les transcriptions audio.

CONSIDÉRATIONS:
- Erreurs de transcription possibles (Oréa=ORIAS, NCA=AC Assurances, etc.)
- Contexte conversationnel important
- Plusieurs façons de dire la même chose
- Variations phonétiques françaises

Génère une query de recherche optimisée avec:
- La query principale
- Mots-clés alternatifs
- Variations phonétiques
- Indices contextuels
- Speakers probables`;

  const result = await generateObject({
    model: openai("gpt-4o"),
    schema: EnhancedQuerySchema,
    prompt,
  });

  return result.object;
}
