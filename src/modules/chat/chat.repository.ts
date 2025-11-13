/**
 * Chat Repository
 * ===============
 * Database operations for chat conversations
 */

import { prisma } from "../../shared/prisma.js";

/**
 * Get or create conversation for audit
 */
export async function getOrCreateAuditConversation(auditId: bigint, ficheId: string) {
  return await prisma.chatConversation.upsert({
    where: {
      ficheId_auditId: {
        ficheId,
        auditId,
      },
    },
    create: {
      ficheId,
      auditId,
    },
    update: {},
    include: {
      messages: {
        orderBy: { timestamp: "asc" },
        take: 50, // Last 50 messages
      },
    },
  });
}

/**
 * Get or create conversation for fiche
 */
export async function getOrCreateFicheConversation(ficheId: string) {
  let conversation = await prisma.chatConversation.findFirst({
    where: {
      ficheId,
      auditId: null,
    },
    include: {
      messages: {
        orderBy: { timestamp: "asc" },
        take: 50,
      },
    },
  });

  if (!conversation) {
    conversation = await prisma.chatConversation.create({
      data: {
        ficheId,
        auditId: null,
      },
      include: {
        messages: {
          orderBy: { timestamp: "asc" },
        },
      },
    });
  }

  return conversation;
}

/**
 * Add message to conversation
 */
export async function addMessage(
  conversationId: bigint,
  role: "user" | "assistant" | "system",
  content: string
) {
  return await prisma.chatMessage.create({
    data: {
      conversationId,
      role,
      content,
    },
  });
}

/**
 * Get conversation history
 */
export async function getConversationHistory(conversationId: bigint) {
  return await prisma.chatMessage.findMany({
    where: { conversationId },
    orderBy: { timestamp: "asc" },
  });
}



