import { createHash } from "node:crypto";

import type { AiBotLink, Prisma } from "@prisma/client";

import { groupAmount } from "@/lib/display";
import { AppError } from "@/lib/errors";
import { prisma } from "@/lib/prisma";
import type { RequestMeta } from "@/lib/request-meta";
import type { CompanyContext } from "@/modules/auth/context";
import type { PermissionKey } from "@/modules/rbac/permissions";

import { APPROVAL_KINDS, type ApprovalKind, KIND_CODE } from "./approval-codes";
import { botOwner } from "./owner";
import type { BotOut } from "./render";

/*
 * Approvals on the bot (Release 5). When something waits for a person's
 * approval (a booking or a booking's new revision, a payroll, a leave request,
 * an expense claim), each linked person who may approve it gets one message
 * with its key facts and Approve / Reject buttons, unless they turned off
 * "Send me approvals on Telegram". A press calls the same service the ERP's
 * own button calls, as that person, with their permissions read again at the
 * press. Approving a booking or a payroll asks for the PIN first (the bot's PIN
 * flow). An expense claim is approved only in the ERP, where the person picks
 * the account it is paid from: the bot offers Reject and the ERP's link, never
 * a payment from an account it chose itself. A button whose item was decided elsewhere answers who
 * decided it; one whose facts changed after its message is refused and the
 * item is shown again as it is now. Never for deletions, permissions or roles.
 * These are the system's own messages: the AI switch does not stop them.
 *
 * Purchase orders are approved as bookings (a booking is the purchase order
 * that needs approval); the ERP has no separate purchase order or discount
 * approval, so the bot has none either.
 */

export { APPROVAL_KINDS, type ApprovalKind };

export type ApprovalFacts = {
  /** Still waiting for a decision. */
  pending: boolean;
  /** Who decided it, when it is no longer waiting. */
  decidedBy: string | null;
  title: string;
  lines: string[];
  href: string;
};

type Flow = {
  /** What it is, in a few words ("booking"). */
  noun: string;
  /** Who gets it and may press: the same key the ERP's own button needs. */
  permission: PermissionKey;
  /** Approving it is about money or prices: the PIN first ("approve the payroll"). */
  pinToApprove: string | null;
  /** The ERP lets it be turned down (with a reason). */
  canReject: boolean;
  facts(companyId: string, id: string): Promise<ApprovalFacts | null>;
  /** Approving on the bot; without it the item is approved only in the ERP. */
  approve?(ctx: CompanyContext, id: string, meta: RequestMeta): Promise<string>;
  /** Why it is approved only in the ERP ("where you pick the …"). */
  approveInErp?: string;
  reject?(ctx: CompanyContext, id: string, reason: string, meta: RequestMeta): Promise<string>;
};

const userName = async (id: string | null | undefined) =>
  id
    ? ((await prisma.user.findUnique({ where: { id }, select: { name: true } }))?.name ?? null)
    : null;

/** The person whose last decision on a record the activity log kept. */
async function lastDecider(companyId: string, entityType: string, entityId: string) {
  const row = await prisma.auditLog.findFirst({
    where: { companyId, entityType, entityId, action: { in: ["STATUS_CHANGE", "UPDATE"] } },
    orderBy: { createdAt: "desc" },
    select: { user: { select: { name: true } } },
  });
  return row?.user?.name ?? null;
}

const day = (d: Date | null | undefined) => (d ? d.toISOString().slice(0, 10) : "not set");

const UNIT_WORD: Record<string, string> = {
  PCS: "pcs",
  METER: "m",
  YARD: "yd",
  KG: "kg",
  GRAM: "g",
  ROLL: "rolls",
};

/** "1,200 kg + 500 pcs": a booking's quantities, added up per unit. */
function quantitiesByUnit(lines: Array<{ quantity: Prisma.Decimal; unit: string }>) {
  const byUnit = new Map<string, number>();
  for (const l of lines) byUnit.set(l.unit, (byUnit.get(l.unit) ?? 0) + Number(l.quantity));
  return (
    [...byUnit]
      .map(
        ([unit, n]) =>
          `${n.toLocaleString("en-US", { maximumFractionDigits: 3 })} ${UNIT_WORD[unit] ?? unit.toLowerCase()}`,
      )
      .join(" + ") || "none"
  );
}

