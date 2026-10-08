import type { BadStockSource, StockGrade, StockMovementType } from "@prisma/client";

import { formatCount, groupAmount } from "@/lib/display";

/*
 * Words and figures for the Products screens: plain strings in, plain strings
 * out, so the browser and the tests share them.
 */

export const GRADE_LABELS: Record<StockGrade, string> = {
  A_GRADE: "A-grade",
  B_GRADE: "B-grade",
};

/** What each kind of stock movement means, as the stock history says it. */
export const MOVEMENT_LABELS: Record<StockMovementType, string> = {
  OPENING: "Opening stock",
  PRODUCTION_IN: "From production",
  PRODUCTION_REVERSAL: "Production delivery undone",
  PURCHASE_IN: "Bought in",
  SALE_OUT: "Sold",
  RETURN_RESTOCK: "Returned to stock",
  BAD_STOCK_OUT: "Moved to bad stock",
  ADJUSTMENT: "Stock count correction",
  TRANSFER_IN: "Transfer in",
  TRANSFER_OUT: "Transfer out",
};

export const BAD_STOCK_SOURCE_LABELS: Record<BadStockSource, string> = {
  WAREHOUSE_DAMAGE: "Damaged in the warehouse",
  PRODUCTION_REJECT: "Production reject",
  RETURN_QC: "Failed the returns check",
  MANUAL: "Other",
};

/** The reasons a person can pick; failed returns arrive from the returns check itself. */
export const BAD_STOCK_SOURCE_CHOICES: ReadonlyArray<{
  value: Exclude<BadStockSource, "RETURN_QC">;
  label: string;
}> = [
  { value: "WAREHOUSE_DAMAGE", label: BAD_STOCK_SOURCE_LABELS.WAREHOUSE_DAMAGE },
  { value: "PRODUCTION_REJECT", label: BAD_STOCK_SOURCE_LABELS.PRODUCTION_REJECT },
  { value: "MANUAL", label: BAD_STOCK_SOURCE_LABELS.MANUAL },
];

/** "1 piece", "1,240 pieces". */
export function pieces(count: number, currency: string): string {
  return `${formatCount(count, currency)} ${Math.abs(count) === 1 ? "piece" : "pieces"}`;
}

/** "+3", "−2" (a real minus sign) or "0": a change in pieces. */
export function signed(count: number, currency: string): string {
  if (count > 0) return `+${formatCount(count, currency)}`;
  if (count < 0) return `−${formatCount(-count, currency)}`;
  return "0";
}

/** "BDT 1,450.00" from "1450.00". */
export function money(fixed: string, currency: string): string {
  return `${currency} ${groupAmount(fixed, currency)}`;
}

/** "Navy / XL": a SKU's colour and size. */
export function variantName(sku: { color: { name: string }; size: { name: string } }): string {
  return `${sku.color.name} / ${sku.size.name}`;
}

/** "Tops › Polos": where a category sits. */
export function categoryPath(path: readonly string[]): string {
  return path.join(" › ");
}
