import {
  makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion,
  downloadMediaMessage,
} from "@whiskeysockets/baileys";
import QRCode from "qrcode";
import fs from "fs";
import path from "path";

import { env } from "../config/env.js";
import { logger } from "../config/logger.js";
import {
  extractNumberFromJid,
  resolveCanonicalJid,
  resolveSenderNumber,
  toWhatsappJid,
} from "../lib/phoneNumber.js";
import { forwardInboundMessage } from "./webhook.service.js";
import {
  publishChatUpdate,
  publishInboundMessage,
  publishSessionUpdate,
} from "./realtime.service.js";
import { detectMessageType, extractMediaInfo } from "../lib/messageType.js";
import { uploadInboundMedia } from "./media.service.js";
import {
  addChatMessage,
  clearSessionChatCache,
  getContactNames,
  registerJidAlias,
  resolveStoredCanonicalJid,
  upsertContactNames,
} from "./chat.store.js";
import {
  recordStoryReaction,
  recordStoryView,
  upsertStory,
} from "./story.store.js";

/**
 * Menyimpan seluruh sesi WhatsApp aktif dalam memori.
 * Key berupa sessionId, value berupa objek berisi socket,
 * status koneksi, dan QR code dalam bentuk data URL.
 */
const sessions = new Map();

/**
 * Menyimpan timer reconnect yang tertunda per session sehingga hanya ada
 * satu percobaan reconnect pada satu waktu.
 */
const reconnectTimers = new Map();

/**
 * Menyimpan jumlah percobaan reconnect berturut-turut per session untuk
 * menghitung backoff. Direset saat koneksi berhasil terbuka.
 */
const reconnectAttempts = new Map();

/**
 * Menandai session yang sedang dalam proses `startSession` agar pemanggilan
 * paralel tidak membuat beberapa socket sekaligus.
 */
const startingSessions = new Set();

const activeCalls = new Map();

const normalizeIdentityJid = (jid) => {
  if (!jid) {
    return "";
  }

  const [identity, server] = String(jid).split("@");
  const [user] = identity.split(":");

  return server ? `${user}@${server}` : String(jid);
};

const getSessionIdentityJids = (session) =>
  new Set(
    [
      session?.socket?.user?.id,
      session?.socket?.user?.lid,
      session?.phoneNumber ? toWhatsappJid(session.phoneNumber) : "",
      ...(session?.identityJids || []),
    ]
      .map(normalizeIdentityJid)
      .filter(Boolean),
  );

const isSessionIdentityJid = (session, jid) => {
  const normalizedJid = normalizeIdentityJid(jid);

  return Boolean(
    normalizedJid && getSessionIdentityJids(session).has(normalizedJid),
  );
};

const findConnectedSessionByJids = (candidateJids, excludedSessionId) => {
  const normalizedCandidates = new Set(
    candidateJids.map(normalizeIdentityJid).filter(Boolean),
  );

  return [...sessions.entries()].find(
    ([candidateSessionId, candidateSession]) =>
      candidateSessionId !== excludedSessionId &&
      candidateSession.status === "open" &&
      [...getSessionIdentityJids(candidateSession)].some((identityJid) =>
        normalizedCandidates.has(identityJid),
      ),
  );
};

const RECONNECT_BASE_DELAY_MS = 3000;
const RECONNECT_MAX_DELAY_MS = 60000;

/**
 * Membersihkan timer dan penghitung reconnect milik sebuah session.
 */
const clearReconnectState = (sessionId) => {
  const timer = reconnectTimers.get(sessionId);

  if (timer) {
    clearTimeout(timer);
    reconnectTimers.delete(sessionId);
  }

  reconnectAttempts.delete(sessionId);
};

/**
 * Menjadwalkan satu reconnect dengan backoff bertahap. Bila sudah ada timer
 * yang menunggu, penjadwalan baru diabaikan agar tidak menumpuk koneksi.
 */
