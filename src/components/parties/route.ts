import type { PartyListName } from "./labels";

/** The list named in the address ("buyers" or "suppliers"), or null for anything else. */
export function listName(value: string): PartyListName | null {
  return value === "buyers" || value === "suppliers" ? value : null;
}

/** "YYYY-MM-DD" from the address, or undefined when missing or malformed. */
export function dayParam(value: string | string[] | undefined): string | undefined {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return undefined;
  const [y, m, d] = value.split("-").map(Number) as [number, number, number];
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d
    ? value
    : undefined;
}
