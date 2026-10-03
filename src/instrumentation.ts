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
