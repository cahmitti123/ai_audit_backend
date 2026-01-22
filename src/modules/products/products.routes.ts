/**
 * Products Routes
 * ===============
 * API endpoints for insurance products
 */

import { type Request, type Response,Router } from "express";

import { asyncHandler } from "../../middleware/async-handler.js";
import { ValidationError } from "../../shared/errors.js";
import { ok } from "../../shared/http.js";
import {
  createFormuleSchema,
  createGammeSchema,
  createGroupeSchema,
  productsQuerySchema,
  updateFormuleSchema,
  updateGammeSchema,
  updateGroupeSchema,
} from "./products.schemas.js";
import * as productsService from "./products.service.js";

export const productsRouter = Router();

function parseBigIntParam(value: string, name = "id"): bigint {
  try {
    return BigInt(value);
  } catch {
    throw new ValidationError(`Invalid ${name}`);
  }
}

// ============================================
// Stats & Search Endpoints
// ============================================

/**
 * @swagger
 * /api/products/stats:
 *   get:
 *     summary: Get products statistics
 *     tags: [Products]
 *     responses:
 *       200:
 *         description: Statistics about insurance products
 */
productsRouter.get(
  "/stats",
  asyncHandler(async (_req: Request, res: Response) => {
    const stats = await productsService.getStats();
    return ok(res, stats);
  })
);

/**
 * @swagger
 * /api/products/link-fiche/{ficheId}:
 *   get:
 *     summary: Link a fiche (sale) to its product formule
 *     tags: [Products]
 *     parameters:
 *       - in: path
 *         name: ficheId
 *         required: true
 *         schema:
 *           type: string
 *         description: Fiche ID to link with product
 *     responses:
 *       200:
 *         description: Matched product formule with complete details
 *       404:
 *         description: Fiche not found or no matching product
 */
productsRouter.get(
  "/link-fiche/:ficheId",
  asyncHandler(async (req: Request, res: Response) => {
    const { ficheId } = req.params;
    const result = await productsService.linkFicheToProduct(ficheId);
    return ok(res, result);
  })
);

/**
 * @swagger
 * /api/products/search:
 *   get:
 *     summary: Search across all product types
 *     tags: [Products]
 *     parameters:
 *       - in: query
 *         name: q
 *         required: true
 *         schema:
 *           type: string
 *         description: Search query (minimum 2 characters)
 *     responses:
 *       200:
 *         description: Search results across groupes, gammes, and formules
 */
productsRouter.get(
  "/search",
  asyncHandler(async (req: Request, res: Response) => {
    const q = req.query.q;
    if (typeof q !== "string" || q.trim().length === 0) {
      throw new ValidationError("Query parameter 'q' is required");
    }

    const results = await productsService.searchProducts(q);
    return ok(res, results);
  })
);

// ============================================
// Groupes Endpoints
// ============================================

/**
 * @swagger
 * /api/products/groupes:
 *   get:
 *     summary: List all insurance groups
 *     tags: [Products]
 *     responses:
 *       200:
 *         description: List of insurance groups
 */
productsRouter.get(
  "/groupes",
  asyncHandler(async (_req: Request, res: Response) => {
    const groupes = await productsService.listGroupes();
    return ok(res, groupes);
  })
);

/**
 * @swagger
 * /api/products/groupes/{id}:
 *   get:
 *     summary: Get groupe details with gammes
 *     tags: [Products]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Groupe details with gammes
 */
productsRouter.get(
  "/groupes/:id",
  asyncHandler(async (req: Request, res: Response) => {
    const id = parseBigIntParam(req.params.id, "groupe id");
    const groupe = await productsService.getGroupeDetails(id);
    return ok(res, groupe);
  })
);

/**
 * @swagger
 * /api/products/groupes:
 *   post:
 *     summary: Create a new groupe
 *     tags: [Products]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               code:
 *                 type: string
 *               libelle:
 *                 type: string
 *     responses:
 *       201:
 *         description: Groupe created successfully
 */
productsRouter.post(
  "/groupes",
  asyncHandler(async (req: Request, res: Response) => {
    const validated = createGroupeSchema.parse(req.body);
    const groupe = await productsService.createGroupe(validated);
    return ok(res, groupe, 201);
  })
);

/**
 * @swagger
 * /api/products/groupes/{id}:
 *   put:
 *     summary: Update a groupe
 *     tags: [Products]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *     responses:
 *       200:
 *         description: Groupe updated successfully
 */
productsRouter.put(
  "/groupes/:id",
  asyncHandler(async (req: Request, res: Response) => {
    const id = parseBigIntParam(req.params.id, "groupe id");
    const validated = updateGroupeSchema.parse(req.body);
    const groupe = await productsService.updateGroupe(id, validated);
    return ok(res, groupe);
  })
);

/**
 * @swagger
 * /api/products/groupes/{id}:
 *   delete:
 *     summary: Delete a groupe
 *     tags: [Products]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Groupe deleted successfully
 */
productsRouter.delete(
  "/groupes/:id",
  asyncHandler(async (req: Request, res: Response) => {
    const id = parseBigIntParam(req.params.id, "groupe id");
    await productsService.deleteGroupe(id);
    return ok(res, { message: "Groupe deleted successfully" });
  })
);

