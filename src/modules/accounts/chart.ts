import {
  type AccountSubType,
  type AccountType,
  type ExpenseCategory,
  Prisma,
} from "@prisma/client";

import type { Db } from "@/lib/db-types";
import { AppError } from "@/lib/errors";
import { prisma } from "@/lib/prisma";

/*
 * Chart of accounts rules
 * -----------------------
 * Each sub-type belongs to one account type, and new accounts are numbered from
 * the sub-type's anchor upwards inside the type's block (assets 1000-1999,
 * liabilities 2000-2999, equity 3000-3999, income 4000-4999, expenses 5000-9999).
 * Balances are shown in the account's natural direction: assets and expenses
 * grow with debits, liabilities, equity and income with credits.
 */

export const SUBTYPE_TYPE: Record<AccountSubType, AccountType> = {
  CASH: "ASSET",
  BANK: "ASSET",
  MOBILE_WALLET: "ASSET",
  ACCOUNTS_RECEIVABLE: "ASSET",
  INVENTORY: "ASSET",
  RAW_MATERIALS: "ASSET",
  PENDING_RETURNS: "ASSET",
  ADVANCE_TO_EMPLOYEE: "ASSET",
  OTHER_CURRENT_ASSET: "ASSET",
  FIXED_ASSET: "ASSET",
  ACCUMULATED_DEPRECIATION: "ASSET",
  ACCOUNTS_PAYABLE: "LIABILITY",
  CUSTOMER_ADVANCE: "LIABILITY",
  LOAN: "LIABILITY",
  INVESTOR: "LIABILITY",
  OTHER_LIABILITY: "LIABILITY",
  CAPITAL: "EQUITY",
  RETAINED_EARNINGS: "EQUITY",
  DRAWINGS: "EQUITY",
  SALES: "INCOME",
  OTHER_INCOME: "INCOME",
  COGS: "EXPENSE",
  INVENTORY_LOSS: "EXPENSE",
  OPERATING_EXPENSE: "EXPENSE",
  PAYROLL_EXPENSE: "EXPENSE",
  MARKETING_EXPENSE: "EXPENSE",
  COURIER_EXPENSE: "EXPENSE",
  FINANCE_COST: "EXPENSE",
};

const CODE_ANCHOR: Record<AccountSubType, number> = {
  CASH: 1000,
  MOBILE_WALLET: 1050,
  BANK: 1100,
  ACCOUNTS_RECEIVABLE: 1200,
  ADVANCE_TO_EMPLOYEE: 1250,
  INVENTORY: 1300,
  OTHER_CURRENT_ASSET: 1350,
  RAW_MATERIALS: 1400,
  PENDING_RETURNS: 1450,
  FIXED_ASSET: 1500,
  ACCUMULATED_DEPRECIATION: 1590,
  ACCOUNTS_PAYABLE: 2100,
  CUSTOMER_ADVANCE: 2150,
  OTHER_LIABILITY: 2200,
  LOAN: 2300,
  INVESTOR: 2400,
  CAPITAL: 3000,
  DRAWINGS: 3100,
  RETAINED_EARNINGS: 3800,
  SALES: 4000,
  OTHER_INCOME: 4100,
  COGS: 5000,
  INVENTORY_LOSS: 5100,
  OPERATING_EXPENSE: 6000,
  PAYROLL_EXPENSE: 6200,
  MARKETING_EXPENSE: 6300,
  COURIER_EXPENSE: 6400,
  FINANCE_COST: 7000,
};

const TYPE_BLOCK: Record<AccountType, [number, number]> = {
  ASSET: [1000, 1999],
  LIABILITY: [2000, 2999],
  EQUITY: [3000, 3999],
  INCOME: [4000, 4999],
  EXPENSE: [5000, 9999],
};

export const CASH_SUBTYPES = ["CASH", "BANK", "MOBILE_WALLET"] as const satisfies AccountSubType[];

export function isCashSubType(subType: AccountSubType): boolean {
  return (CASH_SUBTYPES as readonly AccountSubType[]).includes(subType);
}

/** Party-tagged accounts: every line on them names a buyer or supplier. */
export const PARTY_SUBTYPES = [
  "ACCOUNTS_RECEIVABLE",
  "ACCOUNTS_PAYABLE",
  "CUSTOMER_ADVANCE",
] as const satisfies AccountSubType[];

export function isPartySubType(subType: AccountSubType): boolean {
  return (PARTY_SUBTYPES as readonly AccountSubType[]).includes(subType);
}

/** Debit-natured types grow with debits; the rest with credits. */
export function isDebitNature(type: AccountType): boolean {
  return type === "ASSET" || type === "EXPENSE";
}

