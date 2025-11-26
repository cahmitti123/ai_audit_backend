/**
 * Audit Step Re-Run Workflows
 * ============================
 * Inngest function for async step re-analysis
 */

import { inngest } from "../../inngest/client.js";
import { rerunAuditStep } from "./audits.rerun.js";
import { auditWebhooks } from "../../shared/webhook.js";

export const rerunAuditStepFunction = inngest.createFunction(
  {
    id: "rerun-audit-step",
    name: "Re-Run Audit Step",
    retries: 1,
    timeouts: {
      finish: "10m",
    },
  },
  { event: "audit/step-rerun" },
  async ({ event, step, logger }) => {
    const { audit_id, step_position, custom_prompt } = event.data;

    logger.info("Starting step re-run", {
      audit_id,
      step_position,
      has_custom_prompt: Boolean(custom_prompt),
    });

    // Send started webhook
    await step.run("send-rerun-started", async () => {
      await auditWebhooks.stepRerunStarted(
        `rerun-${audit_id}-${step_position}`,
        audit_id,
        step_position
      );
      return { notified: true };
    });

    // Execute re-run
    const result = await step.run("execute-rerun", async () => {
      return await rerunAuditStep({
        auditId: BigInt(audit_id),
        stepPosition: step_position,
        customPrompt: custom_prompt,
      });
    });

    logger.info("Step re-run completed", {
      audit_id,
      step_position,
      score_changed: result.comparison.scoreChanged,
      original_score: result.comparison.originalScore,
      new_score: result.comparison.newScore,
    });

    // Send completion webhook
    await step.run("send-rerun-completed", async () => {
      await auditWebhooks.stepRerunCompleted(
        `rerun-${audit_id}-${step_position}`,
        audit_id,
        step_position,
        result.originalStep,
        result.rerunStep,
        result.comparison
      );
      return { notified: true };
    });

    // Send event
    await step.sendEvent("emit-rerun-completion", {
      name: "audit/step-rerun-completed",
      data: {
        audit_id,
        step_position,
        original_score: result.comparison.originalScore,
        new_score: result.comparison.newScore,
        score_changed: result.comparison.scoreChanged,
        conforme_changed: result.comparison.conformeChanged,
      },
    });

    return {
      success: true,
      audit_id,
      step_position,
      comparison: result.comparison,
      metadata: result.metadata,
    };
  }
);

export const functions = [rerunAuditStepFunction];


