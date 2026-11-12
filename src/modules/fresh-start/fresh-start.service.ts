import { randomUUID } from "node:crypto";
import { access } from "node:fs/promises";
import path from "node:path";

import { Prisma, type FreshStart } from "@prisma/client";
import { z } from "zod";

import { AppError } from "@/lib/errors";
import { formatInstantDay } from "@/lib/format";
import {
  asFreshStartWork,
  liveFreshStartClaim,
  noteFreshStartRunning,
} from "@/lib/fresh-start-guard";
import { prisma } from "@/lib/prisma";
import { assertMayWrite, readOnlyReason } from "@/lib/read-only";
import type { RequestMeta } from "@/lib/request-meta";
import { runTransaction } from "@/lib/transaction";
import { ensureAccountsSetup } from "@/modules/accounts/setup";
import { requirePin } from "@/modules/ai/settings.service";
import { recordAudit } from "@/modules/audit/audit.service";
import type { CompanyContext } from "@/modules/auth/context";
import { deleteStoredFile } from "@/modules/files/file.service";
import { planShopResync, queueShopResync } from "@/modules/fresh-start/shops";
import { wipeCompany } from "@/modules/fresh-start/wipe";
import { ensureHrSetup } from "@/modules/hr/setup";
import { ensureWalkInParty } from "@/modules/parties/walk-in";

/*
 * Fresh start (the owner's decision, 2026-11-12): the one time in a company's life
 * that its business data is erased, so the owner can start real work on
 * a clean ERP after practising on it. The one exception to "the ERP never
 * deletes history" (CLAUDE.md section 2).
 *
 *   - Only the platform owner (Super Admin), on the web, with the company's name
 *     typed exactly and the PIN. Never the AI (its context is never a Super
 *     Admin) and never the bot (no command reaches it; a stand-in has no session).
 *   - A FreshStart row is claimed first (one per company, with a new claim id), so
 *     a second click or a second tab is refused while it runs, and for ever once
 *     it is DONE. Only the job holding the claim id moves the row, and never off
 *     DONE. From the claim until DONE or FAILED nobody writes to the company's
 *     data (lib/fresh-start-guard.ts), so nothing is saved after the backup only
 *     to be erased.
 *   - A complete backup comes first, through the normal backup system, and must be
 *     checked in Google Drive, with every part in it (the code and the locked
 *     settings too); it is kept for ever ("Before fresh start"). Without it
 *     nothing is erased and the owner is told why.
 *   - The wipe (plan.ts, wipe.ts) is one transaction, together with the DONE mark
 *     and the "Fresh start" activity-log row: all of it or nothing. The files'
 *     bytes go after it is saved. Connected online shops are told their stock is
 *     0 and erased SKUs are gone (shops.ts).
 *   - A row left running by a stopped server (or brought back by a restore) is
 *     settled as FAILED the next time the card is read: no job holds its claim.
 * Restoring a backup from before the fresh start brings the old data back, and
 * with it the button.
 */

export const BEFORE_FRESH_START = "Before fresh start";

/** The wipe's transaction may take this long on a big company. */
const WIPE_TIMEOUT_MS = 30 * 60 * 1000;

export const freshStartSchema = z.object({
  keepParties: z.boolean().default(false),
  keepProducts: z.boolean().default(false),
  keepEmployees: z.boolean().default(false),
  companyName: z.string().max(200).default(""),
  pin: z.string().max(20).optional(),
});

/** The backup made before the wipe: it must be saved and checked in Google Drive. */
export type FreshStartBackup = (actor: {
  userId: string;
}) => Promise<
  { ok: true; runId: string; name: string } | { ok: false; reason: string; runId?: string }
>;

/** Why a fresh start cannot start now (the backup could not reach Drive), or null. */
export type FreshStartReadiness = () => Promise<string | null>;

export type FreshStartOptions = {
  backup?: FreshStartBackup;
  readiness?: FreshStartReadiness;
  /** Wait for the whole run (tests); the screen gets an answer at once and polls. */
  wait?: boolean;
};

/** Only the platform owner, in person on the web: never the AI, the bot or a stand-in. */
function assertOwner(ctx: CompanyContext) {
  if (ctx.byAi || !ctx.user.isSuperAdmin || !ctx.session.token) {
    throw new AppError("FORBIDDEN", "Only the owner (Super Admin) can make a fresh start.");
  }
}

