/**
 * Audit Configs Events
 * ====================
 * Event type definitions for audit config operations
 * Used for observability, logging, and potential event-driven workflows
 */

import type {
  AuditConfig,
  AuditConfigDetail,
  AuditStep,
} from "./audit-configs.schemas.js";

/**
 * Event types emitted by audit config operations
 */
export type AuditConfigsEvents = {
  // Config Events
  "auditConfig:created": {
    auditConfig: { id: string; name: string };
    stepsCount: number;
    createdBy?: string;
  };

  "auditConfig:updated": {
    auditConfig: { id: string; name: string };
    changes: Partial<AuditConfig>;
  };

  "auditConfig:deleted": {
    auditConfigId: string;
    name: string;
  };

  "auditConfig:activated": {
    auditConfigId: string;
    name: string;
  };

  "auditConfig:deactivated": {
    auditConfigId: string;
    name: string;
  };

  // Step Events
  "auditStep:created": {
    auditConfigId: string;
    step: { id: string; name: string; position: number };
  };

  "auditStep:updated": {
    stepId: string;
    auditConfigId: string;
    changes: Partial<AuditStep>;
  };

  "auditStep:deleted": {
    stepId: string;
    auditConfigId: string;
    stepName: string;
  };

  "auditSteps:reordered": {
    auditConfigId: string;
    stepCount: number;
  };

  // Usage Events
  "auditConfig:used": {
    auditConfigId: string;
    auditId: string;
    ficheId: string;
  };

  "auditConfig:validated": {
    auditConfigId: string;
    valid: boolean;
    errors?: string[];
  };
};

/**
 * Type helper for event names
 */
export type AuditConfigEventName = keyof AuditConfigsEvents;

/**
 * Type helper for event payloads
 */
export type AuditConfigEventPayload<T extends AuditConfigEventName> =
  AuditConfigsEvents[T];

