import type { FollowUpKind } from "@prisma/client";
import { z } from "zod";

import { addDays, dateColumn, dateOnly, daysBetween, localDay } from "@/lib/dates";
import { AppError } from "@/lib/errors";
import { formatDay } from "@/lib/format";
import { prisma } from "@/lib/prisma";
import type { RequestMeta } from "@/lib/request-meta";
import { auditInCompany } from "@/modules/audit/audit.service";
import type { CompanyContext } from "@/modules/auth/context";
import { recordHref } from "@/modules/reminders/links";
import { FOLLOW_UP_TYPES, type FollowUpType } from "@/modules/reminders/rules";
import { dueItems, followUpKey, mayOpenFollowUp } from "@/modules/reminders/sources";

/*
 * Follow-ups with buyers, for our own staff (none of it ever goes to a buyer,
 * and none of it needs the AI):
 *   - "Follow up on" a date with a short note, set by hand on a buyer, a
 *     quotation or an order (FollowUp rows of kind MANUAL);
 *   - the day a buyer promised to pay an invoice (Invoice.promisedPayOn);
 *   - Home's "Today's follow-ups": what is due today or overdue of these and of
 *     quotations ending and invoices due (reminders/sources.ts), each with Done
 *     and Snooze. Done and Snooze on a watched date put a mark on that date
 *     (FollowUp with a sourceKey), so a new date starts afresh.
 * The reminder clock (engine.ts) sends each one's reminders once per step.
 */

const id = z.string().trim().min(1).max(64);
const day = z.iso.date("Choose a day");

export const createFollowUpSchema = z
  .object({
    partyId: id.optional(),
    quotationId: id.optional(),
    orderId: id.optional(),
    dueOn: day,
    note: z.string().trim().max(300).optional(),
  })
  .refine((v) => [v.partyId, v.quotationId, v.orderId].filter(Boolean).length === 1, {
    message: "Say what to follow up: one buyer, quotation or order.",
  });

export const promiseSchema = z.object({
  /** null clears the promise. */
  promisedPayOn: day.nullable(),
  note: z.string().trim().max(300).optional(),
});

/** Done or Snooze on Home: a follow-up by its id, or a watched date by its kind, record and day. */
export const markSchema = z.discriminatedUnion("target", [
  z.object({ target: z.literal("followUp"), id }),
  z.object({
    target: z.literal("date"),
    kind: z.enum(["QUOTATION_EXPIRY", "PAYMENT_DUE", "PROMISED_PAYMENT"]),
    recordId: id,
    day,
  }),
]);

export const snoozeSchema = z.object({
  mark: markSchema,
  /** The day it comes back. */
  until: day,
});

const today = (ctx: CompanyContext, now: Date) => localDay(now, ctx.company.timezone);

/** Whether this person may follow up on a buyer (parties.view) or a quotation or order (sales.view). */
function assertMayFollow(ctx: CompanyContext, on: "party" | "sales") {
  if (ctx.byAi) {
    throw new AppError("FORBIDDEN", "Follow-ups are set by people.");
  }
  if (on === "party" ? !ctx.can("parties.view") : !ctx.can("sales.view")) {
    throw new AppError("FORBIDDEN", "You do not have permission to follow this up.");
  }
}

async function targetOf(
  ctx: CompanyContext,
  input: { partyId?: string; quotationId?: string; orderId?: string },
) {
  if (input.partyId) {
    assertMayFollow(ctx, "party");
    const party = await ctx.db.party.findUnique({
      where: { id: input.partyId },
      select: { id: true, name: true, kind: true },
    });
    if (!party || party.kind === "SUPPLIER") throw new AppError("NOT_FOUND", "Buyer not found.");
    return { label: party.name, entityType: "Party" };
  }
  assertMayFollow(ctx, "sales");
  if (input.quotationId) {
    const q = await ctx.db.quotation.findUnique({
      where: { id: input.quotationId },
      select: { number: true },
    });
    if (!q) throw new AppError("NOT_FOUND", "Quotation not found.");
    return { label: `Quotation ${q.number}`, entityType: "Quotation" };
  }
  const o = await ctx.db.salesOrder.findUnique({
    where: { id: input.orderId! },
    select: { number: true },
  });
  if (!o) throw new AppError("NOT_FOUND", "Order not found.");
  return { label: `Order ${o.number}`, entityType: "SalesOrder" };
}

