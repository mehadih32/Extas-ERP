import { type BugGuardFinding, Prisma } from "@prisma/client";
import { z } from "zod";

import { AppError } from "@/lib/errors";
import { prisma } from "@/lib/prisma";
import type { RequestMeta } from "@/lib/request-meta";
import { pushToBot } from "@/modules/ai/bot/push";
import { type PinProof, requirePin } from "@/modules/ai/settings.service";
import { auditInCompany, recordAudit } from "@/modules/audit/audit.service";
import type { CompanyContext } from "@/modules/auth/context";

import { applyPlan, describePlan, planProblem, undoPlan } from "./corrections";
import { ownerStandIn } from "./owner";
import { blockSource, endSession, unblockSource } from "./security";
import { assertPlatform } from "./settings.service";
import type { CodeFacts, CorrectionPlan, SecurityAction } from "./types";

/*
 * What the owner does with a finding (AI Center > Bug Guard, or its buttons on
 * the bot), and only with the owner's OK:
 *   Fix, by kind:
 *     CODE      Claude Code gets an issue with only safe facts and makes a pull
 *               request with a test; the owner merges it with the PIN (AI Center >
 *               Full check), the safe update runs, Bug Guard checks again.
 *     DATA      the exact correction is prepared (before → after); "Apply" with
 *               the PIN makes a full backup first, then applies it as a logged,
 *               reversible correction ("Undo", with the PIN, puts it back).
 *     SECURITY  with the PIN: end a session (never the owner's), block or unblock
 *               a login source.
 *     MANUAL    only the owner can do it: the steps are shown.
 *   Ignore, and Remind me later (quiet for 3 days).
 * It never deletes data, changes roles or permissions, merges or deploys,
 * sends anything to buyers or suppliers, moves money or turns off backups or
 * its own checks (tests/unit/bug-guard.test.ts, "What Bug Guard can never do").
 */

export const SNOOZE_DAYS = 3;
/** A correction whose backup has not finished in this time is given up (nothing changed). */
export const BACKUP_WAIT_MS = 3 * 60 * 60_000;

async function findingOf(ctx: CompanyContext, id: string) {
  const finding = await prisma.bugGuardFinding.findFirst({
    where: { id: String(id).slice(0, 40), companyId: ctx.company.id },
  });
  if (!finding) throw new AppError("NOT_FOUND", "That problem is not in Bug Guard's list.");
  return finding;
}

async function logEvent(
  ctx: CompanyContext | null,
  companyId: string,
  e: { kind: string; summary: string; findingId?: string | null; correctionId?: string | null },
) {
  await prisma.bugGuardEvent.create({
    data: {
      companyId,
      kind: e.kind,
      summary: e.summary.slice(0, 500),
      findingId: e.findingId ?? null,
      correctionId: e.correctionId ?? null,
      byId: ctx?.user.id ?? null,
    },
  });
}

const short = (f: Pick<BugGuardFinding, "title">) =>
  f.title.length > 120 ? `${f.title.slice(0, 119)}…` : f.title;

export const pinSchema = z.object({ pin: z.string().max(20).optional() });

export type FixResult =
  | { kind: "CODE"; issueNumber: number; issueUrl: string }
  | { kind: "DATA"; correctionId: string; summary: string }
  | { kind: "SECURITY"; done: string }
  | { kind: "MANUAL"; steps: string; href: string | null };

/** "Fix" on a finding (the PIN only for a security step: the rest changes nothing yet). */
export async function fixFinding(
  ctx: CompanyContext,
  id: string,
  input: unknown = {},
  meta?: RequestMeta,
  checked?: PinProof,
): Promise<FixResult> {
  assertPlatform(ctx);
  const finding = await findingOf(ctx, id);
  if (!["OPEN", "SNOOZED", "IGNORED"].includes(finding.status)) {
    throw new AppError(
      "CONFLICT",
      finding.status === "FIXING"
        ? "Claude Code is working on this already."
        : "This is not open any more.",
    );
  }
  switch (finding.fixKind) {
    case "CODE":
      return askForCodeFix(ctx, finding, meta);
    case "DATA": {
      const c = await prepareCorrection(ctx, finding, false);
      return { kind: "DATA", correctionId: c.id, summary: c.summary };
    }
    case "SECURITY": {
      const { pin } = pinSchema.parse(input ?? {});
      return { kind: "SECURITY", done: await securityStep(ctx, finding, checked ?? pin, meta) };
    }
    case "MANUAL":
      return { kind: "MANUAL", steps: finding.fix, href: finding.href };
    case "NONE":
      throw new AppError(
        "VALIDATION",
        "There is nothing to fix here: it is a note. Press Ignore if you do not need it.",
      );
  }
}

