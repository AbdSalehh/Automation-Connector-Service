import { prisma } from "../lib/prisma.js";

export const createOwnedSession = async (ownerId, sessionId) => {
  await prisma.whatsappSession.create({
    data: { ownerId, sessionId },
  });
};

export const isSessionOwnedBy = async (ownerId, sessionId) => {
  const session = await prisma.whatsappSession.findUnique({
    where: { sessionId },
    select: { ownerId: true },
  });

  return session?.ownerId === ownerId;
};

export const listOwnedSessionIds = async (ownerId) => {
  const sessions = await prisma.whatsappSession.findMany({
    where: { ownerId },
    orderBy: { updatedAt: "desc" },
    select: { sessionId: true },
  });

  return sessions.map((session) => session.sessionId);
};

export const deleteSessionOwnership = async (ownerId, sessionId) => {
  await prisma.whatsappSession.deleteMany({
    where: { ownerId, sessionId },
  });
};
