/*
 * Which pieces a customer kept (plan v6 sec 8.2), from what the courier
 * collected, when the site's staff did not mark them. Every set of kept pieces
 * is tried: the kept pieces' customer prices + the delivery charge (0 to 200)
 * - the discount written on the site - the advance = what the courier
 * collected, give or take 20 for the rider's rounding. The engine never
 * guesses a discount.
 *   GREEN   one set fits: the pieces coming back are known.
 *   YELLOW  several fit, all with the same count and prices (a combo of equal
 *           pieces): how many come back is known, the colour or size is
 *           settled when the parcel is opened.
 *   ORANGE  sets with different prices fit, or none does: the parcel goes on Hold.
 */

export const MAX_CHARGE = 200;
export const ROUNDING = 20;
/** More pieces than this are not tried one by one: the parcel goes on Hold. */
export const MAX_PIECES = 14;

export type Piece = { lineId: string; price: number };
export type Match = "GREEN" | "YELLOW" | "ORANGE";

export type Identification = {
  match: Match;
  /** One lineId per piece coming back (one of the fitting sets for YELLOW); null for ORANGE. */
  returning: string[] | null;
};

const cents = (value: number) => Math.round(value * 100);

/** The lines as one entry per piece. */
export function piecesOf(
  lines: Array<{ lineId: string; quantity: number; price: number }>,
): Piece[] {
  return lines.flatMap((l) =>
    Array.from({ length: l.quantity }, () => ({ lineId: l.lineId, price: l.price })),
  );
}

/** Every piece comes back (RETURNED), none does (DELIVERED), or the kept lines the site marked. */
export function byMark(pieces: Piece[], keptLines: readonly string[]): Identification {
  const kept = new Set(keptLines);
  return {
    match: "GREEN",
    returning: pieces.filter((p) => !kept.has(p.lineId)).map((p) => p.lineId),
  };
}

export function identifyPartial(input: {
  pieces: Piece[];
  collected: number;
  advance?: number;
  discount?: number;
}): Identification {
  const { pieces } = input;
  if (pieces.length === 0 || pieces.length > MAX_PIECES)
    return { match: "ORANGE", returning: null };
  const paid = cents(input.collected + (input.advance ?? 0) + (input.discount ?? 0));
  const low = -cents(ROUNDING);
  const high = cents(MAX_CHARGE + ROUNDING);
  const fits: number[] = [];
  // Every set but "kept everything": a partial delivery sends something back.
  const all = (1 << pieces.length) - 1;
  for (let mask = 0; mask < all; mask++) {
    let kept = 0;
    for (let i = 0; i < pieces.length; i++) if (mask & (1 << i)) kept += cents(pieces[i]!.price);
    const charge = paid - kept;
    if (charge >= low && charge <= high) fits.push(mask);
  }
  if (fits.length === 0) return { match: "ORANGE", returning: null };
  const returningOf = (mask: number) => pieces.filter((_, i) => !(mask & (1 << i)));
  const priceKey = (mask: number) =>
    returningOf(mask)
      .map((p) => cents(p.price))
      .sort((a, b) => a - b)
      .join(",");
  const first = fits[0]!;
  if (fits.length === 1)
    return { match: "GREEN", returning: returningOf(first).map((p) => p.lineId) };
  // Equal pieces of one line are one answer, not several.
  const lineKey = (mask: number) =>
    returningOf(mask)
      .map((p) => p.lineId)
      .sort()
      .join("|");
  if (new Set(fits.map(lineKey)).size === 1) {
    return { match: "GREEN", returning: returningOf(first).map((p) => p.lineId) };
  }
  if (new Set(fits.map(priceKey)).size === 1) {
    return { match: "YELLOW", returning: returningOf(first).map((p) => p.lineId) };
  }
  return { match: "ORANGE", returning: null };
}
