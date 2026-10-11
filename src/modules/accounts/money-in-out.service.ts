import type { AccountSubType, PaymentMethod } from "@prisma/client";

import { AppError } from "@/lib/errors";
import { isCashSubType } from "@/modules/accounts/chart";
import {
  createCapitalSource,
  receiveCapital,
  repayCapital,
} from "@/modules/accounts/capital.service";
import { ensureControlAccounts } from "@/modules/accounts/control-accounts";
import {
  assertCanManageAccounts,
  assertCanPayMoney,
  assertCanReceiveMoney,
} from "@/modules/accounts/money-guards";
import { bankChargeSchema, ownerMoneySchema } from "@/modules/accounts/schemas";
import type { CompanyContext } from "@/modules/auth/context";
import { createExpense, ensureGeneralExpenseHeads } from "@/modules/expenses/expense.service";
import type { RequestMeta } from "@/lib/request-meta";

/*
 * The "Money in/out" button: money that comes into or leaves the business
 * without a sale, a purchase or a running cost, posted for the person through
 * the capital and expense services, so each is the same entry those make and is
 * undone the same way:
 *   Add fund     Dr Cash / Bank / Wallet       Cr Capital — <owner>
 *   Withdraw     Dr Owner's Drawings (3100)    Cr Cash / Bank / Wallet
 *   Bank charge  Dr Finance Costs (the "Bank Charges" expense head)  Cr Bank / Wallet
 */

/** The method recorded with the money, from the kind of account it moves through. */
const METHOD_OF: Partial<Record<AccountSubType, PaymentMethod>> = {
  CASH: "CASH",
  BANK: "BANK_TRANSFER",
  MOBILE_WALLET: "BKASH",
};

const BANK_CHARGES = "Bank Charges";

async function moneyAccount(
  ctx: CompanyContext,
  accountId: string,
  kinds: readonly AccountSubType[] = ["CASH", "BANK", "MOBILE_WALLET"],
) {
  const account = await ctx.db.ledgerAccount.findFirst({
    where: { id: accountId, isActive: true, subType: { in: [...kinds] } },
    select: { id: true, name: true, subType: true },
  });
  if (!account || !isCashSubType(account.subType)) {
    throw new AppError(
      "VALIDATION",
      kinds.includes("CASH")
        ? "Choose a cash, bank or wallet account."
        : "Choose the bank or wallet account that charged it.",
      { accountId: ["Choose an account."] },
    );
  }
  return { ...account, method: METHOD_OF[account.subType] ?? "CASH" };
}

/** An owner already in the books, by id or by name (a name new to the books is null). */
async function findOwner(ctx: CompanyContext, input: { ownerId?: string; ownerName?: string }) {
  const owner = await ctx.db.capitalSource.findFirst({
    where: {
      kind: "OWNER_CAPITAL",
      ...(input.ownerId
        ? { id: input.ownerId }
        : { name: { equals: input.ownerName!, mode: "insensitive" } }),
    },
    select: { id: true, name: true },
  });
  if (!owner && input.ownerId) throw new AppError("NOT_FOUND", "Owner not found.");
  return owner;
}

/** Who may use each part of the button, and the owners to choose from. */
export async function getMoneyInOutOptions(ctx: CompanyContext) {
  const manage = ctx.can("accounts.manage");
  const can = {
    addFund: manage && ctx.can("accounts.receipts.record"),
    withdraw: manage && ctx.can("accounts.payments.record"),
    bankCharge: ctx.can("accounts.payments.record") && ctx.can("expenses.create"),
  };
  if (!can.addFund && !can.withdraw && !can.bankCharge) return null;
  const owners = await ctx.db.capitalSource.findMany({
    where: { kind: "OWNER_CAPITAL" },
    select: { id: true, name: true, outstanding: true },
    orderBy: { name: "asc" },
  });
  return {
    owners: owners.map((o) => ({ id: o.id, name: o.name, invested: o.outstanding.toFixed(2) })),
    can,
  };
}

