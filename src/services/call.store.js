import { env } from "../config/env.js";
import { prisma } from "../lib/prisma.js";
import { extractNumberFromJid } from "../lib/phoneNumber.js";
import { getContactNames } from "./chat.store.js";

/**
 * Riwayat panggilan WhatsApp.
 *
 * Panggilan disimpan sebagai pesan biasa (`messageType: "call"`) pada tabel
 * WhatsappMessage, dengan detail panggilan pada kolom JSON `call`. Modul ini
 * hanya membaca kembali baris tersebut untuk ditampilkan sebagai daftar
 * panggilan harian, lengkap dengan nama lawan bicaranya.
 */

/** Batas aman jumlah panggilan yang dikembalikan dalam satu hari. */
const MAX_CALLS_PER_DAY = 200;

/**
 * Menghitung selisih (ms) antara zona waktu target dan UTC pada saat tertentu.
 */
const getTimezoneOffsetMs = (date, timeZone) => {
  const utcDate = new Date(date.toLocaleString("en-US", { timeZone: "UTC" }));
  const zonedDate = new Date(date.toLocaleString("en-US", { timeZone }));

  return zonedDate.getTime() - utcDate.getTime();
};

/**
 * Mengembalikan instant tengah malam "hari ini" menurut zona waktu pengguna.
 * Dipakai sebagai batas bawah query agar panggilan dini hari tetap terhitung
 * sebagai hari yang sama seperti yang dilihat pengguna di ponselnya.
 */
const getStartOfToday = () => {
  const now = new Date();
  const offsetMs = getTimezoneOffsetMs(now, env.timezone);

  const zonedNow = new Date(now.getTime() + offsetMs);
  zonedNow.setUTCHours(0, 0, 0, 0);

  return new Date(zonedNow.getTime() - offsetMs);
};

/**
 * Menentukan nama tampilan lawan bicara. Kontak tersimpan diutamakan, lalu nama
 * percakapan, lalu nama yang menempel pada baris pesan, dan terakhir nomor
 * telepon. JID `@lid` adalah identitas internal WhatsApp sehingga tidak pernah
 * ditampilkan sebagai angka.
 */
const resolveCallName = (callMessage, contactNames, conversationNameByJid) => {
  const storedName =
    contactNames.get(callMessage.jid) ||
    conversationNameByJid.get(callMessage.jid) ||
    callMessage.name?.trim() ||
    "";

  if (storedName) {
    return storedName;
  }

  if (callMessage.jid.endsWith("@g.us")) {
    return "Grup WhatsApp";
  }

  if (callMessage.jid.endsWith("@lid")) {
    return "Kontak WhatsApp";
  }

  return extractNumberFromJid(callMessage.jid) || "Kontak WhatsApp";
};

/**
 * Mengembalikan seluruh panggilan masuk & keluar pada hari berjalan untuk
 * sebuah sesi, terbaru lebih dulu.
 */
export const listTodayCalls = async (sessionId) => {
  const startOfToday = getStartOfToday();

  const callMessages = await prisma.whatsappMessage.findMany({
    where: {
      sessionId,
      messageType: "call",
      sentAt: { gte: startOfToday },
    },
    orderBy: [{ sentAt: "desc" }, { id: "desc" }],
    take: MAX_CALLS_PER_DAY,
  });

  if (callMessages.length === 0) {
    return { data: [], metadata: { since: startOfToday.toISOString() } };
  }

  const callJids = Array.from(
    new Set(callMessages.map((callMessage) => callMessage.jid)),
  );

  const [contactNames, conversations] = await Promise.all([
    getContactNames(sessionId, callJids),
    prisma.whatsappConversation.findMany({
      where: { sessionId, jid: { in: callJids } },
      select: { jid: true, name: true },
    }),
  ]);

  const conversationNameByJid = new Map(
    conversations
      .filter((conversation) => conversation.name?.trim())
      .map((conversation) => [conversation.jid, conversation.name.trim()]),
  );

  const data = callMessages.map((callMessage) => {
    const call = callMessage.call || {};

    return {
      id: callMessage.whatsappId,
      jid: callMessage.jid,
      name: resolveCallName(callMessage, contactNames, conversationNameByJid),
      phoneNumber: callMessage.jid.endsWith("@s.whatsapp.net")
        ? extractNumberFromJid(callMessage.jid)
        : "",
      fromMe: callMessage.fromMe,
      isVideo: Boolean(call.isVideo),
      isGroup: Boolean(call.isGroup),
      status: call.status || "",
      durationSeconds: call.durationSeconds ?? null,
      sentAt: callMessage.sentAt.toISOString(),
    };
  });

  return {
    data,
    metadata: {
      since: startOfToday.toISOString(),
      timezone: env.timezone,
      totalItems: data.length,
      incomingCount: data.filter((callEntry) => !callEntry.fromMe).length,
      outgoingCount: data.filter((callEntry) => callEntry.fromMe).length,
    },
  };
};