const scheduleReconnect = (sessionId) => {
  if (reconnectTimers.has(sessionId)) {
    return;
  }

  const attempt = (reconnectAttempts.get(sessionId) || 0) + 1;
  reconnectAttempts.set(sessionId, attempt);

  const delayMs = Math.min(
    RECONNECT_BASE_DELAY_MS * 2 ** (attempt - 1),
    RECONNECT_MAX_DELAY_MS,
  );

  logger.info(
    { sessionId, attempt, delayMs },
    "Menjadwalkan reconnect WhatsApp",
  );

  const timer = setTimeout(() => {
    reconnectTimers.delete(sessionId);

    startSession(sessionId).catch((error) => {
      logger.error(
        { err: error?.message, sessionId },
        "Gagal reconnect WhatsApp",
      );

      scheduleReconnect(sessionId);
    });
  }, delayMs);

  reconnectTimers.set(sessionId, timer);
};

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

const extractSharedMessageData = (messageContent, messageType) => {
  if (messageType === "location") {
    const location =
      messageContent.locationMessage || messageContent.liveLocationMessage;

    if (!location) {
      return null;
    }

    const latitude = Number(location.degreesLatitude);
    const longitude = Number(location.degreesLongitude);

    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
      return null;
    }

    return {
      latitude,
      longitude,
      name: location.name || "",
      address: location.address || "",
      url: `https://www.google.com/maps/search/?api=1&query=${latitude},${longitude}`,
    };
  }

  if (messageType === "contact") {
    const singleContact = messageContent.contactMessage;
    const contactEntries = singleContact
      ? [singleContact]
      : messageContent.contactsArrayMessage?.contacts || [];
    const contacts = contactEntries
      .map((contactEntry) => {
        const vcard = contactEntry?.vcard || "";
        const phoneNumber =
          vcard.match(/(?:TEL[^:]*:)([^\r\n]+)/i)?.[1]?.trim() || "";

        return {
          displayName: contactEntry?.displayName || "Kontak WhatsApp",
          phoneNumber,
        };
      })
      .filter(
        (contactEntry) => contactEntry.displayName || contactEntry.phoneNumber,
      );

    if (contacts.length === 0) {
      return null;
    }

    return {
      contacts,
      contactCount: contacts.length,
    };
  }

  return null;
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
      messageType,
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
const extractReplyContext = (messageContent) => {
  const content = unwrapMessage(messageContent);
  const contentEntry = Object.values(content || {}).find(
    (value) => value?.contextInfo,
  );
  const contextInfo = contentEntry?.contextInfo;

  if (!contextInfo?.stanzaId || !contextInfo.quotedMessage) {
    return null;
  }

  return {
    id: contextInfo.stanzaId,
    senderJid: contextInfo.participant || null,
    message: extractMessageText(contextInfo.quotedMessage),
    messageType: detectMessageType(unwrapMessage(contextInfo.quotedMessage)),
  };
};

const extractMentionJids = (messageContent) => {
  const content = unwrapMessage(messageContent);
  const contentEntry = Object.values(content || {}).find(
    (value) => value?.contextInfo?.mentionedJid?.length,
  );

  return Array.from(new Set(contentEntry?.contextInfo?.mentionedJid || []));
};

const resolveMentions = (mentionJids, contactNames) =>
  mentionJids.map((mentionJid) => ({
    jid: mentionJid,
    number: extractNumberFromJid(mentionJid),
    name:
      contactNames.get(mentionJid) ||
      extractNumberFromJid(mentionJid) ||
      "Kontak WhatsApp",
  }));

const resolveConversationName = async (socket, remoteJid, contactNames) => {
  const storedName = contactNames?.get(remoteJid) || "";

  if (storedName) {
    return storedName;
  }

  if (remoteJid.endsWith("@g.us")) {
    try {
      const metadata = await socket.groupMetadata(remoteJid);
      return metadata.subject || "Grup WhatsApp";
    } catch (error) {
      logger.warn(
        { err: error?.message, remoteJid },
        "Nama grup WhatsApp tidak dapat diambil",
      );

      return "Grup WhatsApp";
    }
  }

  return "";
};

