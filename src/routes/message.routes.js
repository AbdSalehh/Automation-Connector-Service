import { Router } from "express";

import { apiKeyAuth } from "../middlewares/apiKeyAuth.js";
import { handleSendMessage } from "../controllers/message.controller.js";

const messageRouter = Router();

messageRouter.post(
  "/sessions/:sessionId/send-message",
  apiKeyAuth,
  handleSendMessage,
);

export { messageRouter };