/** Sets a "Follow up on" date with a short note; its reminder goes to its setter and the owner. */
export async function createFollowUp(
  ctx: CompanyContext,
  raw: unknown,
  meta?: RequestMeta,
  now: Date = new Date(),
) {
  const input = createFollowUpSchema.parse(raw);
  if (input.dueOn < today(ctx, now)) {
    throw new AppError("VALIDATION", "Choose today or a later day.", {
      dueOn: ["Choose today or a later day."],
    });
  }
  const target = await targetOf(ctx, input);
  const row = await ctx.db.followUp.create({
    data: {
      companyId: ctx.company.id,
      kind: "MANUAL",
      partyId: input.partyId ?? null,
      quotationId: input.quotationId ?? null,
      orderId: input.orderId ?? null,
      dueOn: dateColumn(input.dueOn),
      note: input.note || null,
      createdById: ctx.user.id,
    },
  });
  await auditInCompany(ctx, meta, {
    action: "CREATE",
    entityType: "FollowUp",
    entityId: row.id,
    summary: `Follow up on ${formatDay(input.dueOn)}: ${target.label}${input.note ? ` (${input.note})` : ""}`,
  });
  return presentFollowUp(row, today(ctx, now));
}

type FollowUpRow = Awaited<ReturnType<typeof prisma.followUp.findFirstOrThrow>>;

function presentFollowUp(row: FollowUpRow, todayDay: string) {
  const due = dateOnly(row.snoozedUntil ?? row.dueOn);
  return {
    id: row.id,
    dueOn: due,
    note: row.note,
    done: row.status === "DONE",
    snoozed: row.snoozedUntil !== null,
    daysLeft: daysBetween(todayDay, due),
  };
}

export type FollowUpItem = ReturnType<typeof presentFollowUp>;

/** The open follow-ups set on a buyer, a quotation or an order, soonest first. */
export async function listFollowUps(ctx: CompanyContext, raw: unknown, now: Date = new Date()) {
  const input = z
    .object({ partyId: id.optional(), quotationId: id.optional(), orderId: id.optional() })
    .refine((v) => [v.partyId, v.quotationId, v.orderId].filter(Boolean).length === 1)
    .parse(raw);
  assertMayFollow(ctx, input.partyId ? "party" : "sales");
  const rows = await ctx.db.followUp.findMany({
    where: {
      kind: "MANUAL",
      status: "OPEN",
      ...(input.partyId ? { partyId: input.partyId } : {}),
      ...(input.quotationId ? { quotationId: input.quotationId } : {}),
      ...(input.orderId ? { orderId: input.orderId } : {}),
    },
    orderBy: [{ dueOn: "asc" }, { id: "asc" }],
    take: 20,
  });
  const todayDay = today(ctx, now);
  return {
    today: todayDay,
    items: rows
      .map((row) => presentFollowUp(row, todayDay))
      .sort((a, b) => a.dueOn.localeCompare(b.dueOn)),
  };
}

const KIND_OF: Record<Exclude<FollowUpType, "FOLLOW_UP">, FollowUpKind> = {
  QUOTATION_EXPIRY: "QUOTATION_EXPIRY",
  PAYMENT_DUE: "PAYMENT_DUE",
  PROMISED_PAYMENT: "PROMISED_PAYMENT",
};

/** Checks the person sees what a mark is about and returns the row to change (or the key to make). */
async function resolveMark(ctx: CompanyContext, mark: z.output<typeof markSchema>) {
  if (mark.target === "followUp") {
    const row = await ctx.db.followUp.findUnique({ where: { id: mark.id } });
    if (!row || row.kind !== "MANUAL") throw new AppError("NOT_FOUND", "Follow-up not found.");
    assertMayFollow(ctx, row.partyId ? "party" : "sales");
    return { row, key: null, label: "the follow-up" };
  }
  assertMayFollow(ctx, "sales");
  const exists =
    mark.kind === "QUOTATION_EXPIRY"
      ? await ctx.db.quotation.findUnique({ where: { id: mark.recordId }, select: { id: true } })
      : await ctx.db.invoice.findUnique({ where: { id: mark.recordId }, select: { id: true } });
  if (!exists) throw new AppError("NOT_FOUND", "Record not found.");
  const key = followUpKey(mark.kind, mark.recordId, mark.day);
  const row = await ctx.db.followUp.findUnique({
    where: { companyId_sourceKey: { companyId: ctx.company.id, sourceKey: key } },
  });
  return { row, key, label: mark.kind.toLowerCase().replaceAll("_", " ") };
}

