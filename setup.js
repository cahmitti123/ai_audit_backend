/**
 * Setup - Copie les fichiers nécessaires depuis le dossier parent
 */

import { copyFileSync, mkdirSync, existsSync } from "fs";
import { resolve } from "path";

console.log("\n🔧 Setup AI Audit System...\n");

// Créer dossiers
const dirs = ["./config", "./data"];
dirs.forEach((dir) => {
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
    console.log(`✓ Créé: ${dir}`);
  }
});

// Copier fichiers de config depuis parent
const files = [
  ["../audit_config_18_points.json", "./config/audit_config_18_points.json"],
  [
    "../ressources/ventes/Fiche N°1762209 - Christine BADIN - 26-09-2025/api-response-recordings.json",
    "./config/api-response-recordings.json",
  ],
  ["../.env", "./.env"],
];

files.forEach(([src, dest]) => {
  try {
    copyFileSync(resolve(src), resolve(dest));
    console.log(`✓ Copié: ${src} → ${dest}`);
  } catch (e) {
    console.error(`❌ Erreur copie ${src}:`, e.message);
  }
});

console.log("\n✅ Setup terminé!\n");
console.log("Lancez maintenant: npm run pipeline\n");
