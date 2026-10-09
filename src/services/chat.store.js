import { env } from "../config/env.js";
import { logger } from "../config/logger.js";
import { prisma } from "../lib/prisma.js";
import { extractNumberFromJid } from "../lib/phoneNumber.js";
import { getExcludedJidSet } from "./excludedChat.store.js";
import { extractCloudName, getActiveCloudName } from "./media.service.js";

/**
 * Menandai media yang diunggah ke akun Cloudinary LAIN dari yang aktif
 * sekarang. Setelah kredensial Cloudinary diganti (mis. karena kuota penuh),
 * URL lama tetap tersimpan di database tapi berkasnya tidak lagi dapat diakses.
 * Dengan flag `isStale`, frontend bisa menampilkan placeholder "media tidak
 * tersedia" alih-alih gambar rusak atau tautan mati.
 *
 * Nama cloud dibaca dari field `cloudName` bila ada, atau diurai dari URL agar
 * baris lama (yang belum menyimpan field itu) tetap ikut terdeteksi.
 */
const decorateMedia = (media) => {
  if (!media || typeof media !== "object" || !media.url) {
    return media ?? null;
  }

  const activeCloudName = getActiveCloudName();
  const mediaCloudName = media.cloudName || extractCloudName(media.url);

  if (!activeCloudName || !mediaCloudName) {
    return media;
  }

  return { ...media, isStale: mediaCloudName !== activeCloudName };
};

/**
 * Versi `decorateMedia` untuk ringkasan `lastMessage` yang disimpan sebagai
 * JSON pada baris conversation.
 */
const decorateLastMessage = (lastMessage) => {
  if (!lastMessage || typeof lastMessage !== "object") {
    return lastMessage ?? null;
  }

  return { ...lastMessage, media: decorateMedia(lastMessage.media) };
};

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
  media: decorateMedia(message.media),
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
        /**
         * Arah panggilan baru diketahui pasti ketika riwayat app-state tiba,
         * setelah barisnya mungkin sudah dibuat dari event `call` langsung.
         */
        fromMe: normalizedMessage.fromMe,
        ...(normalizedMessage.sender
          ? { sender: normalizedMessage.sender }
          : {}),
        /**
         * Media hanya ditimpa bila pemanggil benar-benar membawa media baru.
         * Pesan yang sudah tersimpan dikirim ulang tanpa media (`undefined`)
         * agar tidak diunduh dua kali, sehingga menulis `null` begitu saja
         * akan menghapus berkas yang sudah tersimpan.
         */
        ...(normalizedMessage.media ? { media: normalizedMessage.media } : {}),
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

/**
 * Menyimpan nama kontak. Entri bertanda `isFallbackName` berasal dari username
 * WhatsApp (`notify`), bukan dari buku kontak perangkat utama, sehingga hanya
 * dipakai saat kontak belum punya nama tersimpan. Tanpa penjaga ini satu event
 * `contacts.update` yang hanya membawa username bisa menimpa nama kontak asli.
 */
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
        update: contact.isFallbackName ? {} : { name: contact.name.trim() },
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
  const excludedJidSet = await getExcludedJidSet(sessionId);

  const where = {
    sessionId,
    lastSentAt: { gte: activeSince },
    ...(excludedJidSet.size > 0
      ? { jid: { notIn: Array.from(excludedJidSet) } }
      : {}),
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

  const nonGroupJids = conversations
    .filter((conversation) => !conversation.jid.endsWith("@g.us"))
    .map((conversation) => conversation.jid);

  const lidJids = nonGroupJids.filter((jid) => jid.endsWith("@lid"));

  const aliases =
    lidJids.length > 0
      ? await prisma.whatsappJidAlias.findMany({
          where: {
            sessionId,
            aliasJid: { in: lidJids },
          },
          select: { aliasJid: true, canonicalJid: true, name: true },
        })
      : [];

  const aliasByLid = new Map(
    aliases.map((alias) => [alias.aliasJid, alias]),
  );

  const allJidsToLookup = [
    ...nonGroupJids,
    ...aliases.map((alias) => alias.canonicalJid),
  ];

  const contactNames = await getContactNames(sessionId, allJidsToLookup);

  return {
    data: conversations.map((conversation) => {
      if (conversation.jid.endsWith("@g.us")) {
        return {
          jid: conversation.jid,
          name: conversation.name?.trim() || "Grup WhatsApp",
          lastMessage: decorateLastMessage(conversation.lastMessage),
        };
      }

      const alias = aliasByLid.get(conversation.jid);

      const contactName =
        contactNames.get(conversation.jid) ||
        (alias ? contactNames.get(alias.canonicalJid) : null) ||
        alias?.name ||
        conversation.name?.trim() ||
        resolveDisplayName(conversation.jid);

      return {
        jid: conversation.jid,
        name: contactName,
        lastMessage: decorateLastMessage(conversation.lastMessage),
      };
    }),
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

/**
 * Mencari id pesan panggilan yang sudah tersimpan untuk sebuah `callId`.
 *
 * Satu panggilan dapat terlihat dari dua jalur: event `call` secara langsung
 * dan mutasi app-state `callLogAction` yang menyusul. Keduanya memakai
 * `callId` yang sama namun stempel waktu berbeda, sehingga pencocokan lewat
 * awalan `call:<callId>:` mencegah satu panggilan tercatat dua kali.
 */
export const findCallMessageId = async (sessionId, callId) => {
  if (!sessionId || !callId) {
    return null;
  }

  const existingMessage = await prisma.whatsappMessage.findFirst({
    where: {
      sessionId,
      messageType: "call",
      whatsappId: { startsWith: `call:${callId}:` },
    },
    select: { whatsappId: true },
  });

  return existingMessage?.whatsappId ?? null;
};

export const messageExists = async (sessionId, whatsappId) => {
  if (!sessionId || !whatsappId) {
    return false;
  }

  const existingMessage = await prisma.whatsappMessage.findUnique({
    where: { sessionId_whatsappId: { sessionId, whatsappId } },
    select: { id: true },
  });

  return Boolean(existingMessage);
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
