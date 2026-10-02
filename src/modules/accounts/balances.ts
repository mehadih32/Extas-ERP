import { Prisma } from "@prisma/client";

import type { Db } from "@/lib/db-types";
import { prisma } from "@/lib/prisma";

/*
 * Read-side helpers over the journal. Reversed entries stay in the books next to
 * their reversal, so plain sums are always right: nothing is filtered out.
 */

export const ZERO = new Prisma.Decimal(0);

/** Half-open [start, end) on the entry date; either side may be open. */
export type DateRange = { start?: Date; end?: Date };

export type Totals = { debit: Prisma.Decimal; credit: Prisma.Decimal };

/** Rounds to 2 decimals, half up (amounts in the books). */
export const money = (v: Prisma.Decimal.Value) =>
  new Prisma.Decimal(v).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);

function rangeSql(range: DateRange) {
  return Prisma.sql`${range.start ? Prisma.sql`AND je.date >= ${range.start}` : Prisma.empty}
    ${range.end ? Prisma.sql`AND je.date < ${range.end}` : Prisma.empty}`;
}

/** Debit and credit totals per account, for the company's entries dated in the range. */
export async function accountTotals(
  companyId: string,
  range: DateRange = {},
  db: Db = prisma,
): Promise<Map<string, Totals>> {
  const rows = await db.$queryRaw<
    Array<{ accountId: string; debit: Prisma.Decimal; credit: Prisma.Decimal }>
  >`
    SELECT jl."accountId", SUM(jl.debit) AS debit, SUM(jl.credit) AS credit
    FROM "JournalLine" jl
    JOIN "JournalEntry" je ON je.id = jl."entryId"
    WHERE je."companyId" = ${companyId} ${rangeSql(range)}
    GROUP BY jl."accountId"`;
  return new Map(
    rows.map((r) => [
      r.accountId,
      { debit: new Prisma.Decimal(r.debit), credit: new Prisma.Decimal(r.credit) },
    ]),
  );
}

/** Debit minus credit of one account for entries dated in the range. */
export async function rawBalance(
  companyId: string,
  accountId: string,
  range: DateRange = {},
  db: Db = prisma,
): Promise<Prisma.Decimal> {
  const [row] = await db.$queryRaw<Array<{ balance: Prisma.Decimal | null }>>`
    SELECT SUM(jl.debit - jl.credit) AS balance
    FROM "JournalLine" jl
    JOIN "JournalEntry" je ON je.id = jl."entryId"
    WHERE je."companyId" = ${companyId} AND jl."accountId" = ${accountId} ${rangeSql(range)}`;
  return new Prisma.Decimal(row?.balance ?? 0);
}

export type LedgerRow = {
  entryId: string;
  date: Date;
  number: string;
  description: string | null;
  sourceType: string;
  sourceId: string | null;
  memo: string | null;
  debit: Prisma.Decimal;
  credit: Prisma.Decimal;
  /** The other accounts on the same entry ("particulars"). */
  counterAccounts: string | null;
  /** Buyers / suppliers named on the entry. */
  parties: string | null;
  isReversal: boolean;
  isReversed: boolean;
};

/** Every line on one account in the range, oldest first (the body of a ledger or statement). */
export async function ledgerRows(
  companyId: string,
  accountId: string,
  range: DateRange,
  db: Db = prisma,
): Promise<LedgerRow[]> {
  const rows = await db.$queryRaw<LedgerRow[]>`
    SELECT je.id AS "entryId", je.date, je.number, je.description,
           je."sourceType"::text AS "sourceType", je."sourceId", jl.memo, jl.debit, jl.credit,
           (SELECT string_agg(DISTINCT la2.name, ', ')
              FROM "JournalLine" jl2 JOIN "LedgerAccount" la2 ON la2.id = jl2."accountId"
              WHERE jl2."entryId" = je.id AND jl2."accountId" <> jl."accountId") AS "counterAccounts",
           (SELECT string_agg(DISTINCT p.name, ', ')
              FROM "JournalLine" jl3 JOIN "Party" p ON p.id = jl3."partyId"
              WHERE jl3."entryId" = je.id) AS "parties",
           (je."reversalOfId" IS NOT NULL) AS "isReversal",
           je."isReversed"
    FROM "JournalLine" jl
    JOIN "JournalEntry" je ON je.id = jl."entryId"
    WHERE je."companyId" = ${companyId} AND jl."accountId" = ${accountId} ${rangeSql(range)}
    ORDER BY je.date ASC, je."createdAt" ASC, jl.id ASC
    LIMIT 20000`;
  return rows.map((r) => ({
    ...r,
    debit: new Prisma.Decimal(r.debit),
    credit: new Prisma.Decimal(r.credit),
  }));
}
