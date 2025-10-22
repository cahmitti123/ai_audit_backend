/**
 * Construction des Prompts
 * =========================
 * Génération des prompts optimisés pour GPT-5
 */

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
  timelineText: string
): string {
  const totalSteps = auditConfig.auditSteps?.length || step.position;

  return `${auditConfig.systemPrompt}

${timelineText}

═══════════════════════════════════════════════════════════════════════════════
ÉTAPE ${step.position}/${totalSteps}: ${step.name}
═══════════════════════════════════════════════════════════════════════════════

Sévérité: ${step.severityLevel} | Poids: ${step.weight}
Critique: ${step.isCritical ? "⚠️ OUI" : "Non"}

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
