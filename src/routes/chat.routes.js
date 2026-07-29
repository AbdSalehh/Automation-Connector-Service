import { Router } from "express";

import { apiKeyAuth } from "../middlewares/apiKeyAuth.js";
import {
  handleClearConversationCache,
  handleListConversationMessages,
  handleListConversations,
} from "../controllers/chat.controller.js";

const chatRouter = Router();

chatRouter.get(
  "/sessions/:sessionId/conversations",
  apiKeyAuth,
  handleListConversations,
);
chatRouter.get(
  "/sessions/:sessionId/conversations/:jid/messages",
  apiKeyAuth,
  handleListConversationMessages,
);
chatRouter.delete(
  "/sessions/:sessionId/conversations/:jid/cache",
  apiKeyAuth,
  handleClearConversationCache,
);

export { chatRouter };
