import { sendSuccess, sendError } from "../lib/apiResponse.js";
import {
  getSessionStatus,
  startSession,
  getAllSessions,
  deleteSession,
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
