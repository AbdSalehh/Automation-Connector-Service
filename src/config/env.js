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
  ablyApiKey: (process.env.ABLY_API_KEY || "").trim(),
  webhookEncryptionKey: (process.env.WEBHOOK_ENCRYPTION_KEY || "").trim(),
  cloudinaryUrl: (process.env.CLOUDINARY_URL || "").trim(),
  databaseUrl: (process.env.DATABASE_URL || "").trim(),
  directUrl: (process.env.DIRECT_URL || "").trim(),
  mediaMaxBytes: process.env.MEDIA_MAX_BYTES
    ? parseInt(process.env.MEDIA_MAX_BYTES, 10)
    : 16 * 1024 * 1024,
  chatCacheTtlHours: process.env.CHAT_CACHE_TTL_HOURS
    ? parseInt(process.env.CHAT_CACHE_TTL_HOURS, 10)
    : 24,
  chatCacheMaxConversations: process.env.CHAT_CACHE_MAX_CONVERSATIONS
    ? parseInt(process.env.CHAT_CACHE_MAX_CONVERSATIONS, 10)
    : 100,
  chatCacheMaxMessages: process.env.CHAT_CACHE_MAX_MESSAGES
    ? parseInt(process.env.CHAT_CACHE_MAX_MESSAGES, 10)
    : 200,
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

  if (!env.ablyApiKey) {
    logger.warn(
      "ABLY_API_KEY belum diatur. Balasan tidak akan dipublikasikan secara realtime ke frontend",
    );
  }

  if (!env.webhookEncryptionKey) {
    logger.warn(
      "WEBHOOK_ENCRYPTION_KEY belum diatur. Pesan masuk diteruskan ke AutoFlow tanpa enkripsi (format lama)",
    );
  }

  if (!env.cloudinaryUrl) {
    logger.warn(
      "CLOUDINARY_URL belum diatur. Media masuk tidak akan diunggah; hanya teks/caption yang diteruskan",
    );
  }

  if (!env.databaseUrl || !env.directUrl) {
    logger.warn(
      "DATABASE_URL atau DIRECT_URL belum diatur. Chat history Supabase tidak dapat digunakan",
    );
  }
};
