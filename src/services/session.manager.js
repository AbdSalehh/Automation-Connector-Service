import {
  makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion,
  downloadMediaMessage,
} from "@whiskeysockets/baileys";
import qrcodeTerminal from "qrcode-terminal";
import QRCode from "qrcode";
import fs from "fs";
import path from "path";

import { env } from "../config/env.js";
import { logger } from "../config/logger.js";
import {
  extractNumberFromJid,
  resolveSenderNumber,
  toWhatsappJid,
} from "../lib/phoneNumber.js";
import { forwardInboundMessage } from "./webhook.service.js";
import {
  publishInboundMessage,
  publishSessionUpdate,
} from "./realtime.service.js";
import { detectMessageType, extractMediaInfo } from "../lib/messageType.js";
import { uploadInboundMedia } from "./media.service.js";

/**
 * Menyimpan seluruh sesi WhatsApp aktif dalam memori.
 * Key berupa sessionId, value berupa objek berisi socket,
 * status koneksi, dan QR code dalam bentuk data URL.
 */
const sessions = new Map();

/**
 * Mengembalikan path folder penyimpanan auth untuk sebuah sesi.
 * Setiap sesi memiliki subfolder tersendiri di dalam folder dasar.
 */
const getSessionAuthFolder = (sessionId) => {
  return path.join(env.authFolder, sessionId);
};

/**
 * Mengubah timestamp Unix (detik) dari Baileys menjadi string ISO.
 * Nilai dapat berupa number maupun objek Long, sehingga keduanya ditangani.
 */
const convertUnixToIso = (timestamp) => {
  if (!timestamp) {
    return null;
  }

  const seconds =
    typeof timestamp === "number"
      ? timestamp
      : (timestamp.toNumber?.() ?? Number(timestamp));

  if (!seconds) {
    return null;
  }

  return new Date(seconds * 1000).toISOString();
};

/**
 * Membuka lapisan pembungkus pesan WhatsApp seperti pesan sementara
 * (ephemeral) atau pesan sekali lihat (view once) agar isi pesan
 * yang sebenarnya bisa dibaca.
 */
const unwrapMessage = (messageContent) => {
  if (!messageContent) {
    return null;
  }

  if (messageContent.ephemeralMessage) {
    return unwrapMessage(messageContent.ephemeralMessage.message);
  }

  if (messageContent.viewOnceMessage) {
    return unwrapMessage(messageContent.viewOnceMessage.message);
  }

  if (messageContent.viewOnceMessageV2) {
    return unwrapMessage(messageContent.viewOnceMessageV2.message);
  }

  if (messageContent.documentWithCaptionMessage) {
    return unwrapMessage(messageContent.documentWithCaptionMessage.message);
  }

  return messageContent;
};

/**
 * Membaca isi teks dari berbagai kemungkinan struktur pesan WhatsApp:
 * teks biasa, balasan (reply), caption media, maupun balasan tombol.
 */
const extractMessageText = (rawMessageContent) => {
  const messageContent = unwrapMessage(rawMessageContent);

  if (!messageContent) {
    return "";
  }

  return (
    messageContent.conversation ||
    messageContent.extendedTextMessage?.text ||
    messageContent.imageMessage?.caption ||
    messageContent.videoMessage?.caption ||
    messageContent.documentMessage?.caption ||
    messageContent.buttonsResponseMessage?.selectedDisplayText ||
    messageContent.listResponseMessage?.title ||
    messageContent.templateButtonReplyMessage?.selectedDisplayText ||
    ""
  );
};

/**
 * Mengunduh byte media dari sebuah pesan lalu mengunggahnya ke Cloudinary.
 * Ukuran dicek lebih dulu agar berkas melebihi batas tidak ikut diunduh,
 * sehingga RAM dan bandwidth AWS tetap hemat. Mengembalikan metadata media
 * (termasuk URL HTTPS) atau null bila dilewati/gagal.
 */
const downloadAndUploadMedia = async (
  incomingMessage,
  messageContent,
  messageType,
  sessionId,
) => {
  const mediaInfo = extractMediaInfo(messageContent, messageType);

  if (!mediaInfo) {
    return null;
  }

  if (mediaInfo.fileLength > env.mediaMaxBytes) {
    logger.warn(
      {
        sessionId,
        fileLength: mediaInfo.fileLength,
        limit: env.mediaMaxBytes,
      },
      "Ukuran media melebihi batas, media dilewati",
    );

    return null;
  }

  try {
    const session = sessions.get(sessionId);

    const buffer = await downloadMediaMessage(
      incomingMessage,
      "buffer",
      {},
      {
        logger,
        reuploadRequest: session?.socket?.updateMediaMessage,
      },
    );

    if (buffer.length > env.mediaMaxBytes) {
      logger.warn(
        { sessionId, bytes: buffer.length, limit: env.mediaMaxBytes },
        "Ukuran media (setelah unduh) melebihi batas, media dilewati",
      );

      return null;
    }

    return await uploadInboundMedia(buffer, {
      mimetype: mediaInfo.mimetype,
      fileName: mediaInfo.fileName,
      resourceType: mediaInfo.resourceType,
      sessionId,
    });
  } catch (error) {
    logger.error(
      { err: error?.message, sessionId },
      "Gagal mengunduh media masuk dari WhatsApp",
    );

    return null;
  }
};

