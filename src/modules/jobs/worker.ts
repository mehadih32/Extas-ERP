import { JOB_HANDLERS, isJobKind } from "@/modules/jobs/handlers";
import {
  type ClaimOnly,
  claimNextJob,
  completeJob,
  failJob,
  requeueStaleJobs,
} from "@/modules/jobs/queue";

/*
 * The background worker. Started once per server process (instrumentation.ts):
 * every few seconds it runs the jobs that are due, one at a time, and a change
 * that adds a job wakes it at once (kickJobWorker), so a job usually starts
 * within a moment. A run still going when the next tick comes is not doubled.
 */

const CHECK_EVERY_MS = 5_000;
/** Jobs one tick runs at most, so a long queue leaves room for the rest of the server. */
const JOBS_PER_TICK = 20;

let timer: NodeJS.Timeout | null = null;
let running = false;
let again = false;

/** Runs one claimed-or-none job. Returns false when nothing was due. */
async function runOne(now: Date, only?: ClaimOnly): Promise<boolean> {
  const job = await claimNextJob(now, undefined, only);
  if (!job) return false;
  try {
    if (!isJobKind(job.kind)) throw new Error(`No handler for jobs of kind "${job.kind}".`);
    const handler = await JOB_HANDLERS[job.kind]();
    await handler(job);
    await completeJob(job);
  } catch (error) {
    const state = await failJob(job, error);
    console.error(`[jobs] ${job.kind} ${job.id} failed (try ${job.attempts}, ${state})`, error);
    if (state === "FAILED") {
      // Gave up: kept for Bug Guard (the job's kind and the error, not its payload).
      const { recordServerError } = await import("@/modules/bug-guard/server-errors");
      await recordServerError({
        error,
        routeType: "job",
        path: job.kind,
        companyId: job.companyId,
      });
    }
  }
  return true;
}

/**
 * Runs the jobs that are due now (at most `limit`), and returns how many ran.
 * Also used by tests and scripts to run the queue without the clock.
 */
export async function runDueJobs(
  limit = JOBS_PER_TICK,
  now?: () => Date,
  only?: ClaimOnly,
): Promise<number> {
  const clock = now ?? (() => new Date());
  await requeueStaleJobs(clock());
  let ran = 0;
  while (ran < limit && (await runOne(clock(), only))) ran++;
  return ran;
}

export async function jobTick(): Promise<number | null> {
  // A copy on standby after a restore runs only the alarms raised since it went on
  // standby (a failed backup, Bug Guard's urgent items): the backup's own queue would
  // send its messages a second time, so they wait until it goes live (G2).
  const { standbyMark } = await import("@/modules/backups/standby");
  const standby = await standbyMark();
  const only: ClaimOnly | undefined = standby ? { alarmsSince: standby.since } : undefined;
  if (running) {
    again = true;
    return null;
  }
  running = true;
  try {
    let total = 0;
    do {
      again = false;
      total += await runDueJobs(JOBS_PER_TICK, undefined, only);
    } while (again);
    return total;
  } catch (error) {
    console.error("[jobs] run failed", error);
    return null;
  } finally {
    running = false;
  }
}

/** Wakes the worker after a change added a job (does nothing where no worker runs). */
export function kickJobWorker() {
  if (!timer) return;
  setImmediate(() => void jobTick());
}

export function startJobWorker() {
  if (timer) return;
  timer = setInterval(() => void jobTick(), CHECK_EVERY_MS);
  timer.unref();
  console.log("[jobs] background worker started");
  void jobTick();
}

export function stopJobWorker() {
  if (timer) clearInterval(timer);
  timer = null;
}
