import { AppError } from "@/lib/errors";

/*
 * Colour, brand and warehouse names are unique in a company whatever their
 * letter case: "maroon" next to a Maroon would read as the same colour (and make
 * the same SKU code), so it is refused rather than added twice.
 */

/** Matches `name` in any letter case, leaving out the row being renamed. */
export const sameName = (name: string, exceptId?: string) => ({
  name: { equals: name, mode: "insensitive" as const },
  ...(exceptId ? { id: { not: exceptId } } : {}),
});

/** CONFLICT (shown on the name field) when `others` finds a row with the name. */
export async function refuseTakenName(others: Promise<unknown>, taken: string) {
  if (await others) throw new AppError("CONFLICT", taken, { name: [taken] });
}
