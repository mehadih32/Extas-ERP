import { type AccountType, Prisma } from "@prisma/client";

import { dayRange, startOfDayInZone, nextDay, toInstant } from "@/lib/dates";
import type { Db } from "@/lib/db-types";
import { AppError } from "@/lib/errors";
import { nextDocumentNumber } from "@/lib/numbering";
import { prisma } from "@/lib/prisma";
import type { RequestMeta } from "@/lib/request-meta";
import {
  accountTotals,
  type DateRange,
  ledgerRows,
  money,
  rawBalance,
  ZERO,
} from "@/modules/accounts/balances";
import {
  assertCodeFitsType,
  CASH_SUBTYPES,
  createNumberedAccount,
  isCashSubType,
  isDebitNature,
  naturalBalance,
  SUBTYPE_TYPE,
} from "@/modules/accounts/chart";
import { CONTROL_ACCOUNTS, ensureControlAccounts } from "@/modules/accounts/control-accounts";
import { assertCanManageAccounts } from "@/modules/accounts/money-guards";
import {
  accountOpeningSchema,
  createAccountSchema,
  ledgerQuerySchema,
  listAccountsSchema,
  updateAccountSchema,
} from "@/modules/accounts/schemas";
import { ensureAccountsSetup } from "@/modules/accounts/setup";
import { auditInCompany } from "@/modules/audit/audit.service";
import type { CompanyContext } from "@/modules/auth/context";

/*
 * Chart of accounts: every account with its balance, accounts added by hand,
 * balances brought forward on the go-live day, and each account's ledger
 * (date-wise lines with a running balance).
 */

type Tx = Prisma.TransactionClient;

const accountInclude = {
  bankAccount: { select: { id: true, bankName: true, accountNumber: true, isActive: true } },
  capitalSource: { select: { id: true, name: true, kind: true } },
  fixedAsset: { select: { id: true, name: true } },
} satisfies Prisma.LedgerAccountInclude;

type AccountRow = Prisma.LedgerAccountGetPayload<{ include: typeof accountInclude }>;

/** Why an account cannot take hand-written journal lines (null when it can). */
export function manualPostingBlock(account: {
  code: string;
  subType: AccountRow["subType"];
  isActive: boolean;
  capitalSource?: unknown;
}): string | null {
  if (!account.isActive) return "This account is archived.";
  switch (account.subType) {
    case "INVENTORY":
      return "Stock value follows stock movements (opening stock, deliveries, sales, bad stock).";
    case "RAW_MATERIALS":
      return "Raw material stock is kept by the store: buy, issue, count or return materials there.";
    case "PENDING_RETURNS":
      return "Returns are kept by returns QC.";
    case "FIXED_ASSET":
    case "ACCUMULATED_DEPRECIATION":
      return "Use the fixed asset register.";
  }
  if (account.code === CONTROL_ACCOUNTS.WORK_IN_PROGRESS.code) {
    return "Work in progress is kept by Production.";
  }
  if (account.code === CONTROL_ACCOUNTS.EMPLOYEE_ADVANCES.code) {
    return "Advances to employees are kept by HR: give, recover or take back an advance there.";
  }
  if (account.code === CONTROL_ACCOUNTS.SALARIES_PAYABLE.code) {
    return "Salaries payable is kept by payroll (approve and pay a month's payroll).";
  }
  if (account.capitalSource) return "Use capital, investors and loans for this account.";
  return null;
}

/** Accounts that can carry a balance brought forward from before the ERP. */
function openingBalanceBlock(account: AccountRow): string | null {
  const allowed: AccountRow["subType"][] = [
    "CASH",
    "BANK",
    "MOBILE_WALLET",
    "OTHER_CURRENT_ASSET",
    "ADVANCE_TO_EMPLOYEE",
    "OTHER_LIABILITY",
  ];
  if (account.code === CONTROL_ACCOUNTS.EMPLOYEE_ADVANCES.code) {
    return "Enter each employee's advance brought forward in HR instead.";
  }
  if (account.code === CONTROL_ACCOUNTS.SALARIES_PAYABLE.code) {
    return "Salaries payable is kept by payroll.";
  }
  if (
    account.code === CONTROL_ACCOUNTS.WORK_IN_PROGRESS.code ||
    !allowed.includes(account.subType)
  ) {
    switch (account.subType) {
      case "ACCOUNTS_RECEIVABLE":
      case "ACCOUNTS_PAYABLE":
      case "CUSTOMER_ADVANCE":
        return "Set opening balances on each buyer or supplier instead.";
      case "INVENTORY":
        return "Enter opening stock in Inventory instead; its value reaches this account.";
      case "RAW_MATERIALS":
        return "Enter opening stock for each raw material instead; its value reaches this account.";
      case "FIXED_ASSET":
      case "ACCUMULATED_DEPRECIATION":
        return "Add the asset to the fixed asset register as already owned instead.";
      case "LOAN":
      case "INVESTOR":
      case "CAPITAL":
        return "Add the loan, investor or capital with its opening balance instead.";
      default:
        return "This account does not take an opening balance.";
    }
  }
  return null;
}

