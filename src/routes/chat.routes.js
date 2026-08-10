import { Router } from "express";

import { apiKeyAuth } from "../middlewares/apiKeyAuth.js";
import { ownerAuth, requireOwnedSession } from "../middlewares/ownerAuth.js";
import {
  handleClearConversationCache,
  handleListConversationMessages,
  handleListConversations,
} from "../controllers/chat.controller.js";

const chatRouter = Router();

chatRouter.get(
  "/sessions/:sessionId/conversations",
  apiKeyAuth,
  ownerAuth,
  requireOwnedSession,
  handleListConversations,
);
chatRouter.get(
  "/sessions/:sessionId/conversations/:jid/messages",
  apiKeyAuth,
  ownerAuth,
  requireOwnedSession,
  handleListConversationMessages,
);
chatRouter.delete(
  "/sessions/:sessionId/conversations/:jid/cache",
  apiKeyAuth,
  ownerAuth,
  requireOwnedSession,
  handleClearConversationCache,
);

export { chatRouter };
