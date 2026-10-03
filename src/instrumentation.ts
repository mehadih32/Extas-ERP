import type { Instrumentation } from "next";

/**
 * Runs once when the Next.js server starts. Starts the daily backup scheduler,
 * the reminder scheduler and the nightly housekeeping in the Node.js server: each
 * is on by default in production and off in development and tests (set
 * BACKUP_SCHEDULER, REMINDER_SCHEDULER or HOUSEKEEPING_SCHEDULER to on or off to
 * choose).
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const production = process.env.NODE_ENV === "production";
  const on = (value: string | undefined) => (value || (production ? "on" : "off")) === "on";
  if (on(process.env.BACKUP_SCHEDULER)) {
    const { startBackupScheduler } = await import("@/modules/backups/scheduler");
    startBackupScheduler();
  }
  if (on(process.env.REMINDER_SCHEDULER)) {
    const { startReminderScheduler } = await import("@/modules/reminders/scheduler");
    startReminderScheduler();
  }
  if (on(process.env.HOUSEKEEPING_SCHEDULER)) {
    const { startHousekeepingScheduler } = await import("@/modules/housekeeping/scheduler");
    startHousekeepingScheduler();
  }
}

/**
 * Called for every error Next.js catches while showing a screen or running a
 * Server Action. The screen shows the person "Error Code: ERR-<digest>"; this
 * puts the same code in the server log next to Next.js' own report of the error,
 * so support can find it ("When something goes wrong" in deploy/README.md).
 */
export const onRequestError: Instrumentation.onRequestError = (error, request, context) => {
  const digest = (error as { digest?: unknown } | null)?.digest;
  if (typeof digest !== "string") return;
  console.error(`[ERR-${digest}] ${request.method} ${request.path} (${context.routeType})`);
};
