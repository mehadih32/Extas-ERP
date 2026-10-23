import { type BackgroundJob, Prisma } from "@prisma/client";
import { randomUUID } from "node:crypto";

import type { Db } from "@/lib/db-types";
import { prisma } from "@/lib/prisma";

/*
 * The background job queue: a table in the app's own database (BackgroundJob)
 * and a worker inside the app (worker.ts), instead of a separate queue server.
 *   - Adding a job is one insert, so it can go in the same transaction as the
 *     change that needs it: the job exists exactly when the change was saved.
 *   - A worker claims a job with FOR UPDATE SKIP LOCKED, so two workers (or two
 *     ticks) never run the same job.
 *   - A failure waits 30 s, 1 min, 2 min... before the next try, up to
 *     maxAttempts; then the job is FAILED and stays visible until it is retried.
 *   - A job left RUNNING by a crash or restart goes back to the queue after
 *     STALE_AFTER_MS.
 * Handlers must be safe to run again: a crash can come after the work but
 * before the job is marked done.
 */

/** The kinds of work the queue knows (handlers.ts runs each). */
export type JobKind =
  | "terms.pdf"
  | "claim.route"
  | "salary.payout"
  | "exit.certificate"
  | "ai.knowledge.test"
  | "ai.skill.test"
  | "ai.bot.incoming"
  | "ai.bot.push"
  | "ecommerce.webhook.send";

export const STALE_AFTER_MS = 10 * 60_000;
const FIRST_RETRY_MS = 30_000;
const LAST_ERROR_LENGTH = 1000;

/** This process, as named on the jobs it claims. */
export const WORKER_ID = `${process.pid}-${randomUUID().slice(0, 8)}`;

export type NewJob = {
  kind: JobKind;
  companyId?: string | null;
  payload: Prisma.InputJsonObject;
  runAfter?: Date;
  maxAttempts?: number;
};

/** Adds a job. Pass the transaction that makes the change it belongs to. */
export async function enqueueJob(db: Db, job: NewJob): Promise<BackgroundJob> {
  return db.backgroundJob.create({
    data: {
      kind: job.kind,
      companyId: job.companyId ?? null,
      payload: job.payload,
      runAfter: job.runAfter ?? new Date(),
      maxAttempts: job.maxAttempts ?? 5,
    },
  });
}

/** Adds many jobs in one insert (the same defaults as enqueueJob). */
export async function enqueueJobs(db: Db, jobs: readonly NewJob[]): Promise<number> {
  if (jobs.length === 0) return 0;
  const now = new Date();
  const { count } = await db.backgroundJob.createMany({
    data: jobs.map((job) => ({
      kind: job.kind,
      companyId: job.companyId ?? null,
      payload: job.payload,
      runAfter: job.runAfter ?? now,
      maxAttempts: job.maxAttempts ?? 5,
    })),
  });
  return count;
}

/** The wait before try number `attempt + 1`: 30 s, then doubling, at most an hour. */
export function retryDelayMs(attempt: number): number {
  return Math.min(FIRST_RETRY_MS * 2 ** Math.max(attempt - 1, 0), 60 * 60_000);
}

/**
 * Takes the next job that is due, marking it RUNNING for this worker, or null
 * when none is. Jobs another worker holds are skipped, not waited for. Any
 * other kind due goes ahead of the online shops' webhooks: a slow shop never
 * holds up an alarm to the owner or a bot reply (they wait their turn after).
 */
/**
 * Which jobs may be claimed. alarmsSince: only the owner's alarms to the bot queued
 * since then (a copy on standby after a restore, src/modules/jobs/worker.ts).
 */
export type ClaimOnly = { alarmsSince: Date };

