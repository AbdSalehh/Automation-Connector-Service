import { env } from "../config/env.js";
import { logger } from "../config/logger.js";
import { prisma } from "../lib/prisma.js";

const toDate = (value) => {
  const date = value ? new Date(value) : new Date();
  return Number.isNaN(date.getTime()) ? new Date() : date;
};

const normalizeMessage = (jid, message) => ({
  id: message.id,
  jid,
  sender: message.sender || null,
  message: message.message || "",
  name: message.name || "",
  messageType: message.messageType || "text",
  media: message.media || null,
  fromMe: Boolean(message.fromMe),
  sentAt: toDate(message.sentAt || message.receivedAt),
  receivedAt: message.receivedAt ? toDate(message.receivedAt) : null,
});

const toLastMessage = (message) => ({
  ...message,
  sentAt: message.sentAt.toISOString(),
  receivedAt: message.receivedAt?.toISOString() || null,
});

const serializeMessage = (message) => ({
  id: message.whatsappId,
  jid: message.jid,
  sender: message.sender,
  message: message.message,
  name: message.name,
  messageType: message.messageType,
  media: message.media,
  fromMe: message.fromMe,
  sentAt: message.sentAt.toISOString(),
  receivedAt: message.receivedAt?.toISOString() || null,
});

const enforceSessionLimits = async (sessionId) => {
  const overflowConversations = await prisma.whatsappConversation.findMany({
    where: { sessionId },
    orderBy: { lastSentAt: "desc" },
    skip: env.chatCacheMaxConversations,
    select: { id: true },
  });

  if (overflowConversations.length > 0) {
    await prisma.whatsappConversation.deleteMany({
      where: {
        id: {
          in: overflowConversations.map((conversation) => conversation.id),
        },
      },
    });
  }
};

export const addChatMessage = async (sessionId, jid, message) => {
  if (!sessionId || !jid || !message?.id) {
    return;
  }

  const normalizedMessage = normalizeMessage(jid, message);

  try {
    await prisma.$transaction(async (transaction) => {
      const conversation = await transaction.whatsappConversation.upsert({
        where: { sessionId_jid: { sessionId, jid } },
        create: {
          sessionId,
          jid,
          name: normalizedMessage.name,
          lastMessage: toLastMessage(normalizedMessage),
          lastSentAt: normalizedMessage.sentAt,
        },
        update: normalizedMessage.name ? { name: normalizedMessage.name } : {},
      });

      await transaction.whatsappMessage.upsert({
        where: {
          sessionId_whatsappId: {
            sessionId,
            whatsappId: normalizedMessage.id,
          },
        },
        create: {
          whatsappId: normalizedMessage.id,
          conversationId: conversation.id,
          sessionId,
          jid,
          sender: normalizedMessage.sender,
          message: normalizedMessage.message,
          name: normalizedMessage.name,
          messageType: normalizedMessage.messageType,
          media: normalizedMessage.media,
          fromMe: normalizedMessage.fromMe,
          sentAt: normalizedMessage.sentAt,
          receivedAt: normalizedMessage.receivedAt,
        },
        update: {},
      });

      if (normalizedMessage.sentAt >= conversation.lastSentAt) {
        await transaction.whatsappConversation.update({
          where: { id: conversation.id },
          data: {
            name: normalizedMessage.name || conversation.name,
            lastMessage: toLastMessage(normalizedMessage),
            lastSentAt: normalizedMessage.sentAt,
          },
        });
      }

      const overflowMessages = await transaction.whatsappMessage.findMany({
        where: { conversationId: conversation.id },
        orderBy: { sentAt: "desc" },
        skip: env.chatCacheMaxMessages,
        select: { id: true },
      });

      if (overflowMessages.length > 0) {
        await transaction.whatsappMessage.deleteMany({
          where: {
            id: {
              in: overflowMessages.map((storedMessage) => storedMessage.id),
            },
          },
        });
      }
    });

    await enforceSessionLimits(sessionId);
  } catch (error) {
    logger.error(
      { err: error?.message, sessionId, jid },
      "Gagal menyimpan chat WhatsApp ke Supabase",
    );
  }
};

export const updateConversationName = async (sessionId, jid, name) => {
  if (!sessionId || !jid || !name?.trim()) {
    return;
  }

  await prisma.whatsappConversation.updateMany({
    where: { sessionId, jid },
    data: { name: name.trim() },
  });
};

export const listConversations = async (sessionId, { limit, offset }) => {
  const activeSince = new Date(Date.now() - 48 * 60 * 60 * 1000);
  const where = { sessionId, lastSentAt: { gte: activeSince } };
  const [conversations, totalItems] = await prisma.$transaction([
    prisma.whatsappConversation.findMany({
      where,
      orderBy: { lastSentAt: "desc" },
      take: limit,
      skip: offset,
    }),
    prisma.whatsappConversation.count({ where }),
  ]);

  return {
    data: conversations.map((conversation) => ({
      jid: conversation.jid,
      name: conversation.name,
      lastMessage: conversation.lastMessage,
    })),
    metadata: {
      limit,
      offset,
      activeHours: 48,
      totalItems,
      hasMore: offset + conversations.length < totalItems,
    },
  };
};

export const listConversationMessages = async (
  sessionId,
  jid,
  { limit, offset },
) => {
  const where = { sessionId, jid };
  const [messages, totalItems] = await prisma.$transaction([
    prisma.whatsappMessage.findMany({
      where,
      orderBy: [{ sentAt: "desc" }, { id: "desc" }],
      take: limit,
      skip: offset,
    }),
    prisma.whatsappMessage.count({ where }),
  ]);

  return {
    data: messages.map(serializeMessage),
    metadata: {
      limit,
      offset,
      totalItems,
      hasMore: offset + messages.length < totalItems,
      nextOffset: offset + messages.length,
    },
  };
};

export const clearConversationCache = async (sessionId, jid) => {
  const result = await prisma.whatsappConversation.deleteMany({
    where: { sessionId, jid },
  });

  return result.count > 0;
};

export const clearSessionChatCache = async (sessionId) => {
  const result = await prisma.whatsappConversation.deleteMany({
    where: { sessionId },
  });

  return result.count > 0;
};