/** Whether the backup a fresh start needs can be made and sent to Google Drive now. */
export async function backupReadiness(): Promise<string | null> {
  const { readBackupConfig, backupLock } = await import("@/modules/backups/backup-core");
  const { onStandby } = await import("@/modules/backups/standby");
  // Read only: the card may be opened where nothing may be written (a Full check).
  const config = await readBackupConfig();
  if (await onStandby()) {
    return "This ERP is a restored copy waiting on standby: a fresh start is not possible here.";
  }
  if (!config || !backupLock(config)) {
    return "Set your recovery key on the Backups screen first: the backup made before a fresh start must go to Google Drive, locked with it.";
  }
  if (!config.credentialsRef) {
    return "Connect Google Drive on the Backups screen first: the backup made before a fresh start must be safe in Google Drive.";
  }
  return hostPartsReadiness(config);
}

const exists = (file: string) =>
  access(file).then(
    () => true,
    () => false,
  );

/**
 * Whether the server has left what a complete backup needs besides the data
 * (backup.service.ts hostParts): the code at the running version, and the
 * settings file locked with this backup key. Without them the backup would be
 * made but not complete, and a fresh start is refused.
 */
async function hostPartsReadiness(
  config: NonNullable<
    Awaited<ReturnType<typeof import("@/modules/backups/backup-core").readBackupConfig>>
  >,
): Promise<string | null> {
  const { backupLock, hostRoot, hostVersion } = await import("@/modules/backups/backup-core");
  const { formatOf } = await import("@/modules/backups/backup.service");
  const lock = backupLock(config);
  if (formatOf(lock) !== 3) {
    return "Set your own recovery key on the Backups screen first: the backup made before a fresh start must hold the server's settings, and they go in only with it.";
  }
  const host = await hostVersion();
  if (!host.commit || !(await exists(path.join(hostRoot(), "code.bundle")))) {
    return "The server has not yet saved the code of the running version for the backups (it does at each update): a fresh start must wait for a complete backup.";
  }
  const facts = await import("node:fs/promises")
    .then((fs) => fs.readFile(path.join(hostRoot(), "settings.env.json"), "utf8"))
    .then((text) => JSON.parse(text) as { pairId?: string })
    .catch(() => null);
  if (facts?.pairId !== lock!.id || !(await exists(path.join(hostRoot(), "settings.env.locked")))) {
    return "The server has not yet locked its settings file with your backup key (it does within a minute of setting the key, and at each update): a fresh start must wait for a complete backup.";
  }
  return null;
}

/** A complete backup through the normal backup system, kept for ever, checked in Google Drive. */
export const driveBackup: FreshStartBackup = async (actor) => {
  const { runBackup } = await import("@/modules/backups/backup.service");
  let runId: string;
  try {
    const run = await runBackup({
      trigger: "MANUAL",
      actor,
      wait: true,
      keepForever: { label: BEFORE_FRESH_START },
    });
    runId = run.id;
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.message : String(error) };
  }
  const run = await prisma.backupRun.findUnique({ where: { id: runId } });
  if (!run || run.status !== "SUCCEEDED") {
    return { ok: false, runId, reason: `the backup failed (${run?.error ?? "no reason given"})` };
  }
  if (!run.checkedAt || !run.driveFileId) {
    return {
      ok: false,
      runId,
      reason: `the backup was made but is not checked in Google Drive (${run.driveError ?? "no reason given"})`,
    };
  }
  const missing = (run.report as { missing?: unknown } | null)?.missing;
  if (!Array.isArray(missing) || missing.length > 0) {
    const parts = Array.isArray(missing) ? missing.map(String).join(" ") : "its report is missing.";
    return { ok: false, runId, reason: `the backup is not complete: ${parts}` };
  }
  return { ok: true, runId: run.id, name: run.name ?? run.id };
};

function present(row: FreshStart | null, timeZone = "Asia/Dhaka") {
  if (!row) return null;
  return {
    /** The day it was used (or started), in company time: "12 Nov 2026". */
    day: formatInstantDay(row.finishedAt ?? row.startedAt, timeZone),
    id: row.id,
    status: row.status,
    keepParties: row.keepParties,
    keepProducts: row.keepProducts,
    keepEmployees: row.keepEmployees,
    startedByName: row.startedByName,
    startedAt: row.startedAt,
    finishedAt: row.finishedAt,
    backupName: row.backupName,
    error: row.error,
  };
}

/**
 * A run no job of this server holds (the server stopped, or a restored backup
 * brought the row back as it was): nothing was erased (the wipe is one
 * transaction), so it is FAILED and the button is back.
 */
async function settleStale(companyId: string, now = new Date()) {
  const live = liveFreshStartClaim(companyId);
  await prisma.freshStart.updateMany({
    where: {
      companyId,
      status: { in: ["BACKING_UP", "ERASING"] },
      ...(live ? { OR: [{ claimId: null }, { claimId: { not: live } }] } : {}),
    },
    data: {
      status: "FAILED",
      finishedAt: now,
      error: "Interrupted: the server stopped. Nothing was erased.",
    },
  });
}

