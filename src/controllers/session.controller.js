import crypto from "crypto";

import { sendSuccess, sendError } from "../lib/apiResponse.js";
import {
  getSessionStatus,
  startSession,
  deleteSession,
  confirmDuplicateSession,
  cancelDuplicateSession,
} from "../services/session.manager.js";
import {
  createOwnedSession,
  deleteSessionOwnership,
  listOwnedSessionIds,
} from "../services/session-ownership.store.js";
import { sanitizeSessionId } from "../lib/sessionId.js";

export const handleCreateSession = async (request, response) => {
  const sessionId = crypto.randomUUID();

  await createOwnedSession(request.ownerId, sessionId);
  await startSession(sessionId);

  return sendSuccess(response, {
    statusCode: 201,
    message: "Sesi WhatsApp berhasil dibuat",
    data: {
      sessionId,
      session: getSessionStatus(sessionId),
    },
  });
};

export const handleGetSessionStatus = async (request, response) => {
  const sessionId = sanitizeSessionId(request.params.sessionId);

  if (!sessionId) {
    return sendError(response, {
      statusCode: 400,
      message: "Format sessionId tidak valid",
    });
  }

  let session = getSessionStatus(sessionId);

  if (!session) {
    await startSession(sessionId);
    session = getSessionStatus(sessionId);
  }

  return sendSuccess(response, {
    statusCode: 200,
    message: "Status sesi WhatsApp berhasil diambil",
    data: session,
  });
};

/**
 * Controller untuk menampilkan daftar seluruh sesi yang dikelola.
 */
export const handleListSessions = async (request, response) => {
  const ownedSessionIds = await listOwnedSessionIds(request.ownerId);
  const sessions = await Promise.all(
    ownedSessionIds.map(async (sessionId) => {
      if (!getSessionStatus(sessionId)) {
        await startSession(sessionId);
      }

      return getSessionStatus(sessionId);
    }),
  );

  return sendSuccess(response, {
    statusCode: 200,
    message: "Daftar sesi berhasil diambil",
    data: sessions.filter(Boolean),
  });
};

/**
 * Controller untuk logout sekaligus menghapus sebuah sesi.
 */
export const handleDeleteSession = async (request, response) => {
  const sessionId = sanitizeSessionId(request.params.sessionId);

  if (!sessionId) {
    return sendError(response, {
      statusCode: 400,
      message: "Format sessionId tidak valid",
    });
  }

  await deleteSession(sessionId);
  await deleteSessionOwnership(request.ownerId, sessionId);

  return sendSuccess(response, {
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

  const ownedSessionIds = await listOwnedSessionIds(req.ownerId);
  const deletedSessionIds = await confirmDuplicateSession(
    sessionId,
    ownedSessionIds,
  );

  if (!deletedSessionIds) {
    return sendError(res, {
      statusCode: 409,
      message: "Tidak ada konflik nomor yang menunggu konfirmasi",
    });
  }

  await Promise.all(
    deletedSessionIds.map((deletedSessionId) =>
      deleteSessionOwnership(req.ownerId, deletedSessionId),
    ),
  );

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

  await deleteSessionOwnership(req.ownerId, sessionId);

  return sendSuccess(res, {
    statusCode: 200,
    message: "Sesi baru dibatalkan, sesi lama tetap aktif",
    data: null,
  });
};