const FLOWS: Record<ApprovalKind, Flow> = {
  booking: {
    noun: "booking",
    permission: "production.bookings.approve",
    pinToApprove: "approve the booking (prices)",
    // The ERP has no "turn down" for a booking: it stays a draft until approved or cancelled there.
    canReject: false,
    async facts(companyId, id) {
      const b = await prisma.booking.findFirst({
        where: { id, companyId },
        select: {
          stage: true,
          revision: true,
          approvedById: true,
          title: true,
          deliveryPlace: true,
          paymentTerms: true,
          order: {
            select: {
              number: true,
              status: true,
              expectedDate: true,
              supplier: { select: { name: true } },
              lines: {
                select: {
                  quantity: true,
                  amount: true,
                  priceLater: true,
                  rawMaterial: { select: { unit: true } },
                },
              },
            },
          },
          company: { select: { currency: true } },
        },
      });
      if (!b) return null;
      const lines = b.order.lines;
      const value = lines.reduce((sum, l) => sum + Number(l.amount), 0);
      const currency = b.company.currency;
      const { bookingDocNo } = await import("@/modules/production/booking-revisions");
      const open = !["CANCELLED", "CLOSED"].includes(b.order.status);
      return {
        pending: b.stage === "DRAFT" && open,
        decidedBy:
          b.stage !== "DRAFT"
            ? await userName(b.approvedById)
            : open
              ? null
              : await lastDecider(companyId, "Booking", id),
        title: `Booking ${bookingDocNo(b.order.number, b.revision)}${b.revision > 0 ? " (a changed booking)" : ""}`,
        lines: [
          `Supplier: ${b.order.supplier.name}`,
          ...(b.title ? [`For: ${b.title}`] : []),
          `Items: ${lines.length}`,
          `Total quantity: ${quantitiesByUnit(lines.map((l) => ({ quantity: l.quantity, unit: l.rawMaterial.unit })))}`,
          `Total value: ${currency} ${groupAmount(value.toFixed(2), currency)}${lines.some((l) => l.priceLater) ? " (some prices are agreed when the goods arrive)" : ""}`,
          `In-house date: ${day(b.order.expectedDate)}`,
          ...(b.deliveryPlace ? [`Delivery place: ${b.deliveryPlace}`] : []),
          ...(b.paymentTerms ? [`Payment terms: ${b.paymentTerms}`] : []),
        ],
        href: `/production/bookings`,
      };
    },
    async approve(ctx, id, meta) {
      const { approveBooking } = await import("@/modules/production/booking.service");
      const booking = await approveBooking(ctx, id, meta);
      return `Approved: booking ${booking.docNo}. Nothing goes to the supplier until it is printed and sent from the ERP.`;
    },
  },
  payroll: {
    noun: "payroll",
    permission: "hr.payroll.approve",
    pinToApprove: "approve the payroll (salaries)",
    canReject: false,
    async facts(companyId, id) {
      const run = await prisma.payrollRun.findFirst({
        where: { id, companyId },
        select: {
          status: true,
          year: true,
          month: true,
          totalGross: true,
          totalNet: true,
          approvedById: true,
          _count: { select: { items: true } },
        },
      });
      if (!run) return null;
      const company = await prisma.company.findUniqueOrThrow({
        where: { id: companyId },
        select: { currency: true },
      });
      const month = new Date(Date.UTC(run.year, run.month - 1, 1)).toLocaleString("en-GB", {
        month: "long",
        year: "numeric",
        timeZone: "UTC",
      });
      return {
        pending: run.status === "DRAFT",
        decidedBy: run.status === "DRAFT" ? null : await userName(run.approvedById),
        title: `Payroll for ${month}`,
        lines: [
          `Employees: ${run._count.items}`,
          `Gross: ${company.currency} ${groupAmount(run.totalGross.toFixed(2), company.currency)}`,
          `Net pay: ${company.currency} ${groupAmount(run.totalNet.toFixed(2), company.currency)}`,
        ],
        href: `/hr/payroll/${id}`,
      };
    },
    async approve(ctx, id, meta) {
      const { approvePayrollRun } = await import("@/modules/hr/payroll.service");
      await approvePayrollRun(ctx, id, meta);
      return "Approved: the payroll is posted to the books. Pay it from the ERP.";
    },
  },
  leave: {
    noun: "leave request",
    permission: "hr.manage",
    pinToApprove: null,
    canReject: true,
    async facts(companyId, id) {
      const r = await prisma.leaveRequest.findFirst({
        where: { id, companyId },
        select: {
          status: true,
          startDate: true,
          endDate: true,
          days: true,
          halfDay: true,
          reason: true,
          approvedById: true,
          employee: { select: { name: true } },
          leaveType: { select: { name: true } },
        },
      });
      if (!r) return null;
      return {
        pending: r.status === "PENDING",
        decidedBy:
          r.status === "PENDING"
            ? null
            : r.status === "CANCELLED"
              ? ((await lastDecider(companyId, "LeaveRequest", id)) ?? "the person who asked")
              : await userName(r.approvedById),
        title: `Leave: ${r.employee.name}`,
        lines: [
          `Type: ${r.leaveType.name}`,
          `From ${day(r.startDate)} to ${day(r.endDate)} (${r.halfDay ? "half day" : `${r.days.toString()} day(s)`})`,
          ...(r.reason ? [`Reason: ${r.reason}`] : []),
        ],
        href: `/hr/leave/${id}`,
      };
    },
    async approve(ctx, id, meta) {
      const { approveLeave } = await import("@/modules/hr/leave.service");
      await approveLeave(ctx, id, {}, meta);
      return "Approved: the leave is on the calendar.";
    },
    async reject(ctx, id, reason, meta) {
      const { rejectLeave } = await import("@/modules/hr/leave.service");
      await rejectLeave(ctx, id, { note: reason }, meta);
      return "Rejected: the leave request is turned down with your reason.";
    },
  },
  expense: {
    noun: "expense claim",
    permission: "accounts.payments.record",
    // Paying it back needs the account it is paid from: chosen in the ERP, never by the bot.
    pinToApprove: null,
    canReject: true,
    approveInErp: "where you pick the “Paid from” account",
    async facts(companyId, id) {
      const e = await prisma.expense.findFirst({
        where: { id, companyId },
        select: {
          number: true,
          amount: true,
          paymentType: true,
          description: true,
          purpose: true,
          voidedAt: true,
          journalEntryId: true,
          head: { select: { name: true } },
          supplier: { select: { name: true } },
          createdBy: { select: { name: true } },
          journalEntry: { select: { postedBy: { select: { name: true } } } },
        },
      });
      if (!e) return null;
      const company = await prisma.company.findUniqueOrThrow({
        where: { id: companyId },
        select: { currency: true },
      });
      const pending = !e.voidedAt && !e.journalEntryId;
      return {
        pending,
        decidedBy: pending
          ? null
          : e.journalEntryId
            ? (e.journalEntry?.postedBy?.name ?? null)
            : await lastDecider(companyId, "Expense", id),
        title: `Expense claim ${e.number}`,
        lines: [
          `Amount: ${company.currency} ${groupAmount(e.amount.toFixed(2), company.currency)}`,
          `Head: ${e.head.name}`,
          ...(e.createdBy ? [`Claimed by: ${e.createdBy.name}`] : []),
          ...(e.purpose || e.description ? [`For: ${e.purpose ?? e.description}`] : []),
          e.paymentType === "DUE"
            ? `Approving puts it on ${e.supplier?.name ?? "the supplier"}'s account. Approve it in the ERP.`
            : "Approve it in the ERP, where you pick the “Paid from” account. Reject works here.",
        ],
        href: `/accounts/expenses`,
      };
    },
    async reject(ctx, id, reason, meta) {
      const { rejectExpense } = await import("@/modules/expenses/expense.service");
      const e = await rejectExpense(ctx, id, { reason }, meta);
      return `Rejected: claim ${e.number} is turned down with your reason.`;
    },
  },
};