/** Balance in the account's natural direction (positive = its normal side). */
export function naturalBalance(
  type: AccountType,
  debit: Prisma.Decimal.Value,
  credit: Prisma.Decimal.Value,
): Prisma.Decimal {
  const d = new Prisma.Decimal(debit);
  const c = new Prisma.Decimal(credit);
  return isDebitNature(type) ? d.minus(c) : c.minus(d);
}

/** A code typed by the user must sit in its type's block: 1xxx assets, 2xxx liabilities... */
export function assertCodeFitsType(code: string, type: AccountType) {
  const [min, max] = TYPE_BLOCK[type];
  const n = Number(code);
  if (!/^\d{4}$/.test(code) || n < min || n > max) {
    throw new AppError(
      "VALIDATION",
      `${type.toLowerCase()} account codes run from ${min} to ${max}.`,
      { code: [`Use a 4-digit code from ${min} to ${max}.`] },
    );
  }
}

/** The first free code from the sub-type's anchor upwards, inside its type's block. */
export async function nextAccountCode(
  db: Db,
  companyId: string,
  subType: AccountSubType,
): Promise<string> {
  const [, max] = TYPE_BLOCK[SUBTYPE_TYPE[subType]];
  const taken = new Set(
    (await db.ledgerAccount.findMany({ where: { companyId }, select: { code: true } })).map(
      (a) => a.code,
    ),
  );
  for (let n = CODE_ANCHOR[subType]; n <= max; n++) {
    if (!taken.has(String(n))) return String(n);
  }
  throw new AppError("CONFLICT", "There is no free account code left in this range.");
}

/**
 * Creates a ledger account with the next free code for its sub-type. Runs inside a
 * transaction and holds a per-company lock, so two accounts never get one code.
 */
export async function createNumberedAccount(
  tx: Prisma.TransactionClient,
  companyId: string,
  data: { name: string; subType: AccountSubType; isSystem?: boolean },
) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`ledger-code:${companyId}`}))`;
  return tx.ledgerAccount.create({
    data: {
      companyId,
      code: await nextAccountCode(tx, companyId, data.subType),
      name: data.name,
      type: SUBTYPE_TYPE[data.subType],
      subType: data.subType,
      isSystem: data.isSystem ?? false,
    },
  });
}

/**
 * Where general (non-production) expenses land in the books, by category. A head
 * can point at any other expense account instead.
 */
export const EXPENSE_CATEGORY_ACCOUNTS = {
  RENT: { code: "6000", name: "Rent", subType: "OPERATING_EXPENSE" },
  UTILITIES: { code: "6100", name: "Utilities", subType: "OPERATING_EXPENSE" },
  SALARY: { code: "6200", name: "Salaries & Wages", subType: "PAYROLL_EXPENSE" },
  MARKETING: { code: "6300", name: "Marketing & Advertising", subType: "MARKETING_EXPENSE" },
  COURIER: { code: "6400", name: "Courier & Delivery", subType: "COURIER_EXPENSE" },
  OFFICE: { code: "6500", name: "Office Expenses", subType: "OPERATING_EXPENSE" },
  MAINTENANCE: { code: "6600", name: "Repairs & Maintenance", subType: "OPERATING_EXPENSE" },
  CONVEYANCE: { code: "6700", name: "Conveyance & Food", subType: "OPERATING_EXPENSE" },
  FOOD: { code: "6700", name: "Conveyance & Food", subType: "OPERATING_EXPENSE" },
  OTHER: { code: "6900", name: "Other Expenses", subType: "OPERATING_EXPENSE" },
} as const satisfies Partial<
  Record<ExpenseCategory, { code: string; name: string; subType: AccountSubType }>
>;

export type GeneralExpenseCategory = keyof typeof EXPENSE_CATEGORY_ACCOUNTS;

export const GENERAL_EXPENSE_CATEGORIES = Object.keys(
  EXPENSE_CATEGORY_ACCOUNTS,
) as GeneralExpenseCategory[];

/** Creates the expense-category accounts if missing; returns their ids by code. */
export async function ensureExpenseCategoryAccounts(
  companyId: string,
  db: Db = prisma,
): Promise<Map<string, string>> {
  const wanted = new Map(Object.values(EXPENSE_CATEGORY_ACCOUNTS).map((a) => [a.code, a] as const));
  const existing = await db.ledgerAccount.findMany({
    where: { companyId, code: { in: [...wanted.keys()] } },
    select: { id: true, code: true },
  });
  const ids = new Map(existing.map((a) => [a.code, a.id]));
  for (const [code, acc] of wanted) {
    if (ids.has(code)) continue;
    const created = await db.ledgerAccount.upsert({
      where: { companyId_code: { companyId, code } },
      create: {
        companyId,
        code,
        name: acc.name,
        type: "EXPENSE",
        subType: acc.subType,
        isSystem: true,
      },
      update: {},
      select: { id: true },
    });
    ids.set(code, created.id);
  }
  return ids;
}
