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

const isValidConversationJid = (jid) =>
  ["@s.whatsapp.net", "@lid", "@g.us"].some((suffix) => jid.endsWith(suffix));

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

  if (!jid || !isValidConversationJid(jid)) {
    return sendError(response, {
      statusCode: 400,
      message: "Format JID percakapan tidak valid",
    });
  }

  const limit = parsePositiveInteger(request.query.limit, 50, 200) || 50;
  const offset = parsePositiveInteger(request.query.offset, 0, 100000);
  const result = await listConversationMessages(sessionId, jid, {
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

  if (!jid || !isValidConversationJid(jid)) {
    return sendError(response, {
      statusCode: 400,
      message: "Format JID percakapan tidak valid",
    });
  }

  const wasDeleted = await clearConversationCache(sessionId, jid);

  return sendSuccess(response, {
    statusCode: 200,
    message: wasDeleted
      ? "Cache percakapan berhasil dihapus"
      : "Cache percakapan sudah kosong",
    data: { deleted: wasDeleted },
  });
};
