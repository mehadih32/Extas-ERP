/*
 * Challan vs Actual: what a delivery line actually weighed or counted against
 * what the supplier's challan says. Plain numbers in and out, so the receive
 * screen shows the same Short/Extra as the server logs. A short beyond the
 * allowance (2% for fabric, 1% for the rest, as the batch's contracts say) is
 * a supplier fault; a short inside it, or extra, is only shown.
 */

/** How far short of the challan a delivery may be before it is a fault, in percent. */
export const SHORT_ALLOWANCE = { FABRIC: 2, OTHER: 1 } as const;

export type ShortExtraLevel = "MATCH" | "SHORT" | "SHORT_WITHIN" | "EXTRA" | "NO_CHALLAN";

export type ShortExtra = {
  level: ShortExtraLevel;
  /** Actual less challan, to 3 decimals (negative: short). */
  difference: number;
  /** The difference as a percent of the challan, to 1 decimal. */
  percent: number;
};

/** What a line's actual quantity is against its challan: short, extra, or a match. */
export function shortExtra(challan: number | null, actual: number, kind: string): ShortExtra {
  if (challan === null) return { level: "NO_CHALLAN", difference: 0, percent: 0 };
  const difference = Math.round((actual - challan) * 1000) / 1000;
  const percent =
    challan > 0
      ? Math.round((Math.abs(difference) / challan) * 1000) / 10
      : difference === 0
        ? 0
        : 100;
  const allowance = kind === "FABRIC" ? SHORT_ALLOWANCE.FABRIC : SHORT_ALLOWANCE.OTHER;
  const level: ShortExtraLevel =
    difference === 0
      ? "MATCH"
      : difference > 0
        ? "EXTRA"
        : percent > allowance
          ? "SHORT"
          : "SHORT_WITHIN";
  return { level, difference, percent };
}
