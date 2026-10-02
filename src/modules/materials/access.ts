import { AppError } from "@/lib/errors";
import type { CompanyContext } from "@/modules/auth/context";
import type { PermissionKey } from "@/modules/rbac/permissions";

/*
 * Who does what with raw materials (services check these themselves):
 *   materials.view      stock, stock cards, purchase orders, issues (quantities)
 *   materials.manage    the store: add materials, count, wastage, transfers,
 *                       issue to production and take back what comes back
 *   materials.purchase  buying: purchase orders, bills on credit (Due), returns
 *                       to suppliers, opening stock
 *   accounts.payments.record  money paid out (purchases paid now, paying bills)
 * Prices and values are shown to buyers, Production Managers and Accounts only.
 */

export function canSeeMaterialCosts(ctx: CompanyContext) {
  return (
    ctx.can("materials.purchase") ||
    ctx.can("production.manage") ||
    ctx.can("accounts.view") ||
    ctx.can("accounts.payments.record")
  );
}

export function assertCanSeeMaterialCosts(ctx: CompanyContext) {
  if (!canSeeMaterialCosts(ctx)) {
    throw new AppError("FORBIDDEN", "You do not have permission to see raw material prices.");
  }
}

/** Passes when the user holds at least one of the permissions. */
export function assertAnyPermission(
  ctx: CompanyContext,
  permissions: readonly PermissionKey[],
  message: string,
) {
  if (!permissions.some((p) => ctx.can(p))) throw new AppError("FORBIDDEN", message);
}

export function assertCanKeepStore(ctx: CompanyContext) {
  assertAnyPermission(
    ctx,
    ["materials.manage"],
    "Only the store (materials.manage) can change raw material stock.",
  );
}

export function assertCanBuyMaterials(ctx: CompanyContext) {
  assertAnyPermission(
    ctx,
    ["materials.purchase"],
    "You do not have permission to buy raw materials (materials.purchase).",
  );
}

/** Hides a price or value from users who may not see material costs. */
export function costMask(ctx: CompanyContext) {
  const shown = canSeeMaterialCosts(ctx);
  return <T>(value: T): T | null => (shown ? value : null);
}