async function askForCodeFix(
  ctx: CompanyContext,
  finding: BugGuardFinding,
  meta?: RequestMeta,
  byGuard = false,
) {
  const facts = finding.code as CodeFacts | null;
  if (!facts?.route) throw new AppError("VALIDATION", "This problem has no facts for Claude Code.");
  const { sendGuardFix } = await import("@/modules/ai/full-check/full-check.service");
  const sent = await sendGuardFix(
    ctx,
    {
      facts: {
        route: facts.route,
        method: facts.method ?? null,
        status: facts.status ?? null,
        errorType: facts.errorType ?? null,
        stack: facts.stack ?? [],
        routes: facts.routes ?? [],
        times: facts.times ?? undefined,
      },
      problemIds: facts.problemIds,
      summary: `Bug Guard: ${finding.title}`,
    },
    meta,
  );
  await prisma.bugGuardFinding.update({
    where: { id: finding.id },
    data: {
      status: "FIXING",
      requestId: sent.id,
      snoozedUntil: null,
      decidedById: byGuard ? null : ctx.user.id,
      decidedAt: new Date(),
    },
  });
  await logEvent(byGuard ? null : ctx, ctx.company.id, {
    kind: "FIX_ASKED",
    findingId: finding.id,
    summary: `Sent to Claude Code (issue #${sent.issueNumber})${byGuard ? " by Bug Guard itself" : ""}: ${short(finding)}`,
  });
  return { kind: "CODE" as const, issueNumber: sent.issueNumber, issueUrl: sent.issueUrl };
}

/** Prepares the exact correction of a data finding (changes nothing). */
export async function prepareCorrection(
  ctx: CompanyContext,
  finding: BugGuardFinding,
  byGuard: boolean,
) {
  if (finding.fixKind !== "DATA" || !finding.correction) {
    throw new AppError(
      "VALIDATION",
      "This problem has no correction Bug Guard can make: see its steps.",
    );
  }
  const plan = finding.correction as unknown as CorrectionPlan;
  const problem = planProblem(plan);
  if (problem) throw new AppError("VALIDATION", `This correction cannot be made: ${problem}`);
  const open = await prisma.bugGuardCorrection.findFirst({
    where: { findingId: finding.id, status: { in: ["PREPARED", "BACKING_UP"] } },
  });
  if (open) return open;
  const made = await prisma.bugGuardCorrection.create({
    data: {
      companyId: finding.companyId,
      findingId: finding.id,
      plan: plan as unknown as Prisma.InputJsonObject,
      summary: describePlan(plan),
      preparedById: byGuard ? null : ctx.user.id,
      preparedByGuard: byGuard,
    },
  });
  await logEvent(byGuard ? null : ctx, finding.companyId, {
    kind: "PREPARED",
    findingId: finding.id,
    correctionId: made.id,
    summary: `Correction prepared${byGuard ? " by Bug Guard itself" : ""}: ${short(finding)}`,
  });
  return made;
}

async function securityStep(
  ctx: CompanyContext,
  finding: BugGuardFinding,
  pin: PinProof,
  meta?: RequestMeta,
) {
  const action = finding.action as SecurityAction | null;
  if (!action) throw new AppError("VALIDATION", "This problem has no safe step: see its steps.");
  await requirePin(ctx, pin, "take this security step");
  let done: string;
  switch (action.kind) {
    case "END_SESSION": {
      const ended = await endSession({
        sessionId: action.sessionId,
        companyId: ctx.company.id,
        byId: ctx.user.id,
        why: "the owner chose it in Bug Guard",
      });
      done = `${ended.name}'s sign-in was ended. They can sign in again with their password.`;
      break;
    }
    case "BLOCK_SOURCE": {
      const block = await blockSource({
        source: action.source,
        failures: action.failures,
        companyId: ctx.company.id,
        byId: ctx.user.id,
      });
      done = block
        ? `Sign-in from ${action.source} is stopped for 24 hours.`
        : `Sign-in from ${action.source} was stopped already.`;
      break;
    }
    case "UNBLOCK_SOURCE":
      await unblockSource(action.blockId, ctx.company.id, ctx.user.id);
      done = "Sign-in from that place is allowed again.";
      break;
  }
  await prisma.bugGuardFinding.update({
    where: { id: finding.id },
    data: { status: "FIXED", goneAt: new Date(), decidedById: ctx.user.id, decidedAt: new Date() },
  });
  await auditInCompany(ctx, meta, {
    action: "UPDATE",
    entityType: "BugGuardFinding",
    entityId: finding.id,
    summary: `Bug Guard security step: ${done}`,
  });
  return done;
}

