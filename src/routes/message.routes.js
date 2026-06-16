import { Router } from "express";

import { apiKeyAuth } from "../middlewares/apiKeyAuth.js";
import {
  handleSendMessage,
  handleSendPresence,
} from "../controllers/message.controller.js";

const messageRouter = Router();

messageRouter.post(
  "/sessions/:sessionId/send-message",
  apiKeyAuth,
  handleSendMessage,
);

messageRouter.post(
  "/sessions/:sessionId/presence",
  apiKeyAuth,
  handleSendPresence,
);

export { messageRouter };
