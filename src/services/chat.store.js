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
  mentions: message.mentions || null,
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
  mentions: message.mentions,
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

const ensureConversation = async (sessionId, jid, normalizedMessage) => {
  try {
    return await prisma.whatsappConversation.upsert({
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
  } catch (error) {
    if (error?.code !== "P2002") {
      throw error;
    }

    const conversation = await prisma.whatsappConversation.findUnique({
      where: { sessionId_jid: { sessionId, jid } },
    });

    if (!conversation) {
      throw error;
    }

    return conversation;
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
    const conversation = await ensureConversation(
      sessionId,
      jid,
      normalizedMessage,
    );

    await prisma.whatsappMessage.upsert({
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
        mentions: normalizedMessage.mentions,
        call: normalizedMessage.call,
        fromMe: normalizedMessage.fromMe,
        sentAt: normalizedMessage.sentAt,
        receivedAt: normalizedMessage.receivedAt,
      },
      update: {
        message: normalizedMessage.message,
        messageType: normalizedMessage.messageType,
        mentions: normalizedMessage.mentions,
        call: normalizedMessage.call,
        sentAt: normalizedMessage.sentAt,
      },
    });

    await prisma.whatsappConversation.updateMany({
      where: {
        id: conversation.id,
        lastSentAt: { lte: normalizedMessage.sentAt },
      },
      data: {
        ...(normalizedMessage.conversationName
          ? { name: normalizedMessage.conversationName }
          : {}),
        lastMessage: toLastMessage(normalizedMessage),
        lastSentAt: normalizedMessage.sentAt,
      },
    });

    if (!deferRetention) {
      await enforceConversationLimit(conversation.id);
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

export const upsertContactNames = async (sessionId, contacts) => {
  const validContacts = contacts.filter(
    (contact) => contact.jid && contact.name?.trim(),
  );

  await Promise.all(
    validContacts.map((contact) =>
      prisma.whatsappContact.upsert({
        where: {
          sessionId_jid: { sessionId, jid: contact.jid },
        },
        create: {
          sessionId,
          jid: contact.jid,
          name: contact.name.trim(),
        },
        update: { name: contact.name.trim() },
      }),
    ),
  );
};

export const getContactNames = async (sessionId, jids) => {
  const uniqueJids = Array.from(new Set(jids.filter(Boolean)));

  if (uniqueJids.length === 0) {
    return new Map();
  }

  const contacts = await prisma.whatsappContact.findMany({
    where: { sessionId, jid: { in: uniqueJids } },
    select: { jid: true, name: true },
  });

  return new Map(contacts.map((contact) => [contact.jid, contact.name]));
};

export const resolveStoredCanonicalJid = async (sessionId, jid) => {
  if (!jid?.endsWith("@lid")) {
    return jid;
  }

  const alias = await prisma.whatsappJidAlias.findUnique({
    where: { sessionId_aliasJid: { sessionId, aliasJid: jid } },
  });

  return alias?.canonicalJid || jid;
};

export const registerJidAlias = async (
  sessionId,
  aliasJid,
  canonicalJid,
  name = "",
) => {
  if (
    !sessionId ||
    !aliasJid?.endsWith("@lid") ||
    !canonicalJid?.endsWith("@s.whatsapp.net")
  ) {
    return;
  }

  await prisma.whatsappJidAlias.upsert({
    where: { sessionId_aliasJid: { sessionId, aliasJid } },
    create: { sessionId, aliasJid, canonicalJid, name: name.trim() },
    update: { canonicalJid, ...(name.trim() ? { name: name.trim() } : {}) },
  });

  await prisma.$transaction(async (transaction) => {
    const sourceConversation =
      await transaction.whatsappConversation.findUnique({
        where: { sessionId_jid: { sessionId, jid: aliasJid } },
      });

    if (!sourceConversation) {
      return;
    }

    const targetConversation = await transaction.whatsappConversation.upsert({
      where: { sessionId_jid: { sessionId, jid: canonicalJid } },
      create: {
        sessionId,
        jid: canonicalJid,
        name: name.trim() || sourceConversation.name,
        lastMessage: sourceConversation.lastMessage,
        lastSentAt: sourceConversation.lastSentAt,
      },
      update: name.trim() ? { name: name.trim() } : {},
    });

    await transaction.whatsappMessage.updateMany({
      where: { conversationId: sourceConversation.id },
      data: { conversationId: targetConversation.id, jid: canonicalJid },
    });

    const latestMessage = await transaction.whatsappMessage.findFirst({
      where: { conversationId: targetConversation.id },
      orderBy: [{ sentAt: "desc" }, { id: "desc" }],
    });

    if (latestMessage) {
      await transaction.whatsappConversation.update({
        where: { id: targetConversation.id },
        data: {
          lastMessage: serializeMessage(latestMessage),
          lastSentAt: latestMessage.sentAt,
        },
      });
    }

    await transaction.whatsappConversation.delete({
      where: { id: sourceConversation.id },
    });
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
