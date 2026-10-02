import type { CompanyContext } from "@/modules/auth/context";

/*
 * Who sees which dashboard and report figures. Route handlers check the entry
 * permission; these decide which money columns a reader gets.
 */

type Can = Pick<CompanyContext, "can">;

/** Business-wide money: stock value, assets, loans, profit, costs and margins. */
export function canSeeFinancials(ctx: Can): boolean {
  return ctx.can("dashboard.financials") || ctx.can("accounts.view");
}

/** What goods sold for: sales staff and anyone who sees the financials. */
export function canSeeSalesAmounts(ctx: Can): boolean {
  return ctx.can("sales.view") || canSeeFinancials(ctx);
}

/** Stock quantities and alerts. */
export function canSeeStock(ctx: Can): boolean {
  return ctx.can("dashboard.view") || ctx.can("inventory.view");
}
