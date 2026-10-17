import { Prisma } from "@prisma/client";

import { AppError } from "@/lib/errors";
import { postJournalEntry, reverseJournalEntry } from "@/modules/accounts/journal.service";

import { correctableField } from "./correctable";
import type { CorrectionPlan, FieldChange, JournalLinePlan } from "./types";

/*
 * A data or accounting correction, done and undone (fixes.service.ts asks for
 * the owner's PIN and a backup first). Two kinds only, and history is never
 * edited or deleted:
 *   SET      a stored total is set back to what its records add up to, only on
 *            the fields listed in correctable.ts, and only while it still shows
 *            the figure the owner saw. Undo puts the old figure back.
 *   JOURNAL  an adjusting journal entry (source CORRECTION). Undo reverses it.
 */

const money = (v: string) => new Prisma.Decimal(v);

function sameFigure(value: unknown, text: string) {
  if (value === null || value === undefined) return false;
  try {
    return new Prisma.Decimal(String(value)).equals(new Prisma.Decimal(text));
  } catch {
    return false;
  }
}

const isFigure = (text: string, kind: "int" | "decimal") =>
  kind === "int" ? /^-?\d{1,12}$/.test(text) : /^-?\d{1,12}(\.\d{1,2})?$/.test(text);

/** Why a plan may not be carried out, or null when it may. */
export function planProblem(plan: CorrectionPlan): string | null {
  if (plan.kind === "SET") {
    if (plan.changes.length === 0 || plan.changes.length > 50) return "It changes nothing.";
    for (const c of plan.changes) {
      const entry = correctableField(c.model, c.field);
      if (!entry) return `Bug Guard may not change ${c.model}.${c.field}.`;
      if (!isFigure(c.before, entry.kind) || !isFigure(c.after, entry.kind)) {
        return `${c.label}: the figures are not numbers.`;
      }
      if (sameFigure(c.before, c.after)) return `${c.label}: nothing to change.`;
    }
    return null;
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(plan.date)) return "The entry has no date.";
  if (plan.lines.length < 2) return "An entry needs two lines or more.";
  let debit = new Prisma.Decimal(0);
  let credit = new Prisma.Decimal(0);
  for (const l of plan.lines) {
    if (!isFigure(l.debit, "decimal") || !isFigure(l.credit, "decimal")) {
      return "The entry's amounts are not numbers.";
    }
    const d = money(l.debit);
    const c = money(l.credit);
    if (d.isNegative() || c.isNegative() || (!d.isZero() && !c.isZero())) {
      return "Each line is either a debit or a credit.";
    }
    debit = debit.plus(d);
    credit = credit.plus(c);
  }
  if (debit.isZero() || !debit.equals(credit)) return "The entry does not balance.";
  return null;
}

const fmt = (v: string) =>
  new Prisma.Decimal(v).toNumber().toLocaleString("en-US", { maximumFractionDigits: 2 });

/** Before → after, in Bengali, as the owner sees it. */
export function describePlan(plan: CorrectionPlan): string {
  if (plan.kind === "SET") {
    return plan.changes.map((c) => `${c.label}: ${fmt(c.before)} → ${fmt(c.after)}`).join("\n");
  }
  const line = (l: JournalLinePlan) =>
    `${l.account}: ${money(l.debit).isZero() ? `ক্রেডিট ${fmt(l.credit)}` : `ডেবিট ${fmt(l.debit)}`}`;
  return [
    `সমন্বয় এন্ট্রি (${plan.date}): ${plan.description}`,
    ...plan.lines.map((l) => `• ${line(l)}`),
  ].join("\n");
}

type Delegate = {
  findFirst: (args: unknown) => Promise<Record<string, unknown> | null>;
  updateMany: (args: unknown) => Promise<{ count: number }>;
};

function delegateOf(tx: Prisma.TransactionClient, change: FieldChange) {
  const entry = correctableField(change.model, change.field);
  if (!entry) throw new AppError("FORBIDDEN", `Bug Guard may not change ${change.model}.`);
  const delegate = (tx as unknown as Record<string, Delegate>)[entry.client];
  if (!delegate) throw new AppError("INTERNAL", `No table ${entry.client}.`);
  return { entry, delegate };
}

