import { sendSuccess, sendError } from "../lib/apiResponse.js";
import { normalizePhoneNumber } from "../lib/phoneNumber.js";
import { sendTextMessage, sendPresence } from "../services/session.manager.js";
import { sanitizeSessionId } from "../lib/sessionId.js";
import { logger } from "../config/logger.js";

/**
 * Controller untuk endpoint POST /sessions/:sessionId/send-message.
 * Memvalidasi sessionId dan input, lalu mengirim pesan teks
 * melalui sesi WhatsApp yang dimaksud.
 */
export const handleSendMessage = async (req, res) => {
  const sessionId = sanitizeSessionId(req.params.sessionId);

  if (!sessionId) {
    return sendError(res, {
      statusCode: 400,
      message: "Format sessionId tidak valid",
    });
  }

  const { target, message, simulateTyping, typingDelay } = req.body || {};

  const cleanTarget = normalizePhoneNumber(target);

  if (!cleanTarget) {
    return sendError(res, {
      statusCode: 400,
      message: "Nomor target tidak valid atau hilang",
    });
  }

  if (!message || typeof message !== "string" || !message.trim()) {
    return sendError(res, {
      statusCode: 400,
      message: "Isi pesan tidak boleh kosong",
    });
  }

  try {
    const result = await sendTextMessage({
      sessionId,
      target: cleanTarget,
      message,
      simulateTyping: Boolean(simulateTyping),
      typingDelay,
    });

    return sendSuccess(res, {
      statusCode: 200,
      message: "Pesan berhasil dikirim",
      data: result,
    });
  } catch (error) {
    logger.error(
      { err: error?.message, sessionId },
      "Gagal mengirim pesan WhatsApp",
    );

    return sendError(res, {
      statusCode: error?.statusCode || 500,
      message: error?.message || "Gagal mengirim pesan WhatsApp",
    });
  }
};

/**
 * Daftar tipe presence yang diizinkan: mengetik, merekam suara, dan berhenti.
 */
const ALLOWED_PRESENCES = ["composing", "recording", "paused"];

/**
 * Controller untuk endpoint POST /sessions/:sessionId/presence.
 * Mengirim status presence (mis. "composing") ke nomor target sehingga
 * penerima melihat indikator "sedang mengetik" sebelum balasan masuk.
 */
export const handleSendPresence = async (req, res) => {
  const sessionId = sanitizeSessionId(req.params.sessionId);

  if (!sessionId) {
    return sendError(res, {
      statusCode: 400,
      message: "Format sessionId tidak valid",
    });
  }

  const { target, presence } = req.body || {};

  const cleanTarget = normalizePhoneNumber(target);

  if (!cleanTarget) {
    return sendError(res, {
      statusCode: 400,
      message: "Nomor target tidak valid atau hilang",
    });
  }

  const presenceType = presence || "composing";

  if (!ALLOWED_PRESENCES.includes(presenceType)) {
    return sendError(res, {
      statusCode: 400,
      message: "Tipe presence tidak valid",
    });
  }

  try {
    await sendPresence({
      sessionId,
      target: cleanTarget,
      presence: presenceType,
    });

    return sendSuccess(res, {
      statusCode: 200,
      message: "Presence terkirim",
      data: null,
    });
  } catch (error) {
    logger.error(
      { err: error?.message, sessionId },
      "Gagal mengirim presence WhatsApp",
    );

    return sendError(res, {
      statusCode: error?.statusCode || 500,
      message: error?.message || "Gagal mengirim presence WhatsApp",
    });
  }
};
