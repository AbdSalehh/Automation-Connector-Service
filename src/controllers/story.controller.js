import { sendSuccess, sendError } from "../lib/apiResponse.js";
import { sanitizeSessionId } from "../lib/sessionId.js";
import { listStories, markStoryViewed } from "../services/story.store.js";
import { getSessionStatus } from "../services/session.manager.js";

const validateReadySession = (request, response) => {
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

export const handleListStories = async (request, response) => {
  const sessionId = validateReadySession(request, response);

  if (!sessionId) {
    return;
  }

  const stories = await listStories(sessionId);

  return sendSuccess(response, {
    message: "Daftar story berhasil diambil",
    data: stories,
  });
};

export const handleMarkStoryViewed = async (request, response) => {
  const sessionId = validateReadySession(request, response);

  if (!sessionId) {
    return;
  }

  const storyId = String(request.params.storyId || "").trim();

  if (!storyId) {
    return sendError(response, {
      statusCode: 400,
      message: "Story ID wajib diisi",
    });
  }

  const wasUpdated = await markStoryViewed(sessionId, storyId);

  if (!wasUpdated) {
    return sendError(response, {
      statusCode: 404,
      message: "Story tidak ditemukan atau sudah kedaluwarsa",
    });
  }

  return sendSuccess(response, {
    message: "Story ditandai dilihat pada aplikasi",
    data: { viewed: true },
  });
};
