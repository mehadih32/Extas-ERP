import { Prisma } from "@prisma/client";
import { z } from "zod";

import { DATE_ONLY, dayRange, localDay } from "@/lib/dates";
import { AppError } from "@/lib/errors";
import { prisma } from "@/lib/prisma";
import type { RequestMeta } from "@/lib/request-meta";
import { counterAccountsSql } from "@/modules/accounts/balances";
import { assertCanManageAccounts, assertCanViewAccounts } from "@/modules/accounts/money-guards";
import { auditInCompany } from "@/modules/audit/audit.service";
import type { CompanyContext } from "@/modules/auth/context";

/*
 * Bank reconcile: ticking each line of a bank account's ledger that also shows on
 * the real bank statement. A ticked line is "cleared"; the others are deposits
 * the bank has not credited yet and cheques or transfers it has not paid yet, so
 *   balance in the books = cleared balance + deposits not cleared − withdrawals not cleared
 * and the cleared balance is what the bank's own statement should show.
 * An entry and its reversal cancel out on the account, so neither waits to be
 * ticked. Ticking only fills JournalLine.clearedAt and clearedById: amounts,
 * entries and every balance elsewhere stay exactly as they are.
 */

/** Lines shown on the screen at once; the rest are counted. */
export const RECONCILE_LINES_SHOWN = 500;

/** Lines that can wait to be ticked: not an entry that was reversed, nor a reversal. */
const notReversedSql = Prisma.sql`NOT je."isReversed" AND je."reversalOfId" IS NULL`;
const notReversed = { isReversed: false, reversalOfId: null } as const;

async function bankOrThrow(ctx: CompanyContext, bankAccountId: string) {
  const bank = await ctx.db.bankAccount.findUnique({
    where: { id: bankAccountId },
    select: {
      id: true,
      bankName: true,
      accountNumber: true,
      isActive: true,
      ledgerAccountId: true,
    },
  });
  if (!bank) throw new AppError("NOT_FOUND", "Bank account not found.");
  return bank;
}

type Totals = {
  books: Prisma.Decimal;
  depositsOpen: Prisma.Decimal;
  depositCount: number;
  withdrawalsOpen: Prisma.Decimal;
  withdrawalCount: number;
  openCount: number;
  tickedCount: number;
};

/** The account's balance in the books and what is not cleared yet, in one pass. */
async function reconcileTotals(companyId: string, accountId: string): Promise<Totals> {
  const rows = await prisma.$queryRaw<Totals[]>`
    SELECT COALESCE(SUM(jl.debit - jl.credit), 0) AS books,
           COALESCE(SUM(jl.debit) FILTER (WHERE jl."clearedAt" IS NULL AND ${notReversedSql}), 0)
             AS "depositsOpen",
           COUNT(*) FILTER (WHERE jl."clearedAt" IS NULL AND ${notReversedSql} AND jl.debit > 0)::int
             AS "depositCount",
           COALESCE(SUM(jl.credit) FILTER (WHERE jl."clearedAt" IS NULL AND ${notReversedSql}), 0)
             AS "withdrawalsOpen",
           COUNT(*) FILTER (WHERE jl."clearedAt" IS NULL AND ${notReversedSql} AND jl.credit > 0)::int
             AS "withdrawalCount",
           COUNT(*) FILTER (WHERE jl."clearedAt" IS NULL AND ${notReversedSql})::int AS "openCount",
           COUNT(*) FILTER (WHERE jl."clearedAt" IS NOT NULL AND ${notReversedSql})::int
             AS "tickedCount"
    FROM "JournalLine" jl
    JOIN "JournalEntry" je ON je.id = jl."entryId"
    WHERE je."companyId" = ${companyId} AND jl."accountId" = ${accountId}`;
  // An aggregate without GROUP BY always returns one row.
  const row = rows[0]!;
  return {
    ...row,
    books: new Prisma.Decimal(row.books),
    depositsOpen: new Prisma.Decimal(row.depositsOpen),
    withdrawalsOpen: new Prisma.Decimal(row.withdrawalsOpen),
  };
}