/** The card: whether it was used (when, by whom), is running, or may be used, and by whom. */
export async function getFreshStart(ctx: CompanyContext, readiness = backupReadiness) {
  // Writes nothing where writes are refused (a Full check only reads).
  if (!(await readOnlyReason())) await settleStale(ctx.company.id);
  const row = await prisma.freshStart.findUnique({ where: { companyId: ctx.company.id } });
  const owner = !ctx.byAi && ctx.user.isSuperAdmin;
  return {
    /** Only the owner sees the card. */
    canUse: owner && row?.status !== "DONE",
    visible: owner,
    companyName: ctx.company.name,
    record: owner ? present(row, ctx.company.timezone) : null,
    /** Why the backup it needs cannot be made now (shown before the owner starts). */
    notReady: owner && row?.status !== "DONE" ? await readiness() : null,
  };
}

/**
 * Starts the fresh start: checks the owner, the typed company name and the PIN,
 * claims the one-time row, then runs the backup and the wipe in the background
 * (the screen polls getFreshStart). Refused once used, and while one runs.
 */
export async function startFreshStart(
  ctx: CompanyContext,
  raw: unknown,
  meta?: RequestMeta,
  options: FreshStartOptions = {},
) {
  assertOwner(ctx);
  await assertMayWrite();
  const input = freshStartSchema.parse(raw);
  if (input.companyName.trim() !== ctx.company.name.trim()) {
    throw new AppError("VALIDATION", "Type the company name exactly as it is written.", {
      companyName: [`Type the company name exactly: ${ctx.company.name}`],
    });
  }

  // Used or running: said before the PIN is checked (a PIN try is a write the run refuses).
  const companyId = ctx.company.id;
  await settleStale(companyId);
  const existing = await prisma.freshStart.findUnique({ where: { companyId } });
  if (existing?.status === "DONE") {
    throw new AppError("CONFLICT", "Fresh start was already used. It can be used only once.");
  }
  if (existing && existing.status !== "FAILED") {
    throw new AppError("CONFLICT", "A fresh start is already running. Wait for it to finish.");
  }
  await requirePin(ctx, input.pin, "make a fresh start");
  const notReady = await (options.readiness ?? backupReadiness)();
  if (notReady) throw new AppError("VALIDATION", `Nothing was erased. ${notReady}`);

  // Claim the one row: a second click (or tab) finds it taken and stops here.
  const claimId = randomUUID();
  const claim = {
    status: "BACKING_UP" as const,
    claimId,
    keepParties: input.keepParties,
    keepProducts: input.keepProducts,
    keepEmployees: input.keepEmployees,
    startedById: ctx.user.id,
    startedByName: ctx.user.name,
    startedAt: new Date(),
    finishedAt: null,
    backupRunId: null,
    backupName: null,
    error: null,
    report: Prisma.DbNull,
  };
  let row: FreshStart;
  if (!existing) {
    try {
      row = await prisma.freshStart.create({ data: { companyId, ...claim } });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        throw new AppError("CONFLICT", "A fresh start is already running. Wait for it to finish.");
      }
      throw error;
    }
  } else {
    const { count } = await prisma.freshStart.updateMany({
      where: { companyId, status: "FAILED", updatedAt: existing.updatedAt },
      data: claim,
    });
    if (count === 0) {
      throw new AppError("CONFLICT", "A fresh start is already running. Wait for it to finish.");
    }
    row = await prisma.freshStart.findUniqueOrThrow({ where: { companyId } });
  }

  // From here on nobody writes to the company's data until the run ends.
  noteFreshStartRunning(companyId, claimId);
  const job = asFreshStartWork(companyId, claimId, () =>
    runFreshStart(
      { id: row.id, companyId, claimId },
      { userId: ctx.user.id },
      meta,
      options.backup ?? driveBackup,
    ),
  )
    .finally(() => noteFreshStartRunning(companyId, null, claimId))
    .then(async (told) => {
      // The shops' webhooks go out now (outside the fresh start's own work).
      if (told > 0) (await import("@/modules/jobs/worker")).kickJobWorker();
    })
    .catch((error: unknown) => console.error("[fresh-start] after the run", error));
  if (options.wait) await job;
  return present(
    await prisma.freshStart.findUnique({ where: { id: row.id } }),
    ctx.company.timezone,
  );
}

type Claim = { id: string; companyId: string; claimId: string };

class Stopped extends Error {}

/** Marks this run FAILED (only while it still holds its claim and is not DONE). */
async function fail(claim: Claim, error: string, backupRunId?: string | null) {
  await prisma.freshStart.updateMany({
    where: { id: claim.id, claimId: claim.claimId, status: { in: ["BACKING_UP", "ERASING"] } },
    data: { status: "FAILED", finishedAt: new Date(), error },
  });
  if (!backupRunId) return;
  // Never the backup a finished fresh start was made after.
  const row = await prisma.freshStart.findUnique({ where: { id: claim.id } });
  if (row?.status === "DONE" && row.backupRunId === backupRunId) return;
  await unkeep(backupRunId);
}

