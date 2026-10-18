import { Prisma } from "@prisma/client";

import { dayRange } from "@/lib/dates";
import type { Db } from "@/lib/db-types";
import { AppError } from "@/lib/errors";
import { prisma } from "@/lib/prisma";
import type { RequestMeta } from "@/lib/request-meta";
import { lockRow } from "@/lib/row-lock";
import { runTransaction } from "@/lib/transaction";
import { assertAllowed } from "@/lib/verdict";
import { ensureControlAccounts, PARTY_BALANCE_SUBTYPES } from "@/modules/accounts/control-accounts";
import { postJournalEntry, reverseJournalEntry } from "@/modules/accounts/journal.service";
import { assertCanManageAccounts } from "@/modules/accounts/money-guards";
import { lockSupplierAccount, settleSupplierBills } from "@/modules/accounts/supplier-settlement";
import { auditInCompany } from "@/modules/audit/audit.service";
import type { CompanyContext } from "@/modules/auth/context";
import { canSetOpeningBalance } from "@/modules/parties/rules";
import { openingBalanceSchema, statementSchema } from "@/modules/parties/schemas";
import { creditPosition, lockBuyerCredit } from "@/modules/sales/credit.service";

/*
 * Buyer / supplier ledgers
 * ------------------------
 * A party's balance is the sum of (debit - credit) of every journal line tagged
 * with that party on the Receivable, Payable and Customer Advance accounts.
 *   balance > 0  -> they owe us (receivable)
 *   balance < 0  -> we owe them (payable / advance received)
 * Sales, purchases and payments (later modules) post journal entries; this module
 * only reads them, plus posts the one-off opening balance.
 */

const subtypeFilter = Prisma.sql`la."subType" IN (${Prisma.join(
  PARTY_BALANCE_SUBTYPES.map((s) => Prisma.sql`${s}::"AccountSubType"`),
)})`;

const ZERO = new Prisma.Decimal(0);
const TX_OPTIONS = { timeout: 30_000 };

/** Current balance for each party id (0 when it has no entries). */
export async function balancesFor(
  companyId: string,
  partyIds: string[],
  db: Db = prisma,
): Promise<Map<string, Prisma.Decimal>> {
  const result = new Map<string, Prisma.Decimal>(partyIds.map((id) => [id, ZERO]));
  if (partyIds.length === 0) return result;
  const rows = await db.$queryRaw<Array<{ partyId: string; balance: Prisma.Decimal }>>`
    SELECT jl."partyId", SUM(jl.debit - jl.credit) AS balance
    FROM "JournalLine" jl
    JOIN "JournalEntry" je ON je.id = jl."entryId"
    JOIN "LedgerAccount" la ON la.id = jl."accountId"
    WHERE je."companyId" = ${companyId} AND ${subtypeFilter}
      AND jl."partyId" IN (${Prisma.join(partyIds)})
    GROUP BY jl."partyId"`;
  for (const r of rows) result.set(r.partyId, new Prisma.Decimal(r.balance));
  return result;
}

export async function getPartyBalance(ctx: CompanyContext, partyId: string, db: Db = prisma) {
  return (await balancesFor(ctx.company.id, [partyId], db)).get(partyId)!;
}

async function getPartyOrThrow(ctx: CompanyContext, partyId: string) {
  const party = await ctx.db.party.findUnique({ where: { id: partyId } });
  if (!party) throw new AppError("NOT_FOUND", "Buyer or supplier not found.");
  return party;
}

export type StatementLine = {
  entryId: string;
  date: Date;
  number: string;
  description: string | null;
  sourceType: string;
  account: string;
  memo: string | null;
  debit: string;
  credit: string;
  balance: string;
};

/**
 * Lifetime (or date-range) statement: page-1 summary plus the date-wise
 * transaction log with a running balance — the data behind the statement PDF.
 */