/**
 * Menangani pesan masuk untuk sebuah sesi lalu meneruskannya
 * ke webhook AutoFlow. Pesan dari diri sendiri diabaikan untuk
 * mencegah perulangan tak terbatas. Media (gambar/video/audio/dokumen)
 * diunduh lalu diunggah ke Cloudinary, dan URL-nya disertakan di payload.
 */
const createIncomingMessageHandler = (sessionId) => {
  return async ({ messages, type }) => {
    if (type !== "notify") {
      return;
    }

    for (const incomingMessage of messages) {
      if (incomingMessage.key.fromMe || !incomingMessage.message) {
        continue;
      }

      const remoteJid = incomingMessage.key.remoteJid || "";

      if (remoteJid.endsWith("@g.us") || remoteJid === "status@broadcast") {
        continue;
      }

      const sender = resolveSenderNumber(incomingMessage.key);
      const messageText = extractMessageText(incomingMessage.message);
      const senderName = incomingMessage.pushName || "";

      const messageContent = unwrapMessage(incomingMessage.message);
      const messageType = detectMessageType(messageContent);
      const isMedia = messageType !== "text";

      /** Lewati hanya bila benar-benar kosong: tanpa teks dan bukan media. */
      if (!messageText && !isMedia) {
        continue;
      }

      if (!sender) {
        logger.warn(
          { sessionId, remoteJid },
          "Nomor pengirim tidak dapat diresolusi dari LID, balasan dilewati",
        );

        continue;
      }

      logger.info(
        { sessionId, sender, messageType },
        "Pesan masuk diterima dari WhatsApp",
      );

      const media = isMedia
        ? await downloadAndUploadMedia(
            incomingMessage,
            messageContent,
            messageType,
            sessionId,
          )
        : null;

      const inboundPayload = {
        sessionId,
        sender,
        message: messageText,
        name: senderName,
        messageType,
        media,
        sentAt: convertUnixToIso(incomingMessage.messageTimestamp),
        receivedAt: new Date().toISOString(),
      };

      /**
       * Teruskan ke webhook engine (menggerakkan workflow) dan publikasikan ke
       * Ably (UI realtime) secara berdampingan. Keduanya memakai payload sama.
       */
      await forwardInboundMessage(inboundPayload);

      await publishInboundMessage(sessionId, inboundPayload);
    }
  };
};

/**
 * Memetakan kode status pesan Baileys menjadi label yang mudah dibaca.
 * Status 2 (server ack/centang satu) berarti pesan baru sampai server WhatsApp,
 * sedangkan 3 (delivery ack/centang dua) berarti pesan sampai ke perangkat
 * penerima. Bila status mentok di 2, pesan tidak benar-benar terkirim.
 */
const MESSAGE_STATUS_LABEL = {
  0: "error",
  1: "pending",
  2: "server-ack",
  3: "delivered",
  4: "read",
  5: "played",
};

/**
 * Menangani pembaruan status pesan keluar (centang) dari WhatsApp. Berguna
 * untuk mengetahui apakah pesan benar-benar sampai ke penerima atau hanya
 * diterima server, karena `sendMessage` yang sukses belum menjamin pengiriman.
 */
const createMessageStatusHandler = (sessionId) => {
  return (updates) => {
    for (const { key, update } of updates) {
      if (typeof update?.status === "undefined") {
        continue;
      }

      logger.info(
        {
          sessionId,
          messageId: key?.id,
          remoteJid: key?.remoteJid,
          status: MESSAGE_STATUS_LABEL[update.status] || update.status,
        },
        "Status pengiriman pesan diperbarui",
      );
    }
  };
};

/**
 * Menangani pembaruan status koneksi untuk sebuah sesi, termasuk
 * menampilkan QR code, melakukan reconnect otomatis, dan
 * memulihkan sesi secara otomatis saat terjadi logout.
 */
