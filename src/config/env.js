import dotenv from "dotenv";

dotenv.config();

export const env = {
  port: process.env.PORT ? parseInt(process.env.PORT, 10) : 3001,
  apiKey: (process.env.API_KEY || "").trim(),
  autoflowWebhookUrl: (process.env.AUTOFLOW_WEBHOOK_URL || "").trim(),
  authFolder: (process.env.AUTH_FOLDER || "./auth_info_baileys").trim(),
  corsOrigins: process.env.CORS_ORIGINS
    ? process.env.CORS_ORIGINS.split(",").map((origin) => origin.trim())
    : ["http://localhost:3000"],
};

/**
 * Memvalidasi variabel lingkungan penting dan memberi peringatan
 * jika ada konfigurasi yang belum diisi.
 */
export const validateEnv = (logger) => {
  if (!env.apiKey) {
    logger.warn(
      "API_KEY belum diatur. Endpoint tidak akan aman, segera isi di file .env",
    );
  }

  if (!env.autoflowWebhookUrl) {
    logger.warn(
      "AUTOFLOW_WEBHOOK_URL belum diatur. Pesan masuk tidak akan diteruskan ke AutoFlow",
    );
  }
};