const createIncomingMessageHandler = (sessionId) => {
  return async ({ messages, type }) => {
    if (type !== "notify") {
      return;
    }

    for (const incomingMessage of messages) {
      if (!incomingMessage.message) {
        continue;
      }

      const remoteJid = incomingMessage.key.remoteJid || "";

      if (remoteJid === "status@broadcast") {
        const messageContent = unwrapMessage(incomingMessage.message);
        const messageType = detectMessageType(messageContent);
        const messageText = extractMessageText(incomingMessage.message);
        const senderJid =
          incomingMessage.key.participantPn ||
          incomingMessage.key.participant ||
          incomingMessage.key.remoteJidAlt ||
          "";

        if (!incomingMessage.key.id || !senderJid) {
          continue;
        }

        const isDownloadableMedia = [
          "image",
          "video",
          "audio",
          "document",
          "sticker",
        ].includes(messageType);
        const sharedMessageData = extractSharedMessageData(
          messageContent,
          messageType,
        );

        if (!messageText && !isDownloadableMedia && !sharedMessageData) {
          continue;
        }

        const contactNames = await getContactNames(sessionId, [senderJid]);
        const senderName =
          contactNames.get(senderJid) || incomingMessage.pushName || "";
        const media = isDownloadableMedia
          ? await downloadAndUploadMedia(
              incomingMessage,
              messageContent,
              messageType,
              sessionId,
            )
          : sharedMessageData;
        const sentAt = new Date(
          convertUnixToIso(incomingMessage.messageTimestamp),
        );

        await upsertStory(sessionId, {
          whatsappId: incomingMessage.key.id,
          senderJid,
          senderName,
          messageType,
          message: messageText,
          media,
          fromMe: Boolean(incomingMessage.key.fromMe),
          sentAt,
          expiresAt: new Date(sentAt.getTime() + 24 * 60 * 60 * 1000),
        });

        continue;
      }

      const isFromMe = Boolean(incomingMessage.key.fromMe);

      /**
       * Pesan fromMe (dikirim dari HP, bukan dari API ini) tidak punya
       * `senderPn`/`participantPn`; nomor lawan bicara diambil dari
       * `remoteJid` itu sendiri.
       */
      const sender = isFromMe
        ? extractNumberFromJid(remoteJid)
        : resolveSenderNumber(incomingMessage.key);
      const messageText = extractMessageText(incomingMessage.message);
      const messageContent = unwrapMessage(incomingMessage.message);
      const mentionJids = extractMentionJids(incomingMessage.message);
      const senderJid =
        incomingMessage.key.participant ||
        incomingMessage.key.participantPn ||
        remoteJid;
      const contactNames = await getContactNames(sessionId, [
        senderJid,
        remoteJid,
        ...mentionJids,
      ]);
      const senderName =
        contactNames.get(senderJid) || incomingMessage.pushName || "";
      const mentions = resolveMentions(mentionJids, contactNames);

      const messageType = detectMessageType(messageContent);
      const isDownloadableMedia = [
        "image",
        "video",
        "audio",
        "document",
        "sticker",
      ].includes(messageType);
      const sharedMessageData = extractSharedMessageData(
        messageContent,
        messageType,
      );
      const replyTo = extractReplyContext(incomingMessage.message);
      const session = sessions.get(sessionId);
      const sessionUserJid = session?.phoneNumber
        ? toWhatsappJid(session.phoneNumber)
        : "";
      const messageIdentityJids = [remoteJid, incomingMessage.key.remoteJidAlt];
      const isSelfConversation =
        !remoteJid.endsWith("@g.us") &&
        messageIdentityJids.some((identityJid) =>
          isSessionIdentityJid(session, identityJid),
        );
      const resolvedMessageJid = isSelfConversation
        ? sessionUserJid
        : resolveCanonicalJid(incomingMessage.key);
      const alternatePhoneJid = [
        incomingMessage.key.remoteJidAlt,
        incomingMessage.key.senderPn,
        incomingMessage.key.participantPn,
      ].find((jid) => jid?.endsWith("@s.whatsapp.net"));

      if (
        !isSelfConversation &&
        remoteJid.endsWith("@lid") &&
        alternatePhoneJid
      ) {
        await registerJidAlias(
          sessionId,
          remoteJid,
          alternatePhoneJid,
          isFromMe ? "" : senderName,
        );
      }

      const conversationJid = isSelfConversation
        ? sessionUserJid
        : await resolveStoredCanonicalJid(sessionId, resolvedMessageJid);
      const conversationName = isSelfConversation
        ? session?.name || ""
        : remoteJid.endsWith("@g.us")
          ? await resolveConversationName(session?.socket, remoteJid)
          : contactNames.get(conversationJid) ||
            contactNames.get(remoteJid) ||
            (isFromMe ? "" : senderName);

      /** Lewati hanya bila benar-benar kosong: tanpa teks dan bukan media. */
      if (!messageText && !isDownloadableMedia && !sharedMessageData) {
        continue;
      }

      /**
       * Nomor pengirim bisa tidak teresolusi bila remoteJid berupa `@lid`
       * dan kontaknya belum tersinkron dengan `senderPn`. Pesan tetap
       * disimpan ke cache (percakapan tetap muncul), hanya webhook yang
       * dilewati karena butuh nomor tujuan balasan yang valid.
       */
      if (!sender) {
        logger.warn(
          { sessionId, remoteJid },
          "Nomor pengirim tidak dapat diresolusi dari LID, webhook dilewati",
        );
      }

      logger.info(
        { sessionId, sender, messageType, isFromMe },
        "Pesan WhatsApp diterima",
      );

      const media = isDownloadableMedia
        ? await downloadAndUploadMedia(
            incomingMessage,
            messageContent,
            messageType,
            sessionId,
          )
        : sharedMessageData;

      const chatMessage = {
        id: incomingMessage.key.id,
        jid: conversationJid,
        sender: isSelfConversation ? session?.phoneNumber || sender : sender,
        message: messageText,
        name: isSelfConversation ? session?.name || "" : senderName,
        conversationName,
        messageType,
        media,
        replyTo,
        mentions,
        fromMe: isFromMe,
        sentAt: convertUnixToIso(incomingMessage.messageTimestamp),
        receivedAt: new Date().toISOString(),
      };

      await addChatMessage(sessionId, conversationJid, chatMessage);

      await publishChatUpdate(sessionId, chatMessage);

      /**
       * Webhook engine (menggerakkan workflow) hanya dipicu untuk pesan
       * masuk yang bukan fromMe dan punya sender valid, agar tidak
       * memicu balasan otomatis atas pesan yang kita kirim sendiri.
       */
      if (!isFromMe && sender) {
        const inboundPayload = {
          sessionId,
          sender,
          message: messageText,
          name: senderName,
          messageType,
          media,
          sentAt: chatMessage.sentAt,
          receivedAt: chatMessage.receivedAt,
        };

        await forwardInboundMessage(inboundPayload);
        await publishInboundMessage(sessionId, inboundPayload);
      }
    }
  };
};

