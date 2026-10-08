/*
 * The stock count sheet's arithmetic: what was typed in each SKU's box, what a
 * count changes against the pieces on the shelf, and what opening stock adds.
 * Plain values in and out, so the screen and the tests share it.
 */

/** Pieces a box may hold: whole numbers up to a million, as the server allows. */
export const MAX_PIECES = 1_000_000;

export type TypedPieces =
  { kind: "empty" } | { kind: "pieces"; value: number } | { kind: "invalid" };

/** What a box holds: nothing yet, whole pieces, or something that is not a piece count. */
export function readPieces(text: string | undefined): TypedPieces {
  const value = (text ?? "").trim();
  if (value === "") return { kind: "empty" };
  if (!/^\d{1,7}$/.test(value)) return { kind: "invalid" };
  const pieces = Number(value);
  return pieces <= MAX_PIECES ? { kind: "pieces", value: pieces } : { kind: "invalid" };
}

/** One SKU on the sheet, with its pieces on the shelf when the sheet was loaded. */
export type SheetCell = { variantId: string; sku: string; onShelf: number };

export type CountLine = SheetCell & { counted: number; difference: number };
export type OpeningLine = SheetCell & { quantity: number };

/** The boxes holding something that is not a piece count, by SKU. */
function invalidSkus(cells: SheetCell[], typed: Record<string, string>): string[] {
  return cells.filter((c) => readPieces(typed[c.variantId]).kind === "invalid").map((c) => c.sku);
}

/** A count: each SKU with pieces typed, and how far that is from the shelf. */
export function countLines(
  cells: SheetCell[],
  typed: Record<string, string>,
): { lines: CountLine[]; invalid: string[] } {
  const lines = cells.flatMap((cell) => {
    const read = readPieces(typed[cell.variantId]);
    if (read.kind !== "pieces") return [];
    return [{ ...cell, counted: read.value, difference: read.value - cell.onShelf }];
  });
  return { lines, invalid: invalidSkus(cells, typed) };
}

/** What a count would change: SKUs counted, SKUs that differ, pieces found and missing. */
export function countTotals(lines: CountLine[]) {
  return {
    counted: lines.length,
    changed: lines.filter((l) => l.difference !== 0).length,
    added: lines.reduce((sum, l) => sum + Math.max(l.difference, 0), 0),
    removed: lines.reduce((sum, l) => sum + Math.max(-l.difference, 0), 0),
  };
}

/** Opening stock: each SKU with pieces to add (a 0 adds nothing and is left out). */
export function openingLines(
  cells: SheetCell[],
  typed: Record<string, string>,
): { lines: OpeningLine[]; invalid: string[] } {
  const lines = cells.flatMap((cell) => {
    const read = readPieces(typed[cell.variantId]);
    if (read.kind !== "pieces" || read.value === 0) return [];
    return [{ ...cell, quantity: read.value }];
  });
  return { lines, invalid: invalidSkus(cells, typed) };
}

/** Each box filled with the pieces on the shelf, to count only the SKUs that differ. */
export function shelfNumbers(cells: SheetCell[]): Record<string, string> {
  return Object.fromEntries(cells.map((c) => [c.variantId, String(c.onShelf)]));
}

// --- The count screen's choices, kept in the address bar ------------------------------
// "/products/stock-count?style=…&warehouse=…&grade=b&mode=opening"; A-grade and
// counting are the defaults and stay out of the address.

export type CountMode = "COUNT" | "OPENING";

export type CountView = {
  style?: string;
  warehouse?: string;
  grade: "A_GRADE" | "B_GRADE";
  mode: CountMode;
};

export function countViewFrom(params: Record<string, string | string[] | undefined>): CountView {
  const one = (key: string) => {
    const value = params[key];
    return typeof value === "string" && /^[a-z0-9]{1,64}$/i.test(value) ? value : undefined;
  };
  return {
    style: one("style"),
    warehouse: one("warehouse"),
    grade: params.grade === "b" ? "B_GRADE" : "A_GRADE",
    mode: params.mode === "opening" ? "OPENING" : "COUNT",
  };
}

export function countSearch(view: CountView): string {
  const params = new URLSearchParams();
  if (view.style) params.set("style", view.style);
  if (view.warehouse) params.set("warehouse", view.warehouse);
  if (view.grade === "B_GRADE") params.set("grade", "b");
  if (view.mode === "OPENING") params.set("mode", "opening");
  const query = params.toString();
  return query ? `?${query}` : "";
}
