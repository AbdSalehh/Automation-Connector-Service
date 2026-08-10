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

const resolveUploadOptions = (messageType, fileName) => {
  const baseOptions = {
    folder: "whatsapp-inbound",
    use_filename: Boolean(fileName),
    filename_override: fileName || undefined,
  };

  if (messageType === "image" || messageType === "sticker") {
    return {
      ...baseOptions,
      resource_type: "image",
      format: "webp",
      transformation: [{ quality: "auto:eco", fetch_format: "webp" }],
      outputMimetype: "image/webp",
      outputFileName: fileName
        ? `${fileName.replace(/\.[^.]+$/, "")}.webp`
        : "image.webp",
    };
  }

  if (messageType === "video") {
    return {
      ...baseOptions,
      resource_type: "video",
      format: "mp4",
      transformation: [
        {
          width: 1280,
          height: 1280,
          crop: "limit",
          quality: "auto:eco",
          video_codec: "h264",
          audio_codec: "aac",
        },
      ],
      outputMimetype: "video/mp4",
      outputFileName: fileName
        ? `${fileName.replace(/\.[^.]+$/, "")}.mp4`
        : "video.mp4",
    };
  }

  return {
    ...baseOptions,
    resource_type: messageType === "audio" ? "video" : "raw",
    outputMimetype: null,
    outputFileName: fileName,
  };
};

/**
 * Mengunggah buffer media masuk ke Cloudinary lalu mengembalikan URL HTTPS
 * (CDN). Bersifat best-effort: bila Cloudinary belum dikonfigurasi atau upload
 * gagal, mengembalikan null dan mencatat log, tanpa melempar error agar
 * penerusan pesan teks/caption tetap berjalan.
 */
export const uploadInboundMedia = async (
  buffer,
  { mimetype, fileName, messageType, sessionId },
) => {
  if (!ensureCloudinaryReady()) {
    logger.warn(
      { sessionId },
      "Lewati upload media karena CLOUDINARY_URL belum diatur",
    );

    return null;
  }

  try {
    const { outputMimetype, outputFileName, ...cloudinaryUploadOptions } =
      resolveUploadOptions(messageType, fileName);
    const uploadResult = await new Promise((resolve, reject) => {
      const uploadStream = cloudinary.uploader.upload_stream(
        cloudinaryUploadOptions,
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
      {
        sessionId,
        messageType,
        inputBytes: buffer.length,
        outputBytes: uploadResult.bytes,
      },
      "Media masuk berhasil dioptimalkan dan diunggah ke Cloudinary",
    );

    return {
      url: uploadResult.secure_url,
      mimetype: outputMimetype || mimetype,
      fileName: outputFileName,
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
