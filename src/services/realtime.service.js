import Ably from "ably";

import { env } from "../config/env.js";
import { logger } from "../config/logger.js";

/**
 * Nama event yang dipublikasikan saat ada balasan WhatsApp masuk.
 * Frontend men-subscribe event ini pada channel `session:<sessionId>`.
 */
const INBOUND_MESSAGE_EVENT = "inbound-message";

/**
 * Nama event yang dipublikasikan saat status sesi WhatsApp berubah
 * (mis. menampilkan QR, tersambung, terputus, atau dihapus). Frontend
 * men-subscribe event ini pada channel `session:<sessionId>` yang sama.
 */
const SESSION_UPDATE_EVENT = "session-update";

/**
 * Klien Ably REST (publish-only). Diinisialisasi malas (lazy) saat pertama
 * kali dibutuhkan agar service tetap berjalan walau ABLY_API_KEY belum diatur.
 */
let ablyClient = null;

/**
 * Mengembalikan klien Ably yang sudah diinisialisasi, atau null bila
 * ABLY_API_KEY belum diatur. Memakai REST client karena backend hanya
 * melakukan koneksi keluar (outbound HTTPS) untuk publish, sehingga tidak
 * memerlukan TLS/domain pada server ini.
 */
const getAblyClient = () => {
  if (!env.ablyApiKey) {
    return null;
  }

  if (!ablyClient) {
    ablyClient = new Ably.Rest({ key: env.ablyApiKey });
  }

  return ablyClient;
};

/**
 * Mempublikasikan balasan WhatsApp masuk ke channel realtime milik sesi
 * terkait, sehingga frontend yang sedang men-subscribe dapat menampilkannya
 * tanpa polling. Channel dipisah per `sessionId` (= id user pemilik sesi).
 *
 * Bersifat best-effort: kegagalan publish hanya dicatat dan tidak melempar
 * error, agar tidak mengganggu penerusan pesan ke webhook engine.
 */
export const publishInboundMessage = async (sessionId, payload) => {
  const client = getAblyClient();

  if (!client) {
    logger.warn(
      { sessionId },
      "Lewati publish ke Ably karena ABLY_API_KEY belum diatur di environment",
    );

    return;
  }

  try {
    const channel = client.channels.get(`session:${sessionId}`);

    await channel.publish(INBOUND_MESSAGE_EVENT, payload);

    logger.info(
      { sessionId, sender: payload.sender },
      "Balasan masuk dipublikasikan ke Ably",
    );
  } catch (error) {
    logger.error(
      { err: error?.message, sessionId },
      "Gagal mempublikasikan balasan masuk ke Ably",
    );
  }
};

/**
 * Mempublikasikan perubahan status sesi WhatsApp ke channel realtime milik
 * sesi terkait, sehingga frontend bisa memperbarui tampilan status/QR tanpa
 * polling. Memakai channel `session:<sessionId>` yang sama dengan balasan.
 *
 * Bersifat best-effort: kegagalan publish hanya dicatat dan tidak melempar
 * error, agar tidak mengganggu alur koneksi WhatsApp.
 */
export const publishSessionUpdate = async (sessionId, payload) => {
  const client = getAblyClient();

  if (!client) {
    logger.warn(
      { sessionId },
      "Lewati publish ke Ably karena ABLY_API_KEY belum diatur di environment",
    );

    return;
  }

  try {
    const channel = client.channels.get(`session:${sessionId}`);

    await channel.publish(SESSION_UPDATE_EVENT, payload);

    logger.info(
      { sessionId, status: payload.status },
      "Perubahan status sesi dipublikasikan ke Ably",
    );
  } catch (error) {
    logger.error(
      { err: error?.message, sessionId },
      "Gagal mempublikasikan perubahan status sesi ke Ably",
    );
  }
};
