import { type JournalSource, Prisma } from "@prisma/client";

import type { Db } from "@/lib/db-types";
import { AppError } from "@/lib/errors";
import { nextDocumentNumber } from "@/lib/numbering";

/*
 * Double-entry posting used by every module that moves money or value.
 * An entry is only saved when debits equal credits; the party tag on a line
 * feeds that buyer's / supplier's ledger.
 */

export type JournalLineInput = {
  accountId: string;
  partyId?: string | null;
  debit?: Prisma.Decimal | number;
  credit?: Prisma.Decimal | number;
  memo?: string;
};

export type JournalEntryInput = {
  companyId: string;
  date?: Date;
  description: string;
  sourceType: JournalSource;
  sourceId?: string;
  postedById?: string;
  lines: JournalLineInput[];
};

const dec = (v: Prisma.Decimal | number | undefined) =>
  new Prisma.Decimal(v ?? 0).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);

/** Posts a balanced journal entry. Zero-amount lines are dropped. */
export async function postJournalEntry(db: Db, input: JournalEntryInput) {
  const lines = input.lines
    .map((l) => ({ ...l, debit: dec(l.debit), credit: dec(l.credit) }))
    .filter((l) => !l.debit.isZero() || !l.credit.isZero());
  for (const l of lines) {
    if (
      l.debit.isNegative() ||
      l.credit.isNegative() ||
      (!l.debit.isZero() && !l.credit.isZero())
    ) {
      throw new AppError("INTERNAL", "Each journal line is either a debit or a credit.");
    }
  }
  const debit = lines.reduce((s, l) => s.plus(l.debit), new Prisma.Decimal(0));
  const credit = lines.reduce((s, l) => s.plus(l.credit), new Prisma.Decimal(0));
  if (lines.length < 2 || debit.isZero() || !debit.equals(credit)) {
    throw new AppError(
      "INTERNAL",
      `Unbalanced journal entry (debit ${debit.toFixed(2)}, credit ${credit.toFixed(2)}).`,
    );
  }
  return db.journalEntry.create({
    data: {
      companyId: input.companyId,
      number: await nextDocumentNumber(db, input.companyId, "JOURNAL_VOUCHER"),
      date: input.date ?? new Date(),
      description: input.description,
      sourceType: input.sourceType,
      sourceId: input.sourceId,
      postedById: input.postedById,
      lines: {
        create: lines.map((l) => ({
          accountId: l.accountId,
          partyId: l.partyId ?? null,
          debit: l.debit,
          credit: l.credit,
          memo: l.memo,
        })),
      },
    },
  });
}

/** Posts the mirror image of an entry (debits <-> credits) and marks it reversed. */
export async function reverseJournalEntry(
  db: Db,
  entryId: string,
  options: { description: string; postedById?: string; date?: Date },
) {
  const original = await db.journalEntry.findUnique({
    where: { id: entryId },
    include: { lines: true },
  });
  if (!original) throw new AppError("NOT_FOUND", "Journal entry not found.");
  const { count } = await db.journalEntry.updateMany({
    where: { id: original.id, isReversed: false },
    data: { isReversed: true },
  });
  if (count === 0) throw new AppError("CONFLICT", "This entry was already reversed.");
  return db.journalEntry.create({
    data: {
      companyId: original.companyId,
      number: await nextDocumentNumber(db, original.companyId, "JOURNAL_VOUCHER"),
      date: options.date ?? new Date(),
      description: options.description,
      sourceType: original.sourceType,
      sourceId: original.sourceId,
      postedById: options.postedById,
      reversalOfId: original.id,
      lines: {
        create: original.lines.map((l) => ({
          accountId: l.accountId,
          partyId: l.partyId,
          employeeId: l.employeeId,
          debit: l.credit,
          credit: l.debit,
          memo: l.memo,
        })),
      },
    },
  });
}