type Row = {
  lineId: string;
  entryId: string;
  date: Date;
  number: string;
  description: string | null;
  counterAccounts: string | null;
  memo: string | null;
  debit: Prisma.Decimal;
  credit: Prisma.Decimal;
  clearedAt: Date | null;
  clearedBy: string | null;
};

/**
 * The lines still to tick, oldest first (the order a bank statement is read),
 * or the ticked ones, latest first (to untick a mistake).
 */
function reconcileRows(companyId: string, accountId: string, ticked: boolean) {
  return prisma.$queryRaw<Row[]>`
    SELECT jl.id AS "lineId", je.id AS "entryId", je.date, je.number, je.description,
           ${counterAccountsSql} AS "counterAccounts", jl.memo, jl.debit, jl.credit,
           jl."clearedAt", u.name AS "clearedBy"
    FROM "JournalLine" jl
    JOIN "JournalEntry" je ON je.id = jl."entryId"
    LEFT JOIN "User" u ON u.id = jl."clearedById"
    WHERE je."companyId" = ${companyId} AND jl."accountId" = ${accountId} AND ${notReversedSql}
      AND ${ticked ? Prisma.sql`jl."clearedAt" IS NOT NULL` : Prisma.sql`jl."clearedAt" IS NULL`}
    ORDER BY ${
      ticked
        ? Prisma.sql`je.date DESC, je."createdAt" DESC, jl.id DESC`
        : Prisma.sql`je.date ASC, je."createdAt" ASC, jl.id ASC`
    }
    LIMIT ${RECONCILE_LINES_SHOWN}`;
}

export type ReconcileShow = "open" | "ticked";

/**
 * One bank account's reconcile checklist (accounts.view): the balance in the
 * books, the cleared balance, what is not cleared yet, and the lines to tick
 * (accounts.manage ticks them).
 */
export async function getReconcileScreen(
  ctx: CompanyContext,
  bankAccountId: string,
  raw: { show?: unknown } = {},
) {
  assertCanViewAccounts(ctx);
  const show: ReconcileShow = raw.show === "ticked" ? "ticked" : "open";
  const tz = ctx.company.timezone;
  const bank = await bankOrThrow(ctx, bankAccountId);
  const [totals, rows] = await Promise.all([
    reconcileTotals(ctx.company.id, bank.ledgerAccountId),
    reconcileRows(ctx.company.id, bank.ledgerAccountId, show === "ticked"),
  ]);
  const cleared = totals.books.minus(totals.depositsOpen).plus(totals.withdrawalsOpen);
  const listed = show === "ticked" ? totals.tickedCount : totals.openCount;
  return {
    today: localDay(new Date(), tz),
    show,
    bank: {
      id: bank.id,
      bankName: bank.bankName,
      accountNumber: bank.accountNumber,
      isActive: bank.isActive,
      ledgerAccountId: bank.ledgerAccountId,
    },
    summary: {
      books: totals.books.toFixed(2),
      cleared: cleared.toFixed(2),
      depositsOpen: totals.depositsOpen.toFixed(2),
      depositCount: totals.depositCount,
      withdrawalsOpen: totals.withdrawalsOpen.toFixed(2),
      withdrawalCount: totals.withdrawalCount,
      openCount: totals.openCount,
      tickedCount: totals.tickedCount,
    },
    lines: rows.map((r) => ({
      id: r.lineId,
      entryId: r.entryId,
      day: localDay(r.date, tz),
      number: r.number,
      details: [r.description, r.counterAccounts].filter(Boolean).join(" — "),
      note: r.memo,
      deposit: new Prisma.Decimal(r.debit).toFixed(2),
      withdrawal: new Prisma.Decimal(r.credit).toFixed(2),
      cleared: r.clearedAt !== null,
      clearedOn: r.clearedAt ? localDay(r.clearedAt, tz) : null,
      clearedBy: r.clearedBy,
    })),
    hiddenCount: Math.max(0, listed - rows.length),
    can: {
      tick: ctx.can("accounts.manage"),
      openEntries: true,
    },
  };
}

