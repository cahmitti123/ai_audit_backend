/**
 * Construction des Prompts
 * =========================
 * Génération des prompts optimisés pour GPT-5
 */

import type { ProductVerificationContext } from "./audits.vector-store.js";
import { formatVerificationContextForPrompt } from "./audits.vector-store.js";

export function buildAnalysisRules(): string {
  return `═══════════════════════════════════════════════════════════════════════════════
RÈGLES D'ANALYSE
═══════════════════════════════════════════════════════════════════════════════

TOLÉRANCE PHONÉTIQUE:
- Oréa/Auréa → ORIAS
- NCA/AC Assurances/NC Assurances → Net Courtage Assurance
- CME/CMU-C → CMU/CSS
- OPAM → OPTAM
- dépassements d'un horaire → dépassements d'honoraires

STRUCTURE STRICTE:
- Citations DANS chaque point_controle.citations (pas au niveau global)
- Si statut=PRESENT: AU MOINS 1 citation requise
- Si statut=ABSENT/NON_APPLICABLE: citations=[]
- TOUS les champs obligatoires même si vides

MÉTADONNÉES EXACTES:
- recording_index: depuis "Enregistrement #X" (index = X-1)
- chunk_index: depuis "Chunk Y" (index = Y-1)
- minutage_secondes: depuis "Temps: XX.XXs"
- minutage: convertir en MM:SS
- speaker: depuis "speaker_X:"
- recording_date: depuis "Date:" dans l'en-tête (format DD/MM/YYYY)
- recording_time: depuis "Heure:" dans l'en-tête (format HH:MM)

VALEURS ENUM VALIDES:
- conforme: "CONFORME" | "NON_CONFORME" | "PARTIEL"
- niveau_conformite: "EXCELLENT" | "BON" | "ACCEPTABLE" | "INSUFFISANT" | "REJET"
- statut: "PRESENT" | "ABSENT" | "PARTIEL" | "NON_APPLICABLE"

⚠️ CHAMPS REQUIS (fournir même si vides):
{{
  "minutages": [],
  "mots_cles_trouves": [],
  "erreurs_transcription_tolerees": 0,
  "erreur_transcription_notee": false,
  "variation_phonetique_utilisee": null
}}`;
}

export function buildTimelineText(timeline: any[]): string {
  let text =
    "═══════════════════════════════════════════════════════════════════════════════\n";
  text += "CHRONOLOGIE COMPLÈTE DE LA CONVERSATION\n";
  text +=
    "═══════════════════════════════════════════════════════════════════════════════\n\n";

  for (const recording of timeline) {
    text += `\n${"=".repeat(80)}\n`;
    text += `Enregistrement #${recording.recording_index + 1}\n`;
    text += `Date: ${recording.recording_date || "N/A"}\n`;
    text += `Heure: ${recording.recording_time || "N/A"}\n`;
    text += `Call ID: ${recording.call_id}\n`;
    text += `De: ${recording.from_number || "N/A"} → Vers: ${
      recording.to_number || "N/A"
    }\n`;
    text += `Durée: ${recording.duration_seconds}s\n`;
    text += `Total Chunks: ${recording.total_chunks}\n`;
    text += `${"=".repeat(80)}\n\n`;

    for (const chunk of recording.chunks) {
      text += `\n─── Chunk ${chunk.chunk_index + 1} ───\n`;
      text += `Temps: ${chunk.start_timestamp}s - ${chunk.end_timestamp}s\n`;
      text += `Speakers: ${chunk.speakers.join(", ")}\n\n`;
      text += `Conversation:\n${chunk.full_text}\n`;
    }
  }

  text += `\n${"=".repeat(80)}\n`;
  text += "FIN DE LA CHRONOLOGIE\n";
  text += `${"=".repeat(80)}\n\n`;

  return text;
}

export function buildStepPrompt(
  step: any,
  auditConfig: any,
  timelineText: string,
  productVerificationContext?: ProductVerificationContext[] | null
): string {
  const totalSteps = auditConfig.auditSteps?.length || step.position;

  // Add product verification context if available
  let verificationSection = "";
  if (
    productVerificationContext &&
    productVerificationContext.length > 0 &&
    step.verifyProductInfo === true
  ) {
    verificationSection = formatVerificationContextForPrompt(
      productVerificationContext
    );

    // Add special verification instructions
    verificationSection += `
⚠️ VÉRIFICATION PRODUIT OBLIGATOIRE:
─────────────────────────────────────────────────────────────────────────────
Pour cette étape, vous DEVEZ vérifier que toutes les affirmations du conseiller
concernant les garanties, conditions, exclusions, plafonds et remboursements sont
STRICTEMENT CONFORMES à la documentation produit fournie ci-dessus.

Règles de vérification:
1. Pour chaque point de contrôle, comparez les déclarations du conseiller avec la
   documentation officielle du produit
2. Si une affirmation est inexacte ou incomplète, marquez le point comme NON_CONFORME
3. Citez la documentation produit dans vos commentaires lorsque vous identifiez
   des divergences
4. Les garanties annoncées doivent correspondre exactement aux plafonds/conditions
   documentés
5. Toute omission d'exclusion importante doit être signalée

En cas de divergence entre ce que dit le conseiller et la documentation:
- Marquez le checkpoint comme NON_CONFORME ou PARTIEL
- Expliquez clairement la différence dans le commentaire
- Référencez la source de la documentation produit
─────────────────────────────────────────────────────────────────────────────

`;
  }

  return `${auditConfig.systemPrompt}

${timelineText}
${verificationSection}
═══════════════════════════════════════════════════════════════════════════════
ÉTAPE ${step.position}/${totalSteps}: ${step.name}
═══════════════════════════════════════════════════════════════════════════════

Sévérité: ${step.severityLevel} | Poids: ${step.weight}
Critique: ${step.isCritical ? "⚠️ OUI" : "Non"}
${step.verifyProductInfo ? "🔍 VÉRIFICATION PRODUIT: ⚠️ ACTIVÉE" : ""}

DESCRIPTION:
${step.description}

INSTRUCTIONS:
${step.prompt}

POINTS DE CONTRÔLE À ANALYSER:
${step.controlPoints
  .map((cp: string, i: number) => `${i + 1}. ${cp}`)
  .join("\n")}

MOTS-CLÉS: ${step.keywords.join(", ")}

${buildAnalysisRules()}

Analysez maintenant cette étape.`;
}
