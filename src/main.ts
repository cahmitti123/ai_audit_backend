/**
 * Pipeline Complet d'Audit
 * =========================
 * Orchestre transcription → timeline → audit
 */

import { readFileSync, writeFileSync, existsSync } from "fs";
import { buildTimelineText } from "./prompts.js";
import { analyzeAllSteps } from "./services/audit.js";
import "dotenv/config";

const CONFIG_FILE = "../audit_config_18_points.json";
const TIMELINE_FILE = "../timeline_output.json";
const OUTPUT_FILE = "./audit_results.json";

async function main() {
  console.log("\n" + "=".repeat(80));
  console.log("PIPELINE COMPLET D'AUDIT AI");
  console.log("=".repeat(80) + "\n");

  // ═══════════════════════════════════════════════════════════════════════════
  // 1. CHARGER LA CONFIGURATION
  // ═══════════════════════════════════════════════════════════════════════════
  console.log("📂 Chargement de la configuration...\n");

  if (!existsSync(CONFIG_FILE)) {
    console.error(`❌ Fichier manquant: ${CONFIG_FILE}`);
    process.exit(1);
  }

  const auditConfig = JSON.parse(readFileSync(CONFIG_FILE, "utf-8"));
  console.log(`✓ Config: ${auditConfig.name}`);
  console.log(`✓ Étapes: ${auditConfig.auditSteps.length}`);

  // ═══════════════════════════════════════════════════════════════════════════
  // 2. CHARGER LA TIMELINE
  // ═══════════════════════════════════════════════════════════════════════════
  console.log("\n📂 Chargement de la timeline...\n");

  if (!existsSync(TIMELINE_FILE)) {
    console.error(`❌ Fichier manquant: ${TIMELINE_FILE}`);
    console.log("   Lancez d'abord: npm run timeline");
    process.exit(1);
  }

  const timeline = JSON.parse(readFileSync(TIMELINE_FILE, "utf-8"));
  console.log(`✓ Timeline: ${timeline.length} enregistrements`);

  const totalChunks = timeline.reduce(
    (sum: number, r: any) => sum + r.total_chunks,
    0
  );
  console.log(`✓ Chunks: ${totalChunks}`);

  // ═══════════════════════════════════════════════════════════════════════════
  // 3. CONSTRUIRE LE PROMPT STATIQUE
  // ═══════════════════════════════════════════════════════════════════════════
  console.log("\n🔧 Construction du prompt statique...\n");

  const timelineText = buildTimelineText(timeline);
  console.log(
    `✓ Prompt statique: ${timelineText.length.toLocaleString()} caractères`
  );

  // ═══════════════════════════════════════════════════════════════════════════
  // 4. AUDIT AVEC GPT-5
  // ═══════════════════════════════════════════════════════════════════════════
  console.log("\n🤖 Lancement de l'audit GPT-5...");

  const auditResults = await analyzeAllSteps(
    auditConfig,
    timeline,
    timelineText,
    {
      model: "gpt-5",
      reasoningEffort: "high",
      textVerbosity: "high",
      maxRetries: 3,
    }
  );

  // ═══════════════════════════════════════════════════════════════════════════
  // 5. CALCUL DE CONFORMITÉ
  // ═══════════════════════════════════════════════════════════════════════════
  console.log("\n📊 Calcul de la conformité...\n");

  const totalWeight = auditConfig.auditSteps.reduce(
    (sum: number, s: any) => sum + s.weight,
    0
  );

  // Cap each step's score at its maximum weight
  const earnedWeight = auditResults.steps
    .filter((s: any) => s.score !== undefined)
    .reduce((sum: number, s: any) => {
      const maxWeight = s.step_metadata?.weight || s.score;
      const cappedScore = Math.min(s.score, maxWeight);
      return sum + cappedScore;
    }, 0);

  const score = (earnedWeight / totalWeight) * 100;

  const criticalTotal = auditConfig.auditSteps.filter(
    (s: any) => s.isCritical
  ).length;
  const criticalPassed = auditResults.steps.filter(
    (s: any) => s.step_metadata?.is_critical && s.conforme === "CONFORME"
  ).length;

  let niveau = "INSUFFISANT";
  if (criticalPassed < criticalTotal) {
    niveau = "REJET";
  } else if (score >= 90) {
    niveau = "EXCELLENT";
  } else if (score >= 75) {
    niveau = "BON";
  } else if (score >= 60) {
    niveau = "ACCEPTABLE";
  }

  const compliance = {
    score: Number(score.toFixed(2)),
    niveau,
    points_critiques: `${criticalPassed}/${criticalTotal}`,
    poids_obtenu: earnedWeight,
    poids_total: totalWeight,
  };

  // ═══════════════════════════════════════════════════════════════════════════
  // 6. SAUVEGARDER LES RÉSULTATS
  // ═══════════════════════════════════════════════════════════════════════════
  const finalResults = {
    ...auditResults,
    compliance,
  };

  writeFileSync(OUTPUT_FILE, JSON.stringify(finalResults, null, 2));

  // ═══════════════════════════════════════════════════════════════════════════
  // 7. AFFICHER LE RÉSUMÉ
  // ═══════════════════════════════════════════════════════════════════════════
  console.log("\n" + "=".repeat(80));
  console.log("RÉSULTATS FINAUX");
  console.log("=".repeat(80));
  console.log(`\nScore: ${score.toFixed(2)}%`);
  console.log(`Niveau: ${niveau}`);
  console.log(`Points critiques: ${criticalPassed}/${criticalTotal}`);
  console.log(
    `\nÉtapes réussies: ${auditResults.statistics.successful}/${auditConfig.auditSteps.length}`
  );
  console.log(`Échecs: ${auditResults.statistics.failed}`);
  console.log(
    `\nTemps: ${auditResults.statistics.total_time_seconds.toFixed(1)}s`
  );
  console.log(
    `Tokens: ${auditResults.statistics.total_tokens.toLocaleString()}`
  );
  console.log(`\n✓ Sauvegardé: ${OUTPUT_FILE}\n`);

  // Citations totales
  const totalCitations = auditResults.steps
    .filter((s: any) => s.points_controle)
    .reduce(
      (sum: number, s: any) =>
        sum +
        s.points_controle.reduce(
          (s2: number, pc: any) => s2 + pc.citations.length,
          0
        ),
      0
    );

  console.log(`📋 Citations totales: ${totalCitations}`);
  console.log("");
}

main().catch((error) => {
  console.error("\n❌ Erreur fatale:", error);
  process.exit(1);
});
