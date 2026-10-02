import type { PaymentMethod } from "@prisma/client";

import type { Db } from "@/lib/db-types";
import { AppError } from "@/lib/errors";
import { ensureControlAccounts } from "@/modules/accounts/control-accounts";

const CASH_SUBTYPES = ["CASH", "BANK", "MOBILE_WALLET"] as const;

/**
 * The cash / bank / wallet ledger account money moves through: the one chosen,
 * or the default for the payment method (bKash/Nagad/Rocket -> wallets, bank
 * transfer/cheque/card -> bank, anything else -> cash in hand).
 */
export async function cashAccountFor(
  db: Db,
  companyId: string,
  method: PaymentMethod,
  accountId?: string,
) {
  if (accountId) {
    const account = await db.ledgerAccount.findFirst({
      where: { id: accountId, companyId, isActive: true, subType: { in: [...CASH_SUBTYPES] } },
    });
    if (!account) throw new AppError("VALIDATION", "Choose a cash, bank or mobile wallet account.");
    return account.id;
  }
  const acc = await ensureControlAccounts(companyId, db);
  if (method === "BKASH" || method === "NAGAD" || method === "ROCKET") return acc.MOBILE_WALLET;
  if (method === "BANK_TRANSFER" || method === "CHEQUE" || method === "CARD") return acc.BANK;
  return acc.CASH;
}
