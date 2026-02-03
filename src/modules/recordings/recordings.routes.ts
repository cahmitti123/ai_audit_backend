/**
 * Recordings Routes
 * =================
 * API endpoints for recording operations
 */

import type { Request, Response } from "express";
import { Router } from "express";

import { asyncHandler } from "../../middleware/async-handler.js";
import { requirePermission } from "../../middleware/authz.js";
import { getRequestAuth, isUserAuth } from "../../shared/auth-context.js";
import { jsonResponse } from "../../shared/bigint-serializer.js";
import { AuthorizationError } from "../../shared/errors.js";
import { prisma } from "../../shared/prisma.js";

export const recordingsRouter = Router();

type Scope = "ALL" | "GROUP" | "SELF";
type ScopeContext = { scope: Scope; groupes: string[]; crmUserId: string | null };

function getRecordingsScope(req: Request): ScopeContext {
  const auth = getRequestAuth(req);
  if (!auth || auth.kind === "apiToken") {
    return { scope: "ALL", groupes: [], crmUserId: null };
  }
  if (!isUserAuth(auth)) {
    return { scope: "SELF", groupes: [], crmUserId: null };
  }
  const grant = auth.permissions.find((p) => p.key === "recordings");
  const scope = grant?.read_scope ?? "SELF";
  return {
    scope,
    groupes: Array.isArray(auth.groupes) ? auth.groupes : [],
    crmUserId: auth.crmUserId ?? null,
  };
}

async function assertFicheVisible(req: Request, ficheId: string): Promise<void> {
  const scope = getRecordingsScope(req);
  if (scope.scope === "ALL") {return;}

  const row = await prisma.ficheCache.findUnique({
    where: { ficheId },
    select: {
      groupe: true,
      information: { select: { groupe: true, attributionUserId: true } },
    },
  });
  if (!row) {throw new AuthorizationError("Forbidden");}

  const ficheGroupe = row.information?.groupe ?? row.groupe ?? null;
  const attributionUserId = row.information?.attributionUserId ?? null;
  const allowed =
    scope.scope === "GROUP"
      ? Boolean(ficheGroupe && scope.groupes.includes(ficheGroupe))
      : Boolean(attributionUserId && scope.crmUserId && attributionUserId === scope.crmUserId);

  if (!allowed) {
    throw new AuthorizationError("Forbidden");
  }
}

/**
 * @swagger
 * /api/recordings/{fiche_id}:
 *   get:
 *     tags: [Recordings]
 *     summary: Get all recordings for a fiche
 *     description: Returns all audio recordings associated with a specific fiche
 *     parameters:
 *       - in: path
 *         name: fiche_id
 *         required: true
 *         schema:
 *           type: string
 *         description: The fiche ID to get recordings for
 *     responses:
 *       200:
 *         description: List of recordings with metadata
 *       500:
 *         description: Server error
 */
recordingsRouter.get(
  "/:fiche_id",
  requirePermission("recordings.read"),
  asyncHandler(async (req: Request, res: Response) => {
    await assertFicheVisible(req, req.params.fiche_id);
    const { getRecordingsByFiche } = await import("./recordings.repository.js");
    const recordings = await getRecordingsByFiche(req.params.fiche_id);
    return jsonResponse(res, {
      success: true,
      data: recordings,
      count: recordings.length,
    });
  })
);