export type ReconcileScreen = Awaited<ReturnType<typeof getReconcileScreen>>;

const tickSchema = z.object({
  lineIds: z.array(z.string().min(1)).min(1, "Tick at least one line.").max(RECONCILE_LINES_SHOWN),
  cleared: z.boolean(),
});

const MANAGE_ONLY = "Only Accounts can tick lines off against the bank statement.";

const lineWord = (n: number) => `${n} ${n === 1 ? "line" : "lines"}`;

/**
 * Ticks lines as cleared (they are on the bank statement), or unticks them.
 * Every line must be on this bank account and wait to be ticked; lines already
 * in the state asked for are left as they are.
 */
export async function setBankLinesCleared(
  ctx: CompanyContext,
  bankAccountId: string,
  raw: unknown,
  meta?: RequestMeta,
) {
  assertCanManageAccounts(ctx, MANAGE_ONLY);
  const input = tickSchema.parse(raw);
  const bank = await bankOrThrow(ctx, bankAccountId);
  const ids = [...new Set(input.lineIds)];
  return prisma.$transaction(async (tx) => {
    const where = {
      id: { in: ids },
      accountId: bank.ledgerAccountId,
      entry: { companyId: ctx.company.id, ...notReversed },
    };
    const found = await tx.journalLine.count({ where });
    if (found !== ids.length) {
      throw new AppError(
        "NOT_FOUND",
        "Some of these lines are not on this bank account any more. Reload the page and try again.",
      );
    }
    const { count } = await tx.journalLine.updateMany({
      where: { ...where, clearedAt: input.cleared ? null : { not: null } },
      data: input.cleared
        ? { clearedAt: new Date(), clearedById: ctx.user.id }
        : { clearedAt: null, clearedById: null },
    });
    if (count > 0) {
      await auditInCompany(
        ctx,
        meta,
        {
          action: "UPDATE",
          entityType: "BankAccount",
          entityId: bank.id,
          summary: `${input.cleared ? "Ticked" : "Unticked"} ${lineWord(count)} of ${bank.bankName} ${bank.accountNumber} ${input.cleared ? "as cleared by the bank" : "as not cleared yet"}`,
        },
        tx,
      );
    }
    return { changed: count };
  });
}

const tickUpToSchema = z.object({
  upTo: z.string().regex(DATE_ONLY, "Choose a day."),
});

/**
 * Ticks every line dated on or before a day that is still waiting: for starting
 * out, when everything up to the last bank statement has already cleared.
 */
export async function tickBankLinesUpTo(
  ctx: CompanyContext,
  bankAccountId: string,
  raw: unknown,
  meta?: RequestMeta,
) {
  assertCanManageAccounts(ctx, MANAGE_ONLY);
  const { upTo } = tickUpToSchema.parse(raw);
  const tz = ctx.company.timezone;
  if (upTo > localDay(new Date(), tz)) {
    throw new AppError("VALIDATION", "Choose today or an earlier day.", {
      upTo: ["The bank cannot have cleared a day that has not come yet."],
    });
  }
  const bank = await bankOrThrow(ctx, bankAccountId);
  const { end } = dayRange(undefined, upTo, tz);
  return prisma.$transaction(async (tx) => {
    const { count } = await tx.journalLine.updateMany({
      where: {
        accountId: bank.ledgerAccountId,
        clearedAt: null,
        entry: { companyId: ctx.company.id, ...notReversed, date: { lt: end } },
      },
      data: { clearedAt: new Date(), clearedById: ctx.user.id },
    });
    if (count > 0) {
      await auditInCompany(
        ctx,
        meta,
        {
          action: "UPDATE",
          entityType: "BankAccount",
          entityId: bank.id,
          summary: `Ticked ${lineWord(count)} of ${bank.bankName} ${bank.accountNumber} up to ${upTo} as cleared by the bank`,
        },
        tx,
      );
    }
    return { changed: count };
  });
}
