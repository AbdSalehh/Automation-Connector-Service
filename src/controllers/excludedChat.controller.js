import { sendSuccess, sendError } from "../lib/apiResponse.js";
import { sanitizeSessionId } from "../lib/sessionId.js";
import {
  addExcludedChat,
  listExcludedChats,
  removeExcludedChat,
} from "../services/excludedChat.store.js";
import { getSessionStatus } from "../services/session.manager.js";

const CONVERSATION_JID_SUFFIXES = ["@s.whatsapp.net", "@lid", "@g.us"];

const isValidConversationJid = (jid) =>
  CONVERSATION_JID_SUFFIXES.some((suffix) => jid.endsWith(suffix));

const validateSession = (request, response) => {
  const sessionId = sanitizeSessionId(request.params.sessionId);

  if (!sessionId) {
    sendError(response, {
      statusCode: 400,
      message: "Format sessionId tidak valid",
    });

    return null;
  }

  if (!getSessionStatus(sessionId)?.isReady) {
    sendError(response, {
      statusCode: 409,
      message: "Sesi WhatsApp tidak terhubung",
    });

    return null;
  }

  return sessionId;
};

const resolveJid = (rawJid, response) => {
  const jid = decodeURIComponent(rawJid || "").trim();

  if (!jid || !isValidConversationJid(jid)) {
    sendError(response, {
      statusCode: 400,
      message: "Format JID percakapan tidak valid",
    });

    return null;
  }

  return jid;
};

export const handleListExcludedChats = async (request, response) => {
  const sessionId = validateSession(request, response);

  if (!sessionId) {
    return;
  }

  const excludedChats = await listExcludedChats(sessionId);

  return sendSuccess(response, {
    message: "Daftar chat tersembunyi berhasil diambil",
    data: excludedChats,
  });
};

export const handleAddExcludedChat = async (request, response) => {
  const sessionId = validateSession(request, response);

  if (!sessionId) {
    return;
  }

  const jid = resolveJid(request.body?.jid, response);

  if (!jid) {
    return;
  }

  await addExcludedChat(sessionId, jid);

  return sendSuccess(response, {
    statusCode: 201,
    message: "Chat berhasil disembunyikan",
    data: { jid },
  });
};

export const handleRemoveExcludedChat = async (request, response) => {
  const sessionId = validateSession(request, response);

  if (!sessionId) {
    return;
  }

  const jid = resolveJid(request.params.jid, response);

  if (!jid) {
    return;
  }

  const wasRemoved = await removeExcludedChat(sessionId, jid);

  return sendSuccess(response, {
    message: wasRemoved
      ? "Chat berhasil ditampilkan kembali"
      : "Chat tidak ada dalam daftar tersembunyi",
    data: { removed: wasRemoved },
  });
};
