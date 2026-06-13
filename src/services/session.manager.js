import {
  makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion,
} from "@whiskeysockets/baileys";
import qrcodeTerminal from "qrcode-terminal";
import QRCode from "qrcode";
import fs from "fs";
import path from "path";

import { env } from "../config/env.js";
import { logger } from "../config/logger.js";
import { extractNumberFromJid, toWhatsappJid } from "../lib/phoneNumber.js";
import { forwardInboundMessage } from "./webhook.service.js";

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
 * Membaca isi teks dari berbagai kemungkinan struktur pesan WhatsApp,
 * baik pesan teks biasa maupun pesan teks dengan konteks tambahan.
 */
const extractMessageText = (messageContent) => {
  if (!messageContent) {
    return "";
  }

  return (
    messageContent.conversation ||
    messageContent.extendedTextMessage?.text ||
    ""
  );
};

/**
 * Menangani pesan masuk untuk sebuah sesi lalu meneruskannya
 * ke webhook AutoFlow. Pesan dari diri sendiri diabaikan untuk
 * mencegah perulangan tak terbatas.
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

      const sender = extractNumberFromJid(remoteJid);
      const messageText = extractMessageText(incomingMessage.message);
      const senderName = incomingMessage.pushName || "";

      if (!messageText) {
        continue;
      }

      logger.info({ sessionId, sender }, "Pesan masuk diterima dari WhatsApp");

      await forwardInboundMessage({
        sessionId,
        sender,
        message: messageText,
        name: senderName,
        receivedAt: new Date().toISOString(),
      });
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
    }

    if (connection === "open") {
      session.status = "open";
      session.qrDataUrl = null;

      logger.info({ sessionId }, "Koneksi WhatsApp tersambung");
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
  });

  socket.ev.on("creds.update", saveCreds);
  socket.ev.on("connection.update", createConnectionUpdateHandler(sessionId));
  socket.ev.on("messages.upsert", createIncomingMessageHandler(sessionId));

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

  const sentMessage = await socket.sendMessage(jid, { text: message });

  return {
    messageId: sentMessage?.key?.id || null,
  };
};

/**
 * Melakukan logout sesi, menutup socket, lalu menghapus
 * folder auth-nya sehingga sesi benar-benar bersih.
 */
export const deleteSession = async (sessionId) => {
  const session = sessions.get(sessionId);

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

  sessions.delete(sessionId);

  removeSessionAuthFolder(sessionId);
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
