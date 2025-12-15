/**
 * Double-Check Logic for Audit Steps
 * ===================================
 * When AI says "not found", verify with more relaxed criteria
 * 
 * RATIONALE:
 * Sales agents are professionals who know their job well.
 * If AI says something is missing, it's more likely a detection issue
 * than the agent actually forgetting a critical requirement.
 * 
 * STRATEGY:
 * - First pass: Strict verification
 * - If NON_CONFORME: Second pass with relaxed criteria
 * - Compare results and use best judgment
 */

import { analyzeStep } from "./audits.analyzer.js";
import { logger } from "../../shared/logger.js";
import type { AuditStepResult } from "../../schemas.js";
import type {
  AuditConfigForAnalysis,
  AuditStepDefinition,
  ProductLinkResult,
} from "./audits.types.js";

export interface DoubleCheckOptions {
  step: AuditStepDefinition;
  auditConfig: AuditConfigForAnalysis;
  timelineText: string;
  auditId: string;
  ficheId: string;
  productInfo?: ProductLinkResult | null;
  firstPassResult: AuditStepResult;
}

export interface DoubleCheckResult {
  useDoubleCheck: boolean;
  firstPass: AuditStepResult;
  secondPass?: AuditStepResult;
  finalResult: AuditStepResult;
  reasoning: string;
}

/**
 * Determine if a step result should trigger double-check
 */
function shouldDoubleCheck(
  stepResult: AuditStepResult,
  stepDef: Pick<AuditStepDefinition, "weight" | "isCritical">
): boolean {
  // Double-check if:
  // 1. Result is NON_CONFORME or low PARTIEL score
  const isNonConforme = stepResult.conforme === "NON_CONFORME";
  const isLowPartiel =
    stepResult.conforme === "PARTIEL" && stepResult.score < stepDef.weight * 0.3;

  // 2. AND step is important (high weight or critical)
  const isImportant = stepDef.weight >= 7 || stepDef.isCritical;

  // 3. AND has few citations (< 3) - suggests AI couldn't find evidence
  const fewCitations =
    stepResult.points_controle.reduce((sum, pc) => sum + pc.citations.length, 0) < 3;

  return (isNonConforme || isLowPartiel) && isImportant && fewCitations;
}

/**
 * Create relaxed prompt for second pass
 */
function createRelaxedPrompt(stepDef: Pick<AuditStepDefinition, "customInstructions">): string {
  return `
DEUXIÈME VÉRIFICATION (CRITÈRES ASSOUPLIS):

⚠️ CONTEXTE:
La première analyse n'a trouvé que peu ou pas de preuves pour cette étape.
Cependant, les conseillers sont des professionnels formés qui connaissent leurs obligations.

🔍 INSTRUCTIONS POUR CETTE VÉRIFICATION:

1. **Recherche élargie:**
   - Accepter les formulations indirectes ou implicites
   - Considérer le contexte global de la conversation
   - Chercher des synonymes et paraphrases

2. **Exemples acceptables:**
   - Au lieu de "enregistrement", accepter "appel enregistré", "cette conversation", "cet échange"
   - Au lieu de "délai de rétractation", accepter "vous avez le droit de changer d'avis", "période de réflexion"
   - Au lieu de termes techniques exacts, accepter des explications en langage courant

3. **Bénéfice du doute:**
   - Si l'information semble être mentionnée indirectement → PARTIEL (pas NON_CONFORME)
   - Si le contexte suggère que c'était probablement dit → PARTIEL
   - Seul NON_CONFORME si absolument aucune trace après recherche approfondie

4. **Justification obligatoire:**
   - Expliquer POURQUOI vous acceptez ou refusez une formulation
   - Citer les passages pertinents même s'ils sont indirects
   - Si toujours NON_CONFORME, expliquer ce qui aurait dû être dit et pourquoi c'est vraiment absent

${stepDef.customInstructions || ""}
`;
}

/**
 * Perform double-check verification
 */