const createCallHandler = (sessionId) => {
  return async (callEvents) => {
    const session = sessions.get(sessionId);

    for (const callEvent of callEvents || []) {
      const rawConversationJid = callEvent.groupJid || callEvent.chatId;

      if (!rawConversationJid || !callEvent.id) {
        continue;
      }

      let conversationJid = rawConversationJid;
      let callerSessionEntry = null;
      const isSelfConversation =
        !callEvent.isGroup && isSessionIdentityJid(session, rawConversationJid);

      if (isSelfConversation) {
        conversationJid = toWhatsappJid(session?.phoneNumber || "");
      } else if (!callEvent.isGroup) {
        const participantJids = [rawConversationJid, callEvent.from].filter(
          Boolean,
        );

        callerSessionEntry = findConnectedSessionByJids(
          participantJids,
          sessionId,
        );

        if (callerSessionEntry) {
          const [, callerSession] = callerSessionEntry;

          conversationJid = toWhatsappJid(callerSession.phoneNumber);

          for (const participantJid of participantJids) {
            if (participantJid.endsWith("@lid")) {
              await registerJidAlias(
                sessionId,
                normalizeIdentityJid(participantJid),
                conversationJid,
                callerSession.name || "",
              );
            }
          }
        } else {
          const locallyResolvedJid = resolveCanonicalJid({
            remoteJid: rawConversationJid,
          });

          conversationJid = await resolveStoredCanonicalJid(
            sessionId,
            locallyResolvedJid,
          );

          if (!conversationJid.endsWith("@s.whatsapp.net")) {
            logger.warn(
              { sessionId, callId: callEvent.id, participantJids },
              "Call diabaikan karena identitas peserta belum dapat diresolusi",
            );

            continue;
          }
        }
      }

      const callKey = `${sessionId}:${callEvent.id}`;
      const previousCall = activeCalls.get(callKey);
      const callDate = new Date(callEvent.date || Date.now());
      const isNewCallAttempt = callEvent.status === "offer" || !previousCall;
      const callState = {
        messageId: isNewCallAttempt
          ? `call:${callEvent.id}:${callDate.getTime()}`
          : previousCall.messageId,
        acceptedAt:
          callEvent.status === "accept"
            ? callDate
            : (previousCall?.acceptedAt ?? null),
        isVideo: callEvent.isVideo ?? previousCall?.isVideo ?? false,
      };

      activeCalls.set(callKey, callState);

      const durationSeconds =
        callEvent.status === "terminate" && callState.acceptedAt
          ? Math.max(0, Math.round((callDate - callState.acceptedAt) / 1000))
          : null;
      let conversationName = "";

      if (callEvent.isGroup) {
        conversationName = await resolveConversationName(
          session?.socket,
          conversationJid,
        );
      } else {
        const contactNames = await getContactNames(sessionId, [
          conversationJid,
          rawConversationJid,
        ]);

        conversationName = isSelfConversation
          ? session?.name || ""
          : contactNames.get(conversationJid) ||
            contactNames.get(rawConversationJid) ||
            "";
      }

      const sessionUserJid = toWhatsappJid(session?.phoneNumber || "");
      const canonicalCallerJid = isSelfConversation
        ? sessionUserJid
        : callerSessionEntry
          ? toWhatsappJid(callerSessionEntry[1].phoneNumber)
          : await resolveStoredCanonicalJid(
              sessionId,
              callEvent.from || conversationJid,
            );
      const isFromMe =
        isSelfConversation || (!callEvent.isGroup && !callerSessionEntry);
      const call = {
        id: callEvent.id,
        status: callEvent.status,
        isVideo: callState.isVideo,
        isGroup: Boolean(callEvent.isGroup),
        durationSeconds,
      };
      const chatMessage = {
        id: callState.messageId,
        jid: conversationJid,
        sender: extractNumberFromJid(canonicalCallerJid),
        message: callState.isVideo ? "Video call" : "Voice call",
        name: isFromMe ? "" : conversationName,
        conversationName,
        messageType: "call",
        media: null,
        replyTo: null,
        call,
        fromMe: isFromMe,
        sentAt: callDate.toISOString(),
        receivedAt: new Date().toISOString(),
      };

      await addChatMessage(sessionId, conversationJid, chatMessage);
      await publishChatUpdate(sessionId, chatMessage);

      if (!callEvent.isGroup && callerSessionEntry) {
        const [callerSessionId, callerSession] = callerSessionEntry;
        const receiverJid = sessionUserJid;
        const callerContactNames = await getContactNames(callerSessionId, [
          receiverJid,
        ]);
        const receiverName =
          callerContactNames.get(receiverJid) || session?.name || "";

        for (const identityJid of getSessionIdentityJids(session)) {
          if (identityJid.endsWith("@lid")) {
            await registerJidAlias(
              callerSessionId,
              identityJid,
              receiverJid,
              receiverName,
            );
          }
        }

        const callerChatMessage = {
          ...chatMessage,
          jid: receiverJid,
          sender: callerSession.phoneNumber,
          name: "",
          conversationName: receiverName,
          fromMe: true,
        };

        await addChatMessage(callerSessionId, receiverJid, callerChatMessage);
        await publishChatUpdate(callerSessionId, callerChatMessage);
      }

      if (["terminate", "reject", "timeout"].includes(callEvent.status)) {
        activeCalls.delete(callKey);
      }
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
const createContactHandler = (sessionId) => {
  return async (contacts) => {
    await upsertContactNames(
      sessionId,
      contacts.map((contact) => ({
        jid: contact.id,
        name: contact.name || contact.notify || contact.verifiedName || "",
      })),
    );

    for (const contact of contacts) {
      const phoneJid = [contact.id, contact.phoneNumber, contact.pn].find(
        (jid) => jid?.endsWith("@s.whatsapp.net"),
      );
      const lidJid = [contact.id, contact.lid].find((jid) =>
        jid?.endsWith("@lid"),
      );

      if (phoneJid && lidJid) {
        await registerJidAlias(
          sessionId,
          lidJid,
          phoneJid,
          contact.name || contact.notify || contact.verifiedName || "",
        );
      }
    }
  };
};

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
const createConnectionUpdateHandler = (sessionId, ownerSocket) => {
  return async (update) => {
    const { connection, lastDisconnect, qr } = update;

    const session = sessions.get(sessionId);

    if (!session) {
      return;
    }

    /**
     * Abaikan event dari socket lama. Saat reconnect, socket lama dapat
     * mengirim event `close` setelah socket baru dibuat; tanpa penjaga ini
     * event tersebut akan memicu reconnect berulang tanpa henti.
     */
    if (session.socket !== ownerSocket) {
      return;
    }

    if (qr) {
      session.status = "qr";

      logger.info({ sessionId }, "QR code diterima, silakan scan");

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
      const previousPhoneNumber = session.phoneNumber;
      const connectedPhoneNumber = extractNumberFromJid(
        session.socket?.user?.id || "",
      );

      if (
        previousPhoneNumber &&
        connectedPhoneNumber &&
        previousPhoneNumber !== connectedPhoneNumber
      ) {
        await clearSessionChatCache(sessionId);
      }

      clearReconnectState(sessionId);

      session.status = "open";
      session.qrDataUrl = null;
      session.phoneNumber = connectedPhoneNumber;
      session.identityJids = Array.from(
        new Set(
          [
            ...(session.identityJids || []),
            session.socket?.user?.id,
            session.socket?.user?.lid,
          ].filter(Boolean),
        ),
      );
      session.name =
        session.socket?.user?.name || session.socket?.user?.notify || "";
      session.connectedAt = new Date().toISOString();

      logger.info(
        { sessionId, phoneNumber: session.phoneNumber },
        "Koneksi WhatsApp tersambung",
      );

      await detectDuplicateSessions(sessionId, session.phoneNumber);

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
        scheduleReconnect(sessionId);
      } else {
        logger.error(
          { sessionId },
          "Perangkat ter-logout. Menghapus auth tanpa menghapus cache chat...",
        );

        clearReconnectState(sessionId);

        session.phoneNumber = null;
        session.name = null;
        session.connectedAt = null;
        removeSessionAuthFolder(sessionId);

        scheduleReconnect(sessionId);
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
 * Mendeteksi sesi lain yang sudah memakai nomor WhatsApp yang sama. Alih-alih
 * langsung logout sesi lama, sesi baru ditandai `pendingDuplicate` sehingga
 * frontend dapat meminta konfirmasi apakah ingin melanjutkan (logout sesi lama)
 * atau membatalkan.
 */
const detectDuplicateSessions = async (currentSessionId, phoneNumber) => {
  if (!phoneNumber) {
    return;
  }

  const conflictingSessionIds = [];

  for (const [otherSessionId, otherSession] of sessions.entries()) {
    if (otherSessionId === currentSessionId) {
      continue;
    }

    if (otherSession.phoneNumber === phoneNumber) {
      conflictingSessionIds.push(otherSessionId);
    }
  }

  if (conflictingSessionIds.length === 0) {
    return;
  }

  const session = sessions.get(currentSessionId);

  if (session) {
    session.pendingDuplicate = { phoneNumber, conflictingSessionIds };
  }

  logger.warn(
    { currentSessionId, conflictingSessionIds, phoneNumber },
    "Nomor WhatsApp sama terdeteksi, menunggu konfirmasi pengguna",
  );
};

/**
 * Melanjutkan sesi yang menunggu konfirmasi duplikat: logout seluruh sesi lama
 * dengan nomor yang sama lalu membersihkan status pending.
 */
export const confirmDuplicateSession = async (
  sessionId,
  permittedSessionIds,
) => {
  const session = sessions.get(sessionId);

  if (!session?.pendingDuplicate) {
    return null;
  }

  const permittedSessionIdSet = new Set(permittedSessionIds);
  const deletedSessionIds = [];
  const { conflictingSessionIds } = session.pendingDuplicate;

  for (const otherSessionId of conflictingSessionIds) {
    if (permittedSessionIdSet.has(otherSessionId)) {
      await deleteSession(otherSessionId);
      deletedSessionIds.push(otherSessionId);
    }
  }

  session.pendingDuplicate = null;

  await publishSessionUpdate(sessionId, getSessionStatus(sessionId));

  return deletedSessionIds;
};

/**
 * Membatalkan sesi yang menunggu konfirmasi duplikat: sesi baru dihapus dan
 * sesi lama dengan nomor yang sama tetap aktif.
 */
export const cancelDuplicateSession = async (sessionId) => {
  const session = sessions.get(sessionId);

  if (!session?.pendingDuplicate) {
    return false;
  }

  await deleteSession(sessionId);

  return true;
};

/**
 * Membuat atau memulai ulang sebuah sesi WhatsApp berdasarkan sessionId.
 * Sesi disimpan persisten di folder masing-masing sehingga restart
 * kontainer tidak memaksa logout.
 */
export const startSession = async (sessionId) => {
  if (startingSessions.has(sessionId)) {
    return sessions.get(sessionId)?.socket || null;
  }

  startingSessions.add(sessionId);

  try {
    const authFolder = getSessionAuthFolder(sessionId);

    const { state, saveCreds } = await useMultiFileAuthState(authFolder);

    const { version } = await fetchLatestBaileysVersion();

    const socket = makeWASocket({
      version,
      auth: state,
      logger,
      printQRInTerminal: false,
      syncFullHistory: true,
      shouldSyncHistoryMessage: () => true,
    });

    const existingSession = sessions.get(sessionId);

    sessions.set(sessionId, {
      socket,
      status: existingSession?.status || "connecting",
      qrDataUrl: existingSession?.qrDataUrl || null,
      phoneNumber: existingSession?.phoneNumber || null,
      name: existingSession?.name || null,
      connectedAt: existingSession?.connectedAt || null,
      identityJids: [
        state.creds?.me?.id,
        state.creds?.me?.lid,
        ...(existingSession?.identityJids || []),
      ].filter(Boolean),
    });

    socket.ev.on("creds.update", saveCreds);
    socket.ev.on(
      "connection.update",
      createConnectionUpdateHandler(sessionId, socket),
    );
    socket.ev.on("messages.upsert", createIncomingMessageHandler(sessionId));
    socket.ev.on("contacts.upsert", createContactHandler(sessionId));
    socket.ev.on("contacts.update", createContactHandler(sessionId));
    socket.ev.on("call", createCallHandler(sessionId));
    socket.ev.on("messages.update", createMessageStatusHandler(sessionId));
    socket.ev.on(
      "message-receipt.update",
      createStoryReceiptHandler(sessionId),
    );
    socket.ev.on("messages.reaction", createStoryReactionHandler(sessionId));

    return socket;
  } finally {
    startingSessions.delete(sessionId);
  }
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
    pendingDuplicate: session.pendingDuplicate
      ? {
          phoneNumber: session.pendingDuplicate.phoneNumber,
          conflictingSessionIds: session.pendingDuplicate.conflictingSessionIds,
        }
      : null,
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
 * Jika `simulateTyping` bernilai true, status "composing" akan dikirimkan
 * ke target dan pengiriman pesan akan ditunda selama `typingDelay` ms
 * (atau durasi dinamis jika tidak ditentukan) untuk mensimulasikan ketikan manusia.
 */
export const sendTextMessage = async ({
  sessionId,
  target,
  message,
  simulateTyping = false,
  typingDelay,
}) => {
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

  const recipientJid = registeredNumber.jid || jid;

  // Jalankan simulasi mengetik jika diminita
  if (simulateTyping) {
    try {
      await socket.presenceSubscribe(recipientJid);
      await socket.sendPresenceUpdate("composing", recipientJid);

      // Hitung delay: gunakan nilai yang diberikan atau kalkulasi dinamis (20ms/karakter, maks 3 detik)
      const delayMs =
        typeof typingDelay === "number" && typingDelay >= 0
          ? typingDelay
          : Math.min(Math.max(message.length * 20, 1000), 3000);

      await new Promise((resolve) => setTimeout(resolve, delayMs));
    } catch (error) {
      logger.warn(
        { err: error?.message, sessionId, recipientJid },
        "Gagal mengirim presence update saat simulasi mengetik (pesan tetap dikirim)",
      );
    }
  }

  const sentMessage = await socket.sendMessage(recipientJid, { text: message });
  const sentAt = convertUnixToIso(sentMessage?.messageTimestamp);

  const chatMessage = {
    id: sentMessage?.key?.id,
    jid: recipientJid,
    sender: session.phoneNumber,
    message,
    name: "",
    messageType: "text",
    media: null,
    fromMe: true,
    sentAt,
    receivedAt: new Date().toISOString(),
  };

  await addChatMessage(sessionId, recipientJid, chatMessage);
  await publishChatUpdate(sessionId, chatMessage);

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
  clearReconnectState(sessionId);
  await clearSessionChatCache(sessionId);

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
