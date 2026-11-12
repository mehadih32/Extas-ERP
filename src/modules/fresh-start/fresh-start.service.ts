import { Prisma, type FreshStart } from "@prisma/client";
import { z } from "zod";

import { AppError } from "@/lib/errors";
import { formatInstantDay } from "@/lib/format";
import { prisma } from "@/lib/prisma";
import { assertMayWrite, readOnlyReason } from "@/lib/read-only";
import type { RequestMeta } from "@/lib/request-meta";
import { runTransaction } from "@/lib/transaction";
import { ensureAccountsSetup } from "@/modules/accounts/setup";
import { requirePin } from "@/modules/ai/settings.service";
import { recordAudit } from "@/modules/audit/audit.service";
import type { CompanyContext } from "@/modules/auth/context";
import { deleteStoredFile } from "@/modules/files/file.service";
import { wipeCompany } from "@/modules/fresh-start/wipe";
import { ensureHrSetup } from "@/modules/hr/setup";
import { ensureWalkInParty } from "@/modules/parties/walk-in";

/*
 * Fresh start (the owner's decision, 2026-11-12): the one time in the ERP's life
 * that a company's business data is erased, so the owner can start real work on
 * a clean ERP after practising on it. The one exception to "the ERP never
 * deletes history" (CLAUDE.md section 2).
 *
 *   - Only the platform owner (Super Admin), on the web, with the company's name
 *     typed exactly and the PIN. Never the AI (its context is never a Super
 *     Admin) and never the bot (no command reaches it; a stand-in has no session).
 *   - A FreshStart row is claimed first (one per company), so a second click or a
 *     second tab is refused while it runs, and for ever once it is DONE.
 *   - A complete backup comes first, through the normal backup system, and must be
 *     checked in Google Drive; it is kept for ever ("Before fresh start"). Without
 *     it nothing is erased and the owner is told why.
 *   - The wipe (plan.ts, wipe.ts) is one transaction, together with the DONE mark
 *     and the "Fresh start" activity-log row: all of it or nothing. The files'
 *     bytes go after it is saved.
 * Restoring a backup from before the fresh start brings the old data back, and
 * with it the button.
 */

export const BEFORE_FRESH_START = "Before fresh start";

/** A run still backing up or erasing after this long was cut off (the server stopped). */
const STALE_MS = 6 * 60 * 60 * 1000;
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

/** A run cut off by a server stop: nothing was erased (the wipe is one transaction). */
async function settleStale(companyId: string, now = new Date()) {
  await prisma.freshStart.updateMany({
    where: {
      companyId,
      status: { in: ["BACKING_UP", "ERASING"] },
      startedAt: { lt: new Date(now.getTime() - STALE_MS) },
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
  await requirePin(ctx, input.pin, "make a fresh start");

  const companyId = ctx.company.id;
  await settleStale(companyId);
  const existing = await prisma.freshStart.findUnique({ where: { companyId } });
  if (existing?.status === "DONE") {
    throw new AppError("CONFLICT", "Fresh start was already used. It can be used only once.");
  }
  if (existing && existing.status !== "FAILED") {
    throw new AppError("CONFLICT", "A fresh start is already running. Wait for it to finish.");
  }
  const notReady = await (options.readiness ?? backupReadiness)();
  if (notReady) throw new AppError("VALIDATION", `Nothing was erased. ${notReady}`);

  // Claim the one row: a second click (or tab) finds it taken and stops here.
  const claim = {
    status: "BACKING_UP" as const,
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

  const job = runFreshStart(row.id, { userId: ctx.user.id }, meta, options.backup ?? driveBackup);
  if (options.wait) await job;
  return present(
    await prisma.freshStart.findUnique({ where: { id: row.id } }),
    ctx.company.timezone,
  );
}

async function fail(id: string, error: string, backupRunId?: string | null) {
  await prisma.freshStart.update({
    where: { id },
    data: { status: "FAILED", finishedAt: new Date(), error },
  });
  // Nothing was erased: the backup is an ordinary one again, under the usual keeping rules.
  if (backupRunId) {
    await prisma.backupRun
      .updateMany({ where: { id: backupRunId }, data: { keepForever: false, label: null } })
      .catch(() => undefined);
  }
}

/** The background part: the backup, then the wipe. Never rejects. */
async function runFreshStart(
  id: string,
  actor: { userId: string },
  meta: RequestMeta | undefined,
  backup: FreshStartBackup,
): Promise<void> {
  let backupRunId: string | null = null;
  try {
    const made = await backup(actor);
    if (!made.ok) {
      await fail(id, `Nothing was erased: ${made.reason}.`, made.runId);
      return;
    }
    backupRunId = made.runId;
    const row = await prisma.freshStart.update({
      where: { id },
      data: { status: "ERASING", backupRunId: made.runId, backupName: made.name },
    });
    const ticks = {
      keepParties: row.keepParties,
      keepProducts: row.keepProducts,
      keepEmployees: row.keepEmployees,
    };
    const result = await runTransaction(
      async (tx) => {
        // Still ours to run (the row is locked until this is saved).
        const [mine] = await tx.$queryRaw<{ status: string }[]>`
          SELECT "status"::text AS "status" FROM "FreshStart" WHERE "id" = ${id} FOR UPDATE`;
        if (mine?.status !== "ERASING") throw new Error("the fresh start was stopped");
        const wiped = await wipeCompany(tx, row.companyId, ticks);
        // What a new company has from the start (all safe to repeat).
        await ensureAccountsSetup(row.companyId, tx);
        await ensureHrSetup(row.companyId, tx);
        await ensureWalkInParty(row.companyId, tx);
        const kept = [
          ticks.keepParties && "buyers and suppliers",
          ticks.keepProducts && "products and styles",
          ticks.keepEmployees && "employees",
        ].filter(Boolean);
        await tx.freshStart.update({
          where: { id },
          data: {
            status: "DONE",
            finishedAt: new Date(),
            report: { erased: wiped.erased } as Prisma.InputJsonObject,
          },
        });
        await recordAudit(
          {
            companyId: row.companyId,
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
      1,
    );
    // The erased files' bytes, now that the wipe is saved.
    for (const file of result.files) {
      await deleteStoredFile(file).catch((error: unknown) =>
        console.error("[fresh-start] a file could not be removed", error),
      );
    }
  } catch (error) {
    console.error("[fresh-start] stopped", error);
    const reason = error instanceof Error ? error.message : String(error);
    await fail(id, `Nothing was erased: ${reason}`, backupRunId).catch((inner: unknown) =>
      console.error("[fresh-start] could not record the failure", inner),
    );
  }
}
