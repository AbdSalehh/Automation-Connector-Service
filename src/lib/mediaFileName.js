import path from "node:path";

/**
 * Helper penamaan berkas media yang dipakai bersama oleh seluruh penyedia
 * penyimpanan (Cloudinary dan Cloudflare R2).
 */

/**
 * Ekstensi cadangan per mimetype, dipakai saat WhatsApp mengirim media tanpa
 * nama berkas. Penyimpanan objek menyerahkan berkas apa adanya, sehingga tanpa
 * ekstensi berkas dianggap `application/octet-stream` dan gagal dibuka atau
 * diunduh dengan benar di browser.
 */
const EXTENSION_BY_MIMETYPE = {
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/webp": ".webp",
  "image/gif": ".gif",
  "video/mp4": ".mp4",
  "video/3gpp": ".3gp",
  "video/quicktime": ".mov",
  "audio/ogg": ".ogg",
  "audio/mpeg": ".mp3",
  "audio/mp4": ".m4a",
  "audio/aac": ".aac",
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
 * Membuang parameter mimetype, mis. "audio/ogg; codecs=opus" menjadi
 * "audio/ogg", agar cocok dengan tabel ekstensi.
 */
export const normalizeMimetype = (mimetype) =>
  String(mimetype || "")
    .split(";")[0]
    .trim()
    .toLowerCase();

/**
 * Membersihkan nama berkas menjadi nama yang aman sebagai bagian dari kunci
 * objek: hanya huruf, angka, strip, dan garis bawah. Mengembalikan `fallback`
 * bila tidak ada karakter yang tersisa.
 */
export const sanitizeFileBaseName = (fileName, fallback = "dokumen") => {
  const baseName = path
    .basename(fileName || "", path.extname(fileName || ""))
    .replace(/[^a-zA-Z0-9-_]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);

  return baseName || fallback;
};

/**
 * Menentukan ekstensi berkas: dari nama berkas bila ada, atau dari mimetype.
 * Mengembalikan string kosong bila keduanya tidak dikenali.
 */
export const resolveFileExtension = (fileName, mimetype) =>
  path.extname(fileName || "").toLowerCase() ||
  EXTENSION_BY_MIMETYPE[normalizeMimetype(mimetype)] ||
  "";
