/**
 * Export Audit Configs (DB -> files)
 * =================================
 *
 * Generates:
 * - data/audit-configs-db-export.json (latest)
 * - data/audit-configs-db-export.<timestamp>.json
 * - docs/audit-configs-db-export.md (human readable summary)
 * - docs/audit-configs-db-export.<timestamp>.md
 * - docs/rapport-et-configs-audit-details.md (clean combined report + full prompts)
 * - docs/rapport-et-configs-audit-details.<timestamp>.md
 * - docs/rapport-et-configs-audit-details.docx
 * - docs/rapport-et-configs-audit-details.<timestamp>.docx
 *
 * Usage:
 *   npx tsx scripts/export-audit-configs.ts
 *
 * Notes:
 * - Loads `.env` via `dotenv/config`
 * - BigInt-safe JSON serialization
 * - Does NOT print secrets (never logs DATABASE_URL)
 */

import "dotenv/config";

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  Document,
  HeadingLevel,
  Packer,
  Paragraph,
  TextRun,
} from "docx";
import type { Prisma } from "@prisma/client";
import { prisma, disconnectDb } from "../src/shared/prisma.js";
import { stringifyWithBigInt } from "../src/shared/bigint-serializer.js";

function pad2(n: number) {
  return String(n).padStart(2, "0");
}

function formatTimestampForFilename(date: Date) {
  return [
    date.getFullYear(),
    pad2(date.getMonth() + 1),
    pad2(date.getDate()),
    "_",
    pad2(date.getHours()),
    pad2(date.getMinutes()),
    pad2(date.getSeconds()),
  ].join("");
}

type ExportAuditConfig = Prisma.AuditConfigGetPayload<{
  include: { steps: true };
}>;

function boolLabel(v: boolean) {
  return v ? "Oui" : "Non";
}

function mdEscapeInline(text: string) {
  return text.replaceAll("|", "\\|");
}

