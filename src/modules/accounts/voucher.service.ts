import { type AccountSubType, Prisma } from "@prisma/client";

import { dayRange, toInstant } from "@/lib/dates";
import { AppError } from "@/lib/errors";
import { prisma } from "@/lib/prisma";
import type { RequestMeta } from "@/lib/request-meta";
import { money, ZERO } from "@/modules/accounts/balances";
import { isCashSubType, isPartySubType } from "@/modules/accounts/chart";
import { manualPostingBlock } from "@/modules/accounts/chart.service";
import { postJournalEntry, reverseJournalEntry } from "@/modules/accounts/journal.service";
import {
  assertCanManageAccounts,
  assertCanPayMoney,
  assertCanReceiveMoney,
} from "@/modules/accounts/money-guards";
import {
  createJournalSchema,
  listJournalSchema,
  reverseJournalSchema,
  transferSchema,
} from "@/modules/accounts/schemas";
import { settleSuppliersOnLines } from "@/modules/accounts/supplier-settlement";
import { auditInCompany } from "@/modules/audit/audit.service";
import type { CompanyContext } from "@/modules/auth/context";

/*
 * Journal vouchers written by Accounts (adjustments, bank charges and interest,
 * bad debts) and transfers between cash, bank and wallet accounts. Entries made
 * by other modules are undone through their own documents (void the bill, the
 * expense, the asset...), never here.
 */

const entryInclude = {
  lines: {
    orderBy: { id: "asc" },
    include: {
      account: { select: { id: true, code: true, name: true, type: true, subType: true } },
      party: { select: { id: true, code: true, name: true } },
    },
  },
  postedBy: { select: { id: true, name: true } },
  reversalOf: { select: { id: true, number: true } },
  reversedBy: { select: { id: true, number: true } },
} satisfies Prisma.JournalEntryInclude;

/** Money moving through a cash, bank or wallet account needs the matching permission. */
function assertMoneyPermissions(
  ctx: CompanyContext,
  lines: Array<{ subType: AccountSubType; debit: Prisma.Decimal; credit: Prisma.Decimal }>,
) {
  const cash = lines.filter((l) => isCashSubType(l.subType));
  if (cash.some((l) => l.debit.gt(0))) assertCanReceiveMoney(ctx);
  if (cash.some((l) => l.credit.gt(0))) assertCanPayMoney(ctx);
}

export async function listJournalEntries(ctx: CompanyContext, raw: unknown = {}) {
  const q = listJournalSchema.parse(raw);
  const take = q.take ?? 50;
  const { start, end } = dayRange(q.from, q.to, ctx.company.timezone);
  const rows = await ctx.db.journalEntry.findMany({
    where: {
      ...(q.sourceType ? { sourceType: q.sourceType } : {}),
      ...(q.accountId ? { lines: { some: { accountId: q.accountId } } } : {}),
      ...(q.search
        ? {
            OR: [
              { number: { contains: q.search, mode: "insensitive" } },
              { description: { contains: q.search, mode: "insensitive" } },
            ],
          }
        : {}),
      ...(start || end
        ? { date: { ...(start ? { gte: start } : {}), ...(end ? { lt: end } : {}) } }
        : {}),
    },
    include: entryInclude,
    orderBy: [{ date: "desc" }, { id: "desc" }],
    take: take + 1,
    ...(q.cursor ? { cursor: { id: q.cursor }, skip: 1 } : {}),
  });
  const hasMore = rows.length > take;
  const items = hasMore ? rows.slice(0, take) : rows;
  return { items: items.map(presentEntry), nextCursor: hasMore ? items.at(-1)?.id : undefined };
}

type EntryRow = Prisma.JournalEntryGetPayload<{ include: typeof entryInclude }>;

function presentEntry(entry: EntryRow) {
  const total = entry.lines.reduce((s, l) => s.plus(l.debit), ZERO);
  return {
    id: entry.id,
    number: entry.number,
    date: entry.date,
    description: entry.description,
    sourceType: entry.sourceType,
    sourceId: entry.sourceId,
    total: total.toFixed(2),
    isReversed: entry.isReversed,
    reversalOf: entry.reversalOf,
    reversedBy: entry.reversedBy,
    postedBy: entry.postedBy,
    createdAt: entry.createdAt,
    lines: entry.lines.map((l) => ({
      id: l.id,
      account: l.account,
      party: l.party,
      memo: l.memo,
      debit: l.debit.toFixed(2),
      credit: l.credit.toFixed(2),
    })),
  };
}