/** Sets one stored total from `from` to `to`, only while it still shows `from`. */
async function setFigure(
  tx: Prisma.TransactionClient,
  companyId: string,
  change: FieldChange,
  from: string,
  to: string,
) {
  const { entry, delegate } = delegateOf(tx, change);
  const where = { id: change.id, ...entry.inCompany(companyId) };
  const row = await delegate.findFirst({ where, select: { [change.field]: true } });
  if (!row) throw new AppError("NOT_FOUND", `${change.label}: the record is not there any more.`);
  if (!sameFigure(row[change.field], from)) {
    throw new AppError(
      "CONFLICT",
      `${change.label} changed since this was prepared (now ${String(row[change.field])}): nothing was changed.`,
    );
  }
  const value = entry.kind === "int" ? Number(to) : new Prisma.Decimal(to);
  const done = await delegate.updateMany({
    where: { ...where, [change.field]: row[change.field] },
    data: { [change.field]: value },
  });
  if (done.count !== 1) {
    throw new AppError("CONFLICT", `${change.label} changed just now: nothing was changed.`);
  }
}

async function checkAccounts(
  tx: Prisma.TransactionClient,
  companyId: string,
  lines: JournalLinePlan[],
) {
  const accounts = [...new Set(lines.map((l) => l.accountId))];
  const found = await tx.ledgerAccount.count({ where: { id: { in: accounts }, companyId } });
  if (found !== accounts.length)
    throw new AppError("NOT_FOUND", "An account is not there any more.");
  const parties = [...new Set(lines.flatMap((l) => (l.partyId ? [l.partyId] : [])))];
  if (parties.length) {
    const known = await tx.party.count({ where: { id: { in: parties }, companyId } });
    if (known !== parties.length) throw new AppError("NOT_FOUND", "A party is not there any more.");
  }
}

/** Carries out a plan inside the caller's transaction. */
export async function applyPlan(
  tx: Prisma.TransactionClient,
  companyId: string,
  plan: CorrectionPlan,
  by: { userId: string; correctionId: string },
): Promise<{ journalEntryId: string | null }> {
  const problem = planProblem(plan);
  if (problem) throw new AppError("VALIDATION", problem);
  if (plan.kind === "SET") {
    for (const c of plan.changes) await setFigure(tx, companyId, c, c.before, c.after);
    return { journalEntryId: null };
  }
  await checkAccounts(tx, companyId, plan.lines);
  const entry = await postJournalEntry(tx, {
    companyId,
    date: new Date(`${plan.date}T00:00:00.000Z`),
    description: `Bug Guard correction: ${plan.description}`.slice(0, 500),
    sourceType: "CORRECTION",
    sourceId: by.correctionId,
    postedById: by.userId,
    lines: plan.lines.map((l) => ({
      accountId: l.accountId,
      partyId: l.partyId ?? null,
      employeeId: l.employeeId ?? null,
      debit: money(l.debit),
      credit: money(l.credit),
      memo: l.memo,
    })),
  });
  return { journalEntryId: entry.id };
}

/** Undoes an applied plan inside the caller's transaction. */
export async function undoPlan(
  tx: Prisma.TransactionClient,
  companyId: string,
  plan: CorrectionPlan,
  applied: { journalEntryId: string | null },
  by: { userId: string },
): Promise<{ undoJournalEntryId: string | null }> {
  if (plan.kind === "SET") {
    // In the opposite order, so a figure changed twice ends where it began.
    for (const c of [...plan.changes].reverse()) {
      await setFigure(tx, companyId, c, c.after, c.before);
    }
    return { undoJournalEntryId: null };
  }
  if (!applied.journalEntryId) throw new AppError("CONFLICT", "This correction posted no entry.");
  const own = await tx.journalEntry.findFirst({
    where: { id: applied.journalEntryId, companyId, sourceType: "CORRECTION" },
    select: { id: true },
  });
  if (!own) throw new AppError("NOT_FOUND", "The correction's entry is not there any more.");
  const undo = await reverseJournalEntry(tx, own.id, {
    description: "Bug Guard correction undone by the owner",
    postedById: by.userId,
  });
  return { undoJournalEntryId: undo.id };
}
