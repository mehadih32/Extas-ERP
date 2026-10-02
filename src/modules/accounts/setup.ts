import type { Db } from "@/lib/db-types";
import { prisma } from "@/lib/prisma";
import { ensureExpenseCategoryAccounts } from "@/modules/accounts/chart";
import { ensureControlAccounts } from "@/modules/accounts/control-accounts";
import { ensureGeneralExpenseHeads } from "@/modules/expenses/expense.service";

/**
 * Gives a company its starting chart of accounts (control accounts and the
 * expense accounts 6000-6900) and the default expense heads. Safe to repeat.
 */
export async function ensureAccountsSetup(companyId: string, db: Db = prisma) {
  await ensureControlAccounts(companyId, db);
  await ensureExpenseCategoryAccounts(companyId, db);
  await ensureGeneralExpenseHeads(companyId, db);
}