const createConnectionUpdateHandler = (sessionId) => {
  return async (update) => {
    const { connection, lastDisconnect, qr } = update;

    const session = sessions.get(sessionId);

    if (!session) {
      return;
    }

    if (qr) {
      session.status = "qr";

      logger.info({ sessionId }, "QR code diterima, silakan scan");

      qrcodeTerminal.generate(qr, { small: true });

      try {
        session.qrDataUrl = await QRCode.toDataURL(qr);
      } catch (error) {
        logger.error(
          { err: error?.message, sessionId },
          "Gagal mengubah QR code menjadi data URL",
        );
      }

      await publishSessionUpdate(sessionId, getSessionStatus(sessionId));
    }

    if (connection === "open") {
      session.status = "open";
      session.qrDataUrl = null;
      session.phoneNumber = extractNumberFromJid(
        session.socket?.user?.id || "",
      );
      session.name =
        session.socket?.user?.name || session.socket?.user?.notify || "";
      session.connectedAt = new Date().toISOString();

      logger.info(
        { sessionId, phoneNumber: session.phoneNumber },
        "Koneksi WhatsApp tersambung",
      );

      await logoutDuplicateSessions(sessionId, session.phoneNumber);

      await publishSessionUpdate(sessionId, getSessionStatus(sessionId));
    }

    if (connection === "close") {
      session.status = "close";
      session.qrDataUrl = null;

      const statusCode = lastDisconnect?.error?.output?.statusCode;
      const shouldReconnect = statusCode !== DisconnectReason.loggedOut;

      logger.warn(
        { sessionId, statusCode, shouldReconnect },
        "Koneksi WhatsApp terputus",
      );

      await publishSessionUpdate(sessionId, getSessionStatus(sessionId));

      if (shouldReconnect) {
        startSession(sessionId);
      } else {
        logger.error(
          { sessionId },
          "Perangkat ter-logout. Menghapus folder sesi dan memulai ulang...",
        );

        removeSessionAuthFolder(sessionId);

        setTimeout(() => startSession(sessionId), 2000);
      }
    }
  };
};

/**
 * Menghapus folder auth milik sebuah sesi dari disk.
 */
const removeSessionAuthFolder = (sessionId) => {
  const authFolder = getSessionAuthFolder(sessionId);

  try {
    if (fs.existsSync(authFolder)) {
      fs.rmSync(authFolder, { recursive: true, force: true });
    }
  } catch (error) {
    logger.error(
      { err: error?.message, sessionId },
      "Gagal menghapus folder sesi",
    );
  }
};

/**
 * Melakukan logout pada sesi lama yang ternyata memakai nomor WhatsApp
 * yang sama dengan sesi yang baru saja tersambung. Tujuannya agar satu
 * nomor WhatsApp hanya aktif pada satu sesi (scan terbaru yang menang).
 */
const logoutDuplicateSessions = async (currentSessionId, phoneNumber) => {
  if (!phoneNumber) {
    return;
  }

  for (const [otherSessionId, otherSession] of sessions.entries()) {
    if (otherSessionId === currentSessionId) {
      continue;
    }

    if (otherSession.phoneNumber !== phoneNumber) {
      continue;
    }

    logger.warn(
      { currentSessionId, otherSessionId, phoneNumber },
      "Nomor WhatsApp sama terdeteksi di sesi lain, melakukan logout sesi lama",
    );

    await deleteSession(otherSessionId);
  }
};

/**
 * Membuat atau memulai ulang sebuah sesi WhatsApp berdasarkan sessionId.
 * Sesi disimpan persisten di folder masing-masing sehingga restart
 * kontainer tidak memaksa logout.
 */
export const startSession = async (sessionId) => {
  const authFolder = getSessionAuthFolder(sessionId);

  const { state, saveCreds } = await useMultiFileAuthState(authFolder);

  const { version } = await fetchLatestBaileysVersion();

  const socket = makeWASocket({
    version,
    auth: state,
    logger,
    printQRInTerminal: false,
  });

  const existingSession = sessions.get(sessionId);

  sessions.set(sessionId, {
    socket,
    status: existingSession?.status || "connecting",
    qrDataUrl: existingSession?.qrDataUrl || null,
    phoneNumber: existingSession?.phoneNumber || null,
    name: existingSession?.name || null,
    connectedAt: existingSession?.connectedAt || null,
  });

  socket.ev.on("creds.update", saveCreds);
  socket.ev.on("connection.update", createConnectionUpdateHandler(sessionId));
  socket.ev.on("messages.upsert", createIncomingMessageHandler(sessionId));
  socket.ev.on("messages.update", createMessageStatusHandler(sessionId));

  return socket;
};

/**
 * Mengembalikan status sesi terkini beserta QR code bila tersedia.
 * Mengembalikan null jika sesi belum pernah dibuat.
 */
export const getSessionStatus = (sessionId) => {
  const session = sessions.get(sessionId);

  if (!session) {
    return null;
  }

  return {
    status: session.status,
    isReady: session.status === "open",
    qr: session.status === "open" ? null : session.qrDataUrl,
    user:
      session.status === "open"
        ? {
            phoneNumber: session.phoneNumber || null,
            name: session.name || null,
            connectedAt: session.connectedAt || null,
          }
        : null,
  };
};

