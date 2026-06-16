import { v2 as cloudinary } from "cloudinary";

import { env } from "../config/env.js";
import { logger } from "../config/logger.js";

/**
 * Menandai apakah Cloudinary sudah dikonfigurasi sekali saja, agar inisialisasi
 * (parsing CLOUDINARY_URL) tidak diulang pada setiap pesan media masuk.
 */
let isCloudinaryConfigured = false;

/**
 * Menginisialisasi Cloudinary dari CLOUDINARY_URL secara lazy. Mengembalikan
 * false bila kredensial belum diatur, sehingga pemanggil bisa melewati upload
 * tanpa mengganggu jalur teks.
 */
const ensureCloudinaryReady = () => {
  if (isCloudinaryConfigured) {
    return true;
  }

  if (!env.cloudinaryUrl) {
    return false;
  }

  /** SDK membaca CLOUDINARY_URL dari environment secara otomatis. */
  cloudinary.config({ secure: true });

  isCloudinaryConfigured = true;

  return true;
};

/**
 * Mengunggah buffer media masuk ke Cloudinary lalu mengembalikan URL HTTPS
 * (CDN). Bersifat best-effort: bila Cloudinary belum dikonfigurasi atau upload
 * gagal, mengembalikan null dan mencatat log, tanpa melempar error agar
 * penerusan pesan teks/caption tetap berjalan.
 */
export const uploadInboundMedia = async (
  buffer,
  { mimetype, fileName, resourceType, sessionId },
) => {
  if (!ensureCloudinaryReady()) {
    logger.warn(
      { sessionId },
      "Lewati upload media karena CLOUDINARY_URL belum diatur",
    );

    return null;
  }

  try {
    const uploadResult = await new Promise((resolve, reject) => {
      const uploadStream = cloudinary.uploader.upload_stream(
        {
          resource_type: resourceType,
          folder: "whatsapp-inbound",
          use_filename: Boolean(fileName),
          filename_override: fileName || undefined,
        },
        (error, result) => {
          if (error) {
            reject(error);
            return;
          }

          resolve(result);
        },
      );

      uploadStream.end(buffer);
    });

    logger.info(
      { sessionId, bytes: uploadResult.bytes },
      "Media masuk berhasil diunggah ke Cloudinary",
    );

    return {
      url: uploadResult.secure_url,
      mimetype,
      fileName,
      fileLength: uploadResult.bytes,
    };
  } catch (error) {
    logger.error(
      { err: error?.message, sessionId },
      "Gagal mengunggah media masuk ke Cloudinary",
    );

    return null;
  }
};
