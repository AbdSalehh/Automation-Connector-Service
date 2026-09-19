import { Router } from "express";

import { apiKeyAuth } from "../middlewares/apiKeyAuth.js";
import { ownerAuth, requireOwnedSession } from "../middlewares/ownerAuth.js";
import {
  handleClearConversationCache,
  handleGetConversationAvatar,
  handleListConversationMessages,
  handleListConversations,
} from "../controllers/chat.controller.js";
import {
  handleAddExcludedChat,
  handleListExcludedChats,
  handleRemoveExcludedChat,
} from "../controllers/excludedChat.controller.js";
import {
  handleListStories,
  handleMarkStoryViewed,
} from "../controllers/story.controller.js";
import { cleanupExpiredInboundMedia } from "../services/media.service.js";
import { sendSuccess } from "../lib/apiResponse.js";

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
chatRouter.get(
  "/sessions/:sessionId/conversations/:jid/avatar",
  apiKeyAuth,
  ownerAuth,
  requireOwnedSession,
  handleGetConversationAvatar,
);
chatRouter.delete(
  "/sessions/:sessionId/conversations/:jid/cache",
  apiKeyAuth,
  ownerAuth,
  requireOwnedSession,
  handleClearConversationCache,
);
chatRouter.get(
  "/sessions/:sessionId/excluded-chats",
  apiKeyAuth,
  ownerAuth,
  requireOwnedSession,
  handleListExcludedChats,
);
chatRouter.post(
  "/sessions/:sessionId/excluded-chats",
  apiKeyAuth,
  ownerAuth,
  requireOwnedSession,
  handleAddExcludedChat,
);
chatRouter.delete(
  "/sessions/:sessionId/excluded-chats/:jid",
  apiKeyAuth,
  ownerAuth,
  requireOwnedSession,
  handleRemoveExcludedChat,
);
chatRouter.get(
  "/sessions/:sessionId/stories",
  apiKeyAuth,
  ownerAuth,
  requireOwnedSession,
  handleListStories,
);
chatRouter.post(
  "/sessions/:sessionId/stories/:storyId/view",
  apiKeyAuth,
  ownerAuth,
  requireOwnedSession,
  handleMarkStoryViewed,
);
chatRouter.post(
  "/maintenance/media/cleanup",
  apiKeyAuth,
  async (request, response) => {
    const result = await cleanupExpiredInboundMedia();

    return sendSuccess(response, {
      message: "Cleanup media Cloudinary selesai",
      data: result,
    });
  },
);

export { chatRouter };
