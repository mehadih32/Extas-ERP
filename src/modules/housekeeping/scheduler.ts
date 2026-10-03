import { prisma } from "@/lib/prisma";
import { recordAudit } from "@/modules/audit/audit.service";
import { purgeExpiredSessions } from "@/modules/auth/session.service";
import { parseCron, previousRun } from "@/modules/backups/cron";
import { refreshStatusesForCompany } from "@/modules/parties/dormant.service";

/*
 * The nightly housekeeping clock. Started once per server process
 * (instrumentation.ts), it runs every night at 03:30 Bangladesh time, after the
 * 02:00 backup, and once soon after the server starts in case a night was missed:
 *   - in every company, buyers with no business for the company's "dormant
 *     after" period become Dormant, and settling accounts whose dues are cleared
 *     close (the same refresh as POST /api/parties/refresh-statuses);
 *   - expired sign-in sessions are deleted.
 * Every step is safe to repeat, so a run after a restart changes nothing new.
 */

const SCHEDULE = parseCron("30 3 * * *");
const TIMEZONE = "Asia/Dhaka";
const CHECK_EVERY_MS = 60_000;

let timer: NodeJS.Timeout | null = null;
let running = false;
/** The scheduled time this process last ran for. */
let lastDue: number | null = null;

/** Refreshes every company's buyer statuses and removes expired sessions. */
export async function runHousekeeping(now: Date = new Date()) {
  const companies = await prisma.company.findMany({
    select: { id: true, dormantAfterMonths: true },
    orderBy: { createdAt: "asc" },
  });
  let markedDormant = 0;
  let closed = 0;
  for (const company of companies) {
    const result = await refreshStatusesForCompany(company, now);
    if (result.dormant.length + result.closed.length > 0) {
      await recordAudit({
        companyId: company.id,
        userId: null,
        action: "STATUS_CHANGE",
        entityType: "Party",
        summary: `Nightly status refresh: ${result.dormant.length} buyer(s) marked dormant, ${result.closed.length} settled account(s) closed`,
        after: {
          dormant: result.dormant.map((p) => p.code),
          closed: result.closed.map((p) => p.code),
        },
      });
    }
    markedDormant += result.dormant.length;
    closed += result.closed.length;
  }
  const sessionsRemoved = await purgeExpiredSessions();
  return { companies: companies.length, markedDormant, closed, sessionsRemoved };
}

/** Runs the housekeeping when a scheduled time has passed that this process has not run for. */
export async function housekeepingTick(now: Date = new Date()) {
  const due = previousRun(SCHEDULE, TIMEZONE, now);
  if (!due || running || (lastDue !== null && due.getTime() <= lastDue)) return null;
  running = true;
  try {
    return await runHousekeeping(now);
  } catch (error) {
    console.error("[housekeeping] nightly run failed", error);
    return null;
  } finally {
    // A failed night is not retried every minute; the next night runs again.
    lastDue = due.getTime();
    running = false;
  }
}

export function startHousekeepingScheduler() {
  if (timer) return;
  timer = setInterval(() => void housekeepingTick(), CHECK_EVERY_MS);
  timer.unref();
  console.log("[housekeeping] nightly housekeeping scheduler started");
}

/** Stops the clock and forgets the last run (tests start from a clean slate). */
export function stopHousekeepingScheduler() {
  if (timer) clearInterval(timer);
  timer = null;
  lastDue = null;
}
