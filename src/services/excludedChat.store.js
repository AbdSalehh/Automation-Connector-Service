import { prisma } from "../lib/prisma.js";

/**
 * Mengembalikan Set berisi JID chat yang disembunyikan untuk sebuah sesi.
 */
export const getExcludedJidSet = async (sessionId) => {
  const excludedChats = await prisma.whatsappExcludedChat.findMany({
    where: { sessionId },
    select: { jid: true },
  });

  return new Set(excludedChats.map((excludedChat) => excludedChat.jid));
};

export const listExcludedChats = async (sessionId) => {
  return prisma.whatsappExcludedChat.findMany({
    where: { sessionId },
    orderBy: { createdAt: "desc" },
  });
};

export const isChatExcluded = async (sessionId, jid) => {
  if (!sessionId || !jid) {
    return false;
  }

  const excludedChat = await prisma.whatsappExcludedChat.findUnique({
    where: { sessionId_jid: { sessionId, jid } },
    select: { id: true },
  });

  return Boolean(excludedChat);
};

/**
 * Menyembunyikan sebuah chat sekaligus menghapus cache percakapannya agar
 * tidak lagi tampil di daftar dan berhenti memakan storage media.
 */
export const addExcludedChat = async (sessionId, jid) => {
  await prisma.whatsappExcludedChat.upsert({
    where: { sessionId_jid: { sessionId, jid } },
    create: { sessionId, jid },
    update: {},
  });

  await prisma.whatsappConversation.deleteMany({
    where: { sessionId, jid },
  });

  return true;
};

export const removeExcludedChat = async (sessionId, jid) => {
  const result = await prisma.whatsappExcludedChat.deleteMany({
    where: { sessionId, jid },
  });

  return result.count > 0;
};
