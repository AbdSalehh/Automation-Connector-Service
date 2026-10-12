import { prisma } from "../lib/prisma.js";
import {
  resolveContactNames,
  resolveFallbackDisplayName,
} from "./chat.store.js";

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

/**
 * Daftar chat tersembunyi beserta nama tampilannya.
 *
 * Kontak memakai resolver yang sama dengan daftar percakapan agar nama dari
 * buku kontak perangkat utama yang tampil. Nama grup tidak ada di buku kontak
 * dan baris percakapannya sudah dihapus saat chat disembunyikan, sehingga
 * dipakai snapshot nama yang disimpan ketika chat disembunyikan.
 */
export const listExcludedChats = async (sessionId) => {
  const excludedChats = await prisma.whatsappExcludedChat.findMany({
    where: { sessionId },
    orderBy: { createdAt: "desc" },
  });

  const contactNames = await resolveContactNames(
    sessionId,
    excludedChats.map((excludedChat) => excludedChat.jid),
  );

  return excludedChats.map((excludedChat) => ({
    id: excludedChat.id,
    sessionId: excludedChat.sessionId,
    jid: excludedChat.jid,
    name:
      contactNames.get(excludedChat.jid) ||
      excludedChat.name?.trim() ||
      resolveFallbackDisplayName(excludedChat.jid),
    hasStoredName: Boolean(
      contactNames.get(excludedChat.jid) || excludedChat.name?.trim(),
    ),
    createdAt: excludedChat.createdAt,
  }));
};

/**
 * Menyimpan snapshot nama untuk chat tersembunyi yang belum punya nama,
 * misalnya grup yang disembunyikan sebelum kolom nama tersedia.
 */
export const updateExcludedChatName = async (sessionId, jid, name) => {
  if (!name?.trim()) {
    return;
  }

  await prisma.whatsappExcludedChat.updateMany({
    where: { sessionId, jid },
    data: { name: name.trim() },
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
  /**
   * Nama percakapan diambil SEBELUM barisnya dihapus di bawah. Untuk grup,
   * ini satu-satunya sumber nama yang tersisa setelah chat disembunyikan.
   */
  const conversation = await prisma.whatsappConversation.findUnique({
    where: { sessionId_jid: { sessionId, jid } },
    select: { name: true },
  });
  const contactNames = await resolveContactNames(sessionId, [jid]);
  const snapshotName =
    contactNames.get(jid) || conversation?.name?.trim() || "";

  await prisma.whatsappExcludedChat.upsert({
    where: { sessionId_jid: { sessionId, jid } },
    create: { sessionId, jid, name: snapshotName },
    update: snapshotName ? { name: snapshotName } : {},
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