/** "Allow again" on a blocked login source (with the PIN). */
export async function liftBlock(
  ctx: CompanyContext,
  blockId: string,
  input: unknown,
  meta?: RequestMeta,
  checked?: PinProof,
) {
  assertPlatform(ctx);
  const { pin } = pinSchema.parse(input ?? {});
  await requirePin(ctx, checked ?? pin, "allow sign-in from that place again");
  const block = await prisma.loginBlock.findFirst({
    where: {
      id: String(blockId).slice(0, 40),
      OR: [{ companyId: ctx.company.id }, { companyId: null }],
    },
  });
  if (!block) throw new AppError("NOT_FOUND", "That block is not there any more.");
  await unblockSource(block.id, ctx.company.id, ctx.user.id);
  await auditInCompany(ctx, meta, {
    action: "UPDATE",
    entityType: "LoginBlock",
    entityId: block.id,
    summary: `Allowed sign-in from ${block.source} again`,
  });
}

/** "Ignore": not reported again, unless it gets worse. */
export async function ignoreFinding(ctx: CompanyContext, id: string, meta?: RequestMeta) {
  assertPlatform(ctx);
  const finding = await findingOf(ctx, id);
  if (!["OPEN", "SNOOZED"].includes(finding.status)) {
    throw new AppError("CONFLICT", "Only an open problem can be ignored.");
  }
  await prisma.bugGuardFinding.update({
    where: { id: finding.id },
    data: {
      status: "IGNORED",
      snoozedUntil: null,
      decidedById: ctx.user.id,
      decidedAt: new Date(),
    },
  });
  await logEvent(ctx, ctx.company.id, {
    kind: "IGNORED",
    findingId: finding.id,
    summary: `Ignored: ${short(finding)}`,
  });
  await auditInCompany(ctx, meta, {
    action: "UPDATE",
    entityType: "BugGuardFinding",
    entityId: finding.id,
    summary: `Bug Guard: ignored "${short(finding)}"`,
  });
}

/** "Remind me later": quiet for 3 days, then reported again if it is still there. */
export async function snoozeFinding(
  ctx: CompanyContext,
  id: string,
  meta?: RequestMeta,
  now: Date = new Date(),
) {
  assertPlatform(ctx);
  const finding = await findingOf(ctx, id);
  if (finding.status !== "OPEN") throw new AppError("CONFLICT", "Only an open problem can wait.");
  const until = new Date(now.getTime() + SNOOZE_DAYS * 86_400_000);
  await prisma.bugGuardFinding.update({
    where: { id: finding.id },
    data: { status: "SNOOZED", snoozedUntil: until, decidedById: ctx.user.id, decidedAt: now },
  });
  await logEvent(ctx, ctx.company.id, {
    kind: "SNOOZED",
    findingId: finding.id,
    summary: `Remind me later (in ${SNOOZE_DAYS} days): ${short(finding)}`,
  });
  await auditInCompany(ctx, meta, {
    action: "UPDATE",
    entityType: "BugGuardFinding",
    entityId: finding.id,
    summary: `Bug Guard: remind in ${SNOOZE_DAYS} days about "${short(finding)}"`,
  });
  return { until };
}

