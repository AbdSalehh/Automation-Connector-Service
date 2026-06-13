import { Router } from "express";

import { apiKeyAuth } from "../middlewares/apiKeyAuth.js";
import {
  handleGetSessionStatus,
  handleListSessions,
  handleDeleteSession,
} from "../controllers/session.controller.js";

const sessionRouter = Router();

sessionRouter.get("/sessions", apiKeyAuth, handleListSessions);
sessionRouter.get(
  "/sessions/:sessionId/status",
  apiKeyAuth,
  handleGetSessionStatus,
);
sessionRouter.delete("/sessions/:sessionId", apiKeyAuth, handleDeleteSession);

export { sessionRouter };