/** A new mark on a watched date (a follow-up set by hand always has its row already). */
function markData(mark: z.output<typeof markSchema>) {
  if (mark.target !== "date") throw new AppError("NOT_FOUND", "Follow-up not found.");
  return {
    kind: KIND_OF[mark.kind],
    sourceKey: followUpKey(mark.kind, mark.recordId, mark.day),
    dueOn: dateColumn(mark.day),
    ...(mark.kind === "QUOTATION_EXPIRY"
      ? { quotationId: mark.recordId }
      : { invoiceId: mark.recordId }),
  };
}

/** Done: the follow-up (or this date of a quotation or invoice) leaves the list and its reminders stop. */
export async function markFollowUpDone(
  ctx: CompanyContext,
  raw: unknown,
  meta?: RequestMeta,
  now: Date = new Date(),
) {
  const mark = markSchema.parse(raw);
  const { row, key, label } = await resolveMark(ctx, mark);
  const done = { status: "DONE" as const, doneAt: now, doneById: ctx.user.id };
  const saved = row
    ? await ctx.db.followUp.update({ where: { id: row.id }, data: done })
    : await ctx.db.followUp.create({
        data: { companyId: ctx.company.id, ...markData(mark), ...done, createdById: ctx.user.id },
      });
  await auditInCompany(ctx, meta, {
    action: "STATUS_CHANGE",
    entityType: "FollowUp",
    entityId: saved.id,
    summary: `Marked done: ${label}${key ? ` (${key.split(":").pop()})` : ""}`,
  });
  return { id: saved.id, done: true };
}

/** Snooze: it comes back (in the list and as a reminder) on the chosen day. */
export async function snoozeFollowUp(
  ctx: CompanyContext,
  raw: unknown,
  meta?: RequestMeta,
  now: Date = new Date(),
) {
  const input = snoozeSchema.parse(raw);
  if (input.until <= today(ctx, now)) {
    throw new AppError("VALIDATION", "Choose a later day.", { until: ["Choose a later day."] });
  }
  if (input.until > addDays(today(ctx, now), 366)) {
    throw new AppError("VALIDATION", "Choose a day within a year.", {
      until: ["Choose a day within a year."],
    });
  }
  const { row, label } = await resolveMark(ctx, input.mark);
  const data = { snoozedUntil: dateColumn(input.until), status: "OPEN" as const };
  const saved = row
    ? await ctx.db.followUp.update({ where: { id: row.id }, data })
    : await ctx.db.followUp.create({
        data: {
          companyId: ctx.company.id,
          ...markData(input.mark),
          ...data,
          createdById: ctx.user.id,
        },
      });
  await auditInCompany(ctx, meta, {
    action: "UPDATE",
    entityType: "FollowUp",
    entityId: saved.id,
    summary: `Snoozed ${label} to ${formatDay(input.until)}`,
  });
  return { id: saved.id, until: input.until };
}

/** Who may write down a buyer's promise to pay (it changes no money). */
export const mayRecordPromise = (ctx: Pick<CompanyContext, "can">) =>
  ctx.can("sales.order.create") ||
  ctx.can("sales.invoice.edit") ||
  ctx.can("accounts.receipts.record");

/**
 * The day the buyer promised to pay an invoice (and a short note), or null to
 * clear it. A reminder comes on that day to whoever wrote it down and the
 * owner, until the invoice is paid in full. No money moves.
 */
