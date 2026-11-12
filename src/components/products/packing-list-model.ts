import { canonicalSize } from "@/modules/inventory/packing-list/layout";
import {
  closest,
  likeness,
  likelyStyles,
  nameKey,
  type PaperBlock,
  sizeFor,
} from "@/modules/inventory/packing-list/paper";

/*
 * The upload window's choices for one style block of a packing list: which
 * style, and which catalog colour and size each written name is. Kept apart
 * from the screen so the choices (and the Buy ready stock link) can be tested.
 */

type Named = { id: string; name: string };
type StyleOption = { id: string; code: string; name: string };

/** A colour or size choice: a catalog id, "NEW" (made from the written name) or "" (not picked). */
export type Choice = { value: string; how: "SAME" | "REMEMBERED" | "GUESS" | "NEW" | "NONE" };

/** "ANTRA" -> "Antra": a new colour's name as written, tidied. */
export const tidyName = (written: string) =>
  written
    .trim()
    .toLowerCase()
    .replace(/(^|[\s/-])([a-z])/g, (_, a: string, b: string) => a + b.toUpperCase())
    .slice(0, 40);

/** A new style's code from its written title: "R-L Ziper polo" -> "R-L-ZIPER-POLO". */
export const codeFromTitle = (title: string) =>
  title
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);

/** The catalog colour a written name means: remembered for this source, the same name, or a close one. */
export function colourChoice(
  written: string,
  colours: readonly Named[],
  remembered: Record<string, string>,
): Choice {
  const known = remembered[nameKey(written)];
  if (known && colours.some((c) => c.id === known)) return { value: known, how: "REMEMBERED" };
  const guess = closest(written, colours, (c) => c.name);
  if (!guess) return { value: "", how: "NONE" };
  return { value: guess.item.id, how: guess.exact ? "SAME" : "GUESS" };
}

/** The catalog size a written size means; a size the catalog lacks is made new. */
export function sizeChoice(written: string, sizes: readonly Named[]): Choice {
  const found = sizeFor(written, sizes);
  if (found) return { value: found.id, how: "SAME" };
  return canonicalSize(written) ? { value: "NEW", how: "NEW" } : { value: "", how: "NONE" };
}

/**
 * The style a block most likely is: the one named exactly, else the page's own
 * style when the block has no title or one like it, else a very close name.
 * Empty when the person must pick (or make a new style).
 */
export function styleChoice(
  block: Pick<PaperBlock, "title">,
  styles: readonly StyleOption[],
  pageStyle: StyleOption | null,
): { value: string; suggestions: StyleOption[] } {
  const title = block.title?.trim() ?? "";
  if (!title) return { value: pageStyle?.id ?? "", suggestions: [] };
  const suggestions = likelyStyles(title, styles, 4);
  const score = (s: StyleOption) => Math.max(likeness(title, s.code), likeness(title, s.name));
  const exact = styles.find((s) => score(s) === 1);
  if (exact) return { value: exact.id, suggestions };
  if (pageStyle && score(pageStyle) >= 0.6) return { value: pageStyle.id, suggestions };
  const best = suggestions[0];
  return { value: best && score(best) >= 0.85 ? best.id : "", suggestions };
}

/** One colour x size with pieces, by the names chosen for it. */
export type ChosenCell = { colour: string; size: string; pieces: number };

/** The block's cells with pieces, by written colour and size (repeats added up). */
export function cellsWithPieces(block: PaperBlock): ChosenCell[] {
  const cells = new Map<string, ChosenCell>();
  for (const row of block.rows) {
    row.cells.forEach((cell, i) => {
      const size = block.sizes[i];
      if (!size || !cell.pieces) return;
      const key = `${nameKey(row.colour)}:${canonicalSize(size)}`;
      const was = cells.get(key);
      if (was) was.pieces += cell.pieces;
      else cells.set(key, { colour: row.colour, size, pieces: cell.pieces });
    });
  }
  return [...cells.values()];
}

// =============================================================================
// The Buy ready stock form, filled in from a packing list (a link)
// =============================================================================

export type BuyPrefill = { styleId: string; pieces: Record<string, number> };

/** /business/retail/shop-stock?buy=<style>&pieces=<colour>.<size>.<n>,... */
export function buyReadyLink(
  styleId: string,
  cells: Array<{ colorId: string; sizeId: string; pieces: number }>,
) {
  const pieces = cells.map((c) => `${c.colorId}.${c.sizeId}.${c.pieces}`).join(",");
  return `/business/retail/shop-stock?${new URLSearchParams({ buy: styleId, pieces }).toString()}`;
}

/** The link's style and pieces ("colourId:sizeId" -> pieces); null when it is not one. */
export function readBuyPrefill(params: { buy?: string | string[]; pieces?: string | string[] }) {
  const styleId = typeof params.buy === "string" ? params.buy.trim() : "";
  if (!/^[a-z0-9]{8,64}$/i.test(styleId)) return null;
  const raw = typeof params.pieces === "string" ? params.pieces : "";
  const pieces: Record<string, number> = {};
  for (const part of raw.split(",").slice(0, 600)) {
    const m = /^([a-z0-9]{8,64})\.([a-z0-9]{8,64})\.(\d{1,7})$/i.exec(part.trim());
    if (m && Number(m[3]) > 0) pieces[`${m[1]}:${m[2]}`] = Number(m[3]);
  }
  return { styleId, pieces } satisfies BuyPrefill;
}
