import type { Instrumentation } from "next";

/**
 * Runs once when the Next.js server starts. Starts the daily backup scheduler,
 * the reminder scheduler, the nightly housekeeping, the online shops' webhooks
 * and the background job worker in the Node.js server: each is on by default in
 * production and off in development and tests (set BACKUP_SCHEDULER,
 * REMINDER_SCHEDULER, HOUSEKEEPING_SCHEDULER, ECOMMERCE_WEBHOOKS or JOB_WORKER to
 * on or off to choose).
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
  if (on(process.env.ECOMMERCE_WEBHOOKS)) {
    const { startEcommerceWebhooks } = await import("@/modules/ecommerce/webhook-clock");
    startEcommerceWebhooks();
  }
  if (on(process.env.JOB_WORKER)) {
    const { startJobWorker } = await import("@/modules/jobs/worker");
    startJobWorker();
  }
}

/**
 * Called for every error Next.js catches while showing a screen or running a
 * Server Action. The screen shows the person "Error Code: ERR-<digest>"; this
 * puts the same code in the server log next to Next.js' own report of the error,
 * so support can find it ("When something goes wrong" in deploy/README.md), and
 * keeps the error for Bug Guard (modules/bug-guard/server-errors.ts).
 */
export const onRequestError: Instrumentation.onRequestError = async (error, request, context) => {
  const digest = (error as { digest?: unknown } | null)?.digest;
  if (typeof digest === "string") {
    console.error(`[ERR-${digest}] ${request.method} ${request.path} (${context.routeType})`);
  }
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  // Kept for Bug Guard: the route's pattern and the error, never the screen's data.
  const { recordServerError } = await import("@/modules/bug-guard/server-errors");
  const cookie = request.headers.cookie;
  await recordServerError({
    error,
    routeType: context.routeType,
    method: request.method,
    path: context.routePath || request.path,
    digest: typeof digest === "string" ? digest : null,
    cookie: Array.isArray(cookie) ? cookie.join("; ") : (cookie ?? null),
  });
};
