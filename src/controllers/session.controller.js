import { sendSuccess, sendError } from "../lib/apiResponse.js";
import {
  getSessionStatus,
  startSession,
  getAllSessions,
  deleteSession,
  confirmDuplicateSession,
  cancelDuplicateSession,
} from "../services/session.manager.js";
import { sanitizeSessionId } from "../lib/sessionId.js";

/**
 * Controller untuk mengambil status sebuah sesi WhatsApp.
 * Jika sesi belum ada di memori, sesi akan dimulai otomatis
 * agar QR code langsung tersedia untuk discan.
 */
export const handleGetSessionStatus = async (req, res) => {
  const sessionId = sanitizeSessionId(req.params.sessionId);

  if (!sessionId) {
    return sendError(res, {
      statusCode: 400,
      message: "Format sessionId tidak valid",
    });
  }

  let session = getSessionStatus(sessionId);

  if (!session) {
    await startSession(sessionId);
    session = getSessionStatus(sessionId);
  }

  return sendSuccess(res, {
    statusCode: 200,
    message: "Status sesi WhatsApp berhasil diambil",
    data: session,
  });
};

/**
 * Controller untuk menampilkan daftar seluruh sesi yang dikelola.
 */
export const handleListSessions = (req, res) => {
  const sessions = getAllSessions();

  return sendSuccess(res, {
    statusCode: 200,
    message: "Daftar sesi berhasil diambil",
    data: sessions,
  });
};

/**
 * Controller untuk logout sekaligus menghapus sebuah sesi.
 */
export const handleDeleteSession = async (req, res) => {
  const sessionId = sanitizeSessionId(req.params.sessionId);

  if (!sessionId) {
    return sendError(res, {
      statusCode: 400,
      message: "Format sessionId tidak valid",
    });
  }

  await deleteSession(sessionId);

  return sendSuccess(res, {
    statusCode: 200,
    message: "Sesi berhasil dihapus dan dilogout",
    data: null,
  });
};

/**
 * Controller untuk melanjutkan sesi yang menunggu konfirmasi konflik nomor.
 * Sesi lama dengan nomor yang sama akan di-logout.
 */
export const handleConfirmDuplicateSession = async (req, res) => {
  const sessionId = sanitizeSessionId(req.params.sessionId);

  if (!sessionId) {
    return sendError(res, {
      statusCode: 400,
      message: "Format sessionId tidak valid",
    });
  }

  const confirmed = await confirmDuplicateSession(sessionId);

  if (!confirmed) {
    return sendError(res, {
      statusCode: 409,
      message: "Tidak ada konflik nomor yang menunggu konfirmasi",
    });
  }

  return sendSuccess(res, {
    statusCode: 200,
    message: "Sesi lama dilogout, sesi baru dilanjutkan",
    data: getSessionStatus(sessionId),
  });
};

/**
 * Controller untuk membatalkan sesi yang menunggu konfirmasi konflik nomor.
 * Sesi baru dihapus dan sesi lama tetap aktif.
 */
export const handleCancelDuplicateSession = async (req, res) => {
  const sessionId = sanitizeSessionId(req.params.sessionId);

  if (!sessionId) {
    return sendError(res, {
      statusCode: 400,
      message: "Format sessionId tidak valid",
    });
  }

  const cancelled = await cancelDuplicateSession(sessionId);

  if (!cancelled) {
    return sendError(res, {
      statusCode: 409,
      message: "Tidak ada konflik nomor yang menunggu konfirmasi",
    });
  }

  return sendSuccess(res, {
    statusCode: 200,
    message: "Sesi baru dibatalkan, sesi lama tetap aktif",
    data: null,
  });
};