export async function setPromisedPayment(
  ctx: CompanyContext,
  invoiceId: string,
  raw: unknown,
  meta?: RequestMeta,
) {
  if (ctx.byAi || !mayRecordPromise(ctx)) {
    throw new AppError("FORBIDDEN", "You do not have permission to note a promised payment.");
  }
  const input = promiseSchema.parse(raw);
  const invoice = await ctx.db.invoice.findUnique({
    where: { id: invoiceId },
    select: { id: true, number: true, status: true, promisedPayOn: true },
  });
  if (!invoice) throw new AppError("NOT_FOUND", "Invoice not found.");
  if (input.promisedPayOn && (invoice.status === "VOID" || invoice.status === "PAID")) {
    throw new AppError("VALIDATION", `Invoice ${invoice.number} is not waiting for money.`);
  }
  await ctx.db.invoice.update({
    where: { id: invoice.id },
    data: {
      promisedPayOn: input.promisedPayOn ? dateColumn(input.promisedPayOn) : null,
      promiseNote: input.promisedPayOn ? input.note || null : null,
    },
  });
  // Kept under its own name: the reminder goes to whoever wrote the promise down.
  await auditInCompany(ctx, meta, {
    action: "UPDATE",
    entityType: "InvoicePromise",
    entityId: invoice.id,
    summary: input.promisedPayOn
      ? `Buyer promised to pay invoice ${invoice.number} on ${formatDay(input.promisedPayOn)}${input.note ? ` (${input.note})` : ""}`
      : `Cleared the promised payment date of invoice ${invoice.number}`,
    before: { promisedPayOn: invoice.promisedPayOn ? dateOnly(invoice.promisedPayOn) : null },
    after: { promisedPayOn: input.promisedPayOn },
  });
  return {
    promisedPayOn: input.promisedPayOn,
    note: input.promisedPayOn ? input.note || null : null,
  };
}

/** Days a Home card's Snooze offers: tomorrow, in 3 days, in a week. */
export const SNOOZE_DAYS = [1, 3, 7] as const;

/**
 * Home's "Today's follow-ups": what is due today or overdue (quotations ending,
 * invoices due, promised payments, "Follow up on" dates), only of kinds and
 * records this person opens, most overdue first.
 */
export async function todaysFollowUps(ctx: CompanyContext, now: Date = new Date()) {
  const tz = ctx.company.timezone;
  const todayDay = today(ctx, now);
  const items: Array<{
    key: string;
    kind: FollowUpType;
    title: string;
    detail: string;
    dueOn: string;
    daysLeft: number;
    href: string | null;
    mark: z.input<typeof markSchema>;
  }> = [];
  for (const kind of FOLLOW_UP_TYPES) {
    if (
      kind === "FOLLOW_UP"
        ? !ctx.can("sales.view") && !ctx.can("parties.view")
        : !ctx.can("sales.view")
    ) {
      continue;
    }
    const found = await dueItems(ctx.company.id, kind, todayDay, tz, prisma, 100);
    for (const item of found) {
      if (kind === "FOLLOW_UP" && !mayOpenFollowUp(ctx, item)) continue;
      items.push({
        key: `${kind}:${item.recordId}`,
        kind,
        title: item.title,
        detail: item.detail,
        // A snoozed quotation or invoice date still tells its own day (and how late it is).
        dueOn: item.originalDay ?? item.dueDay,
        daysLeft: daysBetween(todayDay, item.originalDay ?? item.dueDay),
        href: recordHref(ctx, item.link),
        mark:
          kind === "FOLLOW_UP"
            ? { target: "followUp", id: item.recordId }
            : {
                target: "date",
                kind,
                recordId: item.recordId,
                day: item.originalDay ?? item.dueDay,
              },
      });
    }
  }
  items.sort((a, b) => a.dueOn.localeCompare(b.dueOn) || a.title.localeCompare(b.title));
  return {
    today: todayDay,
    items: items.slice(0, 50),
    more: Math.max(0, items.length - 50),
    snoozeTo: SNOOZE_DAYS.map((days) => ({ days, day: addDays(todayDay, days) })),
  };
}

export type TodaysFollowUps = Awaited<ReturnType<typeof todaysFollowUps>>;

/** Whether this person sees the Home card at all. */
export const seesFollowUps = (ctx: Pick<CompanyContext, "can">) =>
  ctx.can("sales.view") || ctx.can("parties.view");

/** An invoice's promised payment date and note, for its page (sales.view). */
export async function getPromise(ctx: CompanyContext, invoiceId: string) {
  if (!ctx.can("sales.view"))
    throw new AppError("FORBIDDEN", "You do not have permission to see invoices.");
  const invoice = await ctx.db.invoice.findUnique({
    where: { id: invoiceId },
    select: { promisedPayOn: true, promiseNote: true, status: true },
  });
  if (!invoice) throw new AppError("NOT_FOUND", "Invoice not found.");
  return {
    on: invoice.promisedPayOn ? dateOnly(invoice.promisedPayOn) : null,
    note: invoice.promiseNote,
    open: invoice.status === "UNPAID" || invoice.status === "PARTIALLY_PAID",
    canEdit: mayRecordPromise(ctx),
    today: today(ctx, new Date()),
  };
}
