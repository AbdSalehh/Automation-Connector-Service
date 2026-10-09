import { sendSuccess, sendError } from "../lib/apiResponse.js";
import { sanitizeSessionId } from "../lib/sessionId.js";
import { listTodayCalls } from "../services/call.store.js";
import { getSessionStatus } from "../services/session.manager.js";

/**
 * Controller untuk endpoint GET /sessions/:sessionId/calls.
 * Mengembalikan riwayat panggilan masuk & keluar pada hari berjalan.
 */
export const handleListTodayCalls = async (request, response) => {
  const sessionId = sanitizeSessionId(request.params.sessionId);

  if (!sessionId) {
    return sendError(response, {
      statusCode: 400,
      message: "Format sessionId tidak valid",
    });
  }

  if (!getSessionStatus(sessionId)?.isReady) {
    return sendError(response, {
      statusCode: 409,
      message: "Sesi WhatsApp tidak terhubung",
    });
  }

  const result = await listTodayCalls(sessionId);

  return sendSuccess(response, {
    message: "Riwayat panggilan hari ini berhasil diambil",
    data: result.data,
    metadata: result.metadata,
  });
};
