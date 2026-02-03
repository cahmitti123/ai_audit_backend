import { type Request, type Response,Router } from "express";

import { asyncHandler } from "../../middleware/async-handler.js";
import { requirePermission, requireUserAuth } from "../../middleware/authz.js";
import { getRequestAuth, isUserAuth } from "../../shared/auth-context.js";
import { ValidationError } from "../../shared/errors.js";
import { prisma } from "../../shared/prisma.js";
import {
  getPusherClient,
  isAllowedAuthChannel,
  isValidPusherChannelName,
  isValidPusherEventName,
  triggerPusher,
  usePrivatePusherChannels,
} from "../../shared/pusher.js";
import { validatePusherAuthInput, validatePusherTestInput } from "./realtime.schemas.js";

export const realtimeRouter = Router();

/**
 * Pusher auth endpoint for private/presence channels.
 *
 * IMPORTANT:
 * - This backend supports optional API auth via `API_AUTH_TOKEN(S)`, but it has no
 *   user/org membership system yet.
 * - When API auth is disabled, this endpoint only enforces channel naming rules.
 * - For real security, add auth + membership checks or proxy this endpoint through
 *   a trusted Next.js API route.
 */
realtimeRouter.post(
  "/pusher/auth",
  requireUserAuth(),
  requirePermission("realtime.auth"),
  asyncHandler(async (req: Request, res: Response) => {
    const input = validatePusherAuthInput(req.body);

    const channelCheck = isValidPusherChannelName(input.channel_name);
    if (!channelCheck.ok) {
      throw new ValidationError(channelCheck.error);
    }

    if (!isAllowedAuthChannel(input.channel_name)) {
      return res.status(403).json({
        success: false,
        error: "Channel not allowed",
      });
    }

    const pusher = getPusherClient();
    if (!pusher) {
      return res.status(503).json({
        success: false,
        error: "Pusher not configured",
      });
    }

    const userAuth = getRequestAuth(req);
    if (!isUserAuth(userAuth)) {
      // Should be unreachable due to requireUserAuth(), but keep defensive.
      throw new ValidationError("User auth required");
    }

    const isPresence = input.channel_name.startsWith("presence-");

    // Additional coarse RBAC checks by channel kind (resource-level checks can be added later).
    const has = (key: string, action: "read" | "write" = "read") => {
      const grant = userAuth.permissions.find((p) => p.key === key);
      return grant ? (action === "read" ? grant.read : grant.write) : false;
    };
    const ch = input.channel_name;
    const allowed =
      ch === "private-global" ||
      ch === "presence-global" ||
      (ch.startsWith("private-audit-") && has("audits", "read")) ||
      (ch.startsWith("private-fiche-") && has("fiches", "read")) ||
      (ch.startsWith("private-job-") && (has("automation", "read") || has("audits", "read") || has("fiches", "read"))) ||
      (ch.startsWith("presence-org-") && has("automation", "read"));

    // Resource-level scope checks for per-entity channels.
    const shouldEnforceScope = process.env.NODE_ENV !== "test";
    if (shouldEnforceScope && allowed && ch.startsWith("private-audit-")) {
      const auditKey = ch.slice("private-audit-".length).trim();
      const grant = userAuth.permissions.find((p) => p.key === "audits");
      const scope = grant?.read_scope ?? "SELF";

      if (scope !== "ALL") {
        try {
          const isDbId = /^\d+$/.test(auditKey);
          let ficheGroupe: string | null = null;
          let attributionUserId: string | null = null;

          if (isDbId) {
            const row = await prisma.audit.findUnique({
              where: { id: BigInt(auditKey) },
              select: {
                ficheCache: {
                  select: {
                    groupe: true,
                    information: { select: { groupe: true, attributionUserId: true } },
                  },
                },
              },
            });
            if (row) {
              ficheGroupe = row.ficheCache.information?.groupe ?? row.ficheCache.groupe ?? null;
              attributionUserId = row.ficheCache.information?.attributionUserId ?? null;
            }
          } else {
            // Tracking audit IDs are typically: audit-<ficheId>-<auditConfigId>-<timestamp>
            // Allow early scope checks even before the audit DB row exists, by deriving ficheId.
            const parts = auditKey.split("-");
            const derivedFicheId =
              parts.length >= 2 && parts[0] === "audit" && /^\d+$/.test(parts[1])
                ? parts[1]
                : null;

            if (derivedFicheId) {
              const ficheRow = await prisma.ficheCache.findUnique({
                where: { ficheId: derivedFicheId },
                select: {
                  groupe: true,
                  information: { select: { groupe: true, attributionUserId: true } },
                },
              });
              if (ficheRow) {
                ficheGroupe = ficheRow.information?.groupe ?? ficheRow.groupe ?? null;
                attributionUserId = ficheRow.information?.attributionUserId ?? null;
              }
            }

            // Fallback: if the audit exists, resolve scope via audit -> ficheCache.
            if (!ficheGroupe && !attributionUserId) {
              const auditRow = await prisma.audit.findFirst({
                where: {
                  resultData: {
                    path: ["audit_id"],
                    equals: auditKey,
                  },
                },
                orderBy: { createdAt: "desc" },
                select: {
                  ficheCache: {
                    select: {
                      groupe: true,
                      information: { select: { groupe: true, attributionUserId: true } },
                    },
                  },
                },
              });
              if (auditRow) {
                ficheGroupe =
                  auditRow.ficheCache.information?.groupe ?? auditRow.ficheCache.groupe ?? null;
                attributionUserId = auditRow.ficheCache.information?.attributionUserId ?? null;
              }
            }
          }

          if (!ficheGroupe && !attributionUserId) {
            return res.status(403).json({ success: false, error: "Forbidden" });
          }

          const scopeOk =
            scope === "GROUP"
              ? Boolean(ficheGroupe && userAuth.groupes.includes(ficheGroupe))
              : Boolean(
                attributionUserId &&
                  userAuth.crmUserId &&
                  attributionUserId === userAuth.crmUserId
              );

          if (!scopeOk) {
            return res.status(403).json({ success: false, error: "Forbidden" });
          }
        } catch {
          return res.status(503).json({ success: false, error: "Realtime not available" });
        }
      }
    }

    if (shouldEnforceScope && allowed && ch.startsWith("private-fiche-")) {
      const ficheId = ch.slice("private-fiche-".length).trim();
      if (!/^\d+$/.test(ficheId)) {
        return res.status(403).json({ success: false, error: "Forbidden" });
      }

      const grant = userAuth.permissions.find((p) => p.key === "fiches");
      const scope = grant?.read_scope ?? "SELF";

      if (scope !== "ALL") {
        try {
          const row = await prisma.ficheCache.findUnique({
            where: { ficheId },
            select: {
              groupe: true,
              information: { select: { groupe: true, attributionUserId: true } },
            },
          });
          if (!row) {
            return res.status(403).json({ success: false, error: "Forbidden" });
          }

          const ficheGroupe = row.information?.groupe ?? row.groupe ?? null;
          const attributionUserId = row.information?.attributionUserId ?? null;

          const scopeOk =
            scope === "GROUP"
              ? Boolean(ficheGroupe && userAuth.groupes.includes(ficheGroupe))
              : Boolean(
                  attributionUserId &&
                    userAuth.crmUserId &&
                    attributionUserId === userAuth.crmUserId
                );

          if (!scopeOk) {
            return res.status(403).json({ success: false, error: "Forbidden" });
          }
        } catch {
          return res.status(503).json({ success: false, error: "Realtime not available" });
        }
      }
    }

    if (!allowed) {
      return res.status(403).json({
        success: false,
        error: "Forbidden",
      });
    }

    // Pusher expects the raw auth response (not wrapped in {success:true}).
    const pusherAuth = pusher.authorizeChannel(
      input.socket_id,
      input.channel_name,
      isPresence
        ? {
            user_id: userAuth.userId,
            user_info: {
              ...(input.user_info || {}),
              email: userAuth.email,
              roles: userAuth.roles,
            },
          }
        : undefined
    );

    return res.json(pusherAuth);
  })
);

/**
 * Pusher test endpoint - publishes a simple event so the frontend can validate setup quickly.
 */
realtimeRouter.post(
  "/pusher/test",
  asyncHandler(async (req: Request, res: Response) => {
    const input = validatePusherTestInput(req.body);

    const channel =
      input.channel ||
      (usePrivatePusherChannels() ? "private-realtime-test" : "realtime-test");
    const event = input.event || "realtime.test";
    const payload =
      input.payload ?? { message: "hello from backend", ts: new Date().toISOString() };

    const channelCheck = isValidPusherChannelName(channel);
    if (!channelCheck.ok) {throw new ValidationError(channelCheck.error);}

    const eventCheck = isValidPusherEventName(event);
    if (!eventCheck.ok) {throw new ValidationError(eventCheck.error);}

    const result = await triggerPusher({ channels: [channel], event, payload });
    if (!result.ok) {
      return res.status(500).json({ success: false, error: result.error });
    }

    return res.json({
      success: true,
      channel,
      event,
      payload,
    });
  })
);


