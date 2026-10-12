import { createApp } from "./app.js";
import { restoreSessions } from "./services/session.manager.js";
import { env, validateEnv } from "./config/env.js";
import { logger } from "./config/logger.js";

/**
 * Jaring pengaman terakhir. Secara default Node 15+ mematikan proses pada
 * promise rejection yang tidak tertangani, dan karena seluruh sesi WhatsApp
 * hidup di satu proses, satu error database sesaat bisa memutus semua akun
 * sekaligus lalu memicu reconnect massal saat kontainer restart. Handler event
 * sudah mengisolasi error-nya sendiri; ini hanya untuk jalur yang terlewat,
 * dicatat sebagai error agar tetap terlihat dan bisa diperbaiki.
 */
process.on("unhandledRejection", (reason) => {
  logger.error(
    {
      err: reason instanceof Error ? reason.message : String(reason),
      stack: reason instanceof Error ? reason.stack : undefined,
    },
    "Unhandled promise rejection tertangkap, proses tetap berjalan",
  );
});

/**
 * Titik masuk utama service. Memvalidasi konfigurasi,
 * memulihkan seluruh sesi WhatsApp yang tersimpan, lalu
 * menjalankan server HTTP.
 */
const bootstrap = async () => {
  validateEnv(logger);

  try {
    await restoreSessions();
  } catch (error) {
    logger.error(
      { err: error?.message },
      "Gagal memulihkan sesi WhatsApp tersimpan",
    );
  }

  const app = createApp();

  app.listen(env.port, () => {
    logger.info(`Server berjalan pada port ${env.port}`);
  });
};

bootstrap();
