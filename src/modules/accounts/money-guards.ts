import { AppError } from "@/lib/errors";
import type { CompanyContext } from "@/modules/auth/context";

/*
 * Money in and money out are kept apart from selling and producing: by default
 * only Accounts and Super Admin hold these two permissions. Services call these
 * guards themselves, so no caller can skip them.
 */

export function assertCanReceiveMoney(ctx: CompanyContext, message?: string) {
  if (!ctx.can("accounts.receipts.record")) {
    throw new AppError("FORBIDDEN", message ?? "Only Accounts can record money received.");
  }
}

export function assertCanPayMoney(ctx: CompanyContext, message?: string) {
  if (!ctx.can("accounts.payments.record")) {
    throw new AppError("FORBIDDEN", message ?? "Only Accounts can record money paid out.");
  }
}

/** Journal postings, assets, capital and write-offs are accounting decisions. */
export function assertCanManageAccounts(ctx: CompanyContext, message?: string) {
  if (!ctx.can("accounts.manage")) {
    throw new AppError("FORBIDDEN", message ?? "Only Accounts can do this.");
  }
}

/** Seeing the books: balances, statements, reports. */
export function assertCanViewAccounts(ctx: CompanyContext) {
  if (!ctx.can("accounts.view")) {
    throw new AppError("FORBIDDEN", "You do not have permission to see the accounts.");
  }
}
