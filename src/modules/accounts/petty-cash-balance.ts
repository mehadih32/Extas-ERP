import type { PettyCashBox, Prisma } from "@prisma/client";

import type { Db } from "@/lib/db-types";
import { AppError } from "@/lib/errors";
import { prisma } from "@/lib/prisma";
import { lockRow } from "@/lib/row-lock";
import { rawBalance } from "@/modules/accounts/balances";
import type { PermissionKey } from "@/modules/rbac/permissions";

/*
 * What is in a petty cash box, and the check that keeps it from going below
 * zero: a cost recorded from it (the expense service), money taken back out
 * of it (a transfer) or any other entry crediting it (journal.service.ts) is
 * never more than the box holds.
 */

/** What is in the box now. */
export function boxBalance(
  companyId: string,
  box: Pick<PettyCashBox, "ledgerAccountId">,
  db: Db = prisma,
) {
  return rawBalance(companyId, box.ledgerAccountId, {}, db);
}

/** Locks the box and refuses taking out more than is in it. */
export async function assertBoxCovers(
  tx: Db,
  companyId: string,
  box: Pick<PettyCashBox, "id" | "name" | "ledgerAccountId">,
  amount: Prisma.Decimal,
  /** What the person should do instead, after "<box> has 500.00 in it." */
  advice = "Top it up first, or pay from another account.",
) {
  await lockRow(tx, "PettyCashBox", box.id);
  const balance = await boxBalance(companyId, box, tx);
  if (amount.gt(balance)) {
    throw new AppError("VALIDATION", `${box.name} has ${balance.toFixed(2)} in it. ${advice}`, {
      amount: [`At most ${balance.toFixed(2)}.`],
    });
  }
}

/**
 * What to do when a cost is more than the box holds: Accounts (who top boxes up)
 * top it up; the holder asks Accounts to.
 */
export function topUpAdvice(ctx: { can: (key: PermissionKey) => boolean }) {
  return ctx.can("accounts.payments.record")
    ? "Top it up first (“Top up” on the box), or pay from another account."
    : "Ask Accounts to top it up first.";
}
