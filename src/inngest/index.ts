/**
 * Inngest Functions Aggregator
 * =============================
 * Collects all workflow functions from domain modules
 */

import { fichesFunctions } from "../modules/fiches/index.js";
import { transcriptionsFunctions } from "../modules/transcriptions/index.js";
import { auditsFunctions } from "../modules/audits/index.js";
import { functions as automationFunctions } from "../modules/automation/index.js";

export const functions = [
  ...fichesFunctions,
  ...transcriptionsFunctions,
  ...auditsFunctions,
  ...automationFunctions,
];
