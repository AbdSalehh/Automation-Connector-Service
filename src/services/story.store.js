import { prisma } from "../lib/prisma.js";

export const upsertStory = async (sessionId, story) => {
  return prisma.whatsappStory.upsert({
    where: {
      sessionId_whatsappId: {
        sessionId,
        whatsappId: story.whatsappId,
      },
    },
    create: { sessionId, ...story },
    update: story,
  });
};

export const listStories = async (sessionId) => {
  const now = new Date();

  await prisma.whatsappStory.deleteMany({
    where: { expiresAt: { lte: now } },
  });

  return prisma.whatsappStory.findMany({
    where: { sessionId, expiresAt: { gt: now } },
    orderBy: [{ senderJid: "asc" }, { sentAt: "asc" }],
  });
};

export const markStoryViewed = async (sessionId, storyId) => {
  const result = await prisma.whatsappStory.updateMany({
    where: { id: storyId, sessionId, expiresAt: { gt: new Date() } },
    data: { viewedAt: new Date() },
  });

  return result.count > 0;
};