export async function getStatement(ctx: CompanyContext, partyId: string, raw: unknown = {}) {
  const q = statementSchema.parse(raw);
  const { start: from, end } = dayRange(q.from, q.to, ctx.company.timezone);
  if (from && end && from >= end) {
    throw new AppError("VALIDATION", "'From' date is after 'to' date.");
  }
  const party = await getPartyOrThrow(ctx, partyId);
  const companyId = ctx.company.id;

  const [opening] = from
    ? await prisma.$queryRaw<Array<{ balance: Prisma.Decimal | null }>>`
        SELECT SUM(jl.debit - jl.credit) AS balance
        FROM "JournalLine" jl
        JOIN "JournalEntry" je ON je.id = jl."entryId"
        JOIN "LedgerAccount" la ON la.id = jl."accountId"
        WHERE je."companyId" = ${companyId} AND jl."partyId" = ${party.id} AND ${subtypeFilter}
          AND je.date < ${from}`
    : [{ balance: ZERO }];

  const rows = await prisma.$queryRaw<
    Array<{
      entryId: string;
      date: Date;
      number: string;
      description: string | null;
      sourceType: string;
      account: string;
      memo: string | null;
      debit: Prisma.Decimal;
      credit: Prisma.Decimal;
    }>
  >`
    SELECT je.id AS "entryId", je.date, je.number, je.description, je."sourceType"::text AS "sourceType",
           la.name AS account, jl.memo, jl.debit, jl.credit
    FROM "JournalLine" jl
    JOIN "JournalEntry" je ON je.id = jl."entryId"
    JOIN "LedgerAccount" la ON la.id = jl."accountId"
    WHERE je."companyId" = ${companyId} AND jl."partyId" = ${party.id} AND ${subtypeFilter}
      ${from ? Prisma.sql`AND je.date >= ${from}` : Prisma.empty}
      ${end ? Prisma.sql`AND je.date < ${end}` : Prisma.empty}
    ORDER BY je.date ASC, je."createdAt" ASC, jl.id ASC
    LIMIT 10000`;

  const openingBalance = new Prisma.Decimal(opening?.balance ?? 0);
  let running = openingBalance;
  let totalDebit = ZERO;
  let totalCredit = ZERO;
  const lines: StatementLine[] = rows.map((r) => {
    const debit = new Prisma.Decimal(r.debit);
    const credit = new Prisma.Decimal(r.credit);
    running = running.plus(debit).minus(credit);
    totalDebit = totalDebit.plus(debit);
    totalCredit = totalCredit.plus(credit);
    return {
      ...r,
      debit: debit.toFixed(2),
      credit: credit.toFixed(2),
      balance: running.toFixed(2),
    };
  });

  return {
    party: {
      id: party.id,
      code: party.code,
      name: party.name,
      kind: party.kind,
      grade: party.grade,
      isVerified: party.isVerified,
      status: party.status,
      contactPerson: party.contactPerson,
      address: party.address,
      phone: party.phone,
      email: party.email,
      taxId: party.taxId,
    },
    company: {
      name: ctx.company.name,
      address: ctx.company.address,
      phone: ctx.company.phone,
      email: ctx.company.email,
      logoUrl: ctx.company.logoUrl,
    },
    period: { from: q.from ?? null, to: q.to ?? null, timezone: ctx.company.timezone },
    summary: {
      openingBalance: openingBalance.toFixed(2),
      totalDebit: totalDebit.toFixed(2), // billed to them / paid to them
      totalCredit: totalCredit.toFixed(2), // received from them / billed by them
      closingBalance: running.toFixed(2),
      position: running.gt(0) ? "RECEIVABLE" : running.lt(0) ? "PAYABLE" : "SETTLED",
      transactionCount: lines.length,
    },
    lines,
    generatedAt: new Date(),
  };
}

/**
 * Sets the balance brought forward when the party is migrated into the ERP
 * (Accounts: accounts.manage, checked here as well as in the route). Re-setting
 * reverses the earlier opening entry with a mirror entry dated on the earlier
 * entry's own day, so both stay in the books (never deleted) and cancel out in
 * every report from that day on, and posts the new one; saving the same amount
 * on the same day changes nothing.
 *
 * What a buyer owed goes on their Receivable. What the company owed a buyer
 * (an advance they had paid) is a credit on their Receivable too, like money
 * received on their account: it is their credit, used on invoices or paid back
 * (sales/credit.service.ts). Lowering it is refused once the part taken away
 * has been used: their credit is held first, like every step that uses it. A
 * supplier's goes on Payable, and their bills are settled again. A buyer's
 * opening advance posted on Customer Advance before v6.4.1 moves to Receivable
 * when its opening balance is saved again.
 */
