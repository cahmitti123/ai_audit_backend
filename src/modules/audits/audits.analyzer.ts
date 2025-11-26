/**
 * Audit Analyzer
 * ==============
 * AI-powered audit step analysis using GPT-5
 */

import { openai } from "@ai-sdk/openai";
import { generateObject } from "ai";
import { AuditStepSchema } from "../../schemas.js";
import { buildStepPrompt } from "./audits.prompts.js";
import { auditWebhooks } from "../../shared/webhook.js";
import {
  getProductVerificationContext,
  formatVerificationContextForPrompt,
  type ProductVerificationContext,
} from "./audits.vector-store.js";

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
  auditId: string,
  ficheId: string,
  productInfo: any = null,
  options: AuditOptions = {}
) {
  const opts = { ...DEFAULT_OPTIONS, ...options };

  const totalSteps = auditConfig.auditSteps?.length || step.position;

  console.log(`\n${"=".repeat(80)}`);
  console.log(`Étape ${step.position}/${totalSteps}: ${step.name}`);
  console.log("=".repeat(80));

  // Send step started webhook
  await auditWebhooks.stepStarted(
    auditId,
    ficheId,
    step.position,
    step.name,
    totalSteps,
    step.weight,
    step.isCritical
  );

  // Check if product verification is required
  let productVerificationContext: ProductVerificationContext[] | null = null;
  if (step.verifyProductInfo === true) {
    // Check if product info is available from database
    if (productInfo && productInfo.matched && productInfo.formule) {
      console.log(`✅ Product data available from database - SKIPPING vector store`);
      console.log(`   Groupe: ${productInfo.formule.gamme.groupe.libelle}`);
      console.log(`   Gamme: ${productInfo.formule.gamme.libelle}`);
      console.log(`   Formule: ${productInfo.formule.libelle}`);
      console.log(`   Guarantees: ${productInfo.formule._counts.garanties}`);
      console.log(`   Categories: ${productInfo.formule._counts.categories}`);
      console.log(`   Items: ${productInfo.formule._counts.items}`);
      // Database has complete guarantee data - no need for vector store
    } else {
      // Fallback to vector store only if no database match
      console.log(
        "⚠️ Product not matched in database - fetching from vector store as fallback..."
      );
      try {
        productVerificationContext = await getProductVerificationContext(step);
        console.log(
          `✅ Retrieved verification context from vector store for ${productVerificationContext.length} checkpoints`
        );
      } catch (error) {
        console.error("⚠️ Failed to fetch product verification context:", error);
        // Continue without verification context rather than failing the entire step
      }
    }
  }

  const prompt = buildStepPrompt(
    step,
    auditConfig,
    timelineText,
    productVerificationContext,
    productInfo
  );
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

  // Send step completed webhook
  await auditWebhooks.stepCompleted(
    auditId,
    ficheId,
    step.position,
    step.name,
    result.object.score,
    step.weight,
    result.object.conforme === "CONFORME",
    totalCitations,
    result.usage.totalTokens
  );

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
  auditId: string,
  ficheId: string,
  productInfo: any = null,
  options: AuditOptions = {}
) {
  console.log("\n🚀 Analyse parallèle de toutes les étapes...\n");

  const startTime = Date.now();
  const totalSteps = auditConfig.auditSteps.length;

  // Send analysis started webhook
  await auditWebhooks.analysisStarted(
    auditId,
    ficheId,
    totalSteps,
    options.model || "gpt-5"
  );

  const stepPromises = auditConfig.auditSteps.map((step: any, index: number) =>
    analyzeStep(step, auditConfig, timelineText, auditId, ficheId, productInfo, options)
      .then((result) => {
        // Send progress webhook after each step completes
        const completedSteps = index + 1;
        const failedSteps = 0; // Will be calculated later
        auditWebhooks.progress(
          auditId,
          ficheId,
          completedSteps,
          totalSteps,
          failedSteps,
          "analysis"
        );
        return { success: true, result };
      })
      .catch(async (error) => {
        // Send step failed webhook
        await auditWebhooks.stepFailed(
          auditId,
          ficheId,
          step.position,
          step.name,
          String(error)
        );

        // Still send progress webhook
        const completedSteps = index + 1;
        await auditWebhooks.progress(
          auditId,
          ficheId,
          completedSteps,
          totalSteps,
          1, // This step failed
          "analysis"
        );

        return {
          success: false,
          error: String(error),
          step_metadata: {
            position: step.position,
            name: step.name,
            severity: step.severityLevel,
            is_critical: step.isCritical,
            weight: step.weight,
          },
        };
      })
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
