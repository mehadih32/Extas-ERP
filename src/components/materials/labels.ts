import type {
  MaterialIssueKind,
  MeasurementUnit,
  PurchaseOrderStatus,
  RawMaterialKind,
  RawMaterialMovementType,
} from "@prisma/client";

import { groupDigits, usesLakhGrouping } from "@/lib/display";

/*
 * Words and addresses the Raw materials screens share, for the server and the
 * browser alike.
 */

export const KIND_LABELS: Record<RawMaterialKind, string> = {
  FABRIC: "Fabric",
  TRIM: "Trims",
  ACCESSORY: "Accessories",
  PACKAGING: "Packaging",
  OTHER: "Other",
};

export const KINDS: readonly RawMaterialKind[] = [
  "FABRIC",
  "TRIM",
  "ACCESSORY",
  "PACKAGING",
  "OTHER",
];

export const KIND_HINTS: Record<RawMaterialKind, string> = {
  FABRIC: "Knit or woven fabric, rib, collar. Codes start FAB-.",
  TRIM: "Buttons, zips, labels, thread. Codes start TRM-.",
  ACCESSORY: "Elastic, interlining, hangtags. Codes start ACC-.",
  PACKAGING: "Poly bags, cartons, tissue, stickers. Codes start PKG-.",
  OTHER: "Anything else the factory uses. Codes start RM-.",
};

/** Short unit names after a quantity: "120.5 m". */
export const UNIT_LABELS: Record<MeasurementUnit, string> = {
  PCS: "pcs",
  METER: "m",
  YARD: "yd",
  KG: "kg",
  GRAM: "g",
  ROLL: "rolls",
  DOZEN: "dozen",
  GROSS: "gross",
  CONE: "cones",
  SET: "sets",
};

/** Unit names to choose from. */
export const UNIT_NAMES: Record<MeasurementUnit, string> = {
  PCS: "Pieces (pcs)",
  METER: "Metres (m)",
  YARD: "Yards (yd)",
  KG: "Kilograms (kg)",
  GRAM: "Grams (g)",
  ROLL: "Rolls",
  DOZEN: "Dozens",
  GROSS: "Gross (144 pieces)",
  CONE: "Cones",
  SET: "Sets",
};

export const UNITS: readonly MeasurementUnit[] = [
  "METER",
  "YARD",
  "KG",
  "GRAM",
  "PCS",
  "DOZEN",
  "GROSS",
  "ROLL",
  "CONE",
  "SET",
];

/** Units counted whole (no half cones or 2.5 pieces); the server refuses fractions too. */
export const WHOLE_UNITS: readonly MeasurementUnit[] = ["PCS", "ROLL", "CONE", "SET"];

export const MOVEMENT_LABELS: Record<RawMaterialMovementType, string> = {
  OPENING: "Opening stock",
  PURCHASE_IN: "Bought",
  PURCHASE_VOID: "Purchase voided",
  RETURN_TO_SUPPLIER: "Sent back to the supplier",
  SUPPLIER_RETURN_VOID: "Return voided",
  ISSUE_TO_PRODUCTION: "Issued to production",
  RETURN_FROM_PRODUCTION: "Back from production",
  ADJUSTMENT: "Count correction",
  WASTAGE: "Wastage",
  TRANSFER_OUT: "Moved out",
  TRANSFER_IN: "Moved in",
};

export const ORDER_STATUS_LABELS: Record<PurchaseOrderStatus, string> = {
  OPEN: "Open",
  PARTIALLY_RECEIVED: "Part received",
  RECEIVED: "Received",
  CLOSED: "Closed",
  CANCELLED: "Cancelled",
};

export const ORDER_STATUSES: readonly PurchaseOrderStatus[] = [
  "OPEN",
  "PARTIALLY_RECEIVED",
  "RECEIVED",
  "CLOSED",
  "CANCELLED",
];

export const ISSUE_KIND_LABELS: Record<MaterialIssueKind, string> = {
  ISSUE: "Issued",
  RETURN: "Taken back",
};

/**
 * "1,20,000.5 m": a quantity string from the server with its digits grouped
 * as the company's money is (lakh grouping for BDT and INR), and its unit.
 */
