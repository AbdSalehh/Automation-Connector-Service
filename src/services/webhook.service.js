import { apiClient } from "../lib/apiClient.js";
import { logger } from "../config/logger.js";
import { env } from "../config/env.js";

/**
 * Meneruskan pesan WhatsApp yang masuk ke webhook AutoFlow.
 * Payload memuat sessionId penerima, nomor pengirim, isi pesan,
 * nama pengirim, dan waktu pesan diterima.
 */
export const forwardInboundMessage = async ({
  sessionId,
  sender,
  message,
  name,
  receivedAt,
}) => {
  if (!env.autoflowWebhookUrl) {
    logger.warn("AUTOFLOW_WEBHOOK_URL kosong, pesan masuk tidak diteruskan");
    return;
  }

  try {
    await apiClient.post(env.autoflowWebhookUrl, {
      sessionId,
      sender,
      message,
      name,
      receivedAt,
    });

    logger.info(
      { sessionId, sender },
      "Pesan masuk berhasil diteruskan ke AutoFlow",
    );
  } catch (error) {
    logger.error(
      { err: error?.message, sessionId, sender },
      "Gagal meneruskan pesan masuk ke AutoFlow",
    );
  }
};
