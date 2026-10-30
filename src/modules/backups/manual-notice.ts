import { prisma } from "@/lib/prisma";
import { pushToBot } from "@/modules/ai/bot/push";
import { platformCompanyId } from "@/modules/bug-guard/security";
import { sendInApp } from "@/modules/reminders/notification.service";

import { backupDoneNotice } from "./progress";
import { onDrill } from "./standby";

/*
 * "Back up now" returns at once while the backup keeps running (runBackup), so
 * the person who pressed it is told when it ends: in their ERP inbox and, as
 * the backup alarms are (alertOwner), on the bot of the platform owners. Only a
 * manual run is watched; a scheduled backup stays quiet when it works. A drill
 * copy (restore.sh --drill) sends nothing. It reads the run from the database
 * until it is done, from outside the backup itself, so a restart of the server
 * while a backup runs loses only this message (the Backups screen still shows
 * the result).
 */

export const NOTICE_EVERY_MS = 10_000;
export const NOTICE_LIMIT_MS = 3 * 60 * 60_000;

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms).unref?.());

/** Where the person's inbox message goes: the platform's own store if they are in it, else their first. */
async function inboxCompany(userId: string): Promise<string | null> {
  const memberships = await prisma.companyMembership.findMany({
    where: { userId, isActive: true },
    orderBy: { joinedAt: "asc" },
    select: { companyId: true },
  });
  const platform = await platformCompanyId();
  if (platform && memberships.some((m) => m.companyId === platform)) return platform;
  return memberships[0]?.companyId ?? null;
}

/**
 * Waits for a manual backup to end and tells the person who started it. Never
 * rejects (it runs after the action has returned). True when a message was sent.
 */
export async function noticeWhenDone(
  runId: string,
  userId: string,
  options: { everyMs?: number; limitMs?: number } = {},
): Promise<boolean> {
  const everyMs = options.everyMs ?? NOTICE_EVERY_MS;
  const limitMs = options.limitMs ?? NOTICE_LIMIT_MS;
  try {
    if (await onDrill()) return false;
    const until = Date.now() + limitMs;
    for (;;) {
      const run = await prisma.backupRun.findUnique({
        where: { id: runId },
        select: { status: true, checkedAt: true, driveError: true, error: true, sizeBytes: true },
      });
      if (!run) return false;
      const notice = backupDoneNotice(run);
      if (notice) {
        if (await onDrill()) return false;
        const companyId = await inboxCompany(userId);
        if (companyId) {
          await sendInApp(prisma, companyId, [{ userId }], {
            subject: notice.subject,
            body: notice.text,
            entityType: "BackupRun",
            entityId: runId,
          });
        }
        const platform = await platformCompanyId();
        if (platform)
          await pushToBot(platform, { kind: "text", text: notice.text }, { alarm: true });
        return true;
      }
      if (Date.now() + everyMs > until) return false;
      await wait(everyMs);
    }
  } catch (error) {
    console.error(
      "[backups] could not tell who started the backup",
      error instanceof Error ? error.message : error,
    );
    return false;
  }
}
