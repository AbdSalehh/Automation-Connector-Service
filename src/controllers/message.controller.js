import { sendSuccess, sendError } from "../lib/apiResponse.js";
import { normalizePhoneNumber } from "../lib/phoneNumber.js";
import { sendTextMessage } from "../services/session.manager.js";
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

  const { target, message } = req.body || {};

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
