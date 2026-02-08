/**
 * CRM API Client (Gateway)
 * =======================
 * Fetches CRM users + teams (groupes) from the gateway.
 */

import axios from "axios";

import { gateway } from "../../shared/gateway-client.js";
import { logger } from "../../shared/logger.js";
import { validateCrmGroupsResponse, validateCrmUsersResponse } from "./crm.schemas.js";

export async function fetchCrmUsers(): Promise<ReturnType<typeof validateCrmUsersResponse>["data"]["utilisateurs"]> {
  logger.info("Fetching CRM utilisateurs");

  const response = await axios.get(gateway.url("/utilisateurs"), {
    timeout: 60_000,
    headers: gateway.authHeaders(),
  });

  const validated = validateCrmUsersResponse(response.data);
  return validated.data.utilisateurs;
}

export async function fetchCrmGroups(params?: {
  includeUsers?: boolean;
}): Promise<ReturnType<typeof validateCrmGroupsResponse>["data"]["groupes"]> {
  const includeUsers = Boolean(params?.includeUsers);
  logger.info("Fetching CRM groupes", { includeUsers });

  const qs = new URLSearchParams({ include_users: includeUsers ? "true" : "false" });
  const response = await axios.get(gateway.url("/utilisateurs/groupes", qs), {
    timeout: 60_000,
    headers: gateway.authHeaders(),
  });

  const validated = validateCrmGroupsResponse(response.data);
  return validated.data.groupes;
}

