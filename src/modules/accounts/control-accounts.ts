import type { AccountSubType, AccountType } from "@prisma/client";

import type { Db } from "@/lib/db-types";
import { prisma } from "@/lib/prisma";

/**
 * The few ledger accounts other modules post to before the full Accounts module
 * (chart of accounts) exists. Codes follow a simple 4-digit chart:
 * 1xxx assets, 2xxx liabilities, 3xxx equity, 4xxx income, 5xxx+ expenses.
 */
export const CONTROL_ACCOUNTS = {
  CASH: { code: "1000", name: "Cash in Hand", type: "ASSET", subType: "CASH" },
  MOBILE_WALLET: {
    code: "1050",
    name: "Mobile Wallets (bKash / Nagad / Rocket)",
    type: "ASSET",
    subType: "MOBILE_WALLET",
  },
  BANK: { code: "1100", name: "Bank", type: "ASSET", subType: "BANK" },
  RECEIVABLE: {
    code: "1200",
    name: "Accounts Receivable (Buyers)",
    type: "ASSET",
    subType: "ACCOUNTS_RECEIVABLE",
  },
  INVENTORY: {
    code: "1300",
    name: "Finished Goods Inventory",
    type: "ASSET",
    subType: "INVENTORY",
  },
  WORK_IN_PROGRESS: {
    code: "1350",
    name: "Work in Progress (Production)",
    type: "ASSET",
    subType: "OTHER_CURRENT_ASSET",
  },
  PAYABLE: {
    code: "2100",
    name: "Accounts Payable (Suppliers)",
    type: "LIABILITY",
    subType: "ACCOUNTS_PAYABLE",
  },
  CUSTOMER_ADVANCE: {
    code: "2150",
    name: "Customer Advances",
    type: "LIABILITY",
    subType: "CUSTOMER_ADVANCE",
  },
  VAT_PAYABLE: { code: "2200", name: "VAT Payable", type: "LIABILITY", subType: "OTHER_LIABILITY" },
  OPENING_EQUITY: {
    code: "3900",
    name: "Opening Balance Equity",
    type: "EQUITY",
    subType: "RETAINED_EARNINGS",
  },
  SALES: { code: "4000", name: "Sales", type: "INCOME", subType: "SALES" },
  DELIVERY_INCOME: {
    code: "4100",
    name: "Delivery Charges Collected",
    type: "INCOME",
    subType: "OTHER_INCOME",
  },
  COGS: { code: "5000", name: "Cost of Goods Sold", type: "EXPENSE", subType: "COGS" },
  PRODUCTION_LOSS: {
    code: "5100",
    name: "Production & Inventory Losses",
    type: "EXPENSE",
    subType: "INVENTORY_LOSS",
  },
} as const satisfies Record<
  string,
  { code: string; name: string; type: AccountType; subType: AccountSubType }
>;

export type ControlAccountKey = keyof typeof CONTROL_ACCOUNTS;

/** Sub-types whose lines make up a buyer's / supplier's running balance. */
export const PARTY_BALANCE_SUBTYPES: AccountSubType[] = [
  "ACCOUNTS_RECEIVABLE",
  "ACCOUNTS_PAYABLE",
  "CUSTOMER_ADVANCE",
];

/** Creates the control accounts if missing and returns their ids. */
export async function ensureControlAccounts(
  companyId: string,
  db: Db = prisma,
): Promise<Record<ControlAccountKey, string>> {
  const entries = Object.entries(CONTROL_ACCOUNTS) as Array<
    [ControlAccountKey, (typeof CONTROL_ACCOUNTS)[ControlAccountKey]]
  >;
  const existing = await db.ledgerAccount.findMany({
    where: { companyId, code: { in: entries.map(([, acc]) => acc.code) } },
    select: { id: true, code: true },
  });
  const byCode = new Map(existing.map((a) => [a.code, a.id]));
  const ids = {} as Record<ControlAccountKey, string>;
  for (const [key, acc] of entries) {
    ids[key] =
      byCode.get(acc.code) ??
      (
        await db.ledgerAccount.upsert({
          where: { companyId_code: { companyId, code: acc.code } },
          create: { companyId, ...acc, isSystem: true },
          update: {},
          select: { id: true },
        })
      ).id;
  }
  return ids;
}