export function quantity(text: string, unit: MeasurementUnit, currency: string): string {
  const negative = text.startsWith("-");
  const [whole = "0", fraction] = text.replace(/^-/, "").split(".");
  const grouped = groupDigits(whole, usesLakhGrouping(currency));
  return `${negative ? "−" : ""}${grouped}${fraction ? `.${fraction}` : ""} ${UNIT_LABELS[unit]}`;
}

/** "+120 m" / "−20 m": a stock card movement. */
export function signedQuantity(text: string, unit: MeasurementUnit, currency: string): string {
  return text.startsWith("-")
    ? quantity(text, unit, currency)
    : `+${quantity(text, unit, currency)}`;
}

/** One of a unit, after "per": "per piece", "per m", "per cone". */
export const UNIT_ONE: Record<MeasurementUnit, string> = {
  PCS: "piece",
  METER: "m",
  YARD: "yd",
  KG: "kg",
  GRAM: "g",
  ROLL: "roll",
  DOZEN: "dozen",
  GROSS: "gross",
  CONE: "cone",
  SET: "set",
};

/** A price per unit: "BDT 45.375 per m". */
export function perUnit(price: string, unit: MeasurementUnit, currency: string): string {
  return `${currency} ${price} per ${UNIT_ONE[unit]}`;
}

/** Reads a quantity typed in a form: a number above zero with up to 3 decimals. */
export function readQuantity(
  text: string,
  unit: MeasurementUnit,
  { allowZero = false } = {},
): number | string {
  const value = text.trim().replace(/,/g, "");
  if (!value) return "Enter the quantity.";
  if (!/^\d+(\.\d{1,3})?$/.test(value))
    return "Enter a number like 120 or 120.5 (up to 3 decimals).";
  const n = Number(value);
  if (n > 100_000_000) return "That is more than the store can hold.";
  if (!allowZero && n <= 0) return "Enter more than zero.";
  if (WHOLE_UNITS.includes(unit) && !Number.isInteger(n)) {
    return `${UNIT_LABELS[unit]} are counted whole.`;
  }
  return n;
}

/** Reads a price per unit: up to 4 decimals. */
export function readPrice(text: string): number | string {
  const value = text.trim().replace(/,/g, "");
  if (!value) return "Enter the price per unit.";
  if (!/^\d+(\.\d{1,4})?$/.test(value)) return "Enter a price like 45 or 45.375.";
  const n = Number(value);
  if (n > 100_000_000) return "That price is too high.";
  return n;
}

const enc = encodeURIComponent;
const withQuery = (path: string, params: Record<string, string | undefined>) => {
  const query = new URLSearchParams(
    Object.entries(params).filter((e): e is [string, string] => Boolean(e[1])),
  ).toString();
  return query ? `${path}?${query}` : path;
};

export const materialsHref = {
  stock: "/materials/stock",
  material: (id: string) => `/materials/stock/${enc(id)}`,
  newMaterial: "/materials/stock/new",
  editMaterial: (id: string) => `/materials/stock/${enc(id)}/edit`,
  orders: "/materials/orders",
  order: (id: string) => `/materials/orders/${enc(id)}`,
  newOrder: (from: { material?: string; supplier?: string; project?: string } = {}) =>
    withQuery("/materials/orders/new", from),
  editOrder: (id: string) => `/materials/orders/${enc(id)}/edit`,
  purchases: "/materials/purchases",
  purchase: (id: string) => `/materials/purchases/${enc(id)}`,
  newPurchase: (order?: string) => withQuery("/materials/purchases/new", { order }),
  returns: "/materials/returns",
  supplierReturn: (id: string) => `/materials/returns/${enc(id)}`,
  newReturn: (bill: string) => withQuery("/materials/returns/new", { bill }),
  issues: "/materials/issues",
  issue: (id: string) => `/materials/issues/${enc(id)}`,
  newIssue: (kind: "issue" | "return", project?: string) =>
    withQuery("/materials/issues/new", { kind: kind === "return" ? "return" : undefined, project }),
  supplier: (id: string) => `/parties/suppliers/${enc(id)}`,
  project: (id: string) => `/production/projects/${enc(id)}`,
  file: (id: string) => `/api/files/${enc(id)}`,
};