function presentAccount(
  account: AccountRow,
  totals?: { debit: Prisma.Decimal; credit: Prisma.Decimal },
) {
  const debit = totals?.debit ?? ZERO;
  const credit = totals?.credit ?? ZERO;
  const link = account.bankAccount
    ? {
        kind: "BANK_ACCOUNT" as const,
        id: account.bankAccount.id,
        name: `${account.bankAccount.bankName} ${account.bankAccount.accountNumber}`,
      }
    : account.capitalSource
      ? {
          kind: "CAPITAL_SOURCE" as const,
          id: account.capitalSource.id,
          name: account.capitalSource.name,
        }
      : account.fixedAsset
        ? { kind: "FIXED_ASSET" as const, id: account.fixedAsset.id, name: account.fixedAsset.name }
        : null;
  const block = manualPostingBlock(account);
  return {
    id: account.id,
    code: account.code,
    name: account.name,
    type: account.type,
    subType: account.subType,
    isSystem: account.isSystem,
    isActive: account.isActive,
    isCash: isCashSubType(account.subType),
    debit: debit.toFixed(2),
    credit: credit.toFixed(2),
    /** In the account's normal direction (assets and expenses: debit minus credit). */
    balance: naturalBalance(account.type, debit, credit).toFixed(2),
    openingBalance: account.openingBalance.toFixed(2),
    linkedTo: link,
    manualPosting: block === null,
    manualPostingNote: block,
  };
}

/** Instant at the end of `day` in company time (exclusive bound). */
function endOfDay(ctx: CompanyContext, day: string) {
  return startOfDayInZone(nextDay(day), ctx.company.timezone);
}

export async function listAccounts(ctx: CompanyContext, raw: unknown = {}) {
  const q = listAccountsSchema.parse(raw);
  await ensureAccountsSetup(ctx.company.id);
  const accounts = await ctx.db.ledgerAccount.findMany({
    where: {
      ...(q.type ? { type: q.type } : {}),
      ...(q.subType ? { subType: q.subType } : {}),
      ...(q.includeInactive ? {} : { isActive: true }),
      ...(q.search
        ? {
            OR: [
              { name: { contains: q.search, mode: "insensitive" } },
              { code: { startsWith: q.search } },
            ],
          }
        : {}),
    },
    include: accountInclude,
    orderBy: { code: "asc" },
  });
  const totals = await accountTotals(ctx.company.id, q.asOf ? { end: endOfDay(ctx, q.asOf) } : {});
  return {
    asOf: q.asOf ?? null,
    items: accounts.map((a) => presentAccount(a, totals.get(a.id))),
  };
}

export async function getAccountOrThrow(ctx: CompanyContext, accountId: string, db: Db = prisma) {
  const account = await db.ledgerAccount.findFirst({
    where: { id: accountId, companyId: ctx.company.id },
    include: accountInclude,
  });
  if (!account) throw new AppError("NOT_FOUND", "Account not found.");
  return account;
}

export async function getAccount(ctx: CompanyContext, accountId: string) {
  const account = await getAccountOrThrow(ctx, accountId);
  const sums = await prisma.journalLine.aggregate({
    where: { accountId: account.id, entry: { companyId: ctx.company.id } },
    _sum: { debit: true, credit: true },
  });
  return presentAccount(account, {
    debit: sums._sum.debit ?? ZERO,
    credit: sums._sum.credit ?? ZERO,
  });
}

/** Cash, bank and wallet accounts with their balances: the "paid from / into" choices. */
export async function listCashAccounts(ctx: CompanyContext) {
  await ensureControlAccounts(ctx.company.id);
  const accounts = await ctx.db.ledgerAccount.findMany({
    where: { subType: { in: [...CASH_SUBTYPES] }, isActive: true },
    include: accountInclude,
    orderBy: { code: "asc" },
  });
  const totals = await accountTotals(ctx.company.id);
  return accounts.map((a) => presentAccount(a, totals.get(a.id)));
}

