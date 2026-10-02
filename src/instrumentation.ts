/**
 * Runs once when the Next.js server starts. Starts the daily backup scheduler in
 * the Node.js server: on by default in production, off in development and
 * tests (set BACKUP_SCHEDULER=on or off to choose).
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const mode =
    process.env.BACKUP_SCHEDULER || (process.env.NODE_ENV === "production" ? "on" : "off");
  if (mode !== "on") return;
  const { startBackupScheduler } = await import("@/modules/backups/scheduler");
  startBackupScheduler();
}
