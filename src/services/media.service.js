import { v2 as cloudinary } from "cloudinary";

import { env } from "../config/env.js";
import { logger } from "../config/logger.js";

/**
 * Menandai apakah Cloudinary sudah dikonfigurasi sekali saja, agar inisialisasi
 * (parsing CLOUDINARY_URL) tidak diulang pada setiap pesan media masuk.
 */
let isCloudinaryConfigured = false;

const INBOUND_MEDIA_FOLDER = "whatsapp-inbound";
const RETENTION_DAYS = 3;
const CLOUDINARY_PAGE_SIZE = 100;
const DELETE_BATCH_SIZE = 100;

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
    folder: INBOUND_MEDIA_FOLDER,
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

const listExpiredResources = async (resourceType, cutoffDate) => {
  const resources = [];
  let nextCursor;

  do {
    const result = await cloudinary.api.resources({
      type: "upload",
      resource_type: resourceType,
      prefix: `${INBOUND_MEDIA_FOLDER}/`,
      max_results: CLOUDINARY_PAGE_SIZE,
      next_cursor: nextCursor,
    });

    resources.push(
      ...result.resources.filter(
        (resource) => new Date(resource.created_at) <= cutoffDate,
      ),
    );
    nextCursor = result.next_cursor;
  } while (nextCursor);

  return resources;
};

export const cleanupExpiredInboundMedia = async () => {
  if (!ensureCloudinaryReady()) {
    throw new Error("CLOUDINARY_URL belum diatur");
  }

  const cutoffDate = new Date(
    Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000,
  );
  let deletedCount = 0;
  const inspectedByType = {};

  for (const resourceType of ["image", "video", "raw"]) {
    const resources = await listExpiredResources(resourceType, cutoffDate);
    inspectedByType[resourceType] = resources.length;

    for (
      let batchStart = 0;
      batchStart < resources.length;
      batchStart += DELETE_BATCH_SIZE
    ) {
      const publicIds = resources
        .slice(batchStart, batchStart + DELETE_BATCH_SIZE)
        .map((resource) => resource.public_id);

      if (publicIds.length === 0) {
        continue;
      }

      await cloudinary.api.delete_resources(publicIds, {
        resource_type: resourceType,
        type: "upload",
        invalidate: true,
      });
      deletedCount += publicIds.length;
    }
  }

  logger.info(
    { cutoffDate: cutoffDate.toISOString(), deletedCount, inspectedByType },
    "Cleanup media Cloudinary selesai",
  );

  return {
    folder: INBOUND_MEDIA_FOLDER,
    retentionDays: RETENTION_DAYS,
    cutoffDate: cutoffDate.toISOString(),
    deletedCount,
    inspectedByType,
  };
};
