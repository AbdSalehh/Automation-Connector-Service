/**
 * Menentukan jenis pesan WhatsApp dan mengekstrak metadata media bila ada.
 * Objek pesan yang diterima sudah harus dalam keadaan "unwrapped" (lapisan
 * ephemeral/view-once sudah dibuka oleh pemanggil).
 */

/**
 * Memetakan jenis media ke `resource_type` Cloudinary. Gambar & stiker memakai
 * `image`, video & audio memakai `video` (Cloudinary memproses audio sebagai
 * video), sedangkan dokumen memakai `raw` agar diunggah apa adanya.
 */
const CLOUDINARY_RESOURCE_TYPE = {
  image: "image",
  sticker: "image",
  video: "video",
  audio: "video",
  document: "raw",
};

/**
 * Mengembalikan jenis pesan (`text`, `image`, `video`, `audio`, `document`,
 * `sticker`) berdasarkan field konten yang tersedia. Mengembalikan `text`
 * sebagai default bila bukan media yang dikenali.
 */
export const detectMessageType = (messageContent) => {
  if (!messageContent) {
    return "text";
  }

  if (messageContent.imageMessage) {
    return "image";
  }

  if (messageContent.videoMessage) {
    return "video";
  }

  if (messageContent.audioMessage) {
    return "audio";
  }

  if (messageContent.documentMessage) {
    return "document";
  }

  if (messageContent.stickerMessage) {
    return "sticker";
  }

  return "text";
};

/**
 * Mengembalikan `resource_type` Cloudinary yang sesuai untuk sebuah jenis
 * media, atau `raw` sebagai cadangan yang paling aman.
 */
export const toCloudinaryResourceType = (messageType) => {
  return CLOUDINARY_RESOURCE_TYPE[messageType] || "raw";
};

/**
 * Mengekstrak metadata media (mimetype, nama berkas, ukuran) dari konten pesan
 * untuk jenis media tertentu. Mengembalikan null bila pesan bukan media.
 */
export const extractMediaInfo = (messageContent, messageType) => {
  if (!messageContent) {
    return null;
  }

  const mediaContent =
    messageContent.imageMessage ||
    messageContent.videoMessage ||
    messageContent.audioMessage ||
    messageContent.documentMessage ||
    messageContent.stickerMessage;

  if (!mediaContent) {
    return null;
  }

  const fileLength = Number(mediaContent.fileLength) || 0;

  return {
    mimetype: mediaContent.mimetype || "application/octet-stream",
    fileName: mediaContent.fileName || "",
    fileLength,
    resourceType: toCloudinaryResourceType(messageType),
  };
};