function demoteMarkdownHeadings(markdown: string, by: number) {
  if (by <= 0) return markdown;
  return markdown
    .split(/\r?\n/)
    .map((line) => {
      const match = line.match(/^(#{1,6})\s+/);
      if (!match) return line;
      const level = match[1].length;
      const newLevel = Math.min(6, level + by);
      return `${"#".repeat(newLevel)}${line.slice(level)}`;
    })
    .join("\n");
}

const DOCX_MONO_FONT = "Courier New";

function parseInlineMarkdownToRuns(text: string): TextRun[] {
  const runs: TextRun[] = [];
  let i = 0;

  while (i < text.length) {
    // Bold: **text**
    if (text.startsWith("**", i)) {
      const end = text.indexOf("**", i + 2);
      if (end !== -1) {
        const content = text.slice(i + 2, end);
        runs.push(new TextRun({ text: content, bold: true }));
        i = end + 2;
        continue;
      }
    }

    // Inline code: `text`
    if (text[i] === "`") {
      const end = text.indexOf("`", i + 1);
      if (end !== -1) {
        const content = text.slice(i + 1, end);
        runs.push(new TextRun({ text: content, font: DOCX_MONO_FONT }));
        i = end + 1;
        continue;
      }
    }

    // Plain text until next marker
    const nextBold = text.indexOf("**", i);
    const nextCode = text.indexOf("`", i);
    const next =
      nextBold === -1
        ? nextCode
        : nextCode === -1
          ? nextBold
          : Math.min(nextBold, nextCode);

    if (next === -1) {
      runs.push(new TextRun({ text: text.slice(i) }));
      break;
    }

    if (next > i) {
      runs.push(new TextRun({ text: text.slice(i, next) }));
      i = next;
      continue;
    }

    // Unmatched marker: emit the current char and advance.
    runs.push(new TextRun({ text: text[i] }));
    i += 1;
  }

  return runs.length > 0 ? runs : [new TextRun({ text: "" })];
}

function headingLevelFor(level: number) {
  switch (level) {
    case 1:
      return HeadingLevel.HEADING_1;
    case 2:
      return HeadingLevel.HEADING_2;
    case 3:
      return HeadingLevel.HEADING_3;
    case 4:
      return HeadingLevel.HEADING_4;
    case 5:
      return HeadingLevel.HEADING_5;
    default:
      return HeadingLevel.HEADING_6;
  }
}

function markdownToDocxParagraphs(markdown: string): Paragraph[] {
  const paragraphs: Paragraph[] = [];
  let inCodeBlock = false;

  for (const rawLine of markdown.split(/\r?\n/)) {
    const line = rawLine.replaceAll("\t", "    ");

    // Code block fences
    if (line.trim().startsWith("```")) {
      inCodeBlock = !inCodeBlock;
      continue;
    }

    if (inCodeBlock) {
      // Keep every line as-is (monospace)
      paragraphs.push(
        new Paragraph({
          children: [
            new TextRun({
              text: line === "" ? " " : line,
              font: DOCX_MONO_FONT,
            }),
          ],
        })
      );
      continue;
    }

    // Headings: # / ## / ...
    const headingMatch = line.match(/^(#{1,6})\s+(.*)$/);
    if (headingMatch) {
      const level = headingMatch[1].length;
      const text = headingMatch[2];
      paragraphs.push(
        new Paragraph({
          heading: headingLevelFor(level),
          children: parseInlineMarkdownToRuns(text),
        })
      );
      continue;
    }

    // Bullets: - item
    const bulletMatch = line.match(/^\-\s+(.*)$/);
    if (bulletMatch) {
      paragraphs.push(
        new Paragraph({
          bullet: { level: 0 },
          children: parseInlineMarkdownToRuns(bulletMatch[1]),
        })
      );
      continue;
    }

    // Empty line = paragraph break
    if (line.trim() === "") {
      paragraphs.push(new Paragraph({ text: "" }));
      continue;
    }

    // Default paragraph
    paragraphs.push(new Paragraph({ children: parseInlineMarkdownToRuns(line) }));
  }

  return paragraphs;
}

async function writeDocxFromMarkdown(markdown: string, outPath: string) {
  const doc = new Document({
    sections: [
      {
        properties: {},
        children: markdownToDocxParagraphs(markdown),
      },
    ],
  });

  const buffer = await Packer.toBuffer(doc);
  writeFileSync(outPath, buffer);
}

function buildMarkdownSummary(configs: ExportAuditConfig[], exportedAt: Date) {
  const lines: string[] = [];

  lines.push("# Export DB — Configurations d’audit");
  lines.push("");
  lines.push(`- **Exporté le**: ${exportedAt.toISOString()}`);
  lines.push(`- **Nombre de configurations**: ${configs.length}`);
  lines.push("");
  lines.push(
    "Ce fichier est un **résumé lisible**. Le détail complet (prompts inclus) est dans `data/audit-configs-db-export.json`."
  );
  lines.push("");

  for (const cfg of configs) {
    lines.push(`## ${mdEscapeInline(cfg.name)} (id: ${String(cfg.id)})`);
    lines.push("");
    if (cfg.description) {
      lines.push(`- **Description**: ${cfg.description}`);
    }
    lines.push(`- **Actif**: ${boolLabel(cfg.isActive)}`);
    lines.push(`- **Auto**: ${boolLabel(cfg.runAutomatically)}`);
    lines.push(`- **Créé par**: ${cfg.createdBy ?? "—"}`);
    lines.push(`- **Créé le**: ${cfg.createdAt.toISOString()}`);
    lines.push(`- **Mis à jour le**: ${cfg.updatedAt.toISOString()}`);
    lines.push(`- **Étapes**: ${cfg.steps.length}`);
    lines.push("");

    lines.push(
      "| Pos | Étape | Sévérité | Critique | Poids | Chrono | Vérif produit | #Points | #Mots-clés |"
    );
    lines.push("|---:|---|---|---:|---:|---:|---:|---:|---:|");
    for (const step of cfg.steps) {
      lines.push(
        `| ${step.position} | ${mdEscapeInline(step.name)} | ${step.severityLevel} | ${boolLabel(
          step.isCritical
        )} | ${step.weight} | ${boolLabel(step.chronologicalImportant)} | ${boolLabel(
          step.verifyProductInfo
        )} | ${step.controlPoints.length} | ${step.keywords.length} |`
      );
    }
    lines.push("");
  }

  return lines.join("\n");
}

function buildCombinedReportAndConfigsDoc(options: {
  configs: ExportAuditConfig[];
  exportedAt: Date;
  reportMarkdown: string;
}) {
  const { configs, exportedAt, reportMarkdown } = options;
  const lines: string[] = [];

  lines.push("# Rapport Qualité — Référentiel d’audit (détail complet)");
  lines.push("");
  lines.push(`- **Date**: ${exportedAt.toISOString().slice(0, 10)}`);
  lines.push(`- **Nombre d’audits configurés**: ${configs.length}`);
  lines.push("");
  // 1) Executive report (best-effort, optional)
  if (reportMarkdown.trim()) {
    // Demote headings so the combined doc keeps a single top-level title.
    lines.push(demoteMarkdownHeadings(reportMarkdown.trim(), 1));
  } else {
    lines.push("_Résumé indisponible._");
  }
  lines.push("");

  // 2) Full configs details (prompts included)
  lines.push("## Configurations d’audit — détail complet");
  lines.push("");

  for (const cfg of configs) {
    lines.push(`### ${cfg.name}`);
    lines.push("");
    if (cfg.description) {
      lines.push("**Description**");
      lines.push("");
      lines.push(cfg.description);
      lines.push("");
    }

    lines.push("**Paramètres**");
    lines.push("");
    lines.push(`- **Actif**: ${boolLabel(cfg.isActive)}`);
    lines.push(`- **Exécution automatique**: ${boolLabel(cfg.runAutomatically)}`);
    lines.push(`- **Nombre d’étapes**: ${cfg.steps.length}`);
    lines.push("");

    lines.push("**Prompt système**");
    lines.push("");
    lines.push("```text");
    lines.push(cfg.systemPrompt ?? "");
    lines.push("```");
    lines.push("");

    lines.push("**Étapes**");
    lines.push("");

    for (const step of cfg.steps) {
      lines.push(`#### Étape ${step.position}: ${step.name}`);
      lines.push("");

      lines.push("**Paramètres**");
      lines.push("");
      lines.push(`- **Sévérité**: ${step.severityLevel}`);
      lines.push(`- **Critique**: ${boolLabel(step.isCritical)}`);
      lines.push(`- **Poids**: ${step.weight}`);
      lines.push(`- **Chronologique**: ${boolLabel(step.chronologicalImportant)}`);
      lines.push(`- **Vérification produit**: ${boolLabel(step.verifyProductInfo)}`);
      lines.push("");

      if (step.description) {
        lines.push("**Description**");
        lines.push("");
        lines.push(step.description);
        lines.push("");
      }

      lines.push("**Prompt**");
      lines.push("");
      lines.push("```text");
      lines.push(step.prompt);
      lines.push("```");
      lines.push("");

      lines.push("**Points de contrôle**");
      lines.push("");
      if (step.controlPoints.length === 0) {
        lines.push("- (aucun)");
      } else {
        for (const cp of step.controlPoints) {
          lines.push(`- ${cp}`);
        }
      }
      lines.push("");

      lines.push("**Mots-clés**");
      lines.push("");
      if (step.keywords.length === 0) {
        lines.push("- (aucun)");
      } else {
        for (const kw of step.keywords) {
          lines.push(`- ${kw}`);
        }
      }
      lines.push("");
    }
  }

  return lines.join("\n");
}

async function main() {
  const exportedAt = new Date();
  const timestamp = formatTimestampForFilename(exportedAt);

  const outDataDir = resolve(process.cwd(), "data");
  const outDocsDir = resolve(process.cwd(), "docs");
  mkdirSync(outDataDir, { recursive: true });
  mkdirSync(outDocsDir, { recursive: true });

  // Optional: include the executive report inside the combined doc (best-effort)
  const reportPath = resolve(
    process.cwd(),
    "docs",
    "rapport-executif-application-qualite.md"
  );
  let reportMarkdown = "";
  try {
    reportMarkdown = readFileSync(reportPath, "utf-8");
  } catch {
    reportMarkdown = "";
  }

  const configs = await prisma.auditConfig.findMany({
    include: {
      steps: { orderBy: { position: "asc" } },
    },
    orderBy: { createdAt: "desc" },
  });

  const jsonPayload = {
    exportedAt: exportedAt.toISOString(),
    count: configs.length,
    data: configs,
  };

  const jsonLatestPath = resolve(outDataDir, "audit-configs-db-export.json");
  const jsonTimestampedPath = resolve(
    outDataDir,
    `audit-configs-db-export.${timestamp}.json`
  );
  const json = stringifyWithBigInt(jsonPayload, 2);
  writeFileSync(jsonLatestPath, json, "utf-8");
  writeFileSync(jsonTimestampedPath, json, "utf-8");

  const md = buildMarkdownSummary(configs, exportedAt);
  const mdLatestPath = resolve(outDocsDir, "audit-configs-db-export.md");
  const mdTimestampedPath = resolve(
    outDocsDir,
    `audit-configs-db-export.${timestamp}.md`
  );
  writeFileSync(mdLatestPath, md, "utf-8");
  writeFileSync(mdTimestampedPath, md, "utf-8");

  const combined = buildCombinedReportAndConfigsDoc({
    configs,
    exportedAt,
    reportMarkdown,
  });
  const combinedLatestPath = resolve(
    outDocsDir,
    "rapport-et-configs-audit-details.md"
  );
  const combinedTimestampedPath = resolve(
    outDocsDir,
    `rapport-et-configs-audit-details.${timestamp}.md`
  );
  writeFileSync(combinedLatestPath, combined, "utf-8");
  writeFileSync(combinedTimestampedPath, combined, "utf-8");

  const combinedDocxLatestPath = resolve(
    outDocsDir,
    "rapport-et-configs-audit-details.docx"
  );
  const combinedDocxTimestampedPath = resolve(
    outDocsDir,
    `rapport-et-configs-audit-details.${timestamp}.docx`
  );
  await writeDocxFromMarkdown(combined, combinedDocxLatestPath);
  await writeDocxFromMarkdown(combined, combinedDocxTimestampedPath);

  // Keep output minimal (avoid leaking env)
  console.log(`✅ Exported ${configs.length} audit config(s).`);
  console.log(`- ${jsonLatestPath}`);
  console.log(`- ${jsonTimestampedPath}`);
  console.log(`- ${mdLatestPath}`);
  console.log(`- ${mdTimestampedPath}`);
  console.log(`- ${combinedLatestPath}`);
  console.log(`- ${combinedTimestampedPath}`);
  console.log(`- ${combinedDocxLatestPath}`);
  console.log(`- ${combinedDocxTimestampedPath}`);
}

main()
  .catch((err) => {
    console.error("❌ Failed to export audit configs.");
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await disconnectDb();
  });