export async function createAccount(ctx: CompanyContext, raw: unknown, meta?: RequestMeta) {
  assertCanManageAccounts(ctx);
  const input = createAccountSchema.parse(raw);
  const type = SUBTYPE_TYPE[input.subType];
  if (input.code) assertCodeFitsType(input.code, type);
  const clash = await ctx.db.ledgerAccount.findFirst({
    where: { name: { equals: input.name, mode: "insensitive" } },
  });
  if (clash) throw new AppError("CONFLICT", `An account called "${clash.name}" already exists.`);

  const account = await prisma.$transaction(async (tx) => {
    let created;
    if (input.code) {
      const taken = await tx.ledgerAccount.findFirst({
        where: { companyId: ctx.company.id, code: input.code },
      });
      if (taken) throw new AppError("CONFLICT", `Code ${input.code} is used by "${taken.name}".`);
      created = await tx.ledgerAccount.create({
        data: {
          companyId: ctx.company.id,
          code: input.code,
          name: input.name,
          type,
          subType: input.subType,
        },
      });
    } else {
      created = await createNumberedAccount(tx, ctx.company.id, {
        name: input.name,
        subType: input.subType,
      });
    }
    await auditInCompany(
      ctx,
      meta,
      {
        action: "CREATE",
        entityType: "LedgerAccount",
        entityId: created.id,
        summary: `Added account ${created.code} ${created.name}`,
      },
      tx,
    );
    return created;
  });
  return getAccount(ctx, account.id);
}

export async function updateAccount(
  ctx: CompanyContext,
  accountId: string,
  raw: unknown,
  meta?: RequestMeta,
) {
  assertCanManageAccounts(ctx);
  const input = updateAccountSchema.parse(raw);
  const account = await getAccountOrThrow(ctx, accountId);
  if (input.name && input.name.toLowerCase() !== account.name.toLowerCase()) {
    const clash = await ctx.db.ledgerAccount.findFirst({
      where: { name: { equals: input.name, mode: "insensitive" }, id: { not: account.id } },
    });
    if (clash) throw new AppError("CONFLICT", `An account called "${clash.name}" already exists.`);
  }
  if (input.isActive === false && account.isActive) {
    if (account.isSystem) {
      throw new AppError("CONFLICT", `${account.name} is used by the system and stays active.`);
    }
    if (account.bankAccount || account.capitalSource || account.fixedAsset) {
      throw new AppError("CONFLICT", "Archive the bank account, loan or asset this belongs to.");
    }
    const balance = await rawBalance(ctx.company.id, account.id);
    if (!balance.isZero()) {
      throw new AppError(
        "CONFLICT",
        `${account.name} still has a balance of ${balance.abs().toFixed(2)}; move it out first.`,
      );
    }
  }
  await ctx.db.ledgerAccount.update({
    where: { id: account.id },
    data: { name: input.name, isActive: input.isActive },
  });
  await auditInCompany(ctx, meta, {
    action: "UPDATE",
    entityType: "LedgerAccount",
    entityId: account.id,
    summary: `Updated account ${account.code}${input.name ? ` (now "${input.name}")` : ""}${
      input.isActive === false ? " (archived)" : input.isActive ? " (reactivated)" : ""
    }`,
  });
  return getAccount(ctx, account.id);
}

/**
 * Posts (or replaces) an account's balance brought forward against Opening
 * Balance Equity. `amount` is in the account's normal direction.
 */
export async function postAccountOpeningTx(
  tx: Tx,
  ctx: CompanyContext,
  account: { id: string; code: string; name: string; type: AccountType },
  amount: Prisma.Decimal,
  asOf: Date,
) {
  const companyId = ctx.company.id;
  const acc = await ensureControlAccounts(companyId, tx);
  await tx.journalEntry.deleteMany({
    where: { companyId, sourceType: "OPENING_BALANCE", sourceId: account.id },
  });
  if (!amount.isZero()) {
    const abs = amount.abs();
    // A positive amount sits on the account's normal side.
    const accountOnDebit = isDebitNature(account.type) === amount.gt(0);
    await tx.journalEntry.create({
      data: {
        companyId,
        number: await nextDocumentNumber(tx, companyId, "JOURNAL_VOUCHER"),
        date: asOf,
        description: `Opening balance — ${account.code} ${account.name}`,
        sourceType: "OPENING_BALANCE",
        sourceId: account.id,
        postedById: ctx.user.id,
        lines: {
          create: accountOnDebit
            ? [
                { accountId: account.id, debit: abs },
                { accountId: acc.OPENING_EQUITY, credit: abs },
              ]
            : [
                { accountId: acc.OPENING_EQUITY, debit: abs },
                { accountId: account.id, credit: abs },
              ],
        },
      },
    });
  }
  await tx.ledgerAccount.update({ where: { id: account.id }, data: { openingBalance: amount } });
}

