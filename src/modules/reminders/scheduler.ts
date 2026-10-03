import { runReminders } from "@/modules/reminders/engine";

/*
 * The reminder clock. Started once per server process (instrumentation.ts);
 * every minute it sends the reminders that are due (engine.ts). A run still
 * going when the next minute comes is not doubled.
 */

const CHECK_EVERY_MS = 60_000;
let timer: NodeJS.Timeout | null = null;
let running = false;

export async function reminderTick(now: Date = new Date()) {
  if (running) return null;
  running = true;
  try {
    return await runReminders(now);
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
