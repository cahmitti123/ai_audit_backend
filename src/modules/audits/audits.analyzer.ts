/**
 * Audit Analyzer
 * ==============
 * AI-powered audit step analysis using GPT-5.x (default: gpt-5.2)
 */

import { openai } from "@ai-sdk/openai";
import { generateObject } from "ai";
import { AuditStepSchema } from "../../schemas.js";
import { buildStepPrompt } from "./audits.prompts.js";
import { auditWebhooks } from "../../shared/webhook.js";
import { logger } from "../../shared/logger.js";
import { mapWithConcurrency } from "../../utils/concurrency.js";
import {
  getProductVerificationContext,
  type ProductVerificationContext,
} from "./audits.vector-store.js";
import type { TimelineRecording } from "../../schemas.js";
import type {
  AuditConfigForAnalysis,
  AuditStepDefinition,
  ProductLinkResult,
} from "./audits.types.js";

export interface AuditOptions {
  model?: string;
  reasoningEffort?: ReasoningEffort;
  textVerbosity?: TextVerbosity;
  maxRetries?: number;
}

type ReasoningEffort = "minimal" | "low" | "medium" | "high";
type TextVerbosity = "low" | "medium" | "high";

const DEFAULT_OPTIONS: AuditOptions = {
  model: process.env.OPENAI_MODEL_AUDIT || "gpt-5.2",
  reasoningEffort: "high",
  textVerbosity: "high",
  maxRetries: 3,
};

