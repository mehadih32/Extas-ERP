import { localDay, startOfDayInZone } from "@/lib/dates";
import type { Db } from "@/lib/db-types";

/*
 * The one live opening entry of an account or a buyer/supplier (sourceType
 * OPENING_BALANCE, sourceId the account's or the party's id), and the day a
 * saved opening balance goes on. Saving again keeps the go-live day unless a
 * different day is chosen: the old entry is reversed on its own day, so a new
 * one on a later day would leave every report in between without an opening.
 */

/** The opening entries still counting (not reversed, not reversals), oldest first. */
export function liveOpeningEntries(db: Db, companyId: string, sourceId: string) {
  return db.journalEntry.findMany({
    where: {
      companyId,
      sourceType: "OPENING_BALANCE",
      sourceId,
      isReversed: false,
      reversalOfId: null,
    },
    include: { lines: true },
    orderBy: { createdAt: "asc" },
  });
}

/**
 * The date to post an opening balance on: the day chosen, or else the day of
 * the opening entry already there, or else the start of today (company time).
 * A day chosen that is the current entry's own day keeps that entry's exact
 * time, so saving the day the dialog shows is the same day, not a new one.
 */
export function openingDate(
  asOf: Date | undefined,
  live: readonly { date: Date }[],
  timeZone: string,
): Date {
  const current = live[0]?.date;
  if (!asOf) return current ?? startOfDayInZone(localDay(new Date(), timeZone), timeZone);
  if (current && localDay(asOf, timeZone) === localDay(current, timeZone)) return current;
  return asOf;
}

/** The day ("YYYY-MM-DD", company time) the opening balance now sits on, or null when none. */
export async function openingDay(
  db: Db,
  companyId: string,
  sourceId: string,
  timeZone: string,
): Promise<string | null> {
  const entry = await db.journalEntry.findFirst({
    where: {
      companyId,
      sourceType: "OPENING_BALANCE",
      sourceId,
      isReversed: false,
      reversalOfId: null,
    },
    orderBy: { createdAt: "asc" },
    select: { date: true },
  });
  return entry ? localDay(entry.date, timeZone) : null;
}
