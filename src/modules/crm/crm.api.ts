/**
 * CRM API Client (Gateway)
 * =======================
 * Fetches CRM users + teams (groupes) from the gateway.
 */

import axios from "axios";

import { logger } from "../../shared/logger.js";
import { validateCrmGroupsResponse, validateCrmUsersResponse } from "./crm.schemas.js";

const baseUrl =
  process.env.FICHE_API_BASE_URL ||
  process.env.FICHE_API_URL ||
  "https://api.devis-mutuelle-pas-cher.com";
const apiBase = `${baseUrl}/api`;

function getAuthHeaders(): Record<string, string> {
  const token = (process.env.FICHE_API_AUTH_TOKEN || "").trim();
  if (!token) {return {};}
  const value = token.toLowerCase().startsWith("bearer ") ? token : `Bearer ${token}`;
  return { Authorization: value };
}

export async function fetchCrmUsers(): Promise<ReturnType<typeof validateCrmUsersResponse>["data"]["utilisateurs"]> {
  logger.info("Fetching CRM utilisateurs");

  const response = await axios.get(`${apiBase}/utilisateurs`, {
    timeout: 60_000,
    headers: getAuthHeaders(),
  });

  const validated = validateCrmUsersResponse(response.data);
  return validated.data.utilisateurs;
}

export async function fetchCrmGroups(params?: {
  includeUsers?: boolean;
}): Promise<ReturnType<typeof validateCrmGroupsResponse>["data"]["groupes"]> {
  const includeUsers = Boolean(params?.includeUsers);
  logger.info("Fetching CRM groupes", { includeUsers });

  const response = await axios.get(
    `${apiBase}/utilisateurs/groupes?include_users=${includeUsers ? "true" : "false"}`,
    {
      timeout: 60_000,
      headers: getAuthHeaders(),
    },
  );

  const validated = validateCrmGroupsResponse(response.data);
  return validated.data.groupes;
}

