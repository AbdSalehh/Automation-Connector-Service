import crypto from "node:crypto";
import path from "node:path";

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

/**
 * Mengembalikan nama cloud Cloudinary yang sedang aktif, atau string kosong bila
 * belum dikonfigurasi. Dipakai untuk menandai media lama yang berasal dari akun
 * Cloudinary sebelumnya sehingga frontend bisa menampilkan placeholder alih-alih
 * gambar rusak setelah kredensial diganti.
 */
export const getActiveCloudName = () => {
  if (!ensureCloudinaryReady()) {
    return "";
  }

  return cloudinary.config().cloud_name || "";
};

/**
 * Mengambil nama cloud dari sebuah URL Cloudinary
 * (`https://res.cloudinary.com/<cloud>/<resourceType>/upload/...`).
 * Mengembalikan string kosong bila URL bukan milik Cloudinary, sehingga media
 * lama yang belum menyimpan `cloudName` tetap bisa diperiksa.
 */
export const extractCloudName = (mediaUrl) => {
  if (!mediaUrl || !mediaUrl.includes("res.cloudinary.com")) {
    return "";
  }

  return String(mediaUrl).split("/")[3] || "";
};

/**
 * Ekstensi cadangan per mimetype, dipakai saat WhatsApp mengirim dokumen tanpa
 * nama berkas. Cloudinary menyimpan berkas `raw` apa adanya, sehingga tanpa
 * ekstensi pada public_id berkas diserahkan sebagai `application/octet-stream`
 * dan gagal dibuka/diunduh di browser.
 */
const EXTENSION_BY_MIMETYPE = {
  "application/pdf": ".pdf",
  "application/msword": ".doc",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document":
    ".docx",
  "application/vnd.ms-excel": ".xls",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": ".xlsx",
  "application/vnd.ms-powerpoint": ".ppt",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation":
    ".pptx",
  "application/zip": ".zip",
  "text/plain": ".txt",
  "text/csv": ".csv",
};

/**
 * Membersihkan nama berkas menjadi public_id yang aman untuk Cloudinary:
 * hanya huruf, angka, strip, dan garis bawah. Mengembalikan "dokumen" bila
 * tidak ada karakter yang tersisa.
 */
const sanitizeFileBaseName = (fileName) => {
  const baseName = path
    .basename(fileName || "", path.extname(fileName || ""))
    .replace(/[^a-zA-Z0-9-_]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);

  return baseName || "dokumen";
};

/**
 * Menyusun public_id untuk berkas `raw` secara eksplisit, lengkap dengan
 * ekstensi di bagian akhir. Cloudinary menambahkan sufiks acak SETELAH
 * public_id ketika `use_filename` aktif, sehingga "laporan.pdf" bisa menjadi
 * "laporan.pdf_a1b2c3" dan ekstensinya rusak. Membuat id sendiri menghindari
 * hal itu sekaligus tetap menjamin keunikan.
 */
const buildRawPublicId = (fileName, mimetype) => {
  const extension =
    path.extname(fileName || "") || EXTENSION_BY_MIMETYPE[mimetype] || "";

  const uniqueSuffix = crypto.randomBytes(6).toString("hex");

  return `${sanitizeFileBaseName(fileName)}-${uniqueSuffix}${extension}`;
};

/**
 * Menyisipkan flag `fl_attachment` pada URL Cloudinary agar berkas diunduh
 * dengan nama yang benar alih-alih dibuka sebagai teks mentah oleh browser.
 */
const buildDownloadUrl = (secureUrl, fileName) => {
  if (!secureUrl.includes("/upload/")) {
    return secureUrl;
  }

  const downloadName = sanitizeFileBaseName(fileName);

  return secureUrl.replace(
    "/upload/",
    `/upload/fl_attachment:${downloadName}/`,
  );
};

const resolveUploadOptions = (messageType, fileName, mimetype) => {
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

  if (messageType === "audio") {
    return {
      ...baseOptions,
      resource_type: "video",
      outputMimetype: null,
      outputFileName: fileName,
    };
  }

  /**
   * Dokumen diunggah sebagai `raw` (apa adanya) dengan public_id yang kita
   * tentukan sendiri agar ekstensi berkas tidak rusak oleh sufiks acak
   * Cloudinary.
   */
  return {
    folder: INBOUND_MEDIA_FOLDER,
    resource_type: "raw",
    public_id: buildRawPublicId(fileName, mimetype),
    use_filename: false,
    unique_filename: false,
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
      resolveUploadOptions(messageType, fileName, mimetype);
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

    const isDocument = cloudinaryUploadOptions.resource_type === "raw";

    return {
      url: uploadResult.secure_url,
      /**
       * URL unduh terpisah untuk dokumen agar browser menyimpan berkas dengan
       * nama & ekstensi yang benar, bukan membukanya sebagai teks mentah.
       */
      downloadUrl: isDocument
        ? buildDownloadUrl(uploadResult.secure_url, outputFileName)
        : null,
      mimetype: outputMimetype || mimetype,
      fileName: outputFileName,
      fileLength: uploadResult.bytes,
      /**
       * Jejak asal berkas. `cloudName` dipakai untuk mendeteksi media yang
       * ditinggalkan akun Cloudinary lama setelah kredensial diganti.
       */
      cloudName: extractCloudName(uploadResult.secure_url),
      publicId: uploadResult.public_id,
      resourceType: uploadResult.resource_type,
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
