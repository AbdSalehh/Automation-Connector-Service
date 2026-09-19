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
  const excludedChats = await prisma.whatsappExcludedChat.findMany({
    where: { sessionId },
    orderBy: { createdAt: "desc" },
  });

  const excludedJids = excludedChats.map((excludedChat) => excludedChat.jid);

  const contacts = await prisma.whatsappContact.findMany({
    where: {
      sessionId,
      jid: { in: excludedJids },
    },
    select: { jid: true, name: true },
  });

  const lidJids = excludedJids.filter((jid) => jid.endsWith("@lid"));

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

  const aliasCanonicalJids = aliases.map((alias) => alias.canonicalJid);

  const aliasContacts =
    aliasCanonicalJids.length > 0
      ? await prisma.whatsappContact.findMany({
          where: {
            sessionId,
            jid: { in: aliasCanonicalJids },
          },
          select: { jid: true, name: true },
        })
      : [];

  const contactNameByJid = new Map([
    ...contacts.map((contact) => [contact.jid, contact.name]),
    ...aliasContacts.map((contact) => [contact.jid, contact.name]),
  ]);

  return excludedChats.map((excludedChat) => {
    const alias = aliasByLid.get(excludedChat.jid);

    const resolvedName =
      contactNameByJid.get(excludedChat.jid) ||
      (alias ? contactNameByJid.get(alias.canonicalJid) : null) ||
      alias?.name ||
      "";

    return {
      id: excludedChat.id,
      sessionId: excludedChat.sessionId,
      jid: excludedChat.jid,
      name: resolvedName,
      createdAt: excludedChat.createdAt,
    };
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