/** "Show again" on an ignored or waiting problem. */
export async function reopenFinding(ctx: CompanyContext, id: string, meta?: RequestMeta) {
  assertPlatform(ctx);
  const finding = await findingOf(ctx, id);
  if (!["IGNORED", "SNOOZED"].includes(finding.status)) {
    throw new AppError("CONFLICT", "Only an ignored or waiting problem can be shown again.");
  }
  await prisma.bugGuardFinding.update({
    where: { id: finding.id },
    data: { status: "OPEN", snoozedUntil: null, decidedById: ctx.user.id, decidedAt: new Date() },
  });
  await logEvent(ctx, ctx.company.id, {
    kind: "REOPENED",
    findingId: finding.id,
    summary: `Shown again: ${short(finding)}`,
  });
  await auditInCompany(ctx, meta, {
    action: "UPDATE",
    entityType: "BugGuardFinding",
    entityId: finding.id,
    summary: `Bug Guard: showing "${short(finding)}" again`,
  });
}

// ---------------------------------------------------------------- corrections

async function correctionOf(ctx: CompanyContext, id: string) {
  const c = await prisma.bugGuardCorrection.findFirst({
    where: { id: String(id).slice(0, 40), companyId: ctx.company.id },
    include: { finding: true },
  });
  if (!c) throw new AppError("NOT_FOUND", "That correction is not there.");
  return c;
}

/** Starts the full backup a correction waits for; the id of the backup run. */
export type StartBackup = (userId: string) => Promise<string>;

export const startBackup: StartBackup = async (userId) => {
  const { runBackup } = await import("@/modules/backups/backup.service");
  try {
    const run = await runBackup({ trigger: "MANUAL", actor: { userId }, wait: false });
    return run.id;
  } catch (error) {
    // A backup already running counts: it started before the correction.
    if (error instanceof AppError && error.code === "CONFLICT") {
      const running = await prisma.backupRun.findFirst({
        where: { kind: "BACKUP", status: { in: ["QUEUED", "RUNNING"] } },
        orderBy: { startedAt: "desc" },
        select: { id: true },
      });
      if (running) return running.id;
    }
    throw error;
  }
};

/**
 * "Apply" (with the PIN): checks the figures are still as shown, then starts a
 * full backup; the clock applies the correction once the backup has finished
 * (processCorrections). If the backup fails, nothing is changed.
 */
export async function applyCorrection(
  ctx: CompanyContext,
  id: string,
  input: unknown,
  meta?: RequestMeta,
  checked?: PinProof,
  backup: StartBackup = startBackup,
) {
  assertPlatform(ctx);
  const { pin } = pinSchema.parse(input ?? {});
  const c = await correctionOf(ctx, id);
  if (c.status !== "PREPARED") {
    throw new AppError(
      "CONFLICT",
      c.status === "BACKING_UP"
        ? "It is being applied: the backup is running."
        : "This correction is not waiting to be applied.",
    );
  }
  await requirePin(ctx, checked ?? pin, "apply a data correction");
  const plan = c.plan as unknown as CorrectionPlan;
  const problem = planProblem(plan);
  if (problem) throw new AppError("VALIDATION", `It cannot be applied: ${problem}`);
  // Claim it first, so a second press cannot apply it twice.
  const claimed = await prisma.bugGuardCorrection.updateMany({
    where: { id: c.id, status: "PREPARED" },
    data: { status: "BACKING_UP", appliedById: ctx.user.id, error: null },
  });
  if (claimed.count === 0) throw new AppError("CONFLICT", "It is being applied already.");
  let backupRunId: string;
  try {
    backupRunId = await backup(ctx.user.id);
  } catch (error) {
    await prisma.bugGuardCorrection.update({
      where: { id: c.id },
      data: { status: "PREPARED", appliedById: null },
    });
    throw new AppError(
      "UNAVAILABLE",
      `The backup could not start, so nothing was changed: ${error instanceof Error ? error.message : "try again"}`,
    );
  }
  await prisma.bugGuardCorrection.update({ where: { id: c.id }, data: { backupRunId } });
  await logEvent(ctx, ctx.company.id, {
    kind: "BACKING_UP",
    findingId: c.findingId,
    correctionId: c.id,
    summary: `Apply approved with the PIN: backing up first, then: ${c.summary.split("\n")[0]}`,
  });
  await auditInCompany(ctx, meta, {
    action: "UPDATE",
    entityType: "BugGuardCorrection",
    entityId: c.id,
    summary: `Bug Guard correction approved (applies after the backup): ${c.summary}`.slice(
      0,
      1000,
    ),
  });
  return { backupRunId };
}

