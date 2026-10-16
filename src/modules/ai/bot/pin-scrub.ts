import { prisma } from "@/lib/prisma";

/** What the log, the job and the screen keep instead of a PIN (bot/incoming.ts). */
export const PIN_TEXT = "[PIN]";

/*
 * The v6.3 update hid every bot message of 4 to 8 digits as a PIN, once
 * (prisma/migrations/20261124090000_hide_bot_pins, kept exactly as it ran on
 * the live site). This says how many of the messages it hid did not follow a
 * PIN request, and when they came: those may have been order numbers or other
 * words, and only the backup made before that update still has them. Only
 * messages that came before that wipe ran are counted: every later "[PIN]" was
 * hidden as it came (a PIN the bot asked for, or since v6.4 one typed late or
 * unasked), so it was a PIN. scripts/check-update.ts prints it after each
 * update (no text, only counts and dates).
 */

/** The migration that ran the v6.3 wipe. */
const PIN_WIPE = "20261124090000_hide_bot_pins";

/** How long after the bot asked for the PIN a message is taken as the PIN. */
const PIN_ANSWER_MINUTES = 10;

export async function pinScrubReport() {
  const [ran] = await prisma.$queryRawUnsafe<Array<{ finishedAt: Date }>>(
    `SELECT finished_at AS "finishedAt" FROM "_prisma_migrations"
     WHERE migration_name = $1 AND finished_at IS NOT NULL AND rolled_back_at IS NULL
     ORDER BY finished_at LIMIT 1`,
    PIN_WIPE,
  );
  const wipedAt: Date | null = ran?.finishedAt ?? null;
  if (!wipedAt) {
    return { wipedAt, hidden: 0, afterRequest: 0, notAfterRequest: 0, notAfterRequestDates: [] };
  }
  const rows = await prisma.$queryRawUnsafe<Array<{ createdAt: Date; after: boolean }>>(
    `SELECT m."createdAt", EXISTS (
       SELECT 1 FROM "AiBotMessage" AS ask
       WHERE ask."direction" = 'OUT'
         AND ask."linkId" = m."linkId"
         AND ask."chatId" = m."chatId"
         AND ask."text" LIKE 'Send your PIN to %'
         AND ask."createdAt" <= m."createdAt"
         AND ask."createdAt" > m."createdAt" - make_interval(mins => $2::int)
     ) AS "after"
     FROM "AiBotMessage" AS m
     WHERE m."direction" = 'IN' AND m."text" = $1 AND m."createdAt" <= $3
     ORDER BY m."createdAt"`,
    PIN_TEXT,
    PIN_ANSWER_MINUTES,
    wipedAt,
  );
  const not = rows.filter((r) => !r.after);
  return {
    /** When the v6.3 wipe ran on this database (null: it never ran here). */
    wipedAt,
    hidden: rows.length,
    afterRequest: rows.length - not.length,
    notAfterRequest: not.length,
    notAfterRequestDates: not.map((r) => r.createdAt),
  };
}
