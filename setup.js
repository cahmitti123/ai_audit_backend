/**
 * Setup
 * =====
 * Minimal, safe bootstrap for local development.
 *
 * - Creates required folders (`config/`, `data/`)
 * - Creates `.env` from `.env.example` if missing
 *
 * NOTE: Never copy real secrets from outside this repo.
 */

import { copyFileSync, existsSync,mkdirSync } from "fs";
import { resolve } from "path";

console.log("\n🔧 Setup AI Audit System...\n");

// Ensure folders exist
for (const dir of ["./config", "./data"]) {
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
    console.log(`✓ Created: ${dir}`);
  }
}

// Create .env from example if missing
if (!existsSync("./.env")) {
  const src = "./.env.example";
  const dest = "./.env";
  try {
    copyFileSync(resolve(src), resolve(dest));
    console.log(`✓ Created: ${dest} (from ${src})`);
    console.log("  → Please edit .env and set your credentials/API keys.");
  } catch (e) {
    console.error("❌ Failed to create .env from .env.example:", e.message);
  }
} else {
  console.log("✓ .env already exists (skipping)");
}

console.log("\n✅ Setup complete.\n");
console.log("Next steps:");
console.log("  - npm install");
console.log("  - npx prisma migrate dev");
console.log("  - npm run dev\n");
