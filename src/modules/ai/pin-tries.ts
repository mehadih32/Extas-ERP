import { randomUUID } from "node:crypto";

import { prisma } from "@/lib/prisma";

/*
 * PIN tries per person and store, kept in the database (AiPinTry) so a restart
 * of the server does not start the count again (v6.4.1). The counts:
 *   - "PIN": wrong PINs, on every path (the ERP, the chat, the bot's question),
 *     over fifteen minutes; a right PIN does not count;
 *   - "CHAT": new numbers the ERP's own AI chat checked to hide a PIN typed by
 *     mistake, over fifteen minutes;
 *   - "BOT_PIN": wrong PINs the bot asked for, per store (subject "bot"), over a
 *     day (v6.4.2): from the 5th each one alarms the owner, the 20th stops PIN
 *     actions on the bot until the owner unlocks them (settings.service.ts).
 * ("NUMBER" rows, from before v6.4.2, counted numbers the bot checked; the bot
 * checks none now.) When "PIN" or "CHAT" reaches its limit the owner is told at
 * once (the inbox and the bot, as an alarm: AI on or off), once per fifteen
 * minutes. Only counts and times are kept, never a PIN or a number.
 */

/** The most numbers of one message checked against the PIN (each check takes a moment). */
const MAX_PIN_CANDIDATES = 12;

/**
 * A word for a PIN or password, any case, also stuck to digits: one starting
 * with pin or pass ("PIN4321", "PINCODE", "pass", "password", "PASSCODE"),
 * "OTP" or "code", or পিন, পাস, কোড, ওটিপি. Then every number in the message is
 * checked, codes too. Not inside another word ("shipping", "bypass", "barcode").
 */
const PIN_WORD = /(?<![a-z])(?:pin|pass|otp(?![a-z])|code(?![a-z]))|পিন|পাস|কোড|ওটিপি/i;
/** Two or more capital letters, maybe with -, / or _, right before the digits: "PO4501", "CS-2026", "SO/2026", "LOT_4455". */
const CODE_LETTERS = /[A-Z]{2,}[-/_]?$/;
/** Digits joined to more digits by - or /: "2026-0001", "18/10/2026". */
const JOINED_BEFORE = /\d[-/]$/;
const JOINED_AFTER = /^[-/]\d/;

/**
 * The numbers in a message that could be a PIN: each run of 4 to 8 digits,
 * once (the bot hides a message with any of them unchecked; the ERP's chat
 * checks them). Only digits that are clearly part of a document number are
 * left out: capital letters right before them, as in "PO4501" or
 * "CS-2026-0001", or joined to more digits by - or /, as in "SO/2026/0112" or
 * a date. Anything else counts: "PIN-4321", "2468ok", and Bengali words stuck
 * to a number ("৪৩২১ই", "৪৩২১টা"). When the message has a PIN word ("pin",
 * "pincode", "pass", "OTP", "code", "পিন") every number counts (v6.4.1).
 */
export function pinCandidates(text: string): string[] {
  const everyNumber = PIN_WORD.test(text);
  const runs: string[] = [];
  for (const match of text.matchAll(/\d+/g)) {
    const run = match[0];
    if (run.length < 4 || run.length > 8) continue;
    if (!everyNumber) {
      const before = text.slice(Math.max(0, match.index - 12), match.index);
      const after = text.slice(match.index + run.length, match.index + run.length + 2);
      if (CODE_LETTERS.test(before) || JOINED_BEFORE.test(before) || JOINED_AFTER.test(after)) {
        continue;
      }
    }
    runs.push(run);
  }
  return [...new Set(runs)].slice(0, MAX_PIN_CANDIDATES);
}

export type PinTryKind = "PIN" | "CHAT" | "BOT_PIN";

export const PIN_TRY_MINUTES = 15;

/** Counts one try and returns how many there are now in the window (fifteen minutes unless given). */
export async function countPinTry(
  companyId: string,
  subjectKey: string,
  kind: PinTryKind,
  now = new Date(),
  windowMinutes = PIN_TRY_MINUTES,
): Promise<number> {
  const before = new Date(now.getTime() - windowMinutes * 60_000);
  // One statement, so two tries at the same moment are both counted.
  const [row] = await prisma.$queryRawUnsafe<Array<{ count: number }>>(
    `INSERT INTO "AiPinTry" ("id", "companyId", "subjectKey", "kind", "windowStart", "count")
     VALUES ($1, $2, $3, $4, $5, 1)
     ON CONFLICT ("companyId", "subjectKey", "kind") DO UPDATE SET
       "count" = CASE WHEN "AiPinTry"."windowStart" <= $6 THEN 1 ELSE "AiPinTry"."count" + 1 END,
       "alarmedAt" = CASE WHEN "AiPinTry"."windowStart" <= $6 THEN NULL ELSE "AiPinTry"."alarmedAt" END,
       "windowStart" = CASE WHEN "AiPinTry"."windowStart" <= $6 THEN $5 ELSE "AiPinTry"."windowStart" END
     RETURNING "count"`,
    randomUUID(),
    companyId,
    subjectKey,
    kind,
    now,
    before,
  );
  return row?.count ?? 1;
}

