import { env } from "../config/env.js";

const sessionStores = new Map();

const getTimestamp = (message) => {
  const timestamp = Date.parse(message.sentAt || message.receivedAt || "");
  return Number.isFinite(timestamp) ? timestamp : Date.now();
};

const removeExpiredMessages = (messages) => {
  const minimumTimestamp = Date.now() - env.chatCacheTtlHours * 60 * 60 * 1000;
  return messages.filter(
    (message) => getTimestamp(message) >= minimumTimestamp,
  );
};

const cleanupSession = (sessionId) => {
  const conversations = sessionStores.get(sessionId);

  if (!conversations) {
    return;
  }

  for (const [jid, conversation] of conversations.entries()) {
    conversation.messages = removeExpiredMessages(conversation.messages);

    if (conversation.messages.length === 0) {
      conversations.delete(jid);
    }
  }

  if (conversations.size === 0) {
    sessionStores.delete(sessionId);
  }
};

const enforceConversationLimit = (conversations) => {
  if (conversations.size <= env.chatCacheMaxConversations) {
    return;
  }

  const oldestConversations = [...conversations.entries()].sort(
    ([, firstConversation], [, secondConversation]) =>
      firstConversation.updatedAt - secondConversation.updatedAt,
  );

  const deleteCount = conversations.size - env.chatCacheMaxConversations;

  for (const [jid] of oldestConversations.slice(0, deleteCount)) {
    conversations.delete(jid);
  }
};

export const addChatMessage = (sessionId, jid, message) => {
  if (!sessionId || !jid || !message?.id) {
    return;
  }

  cleanupSession(sessionId);

  const conversations = sessionStores.get(sessionId) || new Map();
  const existingConversation = conversations.get(jid) || {
    jid,
    name: "",
    updatedAt: 0,
    messages: [],
  };

  if (existingConversation.messages.some((item) => item.id === message.id)) {
    return;
  }

  existingConversation.name = message.name || existingConversation.name;
  existingConversation.updatedAt = getTimestamp(message);
  existingConversation.messages.push({ ...message, jid });
  existingConversation.messages.sort(
    (firstMessage, secondMessage) =>
      getTimestamp(firstMessage) - getTimestamp(secondMessage),
  );
  existingConversation.messages = existingConversation.messages.slice(
    -env.chatCacheMaxMessages,
  );

  conversations.set(jid, existingConversation);
  enforceConversationLimit(conversations);
  sessionStores.set(sessionId, conversations);
};

export const listConversations = (sessionId, { limit, offset }) => {
  cleanupSession(sessionId);

  const conversations = sessionStores.get(sessionId);
  const sortedConversations = conversations
    ? [...conversations.values()].sort(
        (firstConversation, secondConversation) =>
          secondConversation.updatedAt - firstConversation.updatedAt,
      )
    : [];

  const data = sortedConversations
    .slice(offset, offset + limit)
    .map((conversation) => ({
      jid: conversation.jid,
      name: conversation.name,
      lastMessage: conversation.messages.at(-1) || null,
    }));

  return {
    data,
    metadata: {
      limit,
      offset,
      totalItems: sortedConversations.length,
      hasMore: offset + data.length < sortedConversations.length,
    },
  };
};

export const listConversationMessages = (
  sessionId,
  jid,
  { hours, limit, offset },
) => {
  cleanupSession(sessionId);

  const conversation = sessionStores.get(sessionId)?.get(jid);
  const minimumTimestamp = Date.now() - hours * 60 * 60 * 1000;
  const messages = conversation
    ? conversation.messages.filter(
        (message) => getTimestamp(message) >= minimumTimestamp,
      )
    : [];
  const descendingMessages = [...messages].reverse();
  const data = descendingMessages.slice(offset, offset + limit);

  return {
    data,
    metadata: {
      limit,
      offset,
      hours,
      totalItems: descendingMessages.length,
      hasMore: offset + data.length < descendingMessages.length,
    },
  };
};

export const clearConversationCache = (sessionId, jid) => {
  const conversations = sessionStores.get(sessionId);

  if (!conversations) {
    return false;
  }

  const wasDeleted = conversations.delete(jid);

  if (conversations.size === 0) {
    sessionStores.delete(sessionId);
  }

  return wasDeleted;
};

export const clearSessionChatCache = (sessionId) => {
  return sessionStores.delete(sessionId);
};

const cleanupInterval = setInterval(
  () => {
    for (const sessionId of sessionStores.keys()) {
      cleanupSession(sessionId);
    }
  },
  15 * 60 * 1000,
);

cleanupInterval.unref();
