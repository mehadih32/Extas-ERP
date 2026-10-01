import type { AccountSubType, AccountType } from "@prisma/client";

import type { Db } from "@/lib/db-types";
import { prisma } from "@/lib/prisma";

/**
 * The few ledger accounts other modules post to before the full Accounts module
 * (chart of accounts) exists. Codes follow a simple 4-digit chart:
 * 1xxx assets, 2xxx liabilities, 3xxx equity, 4xxx income, 5xxx+ expenses.
 */
export const CONTROL_ACCOUNTS = {
  RECEIVABLE: {
    code: "1200",
    name: "Accounts Receivable (Buyers)",
    type: "ASSET",
    subType: "ACCOUNTS_RECEIVABLE",
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
  OPENING_EQUITY: {
    code: "3900",
    name: "Opening Balance Equity",
    type: "EQUITY",
    subType: "RETAINED_EARNINGS",
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
  const ids = {} as Record<ControlAccountKey, string>;
  for (const [key, acc] of Object.entries(CONTROL_ACCOUNTS) as Array<
    [ControlAccountKey, (typeof CONTROL_ACCOUNTS)[ControlAccountKey]]
  >) {
    const row = await db.ledgerAccount.upsert({
      where: { companyId_code: { companyId, code: acc.code } },
      create: { companyId, ...acc, isSystem: true },
      update: {},
      select: { id: true },
    });
    ids[key] = row.id;
  }
  return ids;
}
