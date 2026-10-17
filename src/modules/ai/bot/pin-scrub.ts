import { prisma } from "@/lib/prisma";

/** What the log, the job and the screen keep instead of a PIN (bot/incoming.ts). */
export const PIN_TEXT = "[PIN]";

/*
 * v6.4 A5: the v6.3 update hid every bot message of 4 to 8 digits as a PIN
 * (prisma/migrations/20261124090000_hide_bot_pins, since limited to messages
 * that followed a PIN request). This says how many hidden messages did not
 * follow one, and when they came: those may have been order numbers or other
 * words, and only the backup made before that update still has them.
 * scripts/check-update.ts prints it after each update (no text, only counts
 * and dates).
 */

/** How long after the bot asked for the PIN a message is taken as the PIN. */
const PIN_ANSWER_MINUTES = 10;

export async function pinScrubReport() {
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
     WHERE m."direction" = 'IN' AND m."text" = $1
     ORDER BY m."createdAt"`,
    PIN_TEXT,
    PIN_ANSWER_MINUTES,
  );
  const not = rows.filter((r) => !r.after);
  return {
    hidden: rows.length,
    afterRequest: rows.length - not.length,
    notAfterRequest: not.length,
    notAfterRequestDates: not.map((r) => r.createdAt),
  };
}