export async function analyzeStep(
  step: AuditStepDefinition,
  auditConfig: AuditConfigForAnalysis,
  timelineText: string,
  auditId: string,
  ficheId: string,
  productInfo: ProductLinkResult | null = null,
  options: AuditOptions = {}
) {
  const opts = { ...DEFAULT_OPTIONS, ...options };

  const totalSteps = auditConfig.auditSteps?.length || step.position;

  logger.info("Starting audit step analysis", {
    audit_id: auditId,
    fiche_id: ficheId,
    step_position: step.position,
    step_name: step.name,
    total_steps: totalSteps,
    model: opts.model,
  });

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
      logger.debug("Product data available from DB; skipping vector store", {
        audit_id: auditId,
        fiche_id: ficheId,
        groupe: productInfo.formule.gamme.groupe.libelle,
        gamme: productInfo.formule.gamme.libelle,
        formule: productInfo.formule.libelle,
        guarantees: productInfo.formule._counts?.garanties,
        categories: productInfo.formule._counts?.categories,
        items: productInfo.formule._counts?.items,
      });
      // Database has complete guarantee data - no need for vector store
    } else {
      // Vector-store fallback is opt-in to avoid hallucinations when product mapping is uncertain.
      const allowVectorStore = process.env.PRODUCT_VECTORSTORE_FALLBACK === "1";
      if (!allowVectorStore) {
        logger.warn("Product not matched in DB; vector store fallback disabled", {
          audit_id: auditId,
          fiche_id: ficheId,
          env: "PRODUCT_VECTORSTORE_FALLBACK!=1",
        });
      } else {
        logger.warn("Product not matched in DB; fetching vector store fallback", {
          audit_id: auditId,
          fiche_id: ficheId,
        });
        try {
          productVerificationContext = await getProductVerificationContext(step);
          logger.info("Retrieved vector store verification context", {
            audit_id: auditId,
            fiche_id: ficheId,
            checkpoints: productVerificationContext.length,
          });
        } catch (error) {
          logger.error("Failed to fetch product verification context", {
            audit_id: auditId,
            fiche_id: ficheId,
            error: error instanceof Error ? error.message : String(error),
          });
          // Continue without verification context rather than failing the entire step
        }
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
  logger.debug("Sending prompt to model", {
    audit_id: auditId,
    fiche_id: ficheId,
    step_position: step.position,
    model: opts.model,
  });

  const result = await generateObject({
    model: openai.responses(opts.model!),
    schema: AuditStepSchema,
    prompt,
    maxRetries: opts.maxRetries,
    // Reduce creativity to limit hallucinations; output is schema-constrained.
    temperature: 0,

    providerOptions: {
      openai: {
        reasoningEffort: opts.reasoningEffort!,
        textVerbosity: opts.textVerbosity!,
        reasoningSummary: "detailed",
        strictJsonSchema: true,
      },
    },
    experimental_repairText: async ({ text }) => {
      // Auto-repair JSON only (never rewrite semantics)
      const trimmed = String(text || "").trim();
      return trimmed + (trimmed.endsWith("}") ? "" : "}");
    },
  });

  const totalCitations = result.object.points_controle.reduce(
    (sum, pc) => sum + pc.citations.length,
    0
  );

  logger.info("Audit step analysis completed", {
    audit_id: auditId,
    fiche_id: ficheId,
    step_position: step.position,
    step_name: step.name,
    score: `${result.object.score}/${step.weight}`,
    conforme: result.object.conforme,
    citations: totalCitations,
    tokens: result.usage.totalTokens,
  });

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
  auditConfig: AuditConfigForAnalysis,
  timeline: ReadonlyArray<TimelineRecording>,
  timelineText: string,
  auditId: string,
  ficheId: string,
  productInfo: ProductLinkResult | null = null,
  options: AuditOptions = {}
) {
  logger.info("Starting parallel analysis of all steps", {
    audit_id: auditId,
    fiche_id: ficheId,
    steps: auditConfig.auditSteps.length,
    concurrency: Math.max(1, Number(process.env.AUDIT_STEP_CONCURRENCY || 3)),
  });

  const startTime = Date.now();
  const totalSteps = auditConfig.auditSteps.length;
  const stepConcurrency = Math.max(
    1,
    Number(process.env.AUDIT_STEP_CONCURRENCY || 3)
  );

  // Send analysis started webhook
  await auditWebhooks.analysisStarted(
    auditId,
    ficheId,
    totalSteps,
    (options.model || process.env.OPENAI_MODEL_AUDIT || "gpt-5.2") as string
  );

  // Track progress based on actual completion order (not step index)
  let completedSteps = 0;
  let failedSteps = 0;
  let progressQueue: Promise<void> = Promise.resolve();

  const enqueueProgress = (fn: () => Promise<void>) => {
    progressQueue = progressQueue
      .then(fn)
      .catch((err: unknown) => {
        logger.warn("Audit progress update failed (non-fatal)", {
          audit_id: auditId,
          fiche_id: ficheId,
          error: err instanceof Error ? err.message : String(err),
        });
      });
  };

  const stepResults = await mapWithConcurrency(
    auditConfig.auditSteps,
    stepConcurrency,
    async (step: AuditStepDefinition) => {
      try {
        const result = await analyzeStep(
          step,
          auditConfig,
          timelineText,
          auditId,
          ficheId,
          productInfo,
          options
        );

        enqueueProgress(async () => {
          completedSteps += 1;
          await auditWebhooks.progress(
            auditId,
            ficheId,
            completedSteps,
            totalSteps,
            failedSteps,
            "analysis"
          );
        });

        return { success: true as const, result };
      } catch (error) {
        // Serialize failure + progress updates so counts are consistent and monotonic.
        enqueueProgress(async () => {
          failedSteps += 1;
          completedSteps += 1;

          await auditWebhooks.stepFailed(
            auditId,
            ficheId,
            step.position,
            step.name,
            String(error)
          );

          await auditWebhooks.progress(
            auditId,
            ficheId,
            completedSteps,
            totalSteps,
            failedSteps,
            "analysis"
          );
        });

        return {
          success: false as const,
          error: String(error),
          step_metadata: {
            position: step.position,
            name: step.name,
            severity: step.severityLevel,
            is_critical: step.isCritical,
            weight: step.weight,
          },
        };
      }
    }
  );

  // Ensure all queued progress events are flushed before returning.
  await progressQueue;

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
      total_tokens: stepResults.reduce((sum, r) => {
        if (!r.success) return sum;
        return sum + (r.result.usage?.total_tokens || 0);
      }, 0),
    },
  };

  logger.info("All steps analysis completed", {
    audit_id: auditId,
    fiche_id: ficheId,
    duration_seconds: Number(elapsed.toFixed(1)),
    successful: results.statistics.successful,
    failed: results.statistics.failed,
    total_tokens: results.statistics.total_tokens,
  });

  return results;
}
