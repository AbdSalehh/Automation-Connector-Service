import { sendSuccess, sendError } from "../lib/apiResponse.js";
import { sanitizeSessionId } from "../lib/sessionId.js";
import {
  clearConversationCache,
  listConversationMessages,
  listConversations,
} from "../services/chat.store.js";
import { getSessionStatus } from "../services/session.manager.js";

const parsePositiveInteger = (value, fallback, maximum) => {
  const parsedValue = Number.parseInt(value, 10);

  if (!Number.isFinite(parsedValue) || parsedValue < 0) {
    return fallback;
  }

  return Math.min(parsedValue, maximum);
};

const validateSession = (request, response) => {
  const sessionId = sanitizeSessionId(request.params.sessionId);

  if (!sessionId) {
    sendError(response, {
      statusCode: 400,
      message: "Format sessionId tidak valid",
    });
    return null;
  }

  const session = getSessionStatus(sessionId);

  if (!session?.isReady) {
    sendError(response, {
      statusCode: 409,
      message: "Sesi WhatsApp tidak terhubung",
    });
    return null;
  }

  return sessionId;
};

export const handleListConversations = async (request, response) => {
  const sessionId = validateSession(request, response);

  if (!sessionId) {
    return;
  }

  const limit = parsePositiveInteger(request.query.limit, 15, 50) || 15;
  const offset = parsePositiveInteger(request.query.offset, 0, 10000);
  const result = await listConversations(sessionId, { limit, offset });

  return sendSuccess(response, {
    statusCode: 200,
    message: "Daftar percakapan berhasil diambil",
    data: result.data,
    metadata: result.metadata,
  });
};

export const handleListConversationMessages = async (request, response) => {
  const sessionId = validateSession(request, response);

  if (!sessionId) {
    return;
  }

  const jid = decodeURIComponent(request.params.jid || "").trim();

  if (!jid || (!jid.endsWith("@s.whatsapp.net") && !jid.endsWith("@lid"))) {
    return sendError(response, {
      statusCode: 400,
      message: "Format JID percakapan tidak valid",
    });
  }

  const hours = parsePositiveInteger(request.query.hours, 24, 24) || 24;
  const limit = parsePositiveInteger(request.query.limit, 100, 200) || 100;
  const offset = parsePositiveInteger(request.query.offset, 0, 10000);
  const result = await listConversationMessages(sessionId, jid, {
    hours,
    limit,
    offset,
  });

  return sendSuccess(response, {
    statusCode: 200,
    message: "Riwayat pesan berhasil diambil",
    data: result.data,
    metadata: result.metadata,
  });
};

export const handleClearConversationCache = async (request, response) => {
  const sessionId = validateSession(request, response);

  if (!sessionId) {
    return;
  }

  const jid = decodeURIComponent(request.params.jid || "").trim();
  const wasDeleted = await clearConversationCache(sessionId, jid);

  return sendSuccess(response, {
    statusCode: 200,
    message: wasDeleted
      ? "Cache percakapan berhasil dihapus"
      : "Cache percakapan sudah kosong",
    data: { deleted: wasDeleted },
  });
};