export async function doubleCheckStep(
  options: DoubleCheckOptions
): Promise<DoubleCheckResult> {
  const { step, auditConfig, timelineText, auditId, ficheId, productInfo, firstPassResult } =
    options;

  // Check if double-check is warranted
  if (!shouldDoubleCheck(firstPassResult, step)) {
    return {
      useDoubleCheck: false,
      firstPass: firstPassResult,
      finalResult: firstPassResult,
      reasoning: "First pass result is satisfactory - no double-check needed",
    };
  }

  logger.info("Double-check triggered", {
    audit_id: auditId,
    fiche_id: ficheId,
    step_name: step.name,
    first_pass: `${firstPassResult.score}/${step.weight}`,
    conforme: firstPassResult.conforme,
    citations:
      firstPassResult.points_controle.reduce(
        (sum, pc) => sum + pc.citations.length,
        0
      ),
  });

  // Create modified step with relaxed instructions
  const relaxedStep = {
    ...step,
    customInstructions: createRelaxedPrompt(step),
  };

  logger.info("Running second pass (relaxed criteria)", {
    audit_id: auditId,
    fiche_id: ficheId,
    step_name: step.name,
  });

  // Run second analysis
  const secondPassResult = await analyzeStep(
    relaxedStep,
    auditConfig,
    timelineText,
    `${auditId}-doublecheck`,
    ficheId,
    productInfo ?? null
  );

  logger.info("Second pass completed", {
    audit_id: auditId,
    fiche_id: ficheId,
    step_name: step.name,
    second_pass: `${secondPassResult.score}/${step.weight}`,
    conforme: secondPassResult.conforme,
  });

  // Decide which result to use
  let finalResult: AuditStepResult;
  let reasoning: string;

  // If second pass found more evidence, use it
  if (secondPassResult.score > firstPassResult.score) {
    finalResult = secondPassResult;
    reasoning = `Second pass found more evidence (${secondPassResult.score} vs ${firstPassResult.score}). Using relaxed verification result.`;
    logger.info("Using second pass (better score)", {
      audit_id: auditId,
      fiche_id: ficheId,
      step_name: step.name,
    });
  }
  // If scores similar but second pass has more citations
  else if (
    Math.abs(secondPassResult.score - firstPassResult.score) <= 1 &&
    secondPassResult.points_controle.reduce((sum, pc) => sum + pc.citations.length, 0) >
      firstPassResult.points_controle.reduce((sum, pc) => sum + pc.citations.length, 0)
  ) {
    finalResult = secondPassResult;
    reasoning = `Second pass provided more detailed citations. Using for better traceability.`;
    logger.info("Using second pass (more citations)", {
      audit_id: auditId,
      fiche_id: ficheId,
      step_name: step.name,
    });
  }
  // Otherwise keep first pass (stricter)
  else {
    finalResult = firstPassResult;
    reasoning = `First pass result confirmed after second verification. Requirement truly not met.`;
    logger.info("Keeping first pass (confirmed non-conformity)", {
      audit_id: auditId,
      fiche_id: ficheId,
      step_name: step.name,
    });
  }

  return {
    useDoubleCheck: true,
    firstPass: firstPassResult,
    secondPass: secondPassResult,
    finalResult,
    reasoning,
  };
}

/**
 * Enhance step analysis with automatic double-check
 */
export async function analyzeStepWithDoubleCheck(
  step: AuditStepDefinition,
  auditConfig: AuditConfigForAnalysis,
  timelineText: string,
  auditId: string,
  ficheId: string,
  productInfo: ProductLinkResult | null = null
): Promise<{ result: AuditStepResult; wasDoubleChecked: boolean; reasoning?: string }> {
  // First pass - strict verification
  logger.debug("Analyzing step (first pass - strict)", {
    audit_id: auditId,
    fiche_id: ficheId,
    step_position: step.position,
    step_name: step.name,
  });
  
  const firstPassResult = await analyzeStep(
    step,
    auditConfig,
    timelineText,
    auditId,
    ficheId,
    productInfo ?? null
  );

  // Check if double-check is needed
  const doubleCheckResult = await doubleCheckStep({
    step,
    auditConfig,
    timelineText,
    auditId,
    ficheId,
    productInfo: productInfo ?? null,
    firstPassResult,
  });

  if (doubleCheckResult.useDoubleCheck) {
    logger.info("Double-check completed", {
      audit_id: auditId,
      fiche_id: ficheId,
      step_name: step.name,
      reasoning: doubleCheckResult.reasoning,
    });
    
    return {
      result: doubleCheckResult.finalResult,
      wasDoubleChecked: true,
      reasoning: doubleCheckResult.reasoning,
    };
  }

  return {
    result: firstPassResult,
    wasDoubleChecked: false,
  };
}



