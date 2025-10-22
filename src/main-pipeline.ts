/**
 * Pipeline Complet Autonome
 * ==========================
 * 1. Récupère les données via API
 * 2. Transcrit avec ElevenLabs (cache)
 * 3. Génère timeline
 * 4. Audit GPT-5 par checkpoint
 * 5. Sauvegarde résultats
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "fs";
import axios from "axios";
import { TranscriptionService } from "./services/transcription.js";
import { generateTimeline } from "./services/timeline-generator.js";
import { analyzeAllSteps } from "./services/audit.js";
import { buildTimelineText } from "./prompts.js";
import {
  fetchLatestAuditConfig,
  disconnectAuditConfigDb,
} from "./services/audit-config.js";
import "dotenv/config";

const DATA_DIR = "./data";
const TIMELINE_FILE = "./data/timeline.json";
const RESULTS_FILE = "./data/audit_results.json";

// Configuration
const FICHE_ID = process.env.FICHE_ID || "1762209";
const API_BASE_URL =
  process.env.FICHE_API_BASE_URL || "https://api.devis-mutuelle-pas-cher.com";

/**
 * Récupère les données de la fiche depuis l'API
 */
async function fetchFicheData(ficheId: string) {
  const url = `${API_BASE_URL}/api/fiches/by-id/${ficheId}?include_recordings=true&include_transcriptions=false`;

  console.log(`🌐 Requête API: ${url}\n`);

  try {
    const response = await axios.get(url, {
      headers: {
        accept: "application/json",
      },
    });

    if (!response.data.success) {
      throw new Error(response.data.message || "API request failed");
    }

    return response.data;
  } catch (error: any) {
    if (error.response) {
      throw new Error(
        `API Error ${error.response.status}: ${error.response.statusText}`
      );
    } else if (error.request) {
      throw new Error("No response from API");
    } else {
      throw new Error(`Request error: ${error.message}`);
    }
  }
}

async function main() {
  console.log("\n" + "=".repeat(80));
  console.log("PIPELINE COMPLET AUTONOME - AI AUDIT");
  console.log("=".repeat(80) + "\n");

  // Créer dossiers
  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });

  // ═══════════════════════════════════════════════════════════════════════════
  // 1. RÉCUPÉRER LES DONNÉES VIA API
  // ═══════════════════════════════════════════════════════════════════════════
  console.log("📂 Étape 1/5: Récupération des données\n");

  const ficheData = await fetchFicheData(FICHE_ID);
  console.log(`✓ Fiche ID: ${ficheData.information.fiche_id}`);
  console.log(`✓ ${ficheData.recordings.length} enregistrements trouvés`);
  console.log(
    `✓ Prospect: ${ficheData.prospect.prenom} ${ficheData.prospect.nom}\n`
  );

  // ═══════════════════════════════════════════════════════════════════════════
  // 2. TRANSCRIPTION
  // ═══════════════════════════════════════════════════════════════════════════
  console.log("🎤 Étape 2/5: Transcription audio\n");

  const transcriptionService = new TranscriptionService(
    process.env.ELEVENLABS_API_KEY!
  );

  const transcriptions = await transcriptionService.transcribeAll(
    ficheData.recordings
  );
  console.log(`\n✓ ${transcriptions.length} transcriptions complétées\n`);

  // ═══════════════════════════════════════════════════════════════════════════
  // 3. GÉNÉRATION TIMELINE
  // ═══════════════════════════════════════════════════════════════════════════
  console.log("📊 Étape 3/5: Génération de la timeline\n");

  const timeline = generateTimeline(transcriptions);
  writeFileSync(TIMELINE_FILE, JSON.stringify(timeline, null, 2));

  const totalChunks = timeline.reduce((sum, r) => sum + r.total_chunks, 0);
  console.log(
    `✓ Timeline: ${timeline.length} enregistrements, ${totalChunks} chunks`
  );
  console.log(`✓ Sauvegardé: ${TIMELINE_FILE}\n`);

  // ═══════════════════════════════════════════════════════════════════════════
  // 4. CHARGER CONFIG AUDIT DEPUIS LA BASE DE DONNÉES
  // ═══════════════════════════════════════════════════════════════════════════
  console.log("📋 Étape 4/5: Chargement configuration audit\n");

  const auditConfig = await fetchLatestAuditConfig();
  console.log(`✓ Config: ${auditConfig.name}`);
  console.log(`✓ Config ID: ${auditConfig.id}`);
  console.log(`✓ Étapes: ${auditConfig.auditSteps.length}\n`);

  // ═══════════════════════════════════════════════════════════════════════════
  // 5. AUDIT GPT-5
  // ═══════════════════════════════════════════════════════════════════════════
  console.log("🤖 Étape 5/5: Audit avec GPT-5\n");

  const timelineText = buildTimelineText(timeline);
  const auditResults = await analyzeAllSteps(
    auditConfig,
    timeline,
    timelineText
  );

  writeFileSync(RESULTS_FILE, JSON.stringify(auditResults, null, 2));

  // ═══════════════════════════════════════════════════════════════════════════
  // NETTOYAGE
  // ═══════════════════════════════════════════════════════════════════════════
  await disconnectAuditConfigDb();

  // ═══════════════════════════════════════════════════════════════════════════
  // RÉSUMÉ FINAL
  // ═══════════════════════════════════════════════════════════════════════════
  console.log("\n" + "=".repeat(80));
  console.log("✅ PIPELINE TERMINÉ");
  console.log("=".repeat(80));
  console.log(`\nFichiers générés:`);
  console.log(`  • ${TIMELINE_FILE}`);
  console.log(`  • ${RESULTS_FILE}`);
  console.log(`  • ${DATA_DIR}/transcription_cache.json`);
  console.log("");
}

main().catch(async (error) => {
  console.error("\n❌ Erreur fatale:", error);
  await disconnectAuditConfigDb();
  process.exit(1);
});
