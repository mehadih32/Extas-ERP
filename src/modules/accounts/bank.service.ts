import { Prisma } from "@prisma/client";

import { DATE_ONLY, dayRange, localDay, nextDay, toInstant } from "@/lib/dates";
import { AppError } from "@/lib/errors";
import { prisma } from "@/lib/prisma";
import type { RequestMeta } from "@/lib/request-meta";
import { accountTotals, money, rawBalance, ZERO } from "@/modules/accounts/balances";
import { createNumberedAccount } from "@/modules/accounts/chart";
import { buildLedger, postAccountOpeningTx } from "@/modules/accounts/chart.service";
import { ensureControlAccounts } from "@/modules/accounts/control-accounts";
import { assertCanManageAccounts } from "@/modules/accounts/money-guards";
import { daysBetweenInclusive } from "@/modules/accounts/periods";
import {
  createBankAccountSchema,
  ledgerQuerySchema,
  updateBankAccountSchema,
} from "@/modules/accounts/schemas";
import { auditInCompany } from "@/modules/audit/audit.service";
import type { CompanyContext } from "@/modules/auth/context";
import { letterhead } from "@/modules/companies/letterhead";

/*
 * Bank accounts. Each one has its own ledger account (sub-type BANK), so every
 * deposit and withdrawal recorded anywhere in the ERP lands on its statement.
 * The company's first bank account takes over the general "Bank" account
 * (1100) that bank transfers, cheques and cards default to.
 */

const ledgerSelect = { id: true, code: true, name: true, isActive: true } as const;

const ledgerName = (bankName: string, accountNumber: string) => `${bankName} ${accountNumber}`;

async function getBankOrThrow(ctx: CompanyContext, bankAccountId: string) {
  const bank = await ctx.db.bankAccount.findUnique({
    where: { id: bankAccountId },
    include: { ledgerAccount: { select: ledgerSelect } },
  });
  if (!bank) throw new AppError("NOT_FOUND", "Bank account not found.");
  return bank;
}

export async function listBankAccounts(
  ctx: CompanyContext,
  raw: { includeInactive?: unknown } = {},
) {
  const includeInactive = raw.includeInactive === true || raw.includeInactive === "true";
  const banks = await ctx.db.bankAccount.findMany({
    where: includeInactive ? {} : { isActive: true },
    include: { ledgerAccount: { select: ledgerSelect } },
    orderBy: [{ isActive: "desc" }, { createdAt: "asc" }],
  });
  const totals = await accountTotals(ctx.company.id);
  return banks.map((b) => {
    const t = totals.get(b.ledgerAccountId);
    return {
      ...b,
      balance: (t ? t.debit.minus(t.credit) : ZERO).toFixed(2),
    };
  });
}

export async function getBankAccount(ctx: CompanyContext, bankAccountId: string) {
  const bank = await getBankOrThrow(ctx, bankAccountId);
  const balance = await rawBalance(ctx.company.id, bank.ledgerAccountId);
  return { ...bank, balance: balance.toFixed(2) };
}

export async function createBankAccount(ctx: CompanyContext, raw: unknown, meta?: RequestMeta) {
  assertCanManageAccounts(ctx);
  const input = createBankAccountSchema.parse(raw);
  const companyId = ctx.company.id;
  const duplicate = await ctx.db.bankAccount.findFirst({
    where: { accountNumber: input.accountNumber },
  });
  if (duplicate) {
    throw new AppError("CONFLICT", `Account ${input.accountNumber} is already recorded.`);
  }

  const bank = await prisma.$transaction(async (tx) => {
    const acc = await ensureControlAccounts(companyId, tx);
    const name = ledgerName(input.bankName, input.accountNumber);
    const generalTaken = await tx.bankAccount.findFirst({
      where: { companyId, ledgerAccountId: acc.BANK },
    });
    const ledger = generalTaken
      ? await createNumberedAccount(tx, companyId, { name, subType: "BANK" })
      : await tx.ledgerAccount.update({ where: { id: acc.BANK }, data: { name, isActive: true } });
    const created = await tx.bankAccount.create({
      data: {
        companyId,
        ledgerAccountId: ledger.id,
        bankName: input.bankName,
        branch: input.branch ?? null,
        accountName: input.accountName,
        accountNumber: input.accountNumber,
        routingNumber: input.routingNumber ?? null,
        swiftCode: input.swiftCode ?? null,
      },
    });
    if (input.openingBalance) {
      await postAccountOpeningTx(
        tx,
        ctx,
        ledger,
        money(input.openingBalance),
        input.openingDate ? toInstant(input.openingDate, ctx.company.timezone) : new Date(),
      );
    }
    await auditInCompany(
      ctx,
      meta,
      {
        action: "CREATE",
        entityType: "BankAccount",
        entityId: created.id,
        summary: `Added bank account ${name} (ledger ${ledger.code})${
          input.openingBalance ? `, opening balance ${money(input.openingBalance).toFixed(2)}` : ""
        }`,
      },
      tx,
    );
    return created;
  });
  return getBankAccount(ctx, bank.id);
}

