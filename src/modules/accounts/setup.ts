import type { Db } from "@/lib/db-types";
import { prisma } from "@/lib/prisma";
import { ensureExpenseCategoryAccounts } from "@/modules/accounts/chart";
import { ensureControlAccounts } from "@/modules/accounts/control-accounts";
import { ensureB2bAcquisitionHeads } from "@/modules/business/b2b.service";
import { ensureGeneralExpenseHeads } from "@/modules/expenses/expense.service";

/**
 * Gives a company its starting chart of accounts (control accounts and the
 * expense accounts 6000-6900), the default expense heads and the "Customer
 * acquisition (B2B)" sub-heads. Safe to repeat.
 */
export async function ensureAccountsSetup(companyId: string, db: Db = prisma) {
  await ensureControlAccounts(companyId, db);
  await ensureExpenseCategoryAccounts(companyId, db);
  await ensureGeneralExpenseHeads(companyId, db);
  await ensureB2bAcquisitionHeads(companyId, db);
}
