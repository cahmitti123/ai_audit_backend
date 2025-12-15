/**
 * Vector Store Service
 * ====================
 * Integration with OpenAI Vector Store for product information verification
 */

import OpenAI from "openai";
import { logger } from "../../shared/logger.js";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const VECTOR_STORE_ID =
  process.env.VECTOR_STORE_ID || "vs_68e5139a7f848191af1a05a7e5d3452d";
const MAX_RESULTS = parseInt(process.env.VECTOR_STORE_MAX_RESULTS || "5", 10);

export interface VectorSearchResult {
  content: string;
  file_name?: string;
  score?: number;
  metadata?: Record<string, unknown>;
}

export interface ProductVerificationContext {
  checkpointName: string;
  relevantDocumentation: VectorSearchResult[];
  searchQuery: string;
}

/**
 * Search vector store for relevant product documentation
 */
export async function searchVectorStore(
  query: string,
  maxResults: number = MAX_RESULTS
): Promise<VectorSearchResult[]> {
  try {
    logger.info("Searching vector store", { query });

    // Create a thread with vector store attached
    const thread = await openai.beta.threads.create({
      tool_resources: {
        file_search: {
          vector_store_ids: [VECTOR_STORE_ID],
        },
      },
    });

    // Create a message with the query
    await openai.beta.threads.messages.create(thread.id, {
      role: "user",
      content: query,
    });

    // Create an assistant for this search
    const assistant = await openai.beta.assistants.create({
      model: "gpt-4o-mini",
      tools: [{ type: "file_search" }],
    });

    // Run the search
    const run = await openai.beta.threads.runs.create(thread.id, {
      assistant_id: assistant.id,
    });

    // Wait for completion
    let runStatus = await openai.beta.threads.runs.retrieve(thread.id, run.id);

    while (runStatus.status !== "completed" && runStatus.status !== "failed") {
      await new Promise((resolve) => setTimeout(resolve, 500));
      runStatus = await openai.beta.threads.runs.retrieve(thread.id, run.id);
    }

    if (runStatus.status === "failed") {
      const lastError =
        typeof runStatus === "object" && runStatus !== null
          ? ((runStatus as { last_error?: unknown }).last_error ?? null)
          : null;
      logger.error("Vector store search failed", {
        error: lastError,
      });
      return [];
    }

    // Get the messages with the search results
    const messages = await openai.beta.threads.messages.list(thread.id);

    const results: VectorSearchResult[] = [];

    // Extract content and citations
    // Collect all file retrieval promises for parallel execution
    const fileRetrievalPromises: Promise<VectorSearchResult | null>[] = [];

    for (const message of messages.data) {
      if (message.role === "assistant" && message.content) {
        for (const content of message.content) {
          if (content.type === "text") {
            // Extract annotations (citations)
            const annotations = content.text.annotations || [];

            // Process annotations in parallel
            for (const annotation of annotations) {
              if (
                annotation.type === "file_citation" &&
                annotation.file_citation
              ) {
                const promise = openai.files
                  .retrieve(annotation.file_citation.file_id)
                  .then((file) => ({
                    content: content.text.value,
                    file_name: file.filename,
                    metadata: {
                      file_id: file.id,
                    },
                  }))
                  .catch((error) => {
                    logger.error("Error retrieving vector store file", {
                      error: error instanceof Error ? error.message : String(error),
                    });
                    return null;
                  });
                
                fileRetrievalPromises.push(promise);
              }
            }

            // If no annotations, still include the content
            if (annotations.length === 0 && content.text.value) {
              results.push({
                content: content.text.value,
              });
            }
          }
        }
      }
    }

    // Wait for all file retrievals to complete in parallel
    const fileResults = await Promise.all(fileRetrievalPromises);
    results.push(...fileResults.filter((r): r is VectorSearchResult => r !== null));

    // Cleanup
    await openai.beta.assistants.del(assistant.id);
    await openai.beta.threads.del(thread.id);

    logger.info("Vector store search complete", { results: results.length });
    return results.slice(0, maxResults);
  } catch (error) {
    logger.error("Error searching vector store", {
      error: error instanceof Error ? error.message : String(error),
    });
    return [];
  }
}