export async function getJournalEntry(ctx: CompanyContext, entryId: string) {
  const entry = await ctx.db.journalEntry.findUnique({
    where: { id: entryId },
    include: entryInclude,
  });
  if (!entry) throw new AppError("NOT_FOUND", "Journal entry not found.");
  return presentEntry(entry);
}

/** A journal voucher written by hand: at least two lines, debits equal to credits. */
export async function createJournalVoucher(ctx: CompanyContext, raw: unknown, meta?: RequestMeta) {
  assertCanManageAccounts(ctx);
  const input = createJournalSchema.parse(raw);
  const companyId = ctx.company.id;

  const accounts = new Map(
    (
      await ctx.db.ledgerAccount.findMany({
        where: { id: { in: [...new Set(input.lines.map((l) => l.accountId))] } },
        include: { capitalSource: { select: { id: true } } },
      })
    ).map((a) => [a.id, a]),
  );
  const partyIds = [...new Set(input.lines.flatMap((l) => (l.partyId ? [l.partyId] : [])))];
  const parties = new Map(
    (await ctx.db.party.findMany({ where: { id: { in: partyIds } } })).map((p) => [p.id, p]),
  );

  const lines = input.lines.map((l, i) => {
    const account = accounts.get(l.accountId);
    if (!account) {
      throw new AppError("VALIDATION", `Line ${i + 1}: account not found.`);
    }
    const block = manualPostingBlock(account);
    if (block) throw new AppError("VALIDATION", `Line ${i + 1} (${account.name}): ${block}`);
    if (isPartySubType(account.subType) && !l.partyId) {
      throw new AppError(
        "VALIDATION",
        `Line ${i + 1}: choose the buyer or supplier for ${account.name}.`,
      );
    }
    if (!isPartySubType(account.subType) && l.partyId) {
      throw new AppError(
        "VALIDATION",
        `Line ${i + 1}: only Receivable, Payable and Customer Advance lines name a buyer or supplier.`,
      );
    }
    if (l.partyId && !parties.has(l.partyId)) {
      throw new AppError("VALIDATION", `Line ${i + 1}: buyer or supplier not found.`);
    }
    return {
      accountId: account.id,
      subType: account.subType,
      partyId: l.partyId ?? null,
      debit: money(l.debit ?? 0),
      credit: money(l.credit ?? 0),
      memo: l.memo ?? undefined,
    };
  });
  const debit = lines.reduce((s, l) => s.plus(l.debit), ZERO);
  const credit = lines.reduce((s, l) => s.plus(l.credit), ZERO);
  if (!debit.equals(credit)) {
    throw new AppError(
      "VALIDATION",
      `Debits (${debit.toFixed(2)}) and credits (${credit.toFixed(2)}) must be equal.`,
    );
  }
  assertMoneyPermissions(ctx, lines);

  const date = input.date ? toInstant(input.date, ctx.company.timezone) : new Date();
  const entry = await prisma.$transaction(async (tx) => {
    const posted = await postJournalEntry(tx, {
      companyId,
      date,
      description: input.description,
      sourceType: "MANUAL",
      postedById: ctx.user.id,
      lines: lines.map((l) => ({
        accountId: l.accountId,
        partyId: l.partyId,
        debit: l.debit,
        credit: l.credit,
        memo: l.memo,
      })),
    });
    // An adjustment on a supplier's Payable changes which of their bills are paid.
    await settleSuppliersOnLines(tx, companyId, lines);
    await auditInCompany(
      ctx,
      meta,
      {
        action: "CREATE",
        entityType: "JournalEntry",
        entityId: posted.id,
        summary: `Journal voucher ${posted.number} (${debit.toFixed(2)}): ${input.description}`,
      },
      tx,
    );
    return posted;
  });
  return getJournalEntry(ctx, entry.id);
}

