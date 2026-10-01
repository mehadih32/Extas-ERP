/**
 * Pure "Ratio Fill" maths for the wholesale matrix (no database access).
 */

export type RatioEntry = { sizeId: string; ratio: number };

/** Packs mode: 10 packs of S1 M2 L2 XL1 -> S10 M20 L20 XL10. */
export function fillByPacks(entries: RatioEntry[], packs: number): Map<string, number> {
  return new Map(entries.map((e) => [e.sizeId, e.ratio * packs]));
}

/**
 * Total mode: splits `total` pieces by ratio using the largest-remainder method,
 * so the result always adds up exactly to `total`.
 */
export function fillByTotal(entries: RatioEntry[], total: number): Map<string, number> {
  const ratioSum = entries.reduce((sum, e) => sum + e.ratio, 0);
  if (ratioSum <= 0) return new Map(entries.map((e) => [e.sizeId, 0]));
  const exact = entries.map((e) => ({ sizeId: e.sizeId, value: (total * e.ratio) / ratioSum }));
  const result = new Map(exact.map((x) => [x.sizeId, Math.floor(x.value)]));
  let leftover = total - [...result.values()].reduce((a, b) => a + b, 0);
  const byRemainder = [...exact].sort(
    (a, b) => b.value - Math.floor(b.value) - (a.value - Math.floor(a.value)),
  );
  for (const x of byRemainder) {
    if (leftover <= 0) break;
    result.set(x.sizeId, result.get(x.sizeId)! + 1);
    leftover -= 1;
  }
  return result;
}

/** Limits each cell to what is in stock (never below 0). */
export function capToAvailable(quantity: number, available: number): number {
  return Math.max(0, Math.min(quantity, available));
}
