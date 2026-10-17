import type { BackgroundJob, Prisma } from "@prisma/client";

import { prisma } from "@/lib/prisma";
import { enqueueJob } from "@/modules/jobs/queue";
import { kickJobWorker } from "@/modules/jobs/worker";

/*
 * What Mehedi 2.0 tells the owner on the bot without being asked: a permission
 * or Deletion request (with its buttons), a draft waiting to be sent (with
 * Send and Discard), a follow-up day, the 80% budget alert. It goes through the
 * background worker, so the work that pushes is never held up or broken by
 * Telegram or Meta; nothing is pushed while no bot is linked, nor while the AI
 * is switched off or paused. An alert about the server itself (a failed backup,
 * Server Health, Bug Guard) is the exception: it is the owner's own alarm, AI or
 * not, and it goes only to a bot linked by an active platform owner of the
 * company (a partner or manager who linked the bot never gets it).
 */

export type BotPush =
  | { kind: "text"; text: string; buttons?: Array<Array<{ label: string; data: string }>> }
  | { kind: "draft"; draftId: string; text: string }
  | { kind: "permission"; requestId: string }
  | { kind: "deletion"; requestId: string }
  /** Bug Guard: one problem with Fix, Ignore and Remind me later; a correction with Apply or Undo. */
  | { kind: "guard"; findingId: string }
  | { kind: "guard-correction"; correctionId: string };

/** A push as the background job carries it: an alarm goes to the platform owners' links only. */
export type QueuedPush = BotPush & { alarm?: boolean };

/** Bot links of a company that its active platform owners linked (the ones an alarm may reach). */
export const ownersLinks = (companyId: string) =>
  ({
    owner: {
      isSuperAdmin: true,
      status: "ACTIVE",
      memberships: { some: { companyId, isActive: true } },
    },
  }) satisfies Prisma.AiBotLinkWhereInput;

/** Whether a push is the owner's own alarm (Bug Guard's problems and corrections always are). */
export const isAlarm = (push: QueuedPush) =>
  push.alarm === true || push.kind === "guard" || push.kind === "guard-correction";

/** Queues a push to the company's linked bots (none linked, or the AI off: nothing happens). */
export async function pushToBot(
  companyId: string,
  push: BotPush,
  options: { alarm?: boolean } = {},
) {
  try {
    const queued: QueuedPush = options.alarm ? { ...push, alarm: true } : push;
    const linked = await prisma.aiBotLink.count({
      where: {
        companyId,
        linkedAt: { not: null },
        ...(isAlarm(queued) ? ownersLinks(companyId) : {}),
      },
    });
    if (linked === 0) return;
    if (!options.alarm) {
      const settings = await prisma.aiSettings.findUnique({
        where: { companyId },
        select: { enabled: true, pausedAt: true },
      });
      if (!settings?.enabled || settings.pausedAt) return;
    }
    await enqueueJob(prisma, {
      kind: "ai.bot.push",
      companyId,
      payload: queued as unknown as Prisma.InputJsonObject,
      maxAttempts: 1,
    });
    kickJobWorker();
  } catch (error) {
    console.error("[bot] push not queued", error instanceof Error ? error.message : error);
  }
}

/** The background job: sends one push to each linked bot of the company (an alarm: the owners'). */
export async function runBotPushJob(job: BackgroundJob) {
  const { sendPush } = await import("./send-push");
  await sendPush(job.companyId!, job.payload as unknown as QueuedPush);
}