/**
 * Reverses a journal voucher or a transfer with a mirror entry; both stay in the
 * books. Other entries are undone through their own documents.
 */
export async function reverseJournalVoucher(
  ctx: CompanyContext,
  entryId: string,
  raw: unknown,
  meta?: RequestMeta,
) {
  const input = reverseJournalSchema.parse(raw);
  const entry = await ctx.db.journalEntry.findUnique({
    where: { id: entryId },
    include: { lines: { include: { account: { select: { subType: true } } } } },
  });
  if (!entry) throw new AppError("NOT_FOUND", "Journal entry not found.");
  if (entry.sourceType !== "MANUAL" && entry.sourceType !== "TRANSFER") {
    throw new AppError(
      "CONFLICT",
      `${entry.number} was made by ${entry.sourceType.toLowerCase().replace(/_/g, " ")}; undo it there (void the document).`,
    );
  }
  if (entry.reversalOfId) throw new AppError("CONFLICT", `${entry.number} is itself a reversal.`);
  if (entry.isReversed) throw new AppError("CONFLICT", `${entry.number} was already reversed.`);
  if (entry.sourceType === "MANUAL") assertCanManageAccounts(ctx);
  else assertCanPayMoney(ctx, "Only Accounts can move money between accounts.");
  // The reversal moves money the other way, so it needs the mirrored permissions.
  assertMoneyPermissions(
    ctx,
    entry.lines.map((l) => ({ subType: l.account.subType, debit: l.credit, credit: l.debit })),
  );

  const reversal = await prisma.$transaction(async (tx) => {
    const created = await reverseJournalEntry(tx, entry.id, {
      description: `Reversal of ${entry.number}: ${input.reason}`,
      postedById: ctx.user.id,
      date: input.date ? toInstant(input.date, ctx.company.timezone) : undefined,
    });
    await settleSuppliersOnLines(tx, ctx.company.id, entry.lines);
    await auditInCompany(
      ctx,
      meta,
      {
        action: "STATUS_CHANGE",
        entityType: "JournalEntry",
        entityId: entry.id,
        summary: `Reversed ${entry.number} with ${created.number}: ${input.reason}`,
      },
      tx,
    );
    return created;
  });
  return getJournalEntry(ctx, reversal.id);
}

/** Moves money between two cash, bank or wallet accounts (a deposit, a withdrawal...). */
export async function createTransfer(ctx: CompanyContext, raw: unknown, meta?: RequestMeta) {
  assertCanPayMoney(ctx, "Only Accounts can move money between accounts.");
  const input = transferSchema.parse(raw);
  const found = await ctx.db.ledgerAccount.findMany({
    where: { id: { in: [input.fromAccountId, input.toAccountId] }, isActive: true },
  });
  const from = found.find((a) => a.id === input.fromAccountId);
  const to = found.find((a) => a.id === input.toAccountId);
  if (!from || !to || !isCashSubType(from.subType) || !isCashSubType(to.subType)) {
    throw new AppError(
      "VALIDATION",
      "Transfers move money between cash, bank and wallet accounts.",
    );
  }
  const amount = money(input.amount);
  const date = input.date ? toInstant(input.date, ctx.company.timezone) : new Date();
  const entry = await prisma.$transaction(async (tx) => {
    const posted = await postJournalEntry(tx, {
      companyId: ctx.company.id,
      date,
      description:
        `Transfer from ${from.name} to ${to.name}` + (input.notes ? ` — ${input.notes}` : ""),
      sourceType: "TRANSFER",
      postedById: ctx.user.id,
      lines: [
        { accountId: to.id, debit: amount, memo: input.reference ?? undefined },
        { accountId: from.id, credit: amount, memo: input.reference ?? undefined },
      ],
    });
    await auditInCompany(
      ctx,
      meta,
      {
        action: "CREATE",
        entityType: "JournalEntry",
        entityId: posted.id,
        summary: `Transfer ${posted.number}: ${amount.toFixed(2)} from ${from.name} to ${to.name}`,
      },
      tx,
    );
    return posted;
  });
  return getJournalEntry(ctx, entry.id);
}