export async function updateBankAccount(
  ctx: CompanyContext,
  bankAccountId: string,
  raw: unknown,
  meta?: RequestMeta,
) {
  assertCanManageAccounts(ctx);
  const input = updateBankAccountSchema.parse(raw);
  const bank = await getBankOrThrow(ctx, bankAccountId);
  if (input.accountNumber && input.accountNumber !== bank.accountNumber) {
    const duplicate = await ctx.db.bankAccount.findFirst({
      where: { accountNumber: input.accountNumber, id: { not: bank.id } },
    });
    if (duplicate) {
      throw new AppError("CONFLICT", `Account ${input.accountNumber} is already recorded.`);
    }
  }
  if (input.isActive === false && bank.isActive) {
    const balance = await rawBalance(ctx.company.id, bank.ledgerAccountId);
    if (!balance.isZero()) {
      throw new AppError(
        "CONFLICT",
        `This account still shows ${balance.toFixed(2)}; transfer the balance out before closing it.`,
      );
    }
  }
  await prisma.$transaction(async (tx) => {
    const updated = await tx.bankAccount.update({
      where: { id: bank.id },
      data: {
        bankName: input.bankName,
        branch: input.branch,
        accountName: input.accountName,
        accountNumber: input.accountNumber,
        routingNumber: input.routingNumber,
        swiftCode: input.swiftCode,
        isActive: input.isActive,
      },
    });
    await tx.ledgerAccount.update({
      where: { id: bank.ledgerAccountId },
      data: {
        name: ledgerName(updated.bankName, updated.accountNumber),
        isActive: updated.isActive,
      },
    });
    await auditInCompany(
      ctx,
      meta,
      {
        action: "UPDATE",
        entityType: "BankAccount",
        entityId: bank.id,
        summary: `Updated bank account ${ledgerName(updated.bankName, updated.accountNumber)}${
          input.isActive === false ? " (closed)" : input.isActive ? " (reopened)" : ""
        }`,
      },
      tx,
    );
  });
  return getBankAccount(ctx, bank.id);
}

/** A calendar day for a "from" / "to" filter value (timestamps fall on their local day). */
function filterDay(value: Date | string, timeZone: string): string {
  return typeof value === "string" && DATE_ONLY.test(value)
    ? value
    : localDay(new Date(value), timeZone);
}

/**
 * Bank statement as recorded in the company's books, laid out the way banks
 * and loan officers read them: account details, opening and closing balance,
 * every deposit and withdrawal with a running balance, and a month-by-month
 * summary with the average daily balance.
 */
