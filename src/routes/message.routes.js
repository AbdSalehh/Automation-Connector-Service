import { Router } from "express";

import { apiKeyAuth } from "../middlewares/apiKeyAuth.js";
import { ownerAuth, requireOwnedSession } from "../middlewares/ownerAuth.js";
import {
  handleSendMessage,
  handleSendPresence,
} from "../controllers/message.controller.js";

const messageRouter = Router();

messageRouter.post(
  "/sessions/:sessionId/send-message",
  apiKeyAuth,
  ownerAuth,
  requireOwnedSession,
  handleSendMessage,
);

messageRouter.post(
  "/sessions/:sessionId/presence",
  apiKeyAuth,
  ownerAuth,
  requireOwnedSession,
  handleSendPresence,
);

export { messageRouter };
