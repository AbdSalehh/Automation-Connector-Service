import crypto from "node:crypto";

import {
  DeleteObjectsCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";

import { env } from "../config/env.js";
import { logger } from "../config/logger.js";
import {
  normalizeMimetype,
  resolveFileExtension,
  sanitizeFileBaseName,
} from "../lib/mediaFileName.js";

/**
 * Penyimpanan media masuk di Cloudflare R2 (API kompatibel S3).
 *
 * Berbeda dengan Cloudinary, R2 tidak melakukan transformasi apa pun: berkas
 * disimpan dan diserahkan apa adanya. Media WhatsApp sudah terkompresi
 * (JPEG, MP4 H.264, Ogg Opus), sehingga hal ini tidak menambah ukuran secara
 * berarti, dan R2 tidak menarik biaya egress.
 */

const INBOUND_MEDIA_PREFIX = "whatsapp-inbound/";

/** Batas jumlah kunci per permintaan DeleteObjects pada API S3. */
const DELETE_BATCH_SIZE = 1000;

/** Masa cache di browser/CDN; aman karena setiap kunci objek bersifat unik. */
const IMMUTABLE_CACHE_CONTROL = "public, max-age=31536000, immutable";

let r2Client = null;

/** True bila seluruh variabel R2 sudah diisi. */
export const isR2Configured = () =>
  Boolean(
    env.r2AccountId &&
    env.r2AccessKeyId &&
    env.r2SecretAccessKey &&
    env.r2Bucket &&
    env.r2PublicBaseUrl,
  );

/** Membuat klien S3 untuk R2 secara lazy, sekali per proses. */
const getR2Client = () => {
  if (!r2Client) {
    r2Client = new S3Client({
      region: "auto",
      endpoint: `https://${env.r2AccountId}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId: env.r2AccessKeyId,
        secretAccessKey: env.r2SecretAccessKey,
      },
    });
  }

  return r2Client;
};

/**
 * Kunci objek dikelompokkan per sesi dan tanggal agar mudah ditelusuri di
 * dashboard, dengan sufiks acak supaya dua berkas bernama sama tidak saling
 * menimpa.
 */
const buildObjectKey = ({ sessionId, fileName, mimetype, messageType }) => {
  const datePath = new Date().toISOString().slice(0, 10);
  const baseName = sanitizeFileBaseName(fileName, messageType || "media");
  const uniqueSuffix = crypto.randomBytes(6).toString("hex");
  const extension = resolveFileExtension(fileName, mimetype);

  return `${INBOUND_MEDIA_PREFIX}${sessionId}/${datePath}/${baseName}-${uniqueSuffix}${extension}`;
};

/** Menyusun URL publik objek; tiap segmen kunci di-encode terpisah. */
const buildPublicUrl = (objectKey) =>
  `${env.r2PublicBaseUrl}/${objectKey
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/")}`;

/**
 * Header Content-Disposition. Dokumen dikirim sebagai `attachment` agar browser
 * mengunduhnya dengan nama asli — pengganti flag `fl_attachment` Cloudinary,
 * karena atribut `download` diabaikan browser untuk URL lintas domain.
 */
const buildContentDisposition = (fileName, isAttachment) => {
  const dispositionType = isAttachment ? "attachment" : "inline";

  if (!fileName) {
    return dispositionType;
  }

  const asciiFileName = fileName
    .replace(/[^\x20-\x7e]/g, "_")
    .replace(/"/g, "");

  return `${dispositionType}; filename="${asciiFileName}"; filename*=UTF-8''${encodeURIComponent(fileName)}`;
};

/**
 * Mengunggah buffer media ke R2 dan mengembalikan metadata media dengan
 * bentuk yang sama seperti jalur Cloudinary, sehingga frontend tidak perlu
 * tahu penyedia mana yang dipakai.
 */
export const uploadToR2 = async (
  buffer,
  { mimetype, fileName, messageType, sessionId },
) => {
  const objectKey = buildObjectKey({
    sessionId,
    fileName,
    mimetype,
    messageType,
  });
  const isDocument = messageType === "document";
  const contentType = normalizeMimetype(mimetype)
    ? mimetype
    : "application/octet-stream";

  await getR2Client().send(
    new PutObjectCommand({
      Bucket: env.r2Bucket,
      Key: objectKey,
      Body: buffer,
      ContentType: contentType,
      ContentDisposition: buildContentDisposition(fileName, isDocument),
      CacheControl: IMMUTABLE_CACHE_CONTROL,
    }),
  );

  const publicUrl = buildPublicUrl(objectKey);

  return {
    url: publicUrl,
    downloadUrl: isDocument ? publicUrl : null,
    mimetype: contentType,
    fileName: fileName || "",
    fileLength: buffer.length,
    storageProvider: "r2",
    storageKey: objectKey,
  };
};

/**
 * Menghapus media masuk yang lebih tua dari `cutoffDate`.
 *
 * Cadangan bila lifecycle rule bucket belum diatur. Dengan lifecycle rule,
 * R2 menghapus objek kedaluwarsa sendiri tanpa memakai kuota operasi
 * Class A (list/delete) dari free tier.
 */
export const cleanupExpiredR2Media = async (cutoffDate) => {
  const client = getR2Client();
  let continuationToken;
  let inspectedCount = 0;
  let deletedCount = 0;

  do {
    const listResult = await client.send(
      new ListObjectsV2Command({
        Bucket: env.r2Bucket,
        Prefix: INBOUND_MEDIA_PREFIX,
        ContinuationToken: continuationToken,
      }),
    );

    const objects = listResult.Contents ?? [];
    inspectedCount += objects.length;

    const expiredKeys = objects
      .filter(
        (object) => object.LastModified && object.LastModified <= cutoffDate,
      )
      .map((object) => object.Key);

    for (
      let batchStart = 0;
      batchStart < expiredKeys.length;
      batchStart += DELETE_BATCH_SIZE
    ) {
      const batchKeys = expiredKeys.slice(
        batchStart,
        batchStart + DELETE_BATCH_SIZE,
      );

      await client.send(
        new DeleteObjectsCommand({
          Bucket: env.r2Bucket,
          Delete: {
            Objects: batchKeys.map((key) => ({ Key: key })),
            Quiet: true,
          },
        }),
      );

      deletedCount += batchKeys.length;
    }

    continuationToken = listResult.IsTruncated
      ? listResult.NextContinuationToken
      : undefined;
  } while (continuationToken);

  logger.info(
    { cutoffDate: cutoffDate.toISOString(), inspectedCount, deletedCount },
    "Cleanup media R2 selesai",
  );

  return { inspectedCount, deletedCount };
};
