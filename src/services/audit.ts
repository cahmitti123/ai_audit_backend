/**
 * Audit avec AI SDK
 * ==================
 * Analyse des étapes d'audit avec GPT-5 et structured outputs
 */

import { openai } from "@ai-sdk/openai";
import { generateObject } from "ai";
import { AuditStepSchema } from "../schemas.js";
import { buildStepPrompt } from "../prompts.js";
import { JSONValue } from "ai";

export interface AuditOptions {
  model?: string;
  reasoningEffort?: ReasoningEffort;
  textVerbosity?: TextVerbosity;
  maxRetries?: number;
}

type ReasoningEffort = "minimal" | "low" | "medium" | "high";
type TextVerbosity = "low" | "medium" | "high";

const DEFAULT_OPTIONS: AuditOptions = {
  model: "gpt-5",
  reasoningEffort: "high",
  textVerbosity: "high",
  maxRetries: 3,
};

export async function analyzeStep(
  step: any,
  auditConfig: any,
  timelineText: string,
  options: AuditOptions = {}
) {
  const opts = { ...DEFAULT_OPTIONS, ...options };

  const totalSteps = auditConfig.auditSteps?.length || step.position;

  console.log(`\n${"=".repeat(80)}`);
  console.log(`Étape ${step.position}/${totalSteps}: ${step.name}`);
  console.log("=".repeat(80));

  const prompt = buildStepPrompt(step, auditConfig, timelineText);
  console.log(`Envoi à ${opts.model}...`);

  const result = await generateObject({
    model: openai.responses(opts.model!),
    schema: AuditStepSchema,
    prompt,
    maxRetries: opts.maxRetries,
    providerOptions: {
      openai: {
        reasoningEffort: opts.reasoningEffort!,
        textVerbosity: opts.textVerbosity!,
        reasoningSummary: "detailed",
        strictJsonSchema: true,
      },
    },
    experimental_repairText: async ({ text }) => {
      // Auto-repair
      return (
        text.replace(/"ÉLEVÉ"/g, '"BON"').replace(/"Élevé"/g, '"BON"') +
        (text.trim().endsWith("}") ? "" : "}")
      );
    },
  });

  const totalCitations = result.object.points_controle.reduce(
    (sum, pc) => sum + pc.citations.length,
    0
  );

  console.log(`✅ Succès`);
  console.log(`   Score: ${result.object.score}/${step.weight}`);
  console.log(`   Conforme: ${result.object.conforme}`);
  console.log(`   Citations: ${totalCitations}`);
  console.log(`   Tokens: ${result.usage.totalTokens}`);

  return {
    ...result.object,
    step_metadata: {
      position: step.position,
      name: step.name,
      severity: step.severityLevel,
      is_critical: step.isCritical,
      weight: step.weight,
    },
    usage: {
      prompt_tokens: result.usage.promptTokens,
      completion_tokens: result.usage.completionTokens,
      total_tokens: result.usage.totalTokens,
    },
  };
}

export async function analyzeAllSteps(
  auditConfig: any,
  timeline: any,
  timelineText: string,
  options: AuditOptions = {}
) {
  console.log("\n🚀 Analyse parallèle de toutes les étapes...\n");

  const startTime = Date.now();

  const stepPromises = auditConfig.auditSteps.map((step: any) =>
    analyzeStep(step, auditConfig, timelineText, options)
      .then((result) => ({ success: true, result }))
      .catch((error) => ({
        success: false,
        error: String(error),
        step_metadata: {
          position: step.position,
          name: step.name,
        },
      }))
  );

  const stepResults = await Promise.all(stepPromises);

  const elapsed = (Date.now() - startTime) / 1000;

  // Collecter résultats
  const results = {
    metadata: {
      date: new Date().toISOString(),
      mode: "AI_SDK_GPT5",
      options,
    },
    steps: stepResults.map((r) =>
      r.success
        ? r.result
        : {
            error: r.error,
            step_metadata: r.step_metadata,
          }
    ),
    statistics: {
      successful: stepResults.filter((r) => r.success).length,
      failed: stepResults.filter((r) => !r.success).length,
      total_time_seconds: elapsed,
      total_tokens: stepResults
        .filter((r) => r.success)
        .reduce((sum, r) => sum + (r.result.usage?.total_tokens || 0), 0),
    },
  };

  console.log(`\n✅ Analyse terminée en ${elapsed.toFixed(1)}s`);

  return results;
}