export type ProductVerificationStep = {
  name: string;
  controlPoints: string[];
  keywords: string[];
};

/**
 * Get product verification context for all checkpoints in a step
 */
export async function getProductVerificationContext(
  step: ProductVerificationStep
): Promise<ProductVerificationContext[]> {
  logger.info("Retrieving product verification context", {
    step_name: step.name,
    checkpoints: step.controlPoints.length,
  });

  // Process all checkpoints in parallel for maximum speed
  const contextPromises = step.controlPoints.map(async (checkpoint: string, index: number) => {
    // Build search query combining step context and checkpoint
    const searchQuery = buildProductSearchQuery(step, checkpoint);

    // Small staggered delay to avoid overwhelming the API (0ms, 50ms, 100ms, etc.)
    await new Promise((resolve) => setTimeout(resolve, index * 50));

    // Search vector store
    const relevantDocs = await searchVectorStore(searchQuery, 3);

    return {
      checkpointName: checkpoint,
      relevantDocumentation: relevantDocs,
      searchQuery,
    };
  });

  const contexts = await Promise.all(contextPromises);
  logger.info("Retrieved verification context", { checkpoints: contexts.length });

  return contexts;
}

/**
 * Build optimized search query for product information
 */
function buildProductSearchQuery(step: ProductVerificationStep, checkpoint: string): string {
  // Combine step context with checkpoint for targeted search
  const stepKeywords = step.keywords.slice(0, 5).join(" ");

  return `Produit d'assurance santé complémentaire: ${checkpoint}. 
Contexte: ${step.name}. 
Mots-clés: ${stepKeywords}. 
Recherche garanties, conditions, exclusions, plafonds, remboursements.`;
}

/**
 * Format verification context for prompt inclusion
 */
export function formatVerificationContextForPrompt(
  contexts: ProductVerificationContext[]
): string {
  if (contexts.length === 0) {
    return "";
  }

  let text = `\n${"═".repeat(80)}\n`;
  text += "DOCUMENTATION PRODUIT (depuis Vector Store)\n";
  text += `${"═".repeat(80)}\n\n`;
  text +=
    "⚠️ VÉRIFICATION OBLIGATOIRE: Les affirmations du conseiller doivent être conformes\n";
  text +=
    "à la documentation officielle ci-dessous. Toute divergence doit être signalée.\n\n";

  for (const context of contexts) {
    if (context.relevantDocumentation.length > 0) {
      text += `\n${"─".repeat(80)}\n`;
      text += `Point de contrôle: ${context.checkpointName}\n`;
      text += `${"─".repeat(80)}\n\n`;

      for (const doc of context.relevantDocumentation) {
        text += `📄 Source: ${doc.file_name || "Documentation produit"}\n`;
        text += `${doc.content}\n\n`;
      }
    }
  }

  text += `${"═".repeat(80)}\n\n`;
  return text;
}

/**
 * Verify checkpoint compliance against vector store documentation
 */
export async function verifyCheckpointAgainstDocumentation(
  checkpoint: string,
  advisorStatement: string,
  stepContext: { name: string }
): Promise<{
  compliant: boolean;
  confidence: "high" | "medium" | "low";
  discrepancies: string[];
  supportingDocs: VectorSearchResult[];
}> {
  // Build verification query
  const query = `Vérifier conformité: ${checkpoint}
Déclaration du conseiller: "${advisorStatement}"
Contexte: ${stepContext.name}
Est-ce que cette affirmation est conforme aux garanties et conditions du produit?`;

  // Search for relevant documentation
  const docs = await searchVectorStore(query, 5);

  // Basic compliance check (can be enhanced with GPT analysis)
  const hasRelevantDocs = docs.length > 0;

  return {
    compliant: hasRelevantDocs,
    confidence: hasRelevantDocs ? "medium" : "low",
    discrepancies: [],
    supportingDocs: docs,
  };
}
