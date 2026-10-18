import { runReminders } from "@/modules/reminders/engine";

/*
 * The reminder clock. Started once per server process (instrumentation.ts);
 * every minute it sends the reminders that are due (engine.ts), Mehedi 2.0's
 * reminders, briefs and late order steps to the owner, the Full check's
 * follow-ups on GitHub, the weekly Server Health when it is on, and Bug Guard's
 * schedule (bug-guard/clock.ts). A run still going when the next minute comes
 * is not doubled.
 */

const CHECK_EVERY_MS = 60_000;
let timer: NodeJS.Timeout | null = null;
let running = false;

export async function reminderTick(now: Date = new Date()) {
  if (running) return null;
  running = true;
  try {
    // On standby after a restore (G2): only Bug Guard (the check the restore asked
    // for, G1, its schedule and its alarms); the reminders and messages wait.
    const { onStandby } = await import("@/modules/backups/standby");
    if (await onStandby()) {
      const { runBugGuardClock } = await import("@/modules/bug-guard/clock");
      await runBugGuardClock(now).catch((error) =>
        console.error("[bug-guard] clock failed", error),
      );
      return null;
    }
    const result = await runReminders(now);
    // Mehedi 2.0's follow-up dates and unsent buyer drafts (ai/ai-reminders.ts).
    const { runAiReminders } = await import("@/modules/ai/ai-reminders");
    await runAiReminders(now).catch((error) => console.error("[ai-reminders] run failed", error));
    // His morning brief and evening report (ai/briefs.ts).
    const { runBriefs } = await import("@/modules/ai/briefs");
    await runBriefs(now).catch((error) => console.error("[briefs] run failed", error));
    // Late order steps, checked once an hour (ai/orders/order-run.service.ts).
    if (now.getUTCMinutes() === 5) {
      const { runOrderFollowUps } = await import("@/modules/ai/orders/order-run.service");
      await runOrderFollowUps(now).catch((error) => console.error("[orders] run failed", error));
    }
    // The Full check: checks that never reported end, and Claude Code's fixes are
    // followed on GitHub, every two minutes (ai/full-check/full-check.service.ts).
    if (now.getUTCMinutes() % 2 === 0) {
      const { runFullCheckClock } = await import("@/modules/ai/full-check/full-check.service");
      await runFullCheckClock(now).catch((error) =>
        console.error("[full-check] run failed", error),
      );
    }
    // The weekly Server Health, when turned on (ai/health/health.service.ts).
    const { runWeeklyHealth } = await import("@/modules/ai/health/health.service");
    await runWeeklyHealth(now).catch((error) => console.error("[health] run failed", error));
    // Bug Guard: its schedule, checks after fixes, corrections after their
    // backup, and the weekly summary (bug-guard/clock.ts).
    const { runBugGuardClock } = await import("@/modules/bug-guard/clock");
    await runBugGuardClock(now).catch((error) => console.error("[bug-guard] clock failed", error));
    return result;
  } catch (error) {
    console.error("[reminders] run failed", error);
    return null;
  } finally {
    running = false;
  }
}

export function startReminderScheduler() {
  if (timer) return;
  timer = setInterval(() => void reminderTick(), CHECK_EVERY_MS);
  timer.unref();
  console.log("[reminders] reminder scheduler started");
}

export function stopReminderScheduler() {
  if (timer) clearInterval(timer);
  timer = null;
}
