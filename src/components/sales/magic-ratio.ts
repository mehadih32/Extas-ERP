import { fillByPacks } from "@/modules/inventory/ratio";

/*
 * Magic Ratio for the order grid: a size ratio such as 1:2:2:1 times a number
 * of sets fills every chosen colour at once (10 sets of 1:2:2:1 is 10, 20, 20
 * and 10 pieces). Pure maths, shared with the stock matrix's Ratio Fill.
 */

/** "1:2:2:1", "1-2-2-1" or "1 2 2 1" as numbers; null unless every part is a whole number. */
export function parseRatio(text: string): number[] | null {
  const parts = text.trim().split(/\s*[:\-/,\s]\s*/);
  if (parts.length === 0 || parts.some((p) => !/^\d{1,3}$/.test(p))) return null;
  const ratio = parts.map(Number);
  return ratio.some((n) => n > 0) ? ratio : null;
}

/** The ratio as people write it: [1, 2, 2, 1] is "1:2:2:1". */
export const ratioText = (ratio: number[]) => ratio.join(":");

/**
 * Pieces for each size (by column) for `sets` sets of `ratio`, or why it does not
 * fit: the ratio needs one number per size of the style.
 */
export function ratioPieces(
  sizes: Array<{ id: string; name: string }>,
  ratio: number[] | null,
  sets: number,
): { pieces: Map<string, number> } | { problem: string } {
  if (!ratio) return { problem: "Type the ratio as numbers, like 1:2:2:1." };
  if (ratio.length !== sizes.length) {
    return {
      problem: `This style has ${sizes.length} size${sizes.length === 1 ? "" : "s"} (${sizes
        .map((s) => s.name)
        .join(
          ", ",
        )}): type ${sizes.length} number${sizes.length === 1 ? "" : "s"}. Use 0 to skip a size.`,
    };
  }
  if (!Number.isInteger(sets) || sets < 1 || sets > 100_000) {
    return { problem: "Enter how many sets, like 10." };
  }
  return {
    pieces: fillByPacks(
      sizes.map((size, i) => ({ sizeId: size.id, ratio: ratio[i]! })),
      sets,
    ),
  };
}

/** A saved ratio (Products → ratio presets) laid over a style's sizes; null if a size is missing. */
export function presetRatio(
  sizes: Array<{ id: string }>,
  entries: Array<{ sizeId: string; ratio: number }>,
): number[] | null {
  const bySize = new Map(entries.map((e) => [e.sizeId, e.ratio]));
  if (!sizes.some((s) => (bySize.get(s.id) ?? 0) > 0)) return null;
  return sizes.map((s) => bySize.get(s.id) ?? 0);
}
