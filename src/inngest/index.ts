/**
 * Inngest Functions Aggregator
 * =============================
 * Collects all workflow functions from domain modules
 */

import { fichesFunctions } from "../modules/fiches/index.js";
import { transcriptionsFunctions } from "../modules/transcriptions/index.js";
import { auditsFunctions } from "../modules/audits/index.js";

export const functions = [
  ...fichesFunctions,
  ...transcriptionsFunctions,
  ...auditsFunctions,
];
