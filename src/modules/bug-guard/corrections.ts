import { Prisma } from "@prisma/client";

import type { Db } from "@/lib/db-types";
import { AppError } from "@/lib/errors";
import { lockRow } from "@/lib/row-lock";
import { ensureControlAccounts } from "@/modules/accounts/control-accounts";
import { postJournalEntry, reverseJournalEntry } from "@/modules/accounts/journal.service";
import {
  lockSupplierAccount,
  settleSuppliersOnLines,
} from "@/modules/accounts/supplier-settlement";

import type { CorrectionPlan, JournalLinePlan } from "./types";

/*
 * A data or accounting correction, done and undone (fixes.service.ts asks for
 * the owner's PIN and a backup first). A correction only ever adds a proper
 * record, the way the ERP itself corrects things; it never overwrites a stored
 * figure and never edits or deletes history (v6.4.1 B4):
 *   STOCK    a stock balance whose movements do not add up to it gets one
 *            movement of the difference (type ADJUSTMENT, marked as Bug
 *            Guard's), only while the balance and its movements are still as the
 *            check saw them. The stock kept, and so what it is worth in the
 *            books, does not change. Undo adds the opposite movement.
 *   JOURNAL  an adjusting journal entry (source CORRECTION), only while the
 *            mistake it puts right is still as the check saw it (its
 *            precondition, types.ts) and no other correction of it is applied.
 *            Undo reverses it. On a supplier's Payable, their bills are settled
 *            again either way, as after any voucher (supplier-settlement.ts).
 * A stored total that is only a copy of its records (an order's total or what
 * is paid on it, a payroll's totals, a project's cost) is never set by Bug
 * Guard: those findings are the owner's to put right (MANUAL). An old SET
 * correction from before v6.4.1 is neither applied nor undone.
 */

/** Why an old SET correction is refused. */
export const SET_REFUSED =
  "Bug Guard no longer changes stored figures (v6.4.1): it corrects only with a new record, such as a stock movement or an adjusting entry. See the problem's steps.";

/** How Bug Guard's stock movements are marked (referenceId: the correction). */
export const STOCK_CORRECTION_REFERENCE = "BugGuardCorrection";

const money = (v: string) => new Prisma.Decimal(v);

const isFigure = (text: string, kind: "int" | "decimal") =>
  kind === "int" ? /^-?\d{1,12}$/.test(text) : /^-?\d{1,12}(\.\d{1,2})?$/.test(text);