/** Takes back one try (a right PIN is not a wrong one). */
export async function uncountPinTry(companyId: string, subjectKey: string, kind: PinTryKind) {
  await prisma.aiPinTry.updateMany({
    where: { companyId, subjectKey, kind, count: { gt: 0 } },
    data: { count: { decrement: 1 } },
  });
}

const ALARM: Record<
  Exclude<PinTryKind, "BOT_PIN">,
  (who: string, limit: number) => { subject: string; body: string }
> = {
  PIN: (who, limit) => ({
    subject: "Too many wrong PINs",
    body: `${who}: a wrong PIN was given ${limit} times in ${PIN_TRY_MINUTES} minutes (in the ERP or on the bot). PIN tries are stopped for ${PIN_TRY_MINUTES} minutes. If it was not you, change your password now, then wait ${PIN_TRY_MINUTES} minutes and change your PIN (AI Center > Settings).`,
  }),
  CHAT: (who, limit) => ({
    subject: "Many numbers in the AI chat",
    body: `${who}: ${limit} new numbers were written in the AI chat in the ERP in ${PIN_TRY_MINUTES} minutes. Someone may be looking for your PIN, so for ${PIN_TRY_MINUTES} minutes the chat hides every message with a new number. If it was not you, change your password and your PIN now (AI Center > Settings).`,
  }),
};

/**
 * Tells the owner the limit was hit: the platform owners' inbox and the bot
 * (an alarm, which goes even with the AI off), and the AI Center's log. Once
 * per fifteen minutes per person; a failure never stops the PIN check.
 */
export async function pinLimitAlarm(
  companyId: string,
  subjectKey: string,
  kind: Exclude<PinTryKind, "BOT_PIN">,
  limit: number,
) {
  try {
    const claimed = await prisma.aiPinTry.updateMany({
      where: { companyId, subjectKey, kind, alarmedAt: null },
      data: { alarmedAt: new Date() },
    });
    if (claimed.count === 0) return;
    const person = await prisma.user.findUnique({
      where: { id: subjectKey },
      select: { id: true, name: true },
    });
    const { subject, body } = ALARM[kind](person?.name ?? "The bot's chat", limit);
    await alarmOwner(companyId, person?.id ?? null, subject, body, {
      summary: `${subject}: tries stopped for ${PIN_TRY_MINUTES} minutes`,
    });
  } catch (error) {
    console.error("[ai] PIN alarm not sent", error instanceof Error ? error.message : error);
  }
}

/**
 * Wrong PINs the bot asked for (v6.4.2): from the 5th in a day, each one tells
 * the owner; `stopped` when the 20th stopped PIN actions on the bot.
 */
export async function botPinAlarm(companyId: string, wrong: number, stopped: boolean) {
  try {
    const subject = stopped ? "PIN actions on the bot are stopped" : "Wrong PIN on the bot";
    const body = stopped
      ? `${wrong} wrong PINs were sent to the bot in a day, so the bot now does no money, price, Deletion or other PIN action and takes no PIN until you unlock it in the ERP: AI Center > Bot, “Unlock PIN actions” (it asks for your PIN). If it was not you, someone may have your Telegram: unlink the bot there and change your PIN first.`
      : `${wrong} wrong PINs were sent to the bot in a day, each in answer to the bot asking for the PIN. If it was not you, someone may have your Telegram: unlink the bot in AI Center > Bot and change your PIN. After 20 wrong PINs in a day, PIN actions on the bot stop until you unlock them in the ERP.`;
    await alarmOwner(companyId, null, subject, body, {
      summary: stopped
        ? `PIN actions on the bot stopped after ${wrong} wrong PINs in a day`
        : `Wrong PIN on the bot (${wrong} in a day)`,
    });
  } catch (error) {
    console.error("[ai] bot PIN alarm not sent", error instanceof Error ? error.message : error);
  }
}

/**
 * Tells the owner: the platform owners' inbox and the bot (an alarm, which goes
 * even with the AI off), and the AI Center's log.
 */
async function alarmOwner(
  companyId: string,
  userId: string | null,
  subject: string,
  body: string,
  log: { summary: string },
) {
  await prisma.auditLog.create({
    data: {
      companyId,
      userId,
      action: "STATUS_CHANGE",
      entityType: "AiSettings",
      entityId: companyId,
      summary: log.summary,
    },
  });
  const owners = await prisma.user.findMany({
    where: {
      isSuperAdmin: true,
      status: "ACTIVE",
      memberships: { some: { companyId, isActive: true } },
    },
    select: { id: true },
  });
  const { sendInApp } = await import("@/modules/reminders/notification.service");
  await sendInApp(
    prisma,
    companyId,
    owners.map((o) => ({ userId: o.id })),
    { subject, body },
  );
  const { pushToBot } = await import("./bot/push");
  await pushToBot(companyId, { kind: "text", text: `${subject}. ${body}` }, { alarm: true });
}
