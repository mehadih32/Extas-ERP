/**
 * Runs once when the Next.js server starts. Starts the daily backup scheduler and
 * the reminder scheduler in the Node.js server: each is on by default in
 * production and off in development and tests (set BACKUP_SCHEDULER or
 * REMINDER_SCHEDULER to on or off to choose).
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
}
