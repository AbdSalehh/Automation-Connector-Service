import { apiClient } from "../lib/apiClient.js";
import { logger } from "../config/logger.js";
import { env } from "../config/env.js";
import {
  encryptWebhookJson,
  isWebhookEncryptionConfigured,
} from "../lib/webhookCrypto.js";

/**
 * Jumlah percobaan maksimum saat meneruskan pesan ke webhook, beserta
 * jeda dasar (ms) untuk backoff eksponensial antar percobaan.
 */
const MAX_FORWARD_ATTEMPTS = 3;
const BASE_RETRY_DELAY_MS = 1000;

/**
 * Menunda eksekusi selama durasi tertentu (ms).
 */
const sleep = (durationMs) => {
  return new Promise((resolve) => setTimeout(resolve, durationMs));
};

/**
 * Meneruskan pesan WhatsApp yang masuk ke webhook AutoFlow.
 * Payload memuat sessionId penerima, nomor pengirim, isi pesan,
 * nama pengirim, dan waktu pesan dikirim/diterima.
 *
 * Bila WEBHOOK_ENCRYPTION_KEY diatur, payload dikirim terenkripsi (AES-256-GCM)
 * pada satu field `payload`. Bila tidak, dikirim format lama (plaintext) agar
 * tetap kompatibel mundur.
 *
 * Pengiriman dicoba ulang beberapa kali dengan backoff eksponensial agar
 * gangguan jaringan sesaat atau cold-start serverless tidak menyebabkan
 * trigger di frontend hilang begitu saja.
 */
export const forwardInboundMessage = async ({
  sessionId,
  sender,
  message,
  name,
  sentAt,
  receivedAt,
}) => {
  if (!env.autoflowWebhookUrl) {
    logger.warn("AUTOFLOW_WEBHOOK_URL kosong, pesan masuk tidak diteruskan");
    return;
  }

  const inboundPayload = {
    sessionId,
    sender,
    message,
    name,
    sentAt,
    receivedAt,
  };

  const requestBody = isWebhookEncryptionConfigured()
    ? { payload: encryptWebhookJson(inboundPayload) }
    : inboundPayload;

  for (let attempt = 1; attempt <= MAX_FORWARD_ATTEMPTS; attempt += 1) {
    try {
      await apiClient.post(env.autoflowWebhookUrl, requestBody);

      logger.info(
        { sessionId, sender, attempt },
        "Pesan masuk berhasil diteruskan ke AutoFlow",
      );

      return;
    } catch (error) {
      const isLastAttempt = attempt === MAX_FORWARD_ATTEMPTS;

      logger.error(
        { err: error?.message, sessionId, sender, attempt, isLastAttempt },
        "Gagal meneruskan pesan masuk ke AutoFlow",
      );

      if (isLastAttempt) {
        return;
      }

      const retryDelayMs = BASE_RETRY_DELAY_MS * 2 ** (attempt - 1);

      await sleep(retryDelayMs);
    }
  }
};