/** Nothing was erased: the backup is an ordinary one again, under the usual keeping rules. */
async function unkeep(backupRunId: string) {
  const run = await prisma.backupRun
    .update({
      where: { id: backupRunId },
      data: { keepForever: false, label: null },
      select: { driveFileId: true },
    })
    .catch(() => null);
  if (!run?.driveFileId) return;
  // Its Drive folder loses the "kept for ever" label too, so Drive's newest-3 rule takes it.
  try {
    const { driveToken, getBackupConfig } = await import("@/modules/backups/backup-core");
    const drive = await import("@/modules/backups/google-drive");
    const token = await driveToken(await getBackupConfig());
    if (token) await drive.label(token, run.driveFileId, { keep: null, note: null });
  } catch (error) {
    console.error("[fresh-start] the Drive label could not be taken off", error);
  }
}

/** The background part: the backup, then the wipe. Never rejects; how many shop webhooks it queued. */
async function runFreshStart(
  claim: Claim,
  actor: { userId: string },
  meta: RequestMeta | undefined,
  backup: FreshStartBackup,
): Promise<number> {
  const { id, companyId, claimId } = claim;
  let backupRunId: string | null = null;
  try {
    const made = await backup(actor);
    if (!made.ok) {
      await fail(claim, `Nothing was erased: ${made.reason}.`, made.runId);
      return 0;
    }
    backupRunId = made.runId;
    const moved = await prisma.freshStart.updateMany({
      where: { id, claimId, status: "BACKING_UP" },
      data: { status: "ERASING", backupRunId: made.runId, backupName: made.name },
    });
    if (moved.count !== 1) throw new Stopped("the fresh start was stopped");
    // The ticks of this claim (a newer claim has a new claim id).
    const row = await prisma.freshStart.findFirst({ where: { id, claimId } });
    if (!row) throw new Stopped("the fresh start was stopped");
    const ticks = {
      keepParties: row.keepParties,
      keepProducts: row.keepProducts,
      keepEmployees: row.keepEmployees,
    };
    // What the connected shops are told, read before anything is erased.
    const shops = await planShopResync(companyId, ticks);
    let told = 0;
    const result = await runTransaction(
      async (tx) => {
        // Still ours to run, with the ticks it was claimed with (locked until saved).
        const [mine] = await tx.$queryRaw<{ status: string; claimId: string | null }[]>`
          SELECT "status"::text AS "status", "claimId" FROM "FreshStart" WHERE "id" = ${id} FOR UPDATE`;
        if (mine?.status !== "ERASING" || mine.claimId !== claimId) {
          throw new Stopped("the fresh start was stopped");
        }
        const wiped = await wipeCompany(tx, companyId, ticks);
        // What a new company has from the start (all safe to repeat).
        await ensureAccountsSetup(companyId, tx);
        await ensureHrSetup(companyId, tx);
        await ensureWalkInParty(companyId, tx);
        told = await queueShopResync(tx, companyId, shops);
        const kept = [
          ticks.keepParties && "buyers and suppliers",
          ticks.keepProducts && "products and styles",
          ticks.keepEmployees && "employees",
        ].filter(Boolean);
        const done = await tx.freshStart.updateMany({
          where: { id, claimId, status: "ERASING" },
          data: {
            status: "DONE",
            finishedAt: new Date(),
            report: { erased: wiped.erased, shopEvents: told } as Prisma.InputJsonObject,
          },
        });
        if (done.count !== 1) throw new Stopped("the fresh start was stopped");
        await recordAudit(
          {
            companyId,
            userId: actor.userId,
            action: "DELETE",
            entityType: "FreshStart",
            entityId: id,
            summary: `Fresh start: the business data was erased after the backup ${made.name} (kept for ever)${kept.length ? `; kept ${kept.join(", ")}` : ""}`,
            meta,
          },
          tx,
        );
        return wiped;
      },
      { timeout: WIPE_TIMEOUT_MS, maxWait: 60_000 },
      // Run again if Postgres cancels it to break a deadlock (it waits for its table locks).
      3,
    );
    // The erased files' bytes, now that the wipe is saved.
    for (const file of result.files) {
      await deleteStoredFile(file).catch((error: unknown) =>
        console.error("[fresh-start] a file could not be removed", error),
      );
    }
    return told;
  } catch (error) {
    console.error("[fresh-start] stopped", error);
    const reason = error instanceof Error ? error.message : String(error);
    await fail(claim, `Nothing was erased: ${reason}`, backupRunId).catch((inner: unknown) =>
      console.error("[fresh-start] could not record the failure", inner),
    );
    return 0;
  }
}
