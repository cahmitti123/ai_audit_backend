/**
 * Products Routes
 * ===============
 * API endpoints for insurance products
 */

import { Router, type Request, type Response } from "express";
import * as productsService from "./products.service.js";
import {
  createGroupeSchema,
  updateGroupeSchema,
  createGammeSchema,
  updateGammeSchema,
  createFormuleSchema,
  updateFormuleSchema,
  productsQuerySchema,
} from "./products.schemas.js";
import { logger } from "../../shared/logger.js";
import { serializeBigInt } from "../../shared/bigint-serializer.js";

export const productsRouter = Router();

// Helper for consistent JSON responses with BigInt serialization
function jsonResponse(res: Response, data: any, statusCode = 200) {
  const serialized = serializeBigInt(data);
  return res.status(statusCode).json({
    success: true,
    data: serialized,
  });
}

function errorResponse(res: Response, error: any, statusCode = 500) {
  logger.error("Products API error", { error: error.message });
  return res.status(statusCode).json({
    success: false,
    error: error.message || "Internal server error",
  });
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
productsRouter.get("/stats", async (req: Request, res: Response) => {
  try {
    const stats = await productsService.getStats();
    return jsonResponse(res, stats);
  } catch (error) {
    return errorResponse(res, error);
  }
});

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
productsRouter.get("/link-fiche/:ficheId", async (req: Request, res: Response) => {
  try {
    const { ficheId } = req.params;
    const result = await productsService.linkFicheToProduct(ficheId);
    return jsonResponse(res, result);
  } catch (error) {
    return errorResponse(res, error, 404);
  }
});

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
productsRouter.get("/search", async (req: Request, res: Response) => {
  try {
    const { q } = req.query;
    if (!q || typeof q !== "string") {
      return errorResponse(res, new Error("Query parameter 'q' is required"), 400);
    }

    const results = await productsService.searchProducts(q);
    return jsonResponse(res, results);
  } catch (error) {
    return errorResponse(res, error, 400);
  }
});

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
productsRouter.get("/groupes", async (req: Request, res: Response) => {
  try {
    const groupes = await productsService.listGroupes();
    return jsonResponse(res, groupes);
  } catch (error) {
    return errorResponse(res, error);
  }
});

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
productsRouter.get("/groupes/:id", async (req: Request, res: Response) => {
  try {
    const id = BigInt(req.params.id);
    const groupe = await productsService.getGroupeDetails(id);
    return jsonResponse(res, groupe);
  } catch (error) {
    return errorResponse(res, error, 404);
  }
});

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
productsRouter.post("/groupes", async (req: Request, res: Response) => {
  try {
    const validated = createGroupeSchema.parse(req.body);
    const groupe = await productsService.createGroupe(validated);
    return jsonResponse(res, groupe, 201);
  } catch (error) {
    return errorResponse(res, error, 400);
  }
});

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
productsRouter.put("/groupes/:id", async (req: Request, res: Response) => {
  try {
    const id = BigInt(req.params.id);
    const validated = updateGroupeSchema.parse(req.body);
    const groupe = await productsService.updateGroupe(id, validated);
    return jsonResponse(res, groupe);
  } catch (error) {
    return errorResponse(res, error, 400);
  }
});

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
productsRouter.delete("/groupes/:id", async (req: Request, res: Response) => {
  try {
    const id = BigInt(req.params.id);
    await productsService.deleteGroupe(id);
    return jsonResponse(res, { message: "Groupe deleted successfully" });
  } catch (error) {
    return errorResponse(res, error, 404);
  }
});

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
productsRouter.get("/gammes", async (req: Request, res: Response) => {
  try {
    const query = productsQuerySchema.parse(req.query);
    const result = await productsService.listGammes({
      groupeId: query.groupeId,
      page: query.page,
      limit: query.limit,
      search: query.search,
    });
    return jsonResponse(res, result);
  } catch (error) {
    return errorResponse(res, error, 400);
  }
});

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
productsRouter.get("/gammes/:id", async (req: Request, res: Response) => {
  try {
    const id = BigInt(req.params.id);
    const gamme = await productsService.getGammeDetails(id);
    return jsonResponse(res, gamme);
  } catch (error) {
    return errorResponse(res, error, 404);
  }
});

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
productsRouter.post("/gammes", async (req: Request, res: Response) => {
  try {
    const validated = createGammeSchema.parse(req.body);
    const gamme = await productsService.createGamme(validated);
    return jsonResponse(res, gamme, 201);
  } catch (error) {
    return errorResponse(res, error, 400);
  }
});

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
productsRouter.put("/gammes/:id", async (req: Request, res: Response) => {
  try {
    const id = BigInt(req.params.id);
    const validated = updateGammeSchema.parse(req.body);
    const gamme = await productsService.updateGamme(id, validated);
    return jsonResponse(res, gamme);
  } catch (error) {
    return errorResponse(res, error, 400);
  }
});

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
productsRouter.delete("/gammes/:id", async (req: Request, res: Response) => {
  try {
    const id = BigInt(req.params.id);
    await productsService.deleteGamme(id);
    return jsonResponse(res, { message: "Gamme deleted successfully" });
  } catch (error) {
    return errorResponse(res, error, 404);
  }
});

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
productsRouter.get("/formules", async (req: Request, res: Response) => {
  try {
    const query = productsQuerySchema.parse(req.query);
    const result = await productsService.listFormules({
      gammeId: query.gammeId,
      page: query.page,
      limit: query.limit,
      search: query.search,
    });
    return jsonResponse(res, result);
  } catch (error) {
    return errorResponse(res, error, 400);
  }
});

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
productsRouter.get("/formules/:id", async (req: Request, res: Response) => {
  try {
    const id = BigInt(req.params.id);
    const formule = await productsService.getFormuleDetails(id);
    return jsonResponse(res, formule);
  } catch (error) {
    return errorResponse(res, error, 404);
  }
});

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
productsRouter.post("/formules", async (req: Request, res: Response) => {
  try {
    const validated = createFormuleSchema.parse(req.body);
    const formule = await productsService.createFormule(validated);
    return jsonResponse(res, formule, 201);
  } catch (error) {
    return errorResponse(res, error, 400);
  }
});

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
productsRouter.put("/formules/:id", async (req: Request, res: Response) => {
  try {
    const id = BigInt(req.params.id);
    const validated = updateFormuleSchema.parse(req.body);
    const formule = await productsService.updateFormule(id, validated);
    return jsonResponse(res, formule);
  } catch (error) {
    return errorResponse(res, error, 400);
  }
});

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
productsRouter.delete("/formules/:id", async (req: Request, res: Response) => {
  try {
    const id = BigInt(req.params.id);
    await productsService.deleteFormule(id);
    return jsonResponse(res, { message: "Formule deleted successfully" });
  } catch (error) {
    return errorResponse(res, error, 404);
  }
});