export async function setOpeningBalance(
  ctx: CompanyContext,
  partyId: string,
  raw: unknown,
  meta?: RequestMeta,
) {
  assertCanManageAccounts(ctx, "Only Accounts can set an opening balance: it goes into the books.");
  const input = openingBalanceSchema.parse(raw);
  const party = await getPartyOrThrow(ctx, partyId);
  const amount = new Prisma.Decimal(input.amount.toFixed(2));
  assertAllowed(canSetOpeningBalance(party, amount.toNumber()));
  const companyId = ctx.company.id;
  const date = input.asOf ?? new Date();

  await runTransaction(async (tx) => {
    // The supplier's account (or the buyer's credit) first, the ERP's lock order,
    // before any journal number.
    if (party.kind !== "BUYER") await lockSupplierAccount(tx, companyId, party.id);
    else await lockBuyerCredit(tx, party.id);
    await lockRow(tx, "Party", party.id);
    const accounts = await ensureControlAccounts(companyId, tx);
    // A buyer's advance is credit on their Receivable, like money paid on account.
    const partyAccount =
      amount.gt(0) || party.kind === "BUYER" ? accounts.RECEIVABLE : accounts.PAYABLE;
    const live = await tx.journalEntry.findMany({
      where: {
        companyId,
        sourceType: "OPENING_BALANCE",
        sourceId: party.id,
        isReversed: false,
        reversalOfId: null,
      },
      include: { lines: true },
      orderBy: { createdAt: "asc" },
    });
    const unchanged =
      live.length === (amount.isZero() ? 0 : 1) &&
      live.every(
        (entry) =>
          (!input.asOf || entry.date.getTime() === input.asOf.getTime()) &&
          entry.lines.some(
            (l) =>
              l.accountId === partyAccount &&
              l.partyId === party.id &&
              l.debit.minus(l.credit).equals(amount),
          ),
      );
    if (unchanged && party.openingBalance.equals(amount)) return;

    if (!unchanged && party.kind === "BUYER") {
      // The advance (credit on their Receivable) this change takes away must still be unused.
      const before = live
        .flatMap((e) => e.lines)
        .filter((l) => l.accountId === accounts.RECEIVABLE && l.partyId === party.id)
        .reduce((t, l) => t.plus(l.debit).minus(l.credit), ZERO);
      const taken = Prisma.Decimal.max(before.neg(), ZERO).minus(
        Prisma.Decimal.max(amount.neg(), ZERO),
      );
      if (taken.gt(0)) {
        const { credit } = await creditPosition(tx, companyId, party.id);
        if (taken.gt(credit)) {
          throw new AppError(
            "CONFLICT",
            `${party.name} has used this advance: only ${credit.toFixed(2)} of it is still unused on their account, so it can come down by that much at most. Undo its use first (void the invoice it paid, which gives the credit back, or the refund), then change it.`,
          );
        }
      }
    }

    // Each mirror entry is dated on the entry it reverses, so they cancel out in every
    // report from that day on (no report between go-live and today counts both).
    for (const entry of unchanged ? [] : live) {
      await reverseJournalEntry(tx, entry.id, {
        description: `Opening balance of ${party.name} replaced`,
        postedById: ctx.user.id,
        date: entry.date,
      });
    }
    if (!unchanged && !amount.isZero()) {
      const abs = amount.abs();
      await postJournalEntry(tx, {
        companyId,
        date,
        description: `Opening balance — ${party.name}`,
        sourceType: "OPENING_BALANCE",
        sourceId: party.id,
        postedById: ctx.user.id,
        lines: amount.gt(0)
          ? [
              { accountId: partyAccount, partyId: party.id, debit: abs },
              { accountId: accounts.OPENING_EQUITY, credit: abs },
            ]
          : [
              { accountId: accounts.OPENING_EQUITY, debit: abs },
              {
                accountId: partyAccount,
                partyId: party.id,
                credit: abs,
                memo: party.kind === "BUYER" ? "Advance brought forward" : undefined,
              },
            ],
      });
    }
    await tx.party.update({ where: { id: party.id }, data: { openingBalance: amount } });
    // What we owed before go-live is the oldest due: payments on account settle it first.
    if (party.kind !== "BUYER") await settleSupplierBills(tx, companyId, party.id);
    await auditInCompany(
      ctx,
      meta,
      {
        action: "UPDATE",
        entityType: "Party",
        entityId: party.id,
        summary: `Set opening balance of ${party.code} to ${amount.toFixed(2)}${
          !unchanged && live.length > 0 ? " (the earlier entry reversed)" : ""
        }`,
        before: { openingBalance: party.openingBalance.toFixed(2) },
        after: { openingBalance: amount.toFixed(2) },
      },
      tx,
    );
  }, TX_OPTIONS);
  return { partyId: party.id, balance: (await getPartyBalance(ctx, party.id)).toFixed(2) };
}

/**
 * Total Receivables & Payables master overview: what the market owes us and what
 * we owe suppliers, with a per-party breakdown (largest first).
 */
export async function getReceivablesPayables(ctx: CompanyContext) {
  const rows = await prisma.$queryRaw<
    Array<{
      partyId: string;
      code: string;
      name: string;
      kind: string;
      grade: string | null;
      status: string;
      lastTransactionAt: Date | null;
      balance: Prisma.Decimal;
    }>
  >`
    SELECT p.id AS "partyId", p.code, p.name, p.kind::text AS kind, p.grade::text AS grade,
           p.status::text AS status, p."lastTransactionAt", SUM(jl.debit - jl.credit) AS balance
    FROM "JournalLine" jl
    JOIN "JournalEntry" je ON je.id = jl."entryId"
    JOIN "LedgerAccount" la ON la.id = jl."accountId"
    JOIN "Party" p ON p.id = jl."partyId"
    WHERE je."companyId" = ${ctx.company.id} AND ${subtypeFilter}
    GROUP BY p.id
    HAVING SUM(jl.debit - jl.credit) <> 0
    ORDER BY ABS(SUM(jl.debit - jl.credit)) DESC`;

  const toRow = (r: (typeof rows)[number]) => ({
    ...r,
    balance: new Prisma.Decimal(r.balance).abs().toFixed(2),
  });
  const receivables = rows.filter((r) => new Prisma.Decimal(r.balance).gt(0)).map(toRow);
  const payables = rows.filter((r) => new Prisma.Decimal(r.balance).lt(0)).map(toRow);
  const sum = (list: typeof receivables) =>
    list.reduce((acc, r) => acc.plus(r.balance), ZERO).toFixed(2);

  return {
    totalReceivable: sum(receivables),
    totalPayable: sum(payables),
    receivableCount: receivables.length,
    payableCount: payables.length,
    receivables,
    payables,
    generatedAt: new Date(),
  };
}