/** "Cancel" on a prepared correction: nothing changes. */
export async function cancelCorrection(ctx: CompanyContext, id: string, meta?: RequestMeta) {
  assertPlatform(ctx);
  const c = await correctionOf(ctx, id);
  const done = await prisma.bugGuardCorrection.updateMany({
    where: { id: c.id, status: "PREPARED" },
    data: { status: "CANCELLED" },
  });
  if (done.count === 0) throw new AppError("CONFLICT", "This correction is not waiting any more.");
  await logEvent(ctx, ctx.company.id, {
    kind: "CANCELLED",
    findingId: c.findingId,
    correctionId: c.id,
    summary: `Correction cancelled: ${short(c.finding)}`,
  });
  await auditInCompany(ctx, meta, {
    action: "UPDATE",
    entityType: "BugGuardCorrection",
    entityId: c.id,
    summary: "Bug Guard correction cancelled: nothing changed",
  });
}

/** "Undo" (with the PIN): puts the figures back, or reverses the adjusting entry. */
export async function undoCorrection(
  ctx: CompanyContext,
  id: string,
  input: unknown,
  meta?: RequestMeta,
  checked?: PinProof,
) {
  assertPlatform(ctx);
  const { pin } = pinSchema.parse(input ?? {});
  const c = await correctionOf(ctx, id);
  if (c.status !== "APPLIED")
    throw new AppError("CONFLICT", "Only an applied correction can be undone.");
  await requirePin(ctx, checked ?? pin, "undo a data correction");
  const plan = c.plan as unknown as CorrectionPlan;
  const undone = await prisma.$transaction(async (tx) => {
    const claimed = await tx.bugGuardCorrection.updateMany({
      where: { id: c.id, status: "APPLIED" },
      data: { status: "UNDONE", undoneById: ctx.user.id, undoneAt: new Date() },
    });
    if (claimed.count === 0) throw new AppError("CONFLICT", "It was undone already.");
    const result = await undoPlan(
      tx,
      ctx.company.id,
      plan,
      { journalEntryId: c.journalEntryId },
      { userId: ctx.user.id },
    );
    await tx.bugGuardCorrection.update({
      where: { id: c.id },
      data: { undoJournalEntryId: result.undoJournalEntryId },
    });
    await tx.bugGuardFinding.update({
      where: { id: c.findingId },
      data: { status: "OPEN", goneAt: null, reportedAt: new Date() },
    });
    return result;
  });
  await logEvent(ctx, ctx.company.id, {
    kind: "UNDONE",
    findingId: c.findingId,
    correctionId: c.id,
    summary: `Correction undone with the PIN: ${short(c.finding)}`,
  });
  await auditInCompany(ctx, meta, {
    action: "UPDATE",
    entityType: "BugGuardCorrection",
    entityId: c.id,
    summary: `Bug Guard correction undone: ${c.summary}`.slice(0, 1000),
  });
  return undone;
}

/**
 * The clock: a correction waiting for its backup is applied once the backup
 * finished; a failed or lost backup leaves everything as it was.
 */
export async function processCorrections(now: Date = new Date()) {
  const waiting = await prisma.bugGuardCorrection.findMany({
    where: { status: "BACKING_UP" },
    include: { finding: { select: { id: true, title: true } } },
    take: 20,
  });
  for (const c of waiting) {
    const backup = c.backupRunId
      ? await prisma.backupRun.findUnique({
          where: { id: c.backupRunId },
          select: { status: true, error: true, startedAt: true },
        })
      : null;
    if (backup?.status === "SUCCEEDED") {
      await applyNow(c.id, c.companyId, c.appliedById, c.finding).catch((error: unknown) =>
        console.error("[bug-guard] correction not applied", error),
      );
    } else if (!backup || backup.status === "FAILED") {
      await fail(
        c.id,
        c.companyId,
        c.finding,
        `The backup failed (${backup?.error ?? "it is not there"}), so nothing was changed. Press Apply again.`,
      );
    } else if (now.getTime() - backup.startedAt.getTime() > BACKUP_WAIT_MS) {
      await fail(
        c.id,
        c.companyId,
        c.finding,
        "The backup took too long, so nothing was changed. Press Apply again.",
      );
    }
  }
}