/**
 * Mengembalikan ringkasan seluruh sesi yang sedang dikelola.
 */
export const getAllSessions = () => {
  const summaries = [];

  for (const [sessionId, session] of sessions.entries()) {
    summaries.push({
      sessionId,
      status: session.status,
      isReady: session.status === "open",
      phoneNumber: session.phoneNumber || null,
      name: session.name || null,
      connectedAt: session.connectedAt || null,
    });
  }

  return summaries;
};

/**
 * Mengirim pesan teks dari sebuah sesi ke nomor target.
 * Nomor target divalidasi terlebih dahulu apakah terdaftar di WhatsApp.
 */
export const sendTextMessage = async ({ sessionId, target, message }) => {
  const session = sessions.get(sessionId);

  if (!session || session.status !== "open") {
    throw new Error(
      "Sesi WhatsApp belum siap, silakan scan QR terlebih dahulu",
    );
  }

  const { socket } = session;

  const jid = toWhatsappJid(target);

  const [registeredNumber] = await socket.onWhatsApp(jid);

  if (!registeredNumber?.exists) {
    const notRegisteredError = new Error(
      "Nomor target tidak terdaftar whatsapp",
    );
    notRegisteredError.statusCode = 400;
    throw notRegisteredError;
  }

  /**
   * Kirim ke JID kanonik yang dikembalikan WhatsApp. Sejak migrasi LID,
   * JID ini bisa berbeda dari format <nomor>@s.whatsapp.net yang dibuat manual,
   * dan mengirim ke JID yang salah membuat pesan diterima server tapi tidak
   * sampai ke penerima.
   */
  const recipientJid = registeredNumber.jid || jid;

  const sentMessage = await socket.sendMessage(recipientJid, { text: message });

  logger.info(
    { sessionId, recipientJid, messageId: sentMessage?.key?.id || null },
    "Pesan teks dikirim ke WhatsApp (menunggu ack pengiriman)",
  );

  return {
    messageId: sentMessage?.key?.id || null,
  };
};

/**
 * Mengirim status presence (mis. "composing"/sedang mengetik) dari sebuah sesi
 * ke nomor target. WhatsApp memerlukan subscribe presence terlebih dahulu agar
 * indikator tampil andal di perangkat penerima. Indikator "composing" hilang
 * otomatis saat pesan berikutnya terkirim, jadi pengiriman "paused" opsional.
 */
export const sendPresence = async ({ sessionId, target, presence }) => {
  const session = sessions.get(sessionId);

  if (!session || session.status !== "open") {
    throw new Error(
      "Sesi WhatsApp belum siap, silakan scan QR terlebih dahulu",
    );
  }

  const { socket } = session;

  const jid = toWhatsappJid(target);

  await socket.presenceSubscribe(jid);

  await socket.sendPresenceUpdate(presence, jid);
};

/**
 * Melakukan logout sesi, menutup socket, lalu menghapus
 * folder auth-nya sehingga sesi benar-benar bersih.
 */
export const deleteSession = async (sessionId) => {
  const session = sessions.get(sessionId);

  /**
   * Sesi dihapus dari map terlebih dahulu agar event "close" akibat
   * proses logout tidak memicu reconnect atau restart otomatis.
   */
  sessions.delete(sessionId);

  if (session?.socket) {
    try {
      await session.socket.logout();
    } catch (error) {
      logger.warn(
        { err: error?.message, sessionId },
        "Gagal logout socket, melanjutkan pembersihan",
      );
    }
  }

  removeSessionAuthFolder(sessionId);

  /**
   * Sesi sudah dihapus dari memori sehingga getSessionStatus mengembalikan
   * null. Kirim payload status eksplisit agar frontend dapat mereset tampilan.
   */
  await publishSessionUpdate(sessionId, {
    status: "deleted",
    isReady: false,
    qr: null,
    user: null,
  });
};

/**
 * Memulihkan seluruh sesi yang tersimpan saat server dijalankan.
 * Memindai subfolder di dalam folder auth dasar lalu menyambungkan
 * ulang setiap sesi agar jadwal AutoFlow tetap berjalan tanpa scan ulang.
 */
export const restoreSessions = async () => {
  if (!fs.existsSync(env.authFolder)) {
    logger.info("Belum ada folder sesi, melewati proses restore");
    return;
  }

  const entries = fs.readdirSync(env.authFolder, { withFileTypes: true });

  const sessionIds = entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name);

  if (sessionIds.length === 0) {
    logger.info("Tidak ada sesi tersimpan untuk dipulihkan");
    return;
  }

  for (const sessionId of sessionIds) {
    logger.info({ sessionId }, "Memulihkan sesi tersimpan");

    try {
      await startSession(sessionId);
    } catch (error) {
      logger.error({ err: error?.message, sessionId }, "Gagal memulihkan sesi");
    }
  }
};