export const flowOf = (kind: ApprovalKind) => FLOWS[kind];

/** A short mark of what a message showed: it changes when any of its facts change. */
export const factsVersion = (facts: Pick<ApprovalFacts, "title" | "lines">) =>
  createHash("sha256")
    .update(JSON.stringify([facts.title, facts.lines]))
    .digest("hex")
    .slice(0, 8);

const appUrl = () => (process.env.APP_URL || "http://localhost:3000").replace(/\/$/, "");

/** The bot message for an item waiting for approval, with its buttons. */
export function renderApproval(kind: ApprovalKind, id: string, facts: ApprovalFacts): BotOut {
  const flow = FLOWS[kind];
  const version = factsVersion(facts);
  const code = KIND_CODE[kind];
  const row = [
    ...(flow.approve ? [{ label: "Approve", data: `ok:${code}:${id}:${version}` }] : []),
    ...(flow.canReject ? [{ label: "Reject", data: `no:${code}:${id}:${version}` }] : []),
  ];
  return {
    text: [
      `Waiting for your approval: ${facts.title}`,
      ...facts.lines.map((l) => `• ${l}`),
      ...(flow.approve && flow.pinToApprove ? ["Approving asks for your PIN."] : []),
      flow.approve ? `${appUrl()}${facts.href}` : `Approve in the ERP: ${appUrl()}${facts.href}`,
    ].join("\n"),
    buttons: row.length ? [row] : [],
  };
}