export async function getBankStatement(
  ctx: CompanyContext,
  bankAccountId: string,
  raw: unknown = {},
) {
  const q = ledgerQuerySchema.parse(raw);
  const tz = ctx.company.timezone;
  const { start, end } = dayRange(q.from, q.to, tz);
  if (start && end && start >= end) {
    throw new AppError("VALIDATION", "'From' date is after 'to' date.");
  }
  const bank = await getBankOrThrow(ctx, bankAccountId);
  const ledger = await buildLedger(
    ctx.company.id,
    { id: bank.ledgerAccountId, type: "ASSET" },
    { start, end },
  );

  const today = localDay(new Date(), tz);
  const lastLine = ledger.lines.at(-1);
  const lastLineDay = lastLine ? localDay(lastLine.date, tz) : today;
  // Without a "to" day the statement runs to today (or to a later-dated entry).
  const lastDay = q.to ? filterDay(q.to, tz) : lastLineDay > today ? lastLineDay : today;
  let firstDay = q.from
    ? filterDay(q.from, tz)
    : ledger.lines[0]
      ? localDay(ledger.lines[0].date, tz)
      : lastDay;
  if (firstDay > lastDay) firstDay = lastDay;
  if (daysBetweenInclusive(firstDay, lastDay) > 3700) {
    throw new AppError("VALIDATION", "A statement can cover up to 10 years.");
  }

  // End-of-day balances give the monthly averages banks look at.
  const netByDay = new Map<string, Prisma.Decimal>();
  const byMonth = new Map<
    string,
    { deposits: Prisma.Decimal; withdrawals: Prisma.Decimal; count: number }
  >();
  for (const line of ledger.lines) {
    const day = localDay(line.date, tz);
    netByDay.set(day, (netByDay.get(day) ?? ZERO).plus(line.debit).minus(line.credit));
    const m = byMonth.get(day.slice(0, 7)) ?? { deposits: ZERO, withdrawals: ZERO, count: 0 };
    m.deposits = m.deposits.plus(line.debit);
    m.withdrawals = m.withdrawals.plus(line.credit);
    m.count += 1;
    byMonth.set(day.slice(0, 7), m);
  }
  type MonthTotals = {
    opening: Prisma.Decimal;
    closing: Prisma.Decimal;
    sum: Prisma.Decimal;
    days: number;
  };
  const perMonth = new Map<string, MonthTotals>();
  let balance = ledger.opening;
  let sumAll = ZERO;
  let daysAll = 0;
  for (let day = firstDay; day <= lastDay; day = nextDay(day)) {
    const key = day.slice(0, 7);
    let month = perMonth.get(key);
    if (!month) {
      month = { opening: balance, closing: balance, sum: ZERO, days: 0 };
      perMonth.set(key, month);
    }
    balance = balance.plus(netByDay.get(day) ?? ZERO);
    month.closing = balance;
    month.sum = month.sum.plus(balance);
    month.days += 1;
    sumAll = sumAll.plus(balance);
    daysAll += 1;
  }
  const months = [...perMonth].map(([month, t]) => {
    const moves = byMonth.get(month);
    return {
      month,
      openingBalance: t.opening.toFixed(2),
      deposits: (moves?.deposits ?? ZERO).toFixed(2),
      withdrawals: (moves?.withdrawals ?? ZERO).toFixed(2),
      transactionCount: moves?.count ?? 0,
      closingBalance: t.closing.toFixed(2),
      /** Average of the end-of-day balances. */
      averageBalance: t.sum.dividedBy(t.days).toFixed(2),
    };
  });

  const deposits = ledger.lines.filter((l) => new Prisma.Decimal(l.debit).gt(0));
  const withdrawals = ledger.lines.filter((l) => new Prisma.Decimal(l.credit).gt(0));
  return {
    title: "Bank Statement",
    note: `Statement of account as recorded in the books of ${ctx.company.legalName ?? ctx.company.name}.`,
    letterhead: letterhead(ctx.company),
    accountHolder: {
      name: bank.accountName,
      company: ctx.company.legalName ?? ctx.company.name,
      address: ctx.company.address,
    },
    bank: {
      id: bank.id,
      bankName: bank.bankName,
      branch: bank.branch,
      accountName: bank.accountName,
      accountNumber: bank.accountNumber,
      routingNumber: bank.routingNumber,
      swiftCode: bank.swiftCode,
      currency: ctx.company.currency,
      ledgerAccount: bank.ledgerAccount,
    },
    period: { from: firstDay, to: lastDay, timezone: tz },
    summary: {
      openingBalance: ledger.opening.toFixed(2),
      totalDeposits: ledger.totalDebit.toFixed(2),
      depositCount: deposits.length,
      totalWithdrawals: ledger.totalCredit.toFixed(2),
      withdrawalCount: withdrawals.length,
      closingBalance: ledger.closing.toFixed(2),
      averageBalance:
        daysAll > 0 ? sumAll.dividedBy(daysAll).toFixed(2) : ledger.opening.toFixed(2),
    },
    months,
    transactions: ledger.lines.map((l) => ({
      date: l.date,
      voucherNumber: l.number,
      particulars: [l.description, l.particulars].filter(Boolean).join(" — "),
      reference: l.memo,
      sourceType: l.sourceType,
      withdrawal: l.credit,
      deposit: l.debit,
      balance: l.balance,
    })),
    generatedAt: new Date(),
  };
}
