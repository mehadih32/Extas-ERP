import { addDays, localDay, toInstant } from "@/lib/dates";
import { AppError } from "@/lib/errors";
import { prisma } from "@/lib/prisma";
import { activeMembers, membersWith } from "@/modules/reminders/audience";
import { sendInApp } from "@/modules/reminders/notification.service";

/*
 * What the nightly clock tells the people who pay money: an installment or a
 * monthly fixed cost that could not be recorded by itself, and a person's term
 * that ends within a week. In the inbox of everyone who records payments, and on
 * the bot as an alarm (sent whether the AI is on or off).
 */

/** Days before a person's term ends that the reminder comes. */
export const TERM_REMINDER_DAYS = 7;

/** Problems found in one night, per company, sent together as one message. */
export class NightProblems {
  private byCompany = new Map<string, string[]>();

  add(companyId: string, line: string) {
    const lines = this.byCompany.get(companyId) ?? [];
    lines.push(line);
    this.byCompany.set(companyId, lines);
  }

  /**
   * One message per company per night: a night run again (a restart after an
   * update, or Server Health's clean-up) does not send the same problems twice.
   */
  async send(subject: string, entityType: string, now: Date = new Date()) {
    for (const [companyId, lines] of this.byCompany) {
      const joined = lines.join(" ");
      // As the inbox keeps it (clipped to 2000 characters), so the check finds it.
      const body = joined.length > 2000 ? `${joined.slice(0, 1999)}…` : joined;
      const already = await prisma.notificationLog.count({
        where: {
          companyId,
          entityType,
          subject,
          body,
          createdAt: { gte: new Date(now.getTime() - 20 * 60 * 60 * 1000) },
        },
      });
      if (already > 0) continue;
      await tellPayers(companyId, subject, body, entityType, companyId);
    }
    this.byCompany.clear();
  }
}

/** A short reason for a failure, in the words the error itself gives. */
export function reasonOf(error: unknown) {
  // Only the ERP's own messages are plain words; anything else stays in the server log.
  if (!(error instanceof AppError))
    return "a problem in the system; the server log has the details";
  const text = error.message;
  return text.length > 160 ? `${text.slice(0, 159)}…` : text;
}

/** In the inbox of everyone who records payments, and on the bot as an alarm. */
export async function tellPayers(
  companyId: string,
  subject: string,
  body: string,
  entityType: string,
  entityId: string | null = null,
) {
  try {
    const to = membersWith(await activeMembers(companyId), ["accounts.payments.record"]);
    await sendInApp(
      prisma,
      companyId,
      to.map((userId) => ({ userId })),
      { subject, body, entityType, entityId },
    );
  } catch (error) {
    console.error("[loans] inbox message not sent", error instanceof Error ? error.message : error);
  }
  try {
    const { pushToBot } = await import("@/modules/ai/bot/push");
    await pushToBot(companyId, { kind: "text", text: `${subject}. ${body}` }, { alarm: true });
  } catch (error) {
    console.error(
      "[loans] alarm not sent to the bot",
      error instanceof Error ? error.message : error,
    );
  }
}

/**
 * Tells the people who pay money, once, when a person's term ends within a
 * week (its profit falls due and the money is renewed or returned). Returns how
 * many terms were reminded.
 */
export async function remindTermsEnding(now: Date = new Date()) {
  const due = await prisma.capitalInstallment.findMany({
    where: {
      status: { in: ["SCHEDULED", "OVERDUE"] },
      remindedAt: null,
      dueDate: { lte: addDaysInstant(now, TERM_REMINDER_DAYS + 1) },
      capitalSource: {
        kind: "PRIVATE_LOAN",
        periodMonths: { not: null },
        status: "ACTIVE",
        voidedAt: null,
      },
    },
    include: {
      capitalSource: {
        select: {
          companyId: true,
          name: true,
          lenderId: true,
          company: { select: { timezone: true, currency: true } },
        },
      },
    },
    orderBy: [{ dueDate: "asc" }, { id: "asc" }],
  });
  let reminded = 0;
  for (const i of due) {
    const s = i.capitalSource;
    const tz = s.company.timezone;
    const today = localDay(now, tz);
    const day = localDay(i.dueDate, tz);
    if (day > addDays(today, TERM_REMINDER_DAYS)) continue;
    // Claimed first, so a term is reminded once even if two clocks run.
    const claimed = await prisma.capitalInstallment.updateMany({
      where: { id: i.id, remindedAt: null },
      data: { remindedAt: now },
    });
    if (claimed.count === 0) continue;
    const when =
      day < today ? `was due on ${day}` : day === today ? "ends today" : `ends on ${day}`;
    await tellPayers(
      s.companyId,
      `${s.name}: the term ${when}`,
      `Profit due: ${s.company.currency} ${i.amount.toFixed(2)}. Open Loans & capital to pay it, then renew, return the money or return part of it.`,
      "CapitalLender",
      s.lenderId,
    );
    reminded++;
  }
  return reminded;
}

/** `days` whole days after an instant (for a query window; the exact day is checked in company time). */
function addDaysInstant(now: Date, days: number) {
  return toInstant(addDays(localDay(now, "UTC"), days), "UTC");
}
