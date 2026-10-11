/*
 * A project's target grid: the pieces to make of each SKU (a colour and size of
 * a style). "Start production" on a sales order fills it from the order's lines,
 * and on a proforma from its quotation's items; a proforma advance that starts a
 * project on its own copies it too when every piece finds its SKU.
 */

export type TargetLine = { variantId: string; quantity: number };

/** Pieces per SKU, adding up lines that repeat one; lines of 0 or less are left out. */
export function sumTargets(lines: readonly TargetLine[]) {
  const sums = new Map<string, number>();
  for (const line of lines) {
    if (line.quantity > 0)
      sums.set(line.variantId, (sums.get(line.variantId) ?? 0) + line.quantity);
  }
  return sums;
}

/** What is left to make: each SKU's pieces less those another project already makes. */
export function lessTargets(want: ReadonlyMap<string, number>, made: ReadonlyMap<string, number>) {
  const left = new Map<string, number>();
  for (const [variantId, quantity] of want) {
    const rest = quantity - (made.get(variantId) ?? 0);
    if (rest > 0) left.set(variantId, rest);
  }
  return left;
}

export const targetTotal = (targets: ReadonlyMap<string, number>) =>
  [...targets.values()].reduce((s, q) => s + q, 0);

type QuoteItem = {
  styleId: string | null;
  description: string;
  colorNote: string | null;
  sizeBreakdown: unknown;
  quantity: number;
};
type StyleSku = { id: string; styleId: string; color: { name: string }; size: { name: string } };

/** Why a quotation item's pieces could not go on the grid. */
export type UnplacedReason = "NO_STYLE" | "NO_SKUS" | "NO_COLOUR" | "NO_SIZES";

const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

/** The item's colour among its style's: the only one, or the one its colour note names. */
function colourOf(colours: string[], note: string | null) {
  if (colours.length === 1) return colours[0]!;
  if (!note?.trim()) return null;
  const exact = colours.filter((c) => same(c, note));
  if (exact.length === 1) return exact[0]!;
  const named = colours.filter((c) => note.toLowerCase().includes(c.trim().toLowerCase()));
  return named.length === 1 ? named[0]! : null;
}

/** Pieces per size from a quotation item's breakdown ({ "S": 20, "M": 40 }), or null. */
function sizesOf(breakdown: unknown): Array<[string, number]> | null {
  if (!breakdown || typeof breakdown !== "object" || Array.isArray(breakdown)) return null;
  const sizes = Object.entries(breakdown as Record<string, unknown>).filter(
    (entry): entry is [string, number] =>
      typeof entry[1] === "number" && Number.isInteger(entry[1]) && entry[1] > 0,
  );
  return sizes.length > 0 ? sizes : null;
}

/**
 * Puts a quotation's items on their styles' SKUs. An item finds its colour (the
 * style's only one, or the one its colour note names) and its sizes (from its
 * size breakdown, or the colour's only size); an item that cannot, or has no
 * style (a custom item), is listed as unplaced with why (and its style, when it
 * has one). An item is placed whole or not at all.
 */
export function quotationTargets(items: readonly QuoteItem[], skus: readonly StyleSku[]) {
  const placed: TargetLine[] = [];
  const unplaced: Array<{
    description: string;
    quantity: number;
    styleId: string | null;
    reason: UnplacedReason;
  }> = [];
  for (const item of items) {
    if (item.quantity <= 0) continue;
    const miss = (reason: UnplacedReason) =>
      unplaced.push({
        description: item.description,
        quantity: item.quantity,
        styleId: item.styleId ?? null,
        reason,
      });
    if (!item.styleId) {
      miss("NO_STYLE");
      continue;
    }
    const ofStyle = skus.filter((v) => v.styleId === item.styleId);
    if (ofStyle.length === 0) {
      miss("NO_SKUS");
      continue;
    }
    const colour = colourOf([...new Set(ofStyle.map((v) => v.color.name))], item.colorNote);
    if (!colour) {
      miss("NO_COLOUR");
      continue;
    }
    const inColour = ofStyle.filter((v) => same(v.color.name, colour));
    const sizes =
      sizesOf(item.sizeBreakdown) ??
      (inColour.length === 1
        ? [[inColour[0]!.size.name, item.quantity] as [string, number]]
        : null);
    const lines = sizes?.map(([size, quantity]) => ({
      variantId: inColour.find((v) => same(v.size.name, size))?.id,
      quantity,
    }));
    if (!lines || lines.some((l) => !l.variantId)) {
      miss("NO_SIZES");
      continue;
    }
    for (const line of lines) placed.push({ variantId: line.variantId!, quantity: line.quantity });
  }
  return { targets: sumTargets(placed), unplaced };
}
