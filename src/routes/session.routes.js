import { Router } from "express";

import { apiKeyAuth } from "../middlewares/apiKeyAuth.js";
import {
  handleGetSessionStatus,
  handleListSessions,
  handleDeleteSession,
  handleConfirmDuplicateSession,
  handleCancelDuplicateSession,
} from "../controllers/session.controller.js";

const sessionRouter = Router();

sessionRouter.get("/sessions", apiKeyAuth, handleListSessions);
sessionRouter.get(
  "/sessions/:sessionId/status",
  apiKeyAuth,
  handleGetSessionStatus,
);
sessionRouter.post(
  "/sessions/:sessionId/duplicate/confirm",
  apiKeyAuth,
  handleConfirmDuplicateSession,
);
sessionRouter.post(
  "/sessions/:sessionId/duplicate/cancel",
  apiKeyAuth,
  handleCancelDuplicateSession,
);
sessionRouter.delete("/sessions/:sessionId", apiKeyAuth, handleDeleteSession);

export { sessionRouter };
