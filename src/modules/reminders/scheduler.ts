import { runReminders } from "@/modules/reminders/engine";

/*
 * The reminder clock. Started once per server process (instrumentation.ts);
 * every minute it sends the reminders that are due (engine.ts) and Mehedi 2.0's
 * reminders to the owner (ai/ai-reminders.ts). A run still going when the next
 * minute comes is not doubled.
 */

const CHECK_EVERY_MS = 60_000;
let timer: NodeJS.Timeout | null = null;
let running = false;

export async function reminderTick(now: Date = new Date()) {
  if (running) return null;
  running = true;
  try {
    const result = await runReminders(now);
    // Mehedi 2.0's follow-up dates and unsent buyer drafts (ai/ai-reminders.ts).
    const { runAiReminders } = await import("@/modules/ai/ai-reminders");
    await runAiReminders(now).catch((error) => console.error("[ai-reminders] run failed", error));
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
