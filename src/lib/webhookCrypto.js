import crypto from "node:crypto";

import { env } from "../config/env.js";

/**
 * Skema enkripsi harus identik dengan sisi AutoFlow (webhookCrypto):
 * AES-256-GCM dengan token berformat base64(iv).base64(tag).base64(ciphertext).
 */
const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12;

/**
 * Mengubah WEBHOOK_ENCRYPTION_KEY menjadi kunci 32 byte. Menerima hex 64
 * karakter apa adanya, atau melakukan hash SHA-256 untuk string bebas lain.
 */
const getEncryptionKey = () => {
  const rawKey = env.webhookEncryptionKey;

  if (!rawKey) {
    throw new Error("WEBHOOK_ENCRYPTION_KEY belum diatur");
  }

  if (/^[0-9a-fA-F]{64}$/.test(rawKey)) {
    return Buffer.from(rawKey, "hex");
  }

  return crypto.createHash("sha256").update(rawKey).digest();
};

/**
 * Mengembalikan true bila kunci enkripsi webhook sudah dikonfigurasi, sehingga
 * pemanggil bisa memilih mengirim payload terenkripsi atau format lama.
 */
export const isWebhookEncryptionConfigured = () => {
  return Boolean(env.webhookEncryptionKey);
};

/**
 * Mengenkripsi sebuah nilai JSON menjadi token terenkripsi yang siap dikirim
 * ke webhook AutoFlow pada field `payload`.
 */
export const encryptWebhookJson = (value) => {
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, getEncryptionKey(), iv);

  const plaintext = Buffer.from(JSON.stringify(value), "utf8");
  const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return [
    iv.toString("base64"),
    authTag.toString("base64"),
    encrypted.toString("base64"),
  ].join(".");
};
