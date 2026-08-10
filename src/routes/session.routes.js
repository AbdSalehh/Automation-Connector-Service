import { Router } from "express";

import { apiKeyAuth } from "../middlewares/apiKeyAuth.js";
import { ownerAuth, requireOwnedSession } from "../middlewares/ownerAuth.js";
import {
  handleCreateSession,
  handleGetSessionStatus,
  handleListSessions,
  handleDeleteSession,
  handleConfirmDuplicateSession,
  handleCancelDuplicateSession,
} from "../controllers/session.controller.js";

const sessionRouter = Router();

sessionRouter.get("/sessions", apiKeyAuth, ownerAuth, handleListSessions);
sessionRouter.post("/sessions", apiKeyAuth, ownerAuth, handleCreateSession);
sessionRouter.get(
  "/sessions/:sessionId/status",
  apiKeyAuth,
  ownerAuth,
  requireOwnedSession,
  handleGetSessionStatus,
);
sessionRouter.post(
  "/sessions/:sessionId/duplicate/confirm",
  apiKeyAuth,
  ownerAuth,
  requireOwnedSession,
  handleConfirmDuplicateSession,
);
sessionRouter.post(
  "/sessions/:sessionId/duplicate/cancel",
  apiKeyAuth,
  ownerAuth,
  requireOwnedSession,
  handleCancelDuplicateSession,
);
sessionRouter.delete(
  "/sessions/:sessionId",
  apiKeyAuth,
  ownerAuth,
  requireOwnedSession,
  handleDeleteSession,
);

export { sessionRouter };
