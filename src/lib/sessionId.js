/**
 * Membersihkan dan memvalidasi sessionId.
 * Hanya mengizinkan huruf, angka, tanda hubung, dan garis bawah
 * untuk mencegah path traversal karena sessionId dipakai
 * sebagai nama folder penyimpanan sesi.
 */
export const sanitizeSessionId = (rawSessionId) => {
  if (!rawSessionId || typeof rawSessionId !== "string") {
    return "";
  }

  const trimmed = rawSessionId.trim();

  if (!/^[a-zA-Z0-9_-]+$/.test(trimmed)) {
    return "";
  }

  return trimmed;
};
