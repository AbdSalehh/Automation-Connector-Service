import { createApp } from "./app.js";
import { restoreSessions } from "./services/session.manager.js";
import { env, validateEnv } from "./config/env.js";
import { logger } from "./config/logger.js";

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
