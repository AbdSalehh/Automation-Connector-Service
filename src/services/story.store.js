import { prisma } from "../lib/prisma.js";
import { extractNumberFromJid } from "../lib/phoneNumber.js";
import { getContactNames } from "./chat.store.js";

/**
 * Menyelesaikan nama pengirim story dari buku kontak perangkat utama.
 *
 * Nama yang ikut tersimpan pada baris story diambil saat pesan masuk, dan pada
 * saat itu sinkronisasi kontak sering belum tiba — sehingga yang tersimpan
 * adalah `pushName` (username WhatsApp), bukan nama kontak milik pengguna.
 * Karena itu nama diselesaikan ulang setiap kali dibaca, sama seperti daftar
 * percakapan, dengan urutan prioritas: kontak tersimpan, kontak dari JID
 * kanonik hasil alias LID, nama pada alias, lalu nama yang tersimpan di story.
 */
const resolveStorySenderNames = async (sessionId, senderJids) => {
  const uniqueSenderJids = Array.from(new Set(senderJids.filter(Boolean)));

  if (uniqueSenderJids.length === 0) {
    return new Map();
  }

  /**
   * Alias dicari dua arah. WhatsApp memakai `@lid` maupun nomor telepon untuk
   * kontak yang sama, dan nama kontak hanya tersimpan di bawah salah satunya,
   * sehingga pencarian satu arah saja akan gagal pada separuh kasus.
   */
  const aliases = await prisma.whatsappJidAlias.findMany({
    where: {
      sessionId,
      OR: [
        { aliasJid: { in: uniqueSenderJids } },
        { canonicalJid: { in: uniqueSenderJids } },
      ],
    },
    select: { aliasJid: true, canonicalJid: true, name: true },
  });

  /** Memetakan tiap JID pengirim ke JID pasangannya (LID ⇄ nomor telepon). */
  const aliasBySenderJid = new Map();

  for (const alias of aliases) {
    aliasBySenderJid.set(alias.aliasJid, {
      counterpartJid: alias.canonicalJid,
      name: alias.name,
    });
    aliasBySenderJid.set(alias.canonicalJid, {
      counterpartJid: alias.aliasJid,
      name: alias.name,
    });
  }

  const contactNames = await getContactNames(sessionId, [
    ...uniqueSenderJids,
    ...aliases.flatMap((alias) => [alias.aliasJid, alias.canonicalJid]),
  ]);

  return new Map(
    uniqueSenderJids.map((senderJid) => {
      const alias = aliasBySenderJid.get(senderJid);

      const resolvedName =
        contactNames.get(senderJid) ||
        (alias ? contactNames.get(alias.counterpartJid) : "") ||
        alias?.name ||
        "";

      return [senderJid, resolvedName];
    }),
  );
};

/**
 * Nama cadangan saat kontak belum tersimpan. JID `@lid` adalah identitas
 * internal WhatsApp sehingga tidak pernah ditampilkan sebagai angka.
 */
const resolveStoryDisplayName = (senderJid) => {
  if (senderJid.endsWith("@lid")) {
    return "Kontak WhatsApp";
  }

  return extractNumberFromJid(senderJid) || "Kontak WhatsApp";
};

export const upsertStory = async (sessionId, story) => {
  return prisma.whatsappStory.upsert({
    where: {
      sessionId_whatsappId: {
        sessionId,
        whatsappId: story.whatsappId,
      },
    },
    create: { sessionId, ...story },
    update: story,
  });
};

export const listStories = async (sessionId) => {
  const now = new Date();

  await prisma.whatsappStory.deleteMany({
    where: { expiresAt: { lte: now } },
  });

  const stories = await prisma.whatsappStory.findMany({
    where: { sessionId, expiresAt: { gt: now } },
    orderBy: [{ senderJid: "asc" }, { sentAt: "asc" }],
    include: { engagements: true },
  });

  const senderNameByJid = await resolveStorySenderNames(
    sessionId,
    stories.map((story) => story.senderJid),
  );

  return stories.map((story) => {
    const { engagements, ...storyFields } = story;

    return {
      ...storyFields,
      /**
       * Story milik sendiri tetap memakai nama yang tersimpan, karena nama
       * akun sendiri tidak ada di buku kontak.
       */
      senderName: story.fromMe
        ? story.senderName || "Anda"
        : senderNameByJid.get(story.senderJid) ||
          story.senderName ||
          resolveStoryDisplayName(story.senderJid),
      viewerCount: engagements.filter((engagement) => engagement.viewedAt)
        .length,
      likedBy: engagements
        .filter((engagement) => engagement.likedAt)
        .map((engagement) => engagement.actorName || engagement.actorJid),
    };
  });
};

export const markStoryViewed = async (sessionId, storyId) => {
  const result = await prisma.whatsappStory.updateMany({
    where: { id: storyId, sessionId, expiresAt: { gt: new Date() } },
    data: { viewedAt: new Date() },
  });

  return result.count > 0;
};

/**
 * Mencatat bahwa seseorang telah melihat story milik sesi ini, berdasarkan
 * event `message-receipt.update` dari Baileys. Diabaikan jika story tidak
 * ditemukan (misalnya sudah kedaluwarsa).
 */
export const recordStoryView = async (sessionId, whatsappId, actorJid) => {
  const story = await prisma.whatsappStory.findUnique({
    where: { sessionId_whatsappId: { sessionId, whatsappId } },
  });

  if (!story) {
    return false;
  }

  await prisma.whatsappStoryEngagement.upsert({
    where: { storyId_actorJid: { storyId: story.id, actorJid } },
    create: { storyId: story.id, actorJid, viewedAt: new Date() },
    update: { viewedAt: new Date() },
  });

  return true;
};

/**
 * Mencatat atau menghapus reaksi (heart/emoji) pada story milik sesi ini,
 * berdasarkan event `messages.reaction` dari Baileys.
 */
export const recordStoryReaction = async (
  sessionId,
  whatsappId,
  actorJid,
  actorName,
  hasReaction,
) => {
  const story = await prisma.whatsappStory.findUnique({
    where: { sessionId_whatsappId: { sessionId, whatsappId } },
  });

  if (!story) {
    return false;
  }

  await prisma.whatsappStoryEngagement.upsert({
    where: { storyId_actorJid: { storyId: story.id, actorJid } },
    create: {
      storyId: story.id,
      actorJid,
      actorName: actorName || "",
      likedAt: hasReaction ? new Date() : null,
    },
    update: {
      actorName: actorName || undefined,
      likedAt: hasReaction ? new Date() : null,
    },
  });

  return true;
};