export type MoneyInOutOptions = NonNullable<Awaited<ReturnType<typeof getMoneyInOutOptions>>>;

/** Add fund: the owner puts money in; it goes on their capital account. */
export async function addFund(ctx: CompanyContext, raw: unknown, meta?: RequestMeta) {
  assertCanManageAccounts(ctx, "Only Accounts can record money the owner puts in.");
  assertCanReceiveMoney(ctx);
  const input = ownerMoneySchema.parse(raw);
  const account = await moneyAccount(ctx, input.accountId);
  const owner = await findOwner(ctx, input);
  const money = {
    amount: input.amount,
    method: account.method,
    accountId: account.id,
    reference: input.reference,
  };
  if (owner) {
    await receiveCapital(ctx, owner.id, { ...money, date: input.date, notes: input.notes }, meta);
  } else {
    await createCapitalSource(
      ctx,
      {
        kind: "OWNER_CAPITAL",
        name: input.ownerName,
        startDate: input.date,
        received: money,
        notes: input.notes,
      },
      meta,
    );
  }
  return { owner: owner?.name ?? input.ownerName!, account: account.name };
}

/** Withdraw: the owner takes money out for themselves; it goes to Owner's Drawings. */
export async function withdrawFund(ctx: CompanyContext, raw: unknown, meta?: RequestMeta) {
  assertCanManageAccounts(ctx, "Only Accounts can record money the owner takes out.");
  assertCanPayMoney(ctx);
  const input = ownerMoneySchema.parse(raw);
  const account = await moneyAccount(ctx, input.accountId);
  const owner =
    (await findOwner(ctx, input)) ??
    (await createCapitalSource(ctx, { kind: "OWNER_CAPITAL", name: input.ownerName }, meta));
  // Drawings, not a return of capital: what they put in stays as it is.
  await repayCapital(
    ctx,
    owner.id,
    {
      principal: 0,
      interest: input.amount,
      date: input.date,
      method: account.method,
      accountId: account.id,
      reference: input.reference,
      notes: input.notes,
    },
    meta,
  );
  return { owner: owner.name, account: account.name };
}

/** The "Bank Charges" head (on Finance Costs), added when the company has none by that name. */
async function bankChargesHead(ctx: CompanyContext) {
  await ensureGeneralExpenseHeads(ctx.company.id);
  const head = await ctx.db.expenseHead.findFirst({
    where: { name: { equals: BANK_CHARGES, mode: "insensitive" }, isProductionCost: false },
  });
  if (head && !head.isActive) {
    throw new AppError(
      "VALIDATION",
      `The "${head.name}" expense head is archived. Restore it under Expense heads first.`,
    );
  }
  if (head) return head;
  const acc = await ensureControlAccounts(ctx.company.id);
  return ctx.db.expenseHead.create({
    data: {
      companyId: ctx.company.id,
      name: BANK_CHARGES,
      category: "OTHER",
      isProductionCost: false,
      ledgerAccountId: acc.FINANCE_COST,
    },
  });
}

/**
 * Bank charge: a fee the bank or wallet took (SMS alerts, a cheque book, a
 * transfer fee), recorded as an expense under "Bank Charges", paid from that
 * account. It shows in the Expenses list and in Profit and loss under Finance costs.
 */
export async function recordBankCharge(ctx: CompanyContext, raw: unknown, meta?: RequestMeta) {
  assertCanPayMoney(ctx, "Only Accounts can record bank charges.");
  const input = bankChargeSchema.parse(raw);
  const account = await moneyAccount(ctx, input.accountId, ["BANK", "MOBILE_WALLET"]);
  const head = await bankChargesHead(ctx);
  const expense = await createExpense(
    ctx,
    {
      headId: head.id,
      amount: input.amount,
      date: input.date,
      paymentType: "CASH_BANK",
      method: account.method,
      accountId: account.id,
      purpose: input.notes ?? null,
    },
    meta,
  );
  return { id: expense.id, number: expense.number, account: account.name };
}
