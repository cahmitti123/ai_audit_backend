/**
 * Inngest Functions Aggregator
 * =============================
 * Collects all workflow functions from domain modules
 */

import { auditsFunctions } from "../modules/audits/index.js";
import { automationFunctions } from "../modules/automation/index.js";
import { fichesFunctions } from "../modules/fiches/index.js";
import { transcriptionsFunctions } from "../modules/transcriptions/index.js";

export const functions = [
  ...fichesFunctions,
  ...transcriptionsFunctions,
  ...auditsFunctions,
  ...automationFunctions,
];