async function fail(
  id: string,
  companyId: string,
  finding: { id: string; title: string },
  why: string,
) {
  const done = await prisma.bugGuardCorrection.updateMany({
    where: { id, status: "BACKING_UP" },
    data: { status: "PREPARED", error: why },
  });
  if (done.count === 0) return;
  await logEvent(null, companyId, {
    kind: "FAILED",
    findingId: finding.id,
    correctionId: id,
    summary: why,
  });
  const { alarmOwner } = await import("./security");
  await alarmOwner(companyId, "A correction was not applied", `${short(finding)}. ${why}`);
}

async function applyNow(
  id: string,
  companyId: string,
  userId: string | null,
  finding: { id: string; title: string },
) {
  if (!userId) return fail(id, companyId, finding, "No one approved it, so nothing was changed.");
  let summary = "";
  try {
    await prisma.$transaction(async (tx) => {
      const c = await tx.bugGuardCorrection.findUniqueOrThrow({ where: { id } });
      const claimed = await tx.bugGuardCorrection.updateMany({
        where: { id, status: "BACKING_UP" },
        data: { status: "APPLIED", appliedAt: new Date() },
      });
      if (claimed.count === 0) throw new AppError("CONFLICT", "Applied already.");
      const result = await applyPlan(tx, companyId, c.plan as unknown as CorrectionPlan, {
        userId,
        correctionId: id,
      });
      await tx.bugGuardCorrection.update({
        where: { id },
        data: { journalEntryId: result.journalEntryId, error: null },
      });
      await tx.bugGuardFinding.update({
        where: { id: c.findingId },
        data: { status: "FIXED", goneAt: new Date() },
      });
      summary = c.summary;
    });
  } catch (error) {
    if (
      error instanceof AppError &&
      error.code === "CONFLICT" &&
      error.message === "Applied already."
    )
      return;
    const why = error instanceof AppError ? error.message : "It could not be applied";
    await prisma.bugGuardCorrection.updateMany({
      where: { id, status: "BACKING_UP" },
      data: {
        status: error instanceof AppError && error.code === "CONFLICT" ? "STALE" : "FAILED",
        error: why,
      },
    });
    await logEvent(null, companyId, {
      kind: "FAILED",
      findingId: finding.id,
      correctionId: id,
      summary: `Not applied, nothing changed: ${why}`,
    });
    const { alarmOwner } = await import("./security");
    await alarmOwner(
      companyId,
      "A correction was not applied",
      `${short(finding)}. ${why}. Nothing was changed.`,
    );
    return;
  }
  await prisma.bugGuardEvent.create({
    data: {
      companyId,
      findingId: finding.id,
      correctionId: id,
      kind: "APPLIED",
      byId: userId,
      summary: `Applied after the backup: ${summary}`.slice(0, 500),
    },
  });
  await recordAudit({
    companyId,
    userId,
    action: "UPDATE",
    entityType: "BugGuardCorrection",
    entityId: id,
    summary: `Bug Guard correction applied after the backup: ${summary}`.slice(0, 1000),
  });
  await pushToBot(companyId, { kind: "guard-correction", correctionId: id }, { alarm: true });
}

/**
 * The option "open fixes and prepare corrections by itself" (off by default):
 * code fixes go to Claude Code (at most 3 a run) and data corrections are
 * prepared. Applying and merging always wait for the owner.
 */
export async function prepareByItself(companyId: string, ids: string[]) {
  const ctx = await ownerStandIn(companyId);
  if (!ctx) return;
  const findings = await prisma.bugGuardFinding.findMany({
    where: { companyId, id: { in: ids }, status: "OPEN", fixKind: { in: ["CODE", "DATA"] } },
    orderBy: { severity: "asc" },
  });
  let asked = 0;
  for (const f of findings) {
    try {
      if (f.fixKind === "CODE" && asked < 3) {
        await askForCodeFix(ctx, f, undefined, true);
        asked += 1;
      } else if (f.fixKind === "DATA" && f.correction) {
        const c = await prepareCorrection(ctx, f, true);
        await pushToBot(
          companyId,
          { kind: "guard-correction", correctionId: c.id },
          { alarm: true },
        );
      }
    } catch (error) {
      console.error(
        `[bug-guard] could not prepare a fix for ${f.key}`,
        error instanceof Error ? error.message : error,
      );
    }
  }
}
