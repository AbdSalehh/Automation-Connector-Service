import express from "express";

import { messageRouter } from "./routes/message.routes.js";
import { sessionRouter } from "./routes/session.routes.js";
import { sendSuccess, sendError } from "./lib/apiResponse.js";
import { getAllSessions } from "./services/session.manager.js";
import { logger } from "./config/logger.js";

export const createApp = () => {
  const app = express();

  app.use(express.json());

  /**
   * Endpoint health check untuk memantau status service
   * dan jumlah sesi WhatsApp yang sedang aktif.
   */
  app.get("/health", (req, res) => {
    const sessions = getAllSessions();

    const readyCount = sessions.filter((session) => session.isReady).length;

    return sendSuccess(res, {
      statusCode: 200,
      message: "Service berjalan",
      data: {
        totalSessions: sessions.length,
        readySessions: readyCount,
      },
    });
  });

  app.use(messageRouter);
  app.use(sessionRouter);

  /**
   * Handler untuk rute yang tidak ditemukan.
   */
  app.use((req, res) => {
    return sendError(res, {
      statusCode: 404,
      message: "Rute tidak ditemukan",
    });
  });

  /**
   * Error handler global agar semua error tetap mengikuti
   * format respons standar.
   */
  app.use((error, req, res, next) => {
    logger.error({ err: error?.message }, "Terjadi error tak terduga");

    return sendError(res, {
      statusCode: 500,
      message: "Terjadi kesalahan pada server",
    });
  });

  return app;
};
