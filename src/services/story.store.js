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

  const stories = await prisma.whatsappStory.findMany({
    where: { sessionId, expiresAt: { gt: now } },
    orderBy: [{ senderJid: "asc" }, { sentAt: "asc" }],
    include: { engagements: true },
  });

  return stories.map((story) => {
    const { engagements, ...storyFields } = story;

    return {
      ...storyFields,
      viewerCount: engagements.filter((engagement) => engagement.viewedAt)
        .length,
      likedBy: engagements
        .filter((engagement) => engagement.likedAt)
        .map((engagement) => engagement.actorName || engagement.actorJid),
    };
  });
};

export const markStoryViewed = async (sessionId, storyId) => {
  const result = await prisma.whatsappStory.updateMany({
    where: { id: storyId, sessionId, expiresAt: { gt: new Date() } },
    data: { viewedAt: new Date() },
  });

  return result.count > 0;
};

/**
 * Mencatat bahwa seseorang telah melihat story milik sesi ini, berdasarkan
 * event `message-receipt.update` dari Baileys. Diabaikan jika story tidak
 * ditemukan (misalnya sudah kedaluwarsa).
 */
export const recordStoryView = async (sessionId, whatsappId, actorJid) => {
  const story = await prisma.whatsappStory.findUnique({
    where: { sessionId_whatsappId: { sessionId, whatsappId } },
  });

  if (!story) {
    return false;
  }

  await prisma.whatsappStoryEngagement.upsert({
    where: { storyId_actorJid: { storyId: story.id, actorJid } },
    create: { storyId: story.id, actorJid, viewedAt: new Date() },
    update: { viewedAt: new Date() },
  });

  return true;
};

/**
 * Mencatat atau menghapus reaksi (heart/emoji) pada story milik sesi ini,
 * berdasarkan event `messages.reaction` dari Baileys.
 */
export const recordStoryReaction = async (
  sessionId,
  whatsappId,
  actorJid,
  actorName,
  hasReaction,
) => {
  const story = await prisma.whatsappStory.findUnique({
    where: { sessionId_whatsappId: { sessionId, whatsappId } },
  });

  if (!story) {
    return false;
  }

  await prisma.whatsappStoryEngagement.upsert({
    where: { storyId_actorJid: { storyId: story.id, actorJid } },
    create: {
      storyId: story.id,
      actorJid,
      actorName: actorName || "",
      likedAt: hasReaction ? new Date() : null,
    },
    update: {
      actorName: actorName || undefined,
      likedAt: hasReaction ? new Date() : null,
    },
  });

  return true;
};
