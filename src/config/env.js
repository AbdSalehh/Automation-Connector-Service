import dotenv from "dotenv";

dotenv.config();

export const env = {
  port: process.env.PORT ? parseInt(process.env.PORT, 10) : 3001,
  apiKey: (process.env.API_KEY || "").trim(),
  baileysOwnerSecret: (process.env.BAILEYS_OWNER_SECRET || "").trim(),
  autoflowWebhookUrl: (process.env.AUTOFLOW_WEBHOOK_URL || "").trim(),
  authFolder: (process.env.AUTH_FOLDER || "./auth_info_baileys").trim(),
  /**
   * Zona waktu untuk batas kalender "hari ini" (mis. riwayat panggilan harian).
   * Kontainer berjalan dalam UTC, sehingga tanpa ini panggilan sebelum pukul
   * 07:00 WIB akan dihitung sebagai hari sebelumnya.
   */
  timezone: (process.env.TIMEZONE || "Asia/Jakarta").trim(),
  corsOrigins: process.env.CORS_ORIGINS
    ? process.env.CORS_ORIGINS.split(",").map((origin) => origin.trim())
    : ["http://localhost:3000"],
  ablyApiKey: (process.env.ABLY_API_KEY || "").trim(),
  webhookEncryptionKey: (process.env.WEBHOOK_ENCRYPTION_KEY || "").trim(),
  /**
   * Penyimpanan media masuk: "cloudinary" (default) atau "r2" (Cloudflare R2).
   * Default dibiarkan Cloudinary agar deploy tidak mengubah perilaku sampai
   * kredensial R2 siap dan variabel ini diganti secara sadar.
   */
  storageProvider: (process.env.STORAGE_PROVIDER || "cloudinary")
    .trim()
    .toLowerCase(),
  cloudinaryUrl: (process.env.CLOUDINARY_URL || "").trim(),
  r2AccountId: (process.env.R2_ACCOUNT_ID || "").trim(),
  r2AccessKeyId: (process.env.R2_ACCESS_KEY_ID || "").trim(),
  r2SecretAccessKey: (process.env.R2_SECRET_ACCESS_KEY || "").trim(),
  r2Bucket: (process.env.R2_BUCKET || "").trim(),
  /** URL publik bucket: domain kustom (disarankan) atau subdomain r2.dev. */
  r2PublicBaseUrl: (process.env.R2_PUBLIC_BASE_URL || "")
    .trim()
    .replace(/\/+$/, ""),
  databaseUrl: (process.env.DATABASE_URL || "").trim(),
  directUrl: (process.env.DIRECT_URL || "").trim(),
  mediaMaxBytes: process.env.MEDIA_MAX_BYTES
    ? parseInt(process.env.MEDIA_MAX_BYTES, 10)
    : 16 * 1024 * 1024,
  chatCacheMaxConversations: process.env.CHAT_CACHE_MAX_CONVERSATIONS
    ? parseInt(process.env.CHAT_CACHE_MAX_CONVERSATIONS, 10)
    : 100,
  chatCacheMaxMessages: process.env.CHAT_CACHE_MAX_MESSAGES
    ? parseInt(process.env.CHAT_CACHE_MAX_MESSAGES, 10)
    : 5000,
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

  if (!env.baileysOwnerSecret) {
    logger.warn(
      "BAILEYS_OWNER_SECRET belum diatur. Endpoint sesi tidak dapat memverifikasi kepemilikan user",
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

  if (env.storageProvider === "r2") {
    const missingR2Variables = [
      ["R2_ACCOUNT_ID", env.r2AccountId],
      ["R2_ACCESS_KEY_ID", env.r2AccessKeyId],
      ["R2_SECRET_ACCESS_KEY", env.r2SecretAccessKey],
      ["R2_BUCKET", env.r2Bucket],
      ["R2_PUBLIC_BASE_URL", env.r2PublicBaseUrl],
    ]
      .filter(([, value]) => !value)
      .map(([name]) => name);

    if (missingR2Variables.length > 0) {
      logger.warn(
        { missingR2Variables },
        "STORAGE_PROVIDER=r2 tetapi konfigurasi R2 belum lengkap. Media masuk tidak akan diunggah",
      );
    }
  } else if (env.storageProvider !== "cloudinary") {
    logger.warn(
      { storageProvider: env.storageProvider },
      "STORAGE_PROVIDER tidak dikenal (pilihan: cloudinary, r2). Media masuk tidak akan diunggah",
    );
  } else if (!env.cloudinaryUrl) {
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