/** Whether this person wants approvals on the bot in this store (no choice saved: yes). */
export async function wantsApprovals(companyId: string, userId: string) {
  const row = await prisma.botApprovalSetting.findUnique({
    where: { companyId_userId: { companyId, userId } },
    select: { sendApprovals: true },
  });
  return row?.sendApprovals ?? true;
}

/** Which approvals a person's permissions let them answer (for the screen). */
export const approvalsFor = (can: (key: PermissionKey) => boolean) =>
  APPROVAL_KINDS.filter((k) => can(FLOWS[k].permission));

/** Of the company's linked bots, the ones whose person may approve this kind and wants it. */
export async function approverLinks(companyId: string, kind: ApprovalKind) {
  const links = await prisma.aiBotLink.findMany({
    where: { companyId, linkedAt: { not: null }, chatId: { not: null } },
  });
  const out: AiBotLink[] = [];
  for (const link of links) {
    const owner = await botOwner(link);
    if (!owner) continue;
    if (!owner.access.permissions.has(FLOWS[kind].permission)) continue;
    if (!(await wantsApprovals(companyId, owner.user.id))) continue;
    out.push(link);
  }
  return out;
}

/**
 * Tells the linked approvers that something waits for them. Queued to the
 * background worker (the work that made it is never held up or broken by
 * Telegram); nothing happens when no approver is linked. Never throws.
 */
export async function notifyApprovers(companyId: string, kind: ApprovalKind, id: string) {
  try {
    const { pushToBot } = await import("./push");
    await pushToBot(companyId, { kind: "approval", what: kind, id });
  } catch (error) {
    console.error("[bot] approval not queued", error instanceof Error ? error.message : error);
  }
}

/** The person's own choice, for the screen. */
export async function getApprovalSetting(ctx: CompanyContext) {
  return {
    sendApprovals: await wantsApprovals(ctx.company.id, ctx.user.id),
    kinds: approvalsFor(ctx.can).map((k) => FLOWS[k].noun),
  };
}

/** Turns the person's own approvals on the bot on or off (only their own). */
export async function setApprovalSetting(ctx: CompanyContext, raw: unknown) {
  const on =
    raw && typeof raw === "object" && "sendApprovals" in raw
      ? (raw as { sendApprovals: unknown }).sendApprovals
      : undefined;
  if (typeof on !== "boolean") throw new AppError("VALIDATION", "Say on or off.");
  await prisma.botApprovalSetting.upsert({
    where: { companyId_userId: { companyId: ctx.company.id, userId: ctx.user.id } },
    create: { companyId: ctx.company.id, userId: ctx.user.id, sendApprovals: on },
    update: { sendApprovals: on },
  });
  return getApprovalSetting(ctx);
}

/** The company a button's item belongs to, among these stores (the tenant lock). */
export async function companyOfApproval(
  kind: ApprovalKind,
  id: string,
  companyIds: string[],
): Promise<string | null> {
  const where = { id, companyId: { in: companyIds } };
  const select = { companyId: true } as const;
  let row: { companyId: string } | null = null;
  switch (kind) {
    case "booking":
      row = await prisma.booking.findFirst({ where, select });
      break;
    case "payroll":
      row = await prisma.payrollRun.findFirst({ where, select });
      break;
    case "leave":
      row = await prisma.leaveRequest.findFirst({ where, select });
      break;
    case "expense":
      row = await prisma.expense.findFirst({ where, select });
      break;
  }
  return row?.companyId ?? null;
}

/** What a reason request keeps on the link while it waits for the next message. */
export type ReasonWait = {
  reason: { what: ApprovalKind; id: string; version: string };
  sourceId: string | null;
};

export const isReasonWait = (pending: Prisma.JsonValue | null | undefined): boolean =>
  Boolean(pending && typeof pending === "object" && !Array.isArray(pending) && "reason" in pending);