/** Why a plan may not be carried out, or null when it may. */
export function planProblem(plan: CorrectionPlan): string | null {
  if (plan.kind === "SET") return SET_REFUSED;
  if (plan.kind === "STOCK") {
    const whole = (n: unknown) => Number.isSafeInteger(n);
    if (!plan.balanceId || !plan.variantId || !plan.warehouseId) return "It names no stock.";
    if (plan.grade !== "A_GRADE" && plan.grade !== "B_GRADE") return "It names no grade.";
    if (!whole(plan.stored) || !whole(plan.moved))
      return `${plan.label}: the pieces are not numbers.`;
    if (plan.stored < 0) return `${plan.label}: the stock is below zero; count it first.`;
    if (plan.stored === plan.moved) return `${plan.label}: nothing to change.`;
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

const pieces = (n: number) => n.toLocaleString("en-US");

/** Before → after, in Bengali, as the owner sees it. */
export function describePlan(plan: CorrectionPlan): string {
  if (plan.kind === "SET") {
    return plan.changes.map((c) => `${c.label}: ${fmt(c.before)} → ${fmt(c.after)}`).join("\n");
  }
  if (plan.kind === "STOCK") {
    const diff = plan.stored - plan.moved;
    return [
      `${plan.label}: আসা-যাওয়ার খাতায় ${diff > 0 ? "+" : ""}${pieces(diff)} পিসের একটি Bug Guard correction লাইন যোগ হবে`,
      `• আসা-যাওয়ার যোগফল: ${pieces(plan.moved)} → ${pieces(plan.stored)}`,
      `• স্টকে লেখা ${pieces(plan.stored)} পিস আর স্টকের দাম একই থাকবে`,
    ].join("\n");
  }
  const line = (l: JournalLinePlan) =>
    `${l.account}: ${money(l.debit).isZero() ? `ক্রেডিট ${fmt(l.credit)}` : `ডেবিট ${fmt(l.debit)}`}`;
  return [
    `সমন্বয় এন্ট্রি (${plan.date}): ${plan.description}`,
    ...plan.lines.map((l) => `• ${line(l)}`),
  ].join("\n");
}

type StockPlan = Extract<CorrectionPlan, { kind: "STOCK" }>;

/** The stock kept and what its movements add up to now (in the company), or null when gone. */
async function stockNow(db: Db, companyId: string, plan: StockPlan) {
  const balance = await db.stockBalance.findFirst({
    where: {
      id: plan.balanceId,
      companyId,
      variantId: plan.variantId,
      warehouseId: plan.warehouseId,
      grade: plan.grade,
    },
    select: { quantity: true },
  });
  if (!balance) return null;
  const moved = await db.stockMovement.aggregate({
    where: {
      companyId,
      variantId: plan.variantId,
      warehouseId: plan.warehouseId,
      grade: plan.grade,
    },
    _sum: { quantity: true },
  });
  return { stored: balance.quantity, moved: moved._sum.quantity ?? 0 };
}

/**
 * Why a stock correction may not be made now, or null while the balance and
 * its movements are still exactly as the check saw them (so it is never made
 * twice, nor after the stock was put right another way).
 */
async function stockOutOfDate(db: Db, companyId: string, plan: StockPlan) {
  const now = await stockNow(db, companyId, plan);
  if (!now) return `${plan.label}: the stock line is not there any more.`;
  if (now.stored !== plan.stored || now.moved !== plan.moved) {
    return `${plan.label} changed since this was prepared (stock ${now.stored}, movements ${now.moved}).`;
  }
  return null;
}

/** How an out-of-date adjusting entry is refused (and kept, as the correction's error). */
export const outOfDate = (why: string) => `Out of date, nothing was changed: ${why}`;

const lineKey = (l: {
  accountId: string;
  partyId?: string | null;
  employeeId?: string | null;
  debit: Prisma.Decimal.Value;
  credit: Prisma.Decimal.Value;
}) =>
  [
    l.accountId,
    l.partyId ?? "",
    l.employeeId ?? "",
    new Prisma.Decimal(l.debit).toFixed(2),
    new Prisma.Decimal(l.credit).toFixed(2),
  ].join("|");

/**
 * Why an adjusting entry may not be posted now, or null while the mistake it
 * puts right is still exactly as the check saw it. applyCorrection asks before
 * the backup; applyPlan asks again with the entry or payment locked, so two
 * approvals of the same correction never both post.
 */
export async function journalOutOfDate(
  db: Db,
  companyId: string,
  plan: CorrectionPlan,
  correctionId: string,
): Promise<string | null> {
  if (plan.kind === "STOCK") return stockOutOfDate(db, companyId, plan);
  if (plan.kind !== "JOURNAL") return null;
  const pre = plan.precondition;
  if (!pre) return "it was prepared before Bug Guard kept what to check first. Press Fix again.";
  const [field, target] =
    pre.kind === "ENTRY" ? ["entryId", pre.entryId] : ["paymentId", pre.paymentId];
  const twin = await db.bugGuardCorrection.findFirst({
    where: {
      companyId,
      id: { not: correctionId },
      status: "APPLIED",
      plan: { path: ["precondition", field], equals: target },
    },
    select: { id: true },
  });
  if (twin) return "the same correction was applied already.";

  if (pre.kind === "ENTRY") {
    const entry = await db.journalEntry.findFirst({
      where: { id: pre.entryId, companyId },
      select: {
        number: true,
        isReversed: true,
        reversedBy: { select: { id: true } },
        lines: {
          select: { accountId: true, partyId: true, employeeId: true, debit: true, credit: true },
        },
      },
    });
    if (!entry) return "the entry it reverses is not there any more.";
    if (entry.reversedBy || entry.isReversed !== pre.isReversed) {
      return entry.isReversed
        ? `${entry.number} was reversed meanwhile.`
        : `${entry.number} is no longer marked reversed.`;
    }
    const mirrored = entry.lines
      .filter((l) => !l.debit.isZero() || !l.credit.isZero())
      .map((l) => lineKey({ ...l, debit: l.credit, credit: l.debit }))
      .sort();
    const planned = plan.lines.map(lineKey).sort();
    if (mirrored.join("\n") !== planned.join("\n")) {
      return `${entry.number} changed since this was prepared.`;
    }
    return null;
  }

  const payment = await db.payment.findFirst({
    where: { id: pre.paymentId, companyId },
    select: {
      number: true,
      amount: true,
      accountId: true,
      isAdvance: true,
      partyId: true,
      orderId: true,
      journalEntryId: true,
    },
  });
  if (!payment) return "the payment is not there any more.";
  if (payment.journalEntryId) return `payment ${payment.number} has its entry now.`;
  if (
    !payment.amount.equals(pre.amount) ||
    payment.accountId !== pre.accountId ||
    payment.isAdvance !== pre.isAdvance ||
    payment.partyId !== pre.partyId
  ) {
    return `payment ${payment.number} changed since this was prepared.`;
  }
  if (payment.orderId) {
    // An invoice void moved the order's payments to advance (receiptPlan).
    const moved = await db.journalEntry.count({
      where: { companyId, sourceType: "PAYMENT", sourceId: payment.orderId },
    });
    if (moved > 0) return `the invoice of payment ${payment.number}'s order was voided since.`;
  }
  return null;
}

/**
 * Locks the account of each supplier named on a Payable line, first (the ERP's
 * lock order: supplier account before anything else).
 */
async function lockSuppliersOn(
  tx: Prisma.TransactionClient,
  companyId: string,
  lines: JournalLinePlan[],
) {
  if (!lines.some((l) => l.partyId)) return;
  const acc = await ensureControlAccounts(companyId, tx);
  const suppliers = [
    ...new Set(lines.flatMap((l) => (l.accountId === acc.PAYABLE && l.partyId ? [l.partyId] : []))),
  ].sort();
  for (const id of suppliers) await lockSupplierAccount(tx, companyId, id);
}

/** A supplier's bills follow their Payable ledger after the entry (as after a voucher). */
async function settleSuppliers(
  tx: Prisma.TransactionClient,
  companyId: string,
  lines: JournalLinePlan[],
) {
  if (lines.some((l) => l.partyId)) await settleSuppliersOnLines(tx, companyId, lines);
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
  if (plan.kind === "SET") throw new AppError("VALIDATION", SET_REFUSED);
  if (plan.kind === "STOCK") {
    // The SKU first, as every stock change locks it (the ERP's lock order).
    await lockRow(tx, "ProductVariant", plan.variantId);
    const stale = await stockOutOfDate(tx, companyId, plan);
    if (stale) throw new AppError("CONFLICT", outOfDate(stale));
    await tx.stockMovement.create({
      data: {
        companyId,
        variantId: plan.variantId,
        warehouseId: plan.warehouseId,
        grade: plan.grade,
        type: "ADJUSTMENT",
        quantity: plan.stored - plan.moved,
        referenceType: STOCK_CORRECTION_REFERENCE,
        referenceId: by.correctionId,
        note: `Bug Guard correction: the movements added up to ${plan.moved} pieces, not the ${plan.stored} in stock. This records the difference; the stock and its value did not change.`,
        createdById: by.userId,
      },
    });
    return { journalEntryId: null };
  }
  await lockSuppliersOn(tx, companyId, plan.lines);
  const pre = plan.precondition;
  if (pre) {
    await lockRow(
      tx,
      pre.kind === "ENTRY" ? "JournalEntry" : "Payment",
      pre.kind === "ENTRY" ? pre.entryId : pre.paymentId,
    );
  }
  const stale = await journalOutOfDate(tx, companyId, plan, by.correctionId);
  if (stale) throw new AppError("CONFLICT", outOfDate(stale));
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
  await settleSuppliers(tx, companyId, plan.lines);
  return { journalEntryId: entry.id };
}

/** Undoes an applied plan inside the caller's transaction. */
export async function undoPlan(
  tx: Prisma.TransactionClient,
  companyId: string,
  plan: CorrectionPlan,
  applied: { journalEntryId: string | null },
  by: { userId: string; correctionId: string },
): Promise<{ undoJournalEntryId: string | null }> {
  if (plan.kind === "SET") {
    throw new AppError(
      "VALIDATION",
      "This old correction changed a stored figure, which Bug Guard no longer does (v6.4.1), so it is not undone from here: nothing was changed. Show it to the accountant.",
    );
  }
  if (plan.kind === "STOCK") {
    await lockRow(tx, "ProductVariant", plan.variantId);
    const own = await tx.stockMovement.findMany({
      where: {
        companyId,
        referenceType: STOCK_CORRECTION_REFERENCE,
        referenceId: by.correctionId,
      },
      select: { quantity: true },
    });
    if (own.length !== 1) {
      throw new AppError(
        "CONFLICT",
        own.length === 0
          ? "The correction's stock movement is not there any more."
          : "It was undone already.",
      );
    }
    await tx.stockMovement.create({
      data: {
        companyId,
        variantId: plan.variantId,
        warehouseId: plan.warehouseId,
        grade: plan.grade,
        type: "ADJUSTMENT",
        quantity: -own[0]!.quantity,
        referenceType: STOCK_CORRECTION_REFERENCE,
        referenceId: by.correctionId,
        note: "Bug Guard correction undone by the owner: the opposite movement. The stock and its value did not change.",
        createdById: by.userId,
      },
    });
    return { undoJournalEntryId: null };
  }
  if (!applied.journalEntryId) throw new AppError("CONFLICT", "This correction posted no entry.");
  await lockSuppliersOn(tx, companyId, plan.lines);
  const own = await tx.journalEntry.findFirst({
    where: { id: applied.journalEntryId, companyId, sourceType: "CORRECTION" },
    select: { id: true },
  });
  if (!own) throw new AppError("NOT_FOUND", "The correction's entry is not there any more.");
  const undo = await reverseJournalEntry(tx, own.id, {
    description: "Bug Guard correction undone by the owner",
    postedById: by.userId,
  });
  await settleSuppliers(tx, companyId, plan.lines);
  return { undoJournalEntryId: undo.id };
}