// ============================================
// Gammes Endpoints
// ============================================

/**
 * @swagger
 * /api/products/gammes:
 *   get:
 *     summary: List gammes with pagination
 *     tags: [Products]
 *     parameters:
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *       - in: query
 *         name: groupeId
 *         schema:
 *           type: string
 *       - in: query
 *         name: search
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Paginated list of gammes
 */
productsRouter.get(
  "/gammes",
  asyncHandler(async (req: Request, res: Response) => {
    const query = productsQuerySchema.parse(req.query);
    const result = await productsService.listGammes({
      groupeId: query.groupeId,
      page: query.page,
      limit: query.limit,
      search: query.search,
    });
    return ok(res, result);
  })
);

/**
 * @swagger
 * /api/products/gammes/{id}:
 *   get:
 *     summary: Get gamme details with formules
 *     tags: [Products]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Gamme details with formules
 */
productsRouter.get(
  "/gammes/:id",
  asyncHandler(async (req: Request, res: Response) => {
    const id = parseBigIntParam(req.params.id, "gamme id");
    const gamme = await productsService.getGammeDetails(id);
    return ok(res, gamme);
  })
);

/**
 * @swagger
 * /api/products/gammes:
 *   post:
 *     summary: Create a new gamme
 *     tags: [Products]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *     responses:
 *       201:
 *         description: Gamme created successfully
 */
productsRouter.post(
  "/gammes",
  asyncHandler(async (req: Request, res: Response) => {
    const validated = createGammeSchema.parse(req.body);
    const gamme = await productsService.createGamme(validated);
    return ok(res, gamme, 201);
  })
);

/**
 * @swagger
 * /api/products/gammes/{id}:
 *   put:
 *     summary: Update a gamme
 *     tags: [Products]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Gamme updated successfully
 */
productsRouter.put(
  "/gammes/:id",
  asyncHandler(async (req: Request, res: Response) => {
    const id = parseBigIntParam(req.params.id, "gamme id");
    const validated = updateGammeSchema.parse(req.body);
    const gamme = await productsService.updateGamme(id, validated);
    return ok(res, gamme);
  })
);

/**
 * @swagger
 * /api/products/gammes/{id}:
 *   delete:
 *     summary: Delete a gamme
 *     tags: [Products]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Gamme deleted successfully
 */
productsRouter.delete(
  "/gammes/:id",
  asyncHandler(async (req: Request, res: Response) => {
    const id = parseBigIntParam(req.params.id, "gamme id");
    await productsService.deleteGamme(id);
    return ok(res, { message: "Gamme deleted successfully" });
  })
);

// ============================================
// Formules Endpoints
// ============================================

/**
 * @swagger
 * /api/products/formules:
 *   get:
 *     summary: List formules with pagination
 *     tags: [Products]
 *     parameters:
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *       - in: query
 *         name: gammeId
 *         schema:
 *           type: string
 *       - in: query
 *         name: search
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Paginated list of formules
 */
productsRouter.get(
  "/formules",
  asyncHandler(async (req: Request, res: Response) => {
    const query = productsQuerySchema.parse(req.query);
    const result = await productsService.listFormules({
      gammeId: query.gammeId,
      page: query.page,
      limit: query.limit,
      search: query.search,
    });
    return ok(res, result);
  })
);

/**
 * @swagger
 * /api/products/formules/{id}:
 *   get:
 *     summary: Get formule details with guarantees
 *     tags: [Products]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Formule details with guarantees
 */
productsRouter.get(
  "/formules/:id",
  asyncHandler(async (req: Request, res: Response) => {
    const id = parseBigIntParam(req.params.id, "formule id");
    const formule = await productsService.getFormuleDetails(id);
    return ok(res, formule);
  })
);

/**
 * @swagger
 * /api/products/formules:
 *   post:
 *     summary: Create a new formule
 *     tags: [Products]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *     responses:
 *       201:
 *         description: Formule created successfully
 */
productsRouter.post(
  "/formules",
  asyncHandler(async (req: Request, res: Response) => {
    const validated = createFormuleSchema.parse(req.body);
    const formule = await productsService.createFormule(validated);
    return ok(res, formule, 201);
  })
);

/**
 * @swagger
 * /api/products/formules/{id}:
 *   put:
 *     summary: Update a formule
 *     tags: [Products]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Formule updated successfully
 */
productsRouter.put(
  "/formules/:id",
  asyncHandler(async (req: Request, res: Response) => {
    const id = parseBigIntParam(req.params.id, "formule id");
    const validated = updateFormuleSchema.parse(req.body);
    const formule = await productsService.updateFormule(id, validated);
    return ok(res, formule);
  })
);

/**
 * @swagger
 * /api/products/formules/{id}:
 *   delete:
 *     summary: Delete a formule
 *     tags: [Products]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Formule deleted successfully
 */
productsRouter.delete(
  "/formules/:id",
  asyncHandler(async (req: Request, res: Response) => {
    const id = parseBigIntParam(req.params.id, "formule id");
    await productsService.deleteFormule(id);
    return ok(res, { message: "Formule deleted successfully" });
  })
);

