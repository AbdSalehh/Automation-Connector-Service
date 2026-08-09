import { env } from "../config/env.js";
import { logger } from "../config/logger.js";
import { prisma } from "../lib/prisma.js";
import { extractNumberFromJid } from "../lib/phoneNumber.js";

const toDate = (value) => {
  const date = value ? new Date(value) : new Date();
  return Number.isNaN(date.getTime()) ? new Date() : date;
};

/**
 * Fallback nama tampilan saat conversation tidak punya nama tersimpan.
 * JID `@lid` adalah identitas internal WhatsApp, bukan nomor telepon,
 * sehingga tidak boleh ditampilkan sebagai digit nomor.
 */
const resolveDisplayName = (jid) => {
  if (jid.endsWith("@lid")) {
    return "Kontak WhatsApp";
  }

  return extractNumberFromJid(jid);
};

const normalizeMessage = (jid, message) => ({
  id: message.id,
  jid,
  sender: message.sender || null,
  message: message.message || "",
  name: message.name || "",
  conversationName: message.conversationName?.trim() || "",
  messageType: message.messageType || "text",
  media: message.media || null,
  replyTo: message.replyTo || null,
  call: message.call || null,
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
  replyTo: message.replyTo,
  call: message.call,
  fromMe: message.fromMe,
  sentAt: message.sentAt.toISOString(),
  receivedAt: message.receivedAt?.toISOString() || null,
});

const enforceConversationLimit = async (conversationId) => {
  const overflowMessages = await prisma.whatsappMessage.findMany({
    where: { conversationId },
    orderBy: [{ sentAt: "desc" }, { id: "desc" }],
    skip: env.chatCacheMaxMessages,
    select: { id: true },
  });

  if (overflowMessages.length > 0) {
    await prisma.whatsappMessage.deleteMany({
      where: {
        id: {
          in: overflowMessages.map((storedMessage) => storedMessage.id),
        },
      },
    });
  }
};

const enforceSessionLimits = async (sessionId) => {
  const overflowConversations = await prisma.whatsappConversation.findMany({
    where: { sessionId },
    orderBy: [{ lastSentAt: "desc" }, { id: "desc" }],
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

export const addChatMessage = async (
  sessionId,
  jid,
  message,
  { deferRetention = false } = {},
) => {
  if (!sessionId || !jid || !message?.id) {
    return false;
  }

  const normalizedMessage = normalizeMessage(jid, message);

  try {
    const conversationId = await prisma.$transaction(async (transaction) => {
      const conversation = await transaction.whatsappConversation.upsert({
        where: { sessionId_jid: { sessionId, jid } },
        create: {
          sessionId,
          jid,
          name: normalizedMessage.conversationName,
          lastMessage: toLastMessage(normalizedMessage),
          lastSentAt: normalizedMessage.sentAt,
        },
        update: normalizedMessage.conversationName
          ? { name: normalizedMessage.conversationName }
          : {},
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
          replyTo: normalizedMessage.replyTo,
          call: normalizedMessage.call,
          fromMe: normalizedMessage.fromMe,
          sentAt: normalizedMessage.sentAt,
          receivedAt: normalizedMessage.receivedAt,
        },
        update: {
          message: normalizedMessage.message,
          messageType: normalizedMessage.messageType,
          call: normalizedMessage.call,
          sentAt: normalizedMessage.sentAt,
        },
      });

      if (normalizedMessage.sentAt >= conversation.lastSentAt) {
        await transaction.whatsappConversation.update({
          where: { id: conversation.id },
          data: {
            name: normalizedMessage.conversationName || conversation.name,
            lastMessage: toLastMessage(normalizedMessage),
            lastSentAt: normalizedMessage.sentAt,
          },
        });
      }

      return conversation.id;
    });

    if (!deferRetention) {
      await enforceConversationLimit(conversationId);
      await enforceSessionLimits(sessionId);
    }

    return true;
  } catch (error) {
    logger.error(
      { err: error?.message, sessionId, jid },
      "Gagal menyimpan chat WhatsApp ke Supabase",
    );

    return false;
  }
};

export const finalizeHistoryBatch = async (sessionId, conversationJids) => {
  const conversations = await prisma.whatsappConversation.findMany({
    where: {
      sessionId,
      jid: { in: Array.from(new Set(conversationJids)) },
    },
    select: { id: true },
  });

  for (const conversation of conversations) {
    await enforceConversationLimit(conversation.id);
  }

  await enforceSessionLimits(sessionId);
};

/**
 * Membuat atau memperbarui conversation dari daftar chat Baileys. Nama diisi
 * bila tersedia, dan `lastSentAt` hanya dimajukan bila timestamp chat lebih
 * baru agar urutan daftar tetap benar.
 */
export const seedConversation = async (
  sessionId,
  { jid, name, lastSentAt, lastMessage },
) => {
  if (!sessionId || !jid) {
    return;
  }

  const conversationSentAt = toDate(lastSentAt);
  const trimmedName = name?.trim() || "";

  const existing = await prisma.whatsappConversation.findUnique({
    where: { sessionId_jid: { sessionId, jid } },
    select: { lastSentAt: true },
  });

  const shouldAdvanceTimestamp =
    !existing || conversationSentAt > existing.lastSentAt;

  await prisma.whatsappConversation.upsert({
    where: { sessionId_jid: { sessionId, jid } },
    create: {
      sessionId,
      jid,
      name: trimmedName,
      lastMessage: lastMessage || null,
      lastSentAt: conversationSentAt,
    },
    update: {
      ...(trimmedName ? { name: trimmedName } : {}),
      ...(shouldAdvanceTimestamp ? { lastSentAt: conversationSentAt } : {}),
      ...(shouldAdvanceTimestamp && lastMessage ? { lastMessage } : {}),
    },
  });
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
  const activeSince = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const where = {
    sessionId,
    lastSentAt: { gte: activeSince },
  };
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
      name: conversation.name?.trim() || resolveDisplayName(conversation.jid),
      lastMessage: conversation.lastMessage,
    })),
    metadata: {
      limit,
      offset,
      activeHours: 24,
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
  const activeSince = new Date(Date.now() - 48 * 60 * 60 * 1000);
  const where = { sessionId, jid, sentAt: { gte: activeSince } };
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
      activeHours: 48,
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