export async function setAccountOpeningBalance(
  ctx: CompanyContext,
  accountId: string,
  raw: unknown,
  meta?: RequestMeta,
) {
  assertCanManageAccounts(ctx);
  const input = accountOpeningSchema.parse(raw);
  const account = await getAccountOrThrow(ctx, accountId);
  const block = openingBalanceBlock(account);
  if (block) throw new AppError("VALIDATION", block);
  const amount = money(input.amount);
  const asOf = input.asOf ? toInstant(input.asOf, ctx.company.timezone) : new Date();
  await prisma.$transaction(async (tx) => {
    await postAccountOpeningTx(tx, ctx, account, amount, asOf);
    await auditInCompany(
      ctx,
      meta,
      {
        action: "UPDATE",
        entityType: "LedgerAccount",
        entityId: account.id,
        summary: `Set opening balance of ${account.code} ${account.name} to ${amount.toFixed(2)}`,
        before: { openingBalance: account.openingBalance.toFixed(2) },
        after: { openingBalance: amount.toFixed(2) },
      },
      tx,
    );
  });
  return getAccount(ctx, account.id);
}

/** Opening balance, lines with a running balance and totals, in the account's normal direction. */
export async function buildLedger(
  companyId: string,
  account: { id: string; type: AccountType },
  range: DateRange,
) {
  const natural = (debit: Prisma.Decimal.Value, credit: Prisma.Decimal.Value) =>
    naturalBalance(account.type, debit, credit);
  const openingRaw = range.start
    ? await rawBalance(companyId, account.id, { end: range.start })
    : ZERO;
  const opening = isDebitNature(account.type) ? openingRaw : openingRaw.neg();
  const rows = await ledgerRows(companyId, account.id, range);
  let running = opening;
  let totalDebit = ZERO;
  let totalCredit = ZERO;
  const lines = rows.map((r) => {
    running = running.plus(natural(r.debit, r.credit));
    totalDebit = totalDebit.plus(r.debit);
    totalCredit = totalCredit.plus(r.credit);
    return {
      entryId: r.entryId,
      date: r.date,
      number: r.number,
      description: r.description,
      sourceType: r.sourceType,
      sourceId: r.sourceId,
      particulars: r.counterAccounts,
      parties: r.parties,
      memo: r.memo,
      isReversal: r.isReversal,
      isReversed: r.isReversed,
      debit: r.debit.toFixed(2),
      credit: r.credit.toFixed(2),
      balance: running.toFixed(2),
    };
  });
  return { opening, closing: running, totalDebit, totalCredit, lines };
}

/** One account's ledger for a period (every account, including cash and wallets). */
export async function getAccountLedger(ctx: CompanyContext, accountId: string, raw: unknown = {}) {
  const q = ledgerQuerySchema.parse(raw);
  const { start, end } = dayRange(q.from, q.to, ctx.company.timezone);
  if (start && end && start >= end) {
    throw new AppError("VALIDATION", "'From' date is after 'to' date.");
  }
  const account = await getAccountOrThrow(ctx, accountId);
  const ledger = await buildLedger(ctx.company.id, account, { start, end });
  return {
    // Today's balance; the summary below is for the period asked for.
    account: await getAccount(ctx, account.id),
    period: { from: q.from ?? null, to: q.to ?? null, timezone: ctx.company.timezone },
    summary: {
      openingBalance: ledger.opening.toFixed(2),
      totalDebit: ledger.totalDebit.toFixed(2),
      totalCredit: ledger.totalCredit.toFixed(2),
      closingBalance: ledger.closing.toFixed(2),
      transactionCount: ledger.lines.length,
    },
    lines: ledger.lines,
    generatedAt: new Date(),
  };
}
