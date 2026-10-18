import { randomUUID } from "node:crypto";

import { prisma } from "@/lib/prisma";

/*
 * PIN tries per person and store, kept in the database (AiPinTry) so a restart
 * of the server does not start the count again (v6.4.1). Two counts, each over
 * fifteen minutes:
 *   - "PIN": wrong PINs, on every path (the ERP, the chat, the bot's question);
 *     a right PIN does not count;
 *   - "NUMBER": new numbers the bot checked to hide a PIN typed by mistake.
 * When a count reaches its limit the owner is told at once (the inbox and the
 * bot, as an alarm: AI on or off), once per fifteen minutes. Only counts and
 * times are kept, never a PIN or a number.
 */

/** The most numbers of one message checked against the PIN (each check takes a moment). */
const MAX_PIN_CANDIDATES = 12;

/** A letter, a hyphen, a slash or an underscore next to digits: they are part of a code. */
const CODE_NEIGHBOUR = /[\p{L}\p{M}\-_/]/u;

/**
 * The numbers in a message that could be a PIN: each run of 4 to 8 digits,
 * once. Digits that are part of a code, like "CS-2026-0001", "PO4501" or
 * "SO/2026/0112" (a letter, hyphen, slash or underscore right next to them),
 * are not a PIN and use up none of the PIN checks (v6.4.1).
 */
export function pinCandidates(text: string): string[] {
  const runs: string[] = [];
  for (const match of text.matchAll(/\d+/g)) {
    const run = match[0];
    const before = text[match.index - 1] ?? "";
    const after = text[match.index + run.length] ?? "";
    if (CODE_NEIGHBOUR.test(before) || CODE_NEIGHBOUR.test(after)) continue;
    if (run.length >= 4 && run.length <= 8) runs.push(run);
  }
  return [...new Set(runs)].slice(0, MAX_PIN_CANDIDATES);
}

export type PinTryKind = "PIN" | "NUMBER";

export const PIN_TRY_MINUTES = 15;

/** Counts one try and returns how many there are now in the fifteen minutes. */
export async function countPinTry(
  companyId: string,
  subjectKey: string,
  kind: PinTryKind,
  now = new Date(),
): Promise<number> {
  const before = new Date(now.getTime() - PIN_TRY_MINUTES * 60_000);
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

const ALARM: Record<PinTryKind, (who: string, limit: number) => { subject: string; body: string }> =
  {
    PIN: (who, limit) => ({
      subject: "Too many wrong PINs",
      body: `${who}: a wrong PIN was given ${limit} times in ${PIN_TRY_MINUTES} minutes (in the ERP or on the bot). PIN tries are stopped for ${PIN_TRY_MINUTES} minutes. If it was not you, change your password and your PIN now (AI Center > Settings).`,
    }),
    NUMBER: (who, limit) => ({
      subject: "Many numbers sent to the bot",
      body: `${who}: ${limit} new numbers came to the bot in ${PIN_TRY_MINUTES} minutes. Any of them could be your PIN, so for ${PIN_TRY_MINUTES} minutes the bot hides every message with a new number. If it was not you, unlink the bot in AI Center > Bot and change your PIN.`,
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
  kind: PinTryKind,
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
    await prisma.auditLog.create({
      data: {
        companyId,
        userId: person?.id ?? null,
        action: "STATUS_CHANGE",
        entityType: "AiSettings",
        entityId: companyId,
        summary: `${subject}: tries stopped for ${PIN_TRY_MINUTES} minutes`,
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
  } catch (error) {
    console.error("[ai] PIN alarm not sent", error instanceof Error ? error.message : error);
  }
}
