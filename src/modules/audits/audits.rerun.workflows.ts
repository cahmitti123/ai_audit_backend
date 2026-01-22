/**
 * Audit Step Re-Run Workflows
 * ============================
 * Inngest function for async step re-analysis
 */

import { inngest } from "../../inngest/client.js";
import { auditWebhooks } from "../../shared/webhook.js";
import {
  rerunAuditStepControlPoint,
  saveControlPointRerunResult,
} from "./audits.control-point.rerun.js";
import { rerunAuditStep, saveRerunResult } from "./audits.rerun.js";

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

    const rerunId = `rerun-${audit_id}-${step_position}-${event.id}`;

    logger.info("Starting step re-run", {
      audit_id,
      step_position,
      has_custom_prompt: Boolean(custom_prompt),
    });

    // Send started webhook
    await step.run("send-rerun-started", async () => {
      await auditWebhooks.stepRerunStarted(
        rerunId,
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

    // Persist rerun result into the stored audit so the UI sees the updated step on fetch.
    await step.run("persist-rerun", async () => {
      return await saveRerunResult(
        {
          auditId: BigInt(audit_id),
          stepPosition: step_position,
          customPrompt: custom_prompt,
        },
        result,
        true,
        { rerunId, eventId: event.id }
      );
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
        rerunId,
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
        original_score: result.comparison.originalScore ?? 0,
        new_score: result.comparison.newScore ?? 0,
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

export const rerunAuditStepControlPointFunction = inngest.createFunction(
  {
    id: "rerun-audit-step-control-point",
    name: "Re-Run Audit Step Control Point",
    retries: 1,
    timeouts: {
      finish: "10m",
    },
  },
  { event: "audit/step-control-point-rerun" },
  async ({ event, step, logger }) => {
    const { audit_id, step_position, control_point_index, custom_prompt } =
      event.data as typeof event.data & {
        control_point_index: number;
      };

    const rerunId = `rerun-${audit_id}-${step_position}-cp-${control_point_index}-${event.id}`;

    logger.info("Starting control point re-run", {
      audit_id,
      step_position,
      control_point_index,
      has_custom_prompt: Boolean(custom_prompt),
    });

    await step.run("send-rerun-started", async () => {
      await auditWebhooks.stepControlPointRerunStarted(
        rerunId,
        audit_id,
        step_position,
        control_point_index
      );
      return { notified: true };
    });

    const result = await step.run("execute-rerun", async () => {
      return await rerunAuditStepControlPoint({
        auditId: BigInt(audit_id),
        stepPosition: step_position,
        controlPointIndex: control_point_index,
        customPrompt: custom_prompt,
      });
    });

    // Persist rerun result into the stored audit (updates rawResult + step score/conforme deterministically).
    await step.run("persist-control-point-rerun", async () => {
      return await saveControlPointRerunResult(
        {
          auditId: BigInt(audit_id),
          stepPosition: step_position,
          controlPointIndex: control_point_index,
          customPrompt: custom_prompt,
        },
        result,
        true,
        { rerunId, eventId: event.id }
      );
    });

    logger.info("Control point re-run completed", {
      audit_id,
      step_position,
      control_point_index,
      statut_changed: result.comparison.statutChanged,
      original_statut: result.comparison.originalStatut,
      new_statut: result.comparison.newStatut,
    });

    await step.run("send-rerun-completed", async () => {
      await auditWebhooks.stepControlPointRerunCompleted(
        rerunId,
        audit_id,
        step_position,
        control_point_index,
        result.originalControlPoint,
        result.rerunControlPoint,
        result.comparison
      );
      return { notified: true };
    });

    await step.sendEvent("emit-control-point-rerun-completion", {
      name: "audit/step-control-point-rerun-completed",
      data: {
        audit_id,
        step_position,
        control_point_index,
        statut_changed: result.comparison.statutChanged,
        citations_changed: result.comparison.citationsChanged,
      },
    });

    return {
      success: true,
      audit_id,
      step_position,
      control_point_index,
      comparison: result.comparison,
      metadata: result.metadata,
    };
  }
);

export const functions = [rerunAuditStepFunction, rerunAuditStepControlPointFunction];