export async function claimNextJob(
  now: Date = new Date(),
  workerId: string = WORKER_ID,
  only?: ClaimOnly,
): Promise<BackgroundJob | null> {
  // Timestamps are stored as UTC wall-clock time, whatever the database's own zone.
  const utc = (date: Date) => Prisma.sql`(${date.toISOString()}::timestamptz AT TIME ZONE 'UTC')`;
  const at = utc(now);
  const which = only
    ? Prisma.sql`AND "kind" = 'ai.bot.push' AND "payload"->>'alarm' = 'true' AND "createdAt" >= ${utc(only.alarmsSince)}`
    : Prisma.empty;
  const rows = await prisma.$queryRaw<BackgroundJob[]>`
    UPDATE "BackgroundJob"
    SET "status" = 'RUNNING', "lockedAt" = ${at}, "lockedBy" = ${workerId},
        "attempts" = "attempts" + 1, "updatedAt" = ${at}
    WHERE "id" = (
      SELECT "id" FROM "BackgroundJob"
      WHERE "status" = 'QUEUED' AND "runAfter" <= ${at} ${which}
      ORDER BY ("kind" = 'ecommerce.webhook.send'), "runAfter", "createdAt"
      LIMIT 1
      FOR UPDATE SKIP LOCKED
    )
    RETURNING *`;
  return rows[0] ?? null;
}

/** Marks a claimed job succeeded. */
export async function completeJob(job: Pick<BackgroundJob, "id">, now: Date = new Date()) {
  await prisma.backgroundJob.update({
    where: { id: job.id },
    data: { status: "SUCCEEDED", finishedAt: now, lockedAt: null, lockedBy: null, lastError: null },
  });
}

/**
 * Thrown by a handler that should not run yet (an online shop's webhooks while
 * the shop is paused): the job goes back to the queue until `until`, and the
 * try is not counted.
 */
export class DeferJob extends Error {
  constructor(readonly until: Date) {
    super("Not yet: waiting until " + until.toISOString());
    this.name = "DeferJob";
  }
}

/** Puts a claimed job back until `until`, without counting the try. */
export async function deferJob(job: Pick<BackgroundJob, "id">, until: Date) {
  await prisma.backgroundJob.update({
    where: { id: job.id },
    data: {
      status: "QUEUED",
      runAfter: until,
      attempts: { decrement: 1 },
      lockedAt: null,
      lockedBy: null,
    },
  });
}

/** Records a failed try: back in the queue after a wait, or FAILED after the last try. */
export async function failJob(
  job: Pick<BackgroundJob, "id" | "attempts" | "maxAttempts">,
  error: unknown,
  now: Date = new Date(),
) {
  const message = (error instanceof Error ? error.message : String(error)).slice(
    0,
    LAST_ERROR_LENGTH,
  );
  const last = job.attempts >= job.maxAttempts;
  await prisma.backgroundJob.update({
    where: { id: job.id },
    data: {
      status: last ? "FAILED" : "QUEUED",
      runAfter: last ? undefined : new Date(now.getTime() + retryDelayMs(job.attempts)),
      finishedAt: last ? now : null,
      lockedAt: null,
      lockedBy: null,
      lastError: message,
    },
  });
  return last ? "FAILED" : "QUEUED";
}

/** Puts jobs a crashed or restarted worker left RUNNING back in the queue. */
export async function requeueStaleJobs(now: Date = new Date()): Promise<number> {
  const { count } = await prisma.backgroundJob.updateMany({
    where: { status: "RUNNING", lockedAt: { lt: new Date(now.getTime() - STALE_AFTER_MS) } },
    data: { status: "QUEUED", lockedAt: null, lockedBy: null, runAfter: now },
  });
  return count;
}

/** Runs a FAILED job again from the start (a person asked for it). */
export async function retryJob(db: Db, id: string, now: Date = new Date()) {
  return db.backgroundJob.updateMany({
    where: { id, status: "FAILED" },
    data: { status: "QUEUED", attempts: 0, runAfter: now, finishedAt: null, lastError: null },
  });
}

/** Clears finished jobs: succeeded ones after 30 days, failed ones after 90 (housekeeping). */
export async function purgeOldJobs(now: Date = new Date()): Promise<number> {
  const day = 24 * 60 * 60_000;
  const { count } = await prisma.backgroundJob.deleteMany({
    where: {
      OR: [
        { status: "SUCCEEDED", finishedAt: { lt: new Date(now.getTime() - 30 * day) } },
        { status: "FAILED", finishedAt: { lt: new Date(now.getTime() - 90 * day) } },
      ],
    },
  });
  return count;
}
