import type { TaskPriority } from "@prisma/client";

import type { Db } from "@/lib/db-types";
import { dateColumn, dateOnly, localDay, localTime, nextDay, startOfDayInZone } from "@/lib/dates";
import { formatAmount, formatDay } from "@/lib/format";
import { prisma } from "@/lib/prisma";
import { COMPLIANCE_TYPE_LABELS } from "@/modules/compliance/status";
import { dueLeads } from "@/modules/leads/due";
import { STAGE_LABELS as LEAD_STAGE_LABELS } from "@/modules/leads/rules";
import { STAGE_LABELS } from "@/modules/production/timeline";
import type { PermissionKey } from "@/modules/rbac/permissions";
import type { AutoType } from "@/modules/reminders/rules";

/*
 * The dates automatic reminders watch, read straight from the records so that a
 * moved date, a finished project or a delivered order is seen at once:
 *   PRODUCTION_DEADLINE  planned and active projects' target dates (on hold = paused)
 *   GOODS_IN_HOUSE       open purchase orders' expected dates
 *   SHIPMENT             open sales orders' shipment dates
 *   COMPLIANCE_EXPIRY    current licences' expiry dates
 *   TASK_DUE             open tasks' due dates
 *   QUOTATION_EXPIRY     draft and sent quotations' Valid until dates
 *   PAYMENT_DUE          unpaid invoices' due dates
 *   PROMISED_PAYMENT     the day a buyer promised to pay an unpaid invoice
 *   FOLLOW_UP            "Follow up on" dates set by hand on a buyer, quotation or order
 * The same list feeds the "coming up" agenda and Home's "Today's follow-ups".
 * A follow-up marked Done from Home is left out; a snoozed one comes back on
 * its new day (FollowUp rows, follow-up.service.ts).
 */

export type DueItem = {
  type: AutoType;
  recordId: string;
  /** The date, in company time ("2026-10-12"). */
  dueDay: string;
  /** Tasks due at a set time ("10:30"). */
  dueTime: string | null;
  title: string;
  detail: string;
  /** People on the record: who raised the purchase order, who created the task. */
  ownerUserIds: string[];
  /** Staff on the record: the task's assignee. */
  ownerEmployeeIds: string[];
  /** Licences: days before expiry when the renewal window opens. */
  alertDaysBefore: number | null;
  link: { type: string; id: string };
  /** Follow-ups: the mark that Done and Snooze put on this date ("KIND:record:day"). */
  markKey?: string;
  /** Follow-ups: the day it was due before it was snoozed. */
  originalDay?: string;
  /** Leads not given to anyone: everyone who sees leads sees them in the agenda. */
  openToAll?: boolean;
  /** Reminder columns that point at the record. */
  refs: {
    projectId?: string;
    orderId?: string;
    purchaseOrderId?: string;
    complianceDocumentId?: string;
    taskId?: string;
  };
};

/** Sales orders not yet delivered or cancelled. */
export const OPEN_ORDER_STATUSES = ["DRAFT", "CONFIRMED", "PROCESSING", "PACKED"] as const;
const OPEN_PO_STATUSES = ["OPEN", "PARTIALLY_RECEIVED"] as const;

const PRIORITY_NOTE: Partial<Record<TaskPriority, string>> = {
  HIGH: "High priority",
  URGENT: "Urgent",
};

const ORDER_STATUS: Record<(typeof OPEN_ORDER_STATUSES)[number], string> = {
  DRAFT: "Draft",
  CONFIRMED: "Confirmed",
  PROCESSING: "Partly delivered",
  PACKED: "Packed",
};

const NEXT_WORDS: Record<string, string> = {
  EMAIL: "email",
  CALL: "call",
  MEETING: "meeting",
  SAMPLE: "sample",
  QUOTE: "quotation",
  OTHER: "follow up",
};

const join = (...parts: Array<string | null | undefined | false>) =>
  parts.filter(Boolean).join(" · ");

/** Quotations a buyer may still take (their end date matters). */
const LIVE_QUOTATIONS = ["DRAFT", "SENT"] as const;
const OPEN_INVOICES = ["UNPAID", "PARTIALLY_PAID"] as const;

/** The mark on a watched date (Done or Snooze from Home). */
export const followUpKey = (type: string, recordId: string, day: string) =>
  `${type}:${recordId}:${day}`;

/** Whether this person opens the record a follow-up is about. */
export function mayOpenFollowUp(
  ctx: { can: (p: PermissionKey) => boolean },
  item: Pick<DueItem, "link">,
) {
  return item.link.type === "Party" ? ctx.can("parties.view") : ctx.can("sales.view");
}

/**
 * Leaves out watched dates marked Done, and moves snoozed ones to their new
 * day (only those on or before `untilDay` stay).
 */
async function applyMarks(
  db: Db,
  companyId: string,
  items: DueItem[],
  untilDay: string,
): Promise<DueItem[]> {
  if (items.length === 0) return items;
  const marks = await db.followUp.findMany({
    where: { companyId, sourceKey: { in: items.map((i) => i.markKey!) } },
    select: { sourceKey: true, status: true, snoozedUntil: true },
  });
  const byKey = new Map(marks.map((m) => [m.sourceKey, m]));
  return items.flatMap((item) => {
    const mark = byKey.get(item.markKey!);
    if (!mark) return [item];
    if (mark.status === "DONE") return [];
    if (!mark.snoozedUntil) return [item];
    const day = dateOnly(mark.snoozedUntil);
    if (day <= item.dueDay) return [item];
    return day <= untilDay ? [{ ...item, originalDay: item.dueDay, dueDay: day }] : [];
  });
}

async function currencyOf(db: Db, companyId: string) {
  const company = await db.company.findUnique({
    where: { id: companyId },
    select: { currency: true },
  });
  return company?.currency ?? "BDT";
}

/**
 * Open records of one kind whose date is on or before `untilDay` (overdue ones
 * included), soonest first.
 */
export async function dueItems(
  companyId: string,
  type: AutoType,
  untilDay: string,
  timeZone: string,
  db: Db = prisma,
  limit = 1000,
): Promise<DueItem[]> {
  const endInstant = startOfDayInZone(nextDay(untilDay), timeZone);
  switch (type) {
    case "PRODUCTION_DEADLINE": {
      const projects = await db.productionProject.findMany({
        where: { companyId, status: { in: ["PLANNED", "ACTIVE"] }, targetDate: { lt: endInstant } },
        select: {
          id: true,
          code: true,
          name: true,
          stage: true,
          targetDate: true,
          targetQuantity: true,
          producedQtyA: true,
          producedQtyB: true,
          factoryName: true,
          factory: { select: { name: true } },
        },
        orderBy: [{ targetDate: "asc" }, { id: "asc" }],
        take: limit,
      });
      return projects.map((p) => ({
        type,
        recordId: p.id,
        dueDay: localDay(p.targetDate, timeZone),
        dueTime: null,
        title: `${p.code} ${p.name}`,
        detail: join(
          `Stage: ${STAGE_LABELS[p.stage]}`,
          `${formatAmount(p.producedQtyA + p.producedQtyB, 0, "BDT")} of ${formatAmount(p.targetQuantity, 0, "BDT")} pcs made`,
          p.factory?.name ?? p.factoryName,
        ),
        ownerUserIds: [],
        ownerEmployeeIds: [],
        alertDaysBefore: null,
        link: { type: "ProductionProject", id: p.id },
        refs: { projectId: p.id },
      }));
    }
    case "GOODS_IN_HOUSE": {
      const orders = await db.purchaseOrder.findMany({
        where: {
          companyId,
          status: { in: [...OPEN_PO_STATUSES] },
          expectedDate: { not: null, lte: dateColumn(untilDay) },
        },
        select: {
          id: true,
          number: true,
          status: true,
          expectedDate: true,
          supplierRef: true,
          createdById: true,
          supplier: { select: { name: true } },
          project: { select: { code: true } },
          _count: { select: { lines: true } },
        },
        orderBy: [{ expectedDate: "asc" }, { id: "asc" }],
        take: limit,
      });
      return orders.map((o) => ({
        type,
        recordId: o.id,
        dueDay: dateOnly(o.expectedDate!),
        dueTime: null,
        title: `${o.number} from ${o.supplier.name}`,
        detail: join(
          o.status === "OPEN" ? "Nothing received yet" : "Partly received",
          `${o._count.lines} item${o._count.lines === 1 ? "" : "s"}`,
          o.project && `For ${o.project.code}`,
          o.supplierRef && `Ref ${o.supplierRef}`,
        ),
        ownerUserIds: o.createdById ? [o.createdById] : [],
        ownerEmployeeIds: [],
        alertDaysBefore: null,
        link: { type: "PurchaseOrder", id: o.id },
        refs: { purchaseOrderId: o.id },
      }));
    }
    case "SHIPMENT": {
      const orders = await db.salesOrder.findMany({
        where: {
          companyId,
          status: { in: [...OPEN_ORDER_STATUSES] },
          shipmentDate: { not: null, lte: dateColumn(untilDay) },
        },
        select: {
          id: true,
          number: true,
          status: true,
          shipmentDate: true,
          customerName: true,
          party: { select: { name: true } },
        },
        orderBy: [{ shipmentDate: "asc" }, { id: "asc" }],
        take: limit,
      });
      return orders.map((o) => ({
        type,
        recordId: o.id,
        dueDay: dateOnly(o.shipmentDate!),
        dueTime: null,
        title: `${o.number} for ${o.party?.name ?? o.customerName ?? "walk-in customer"}`,
        detail: `Order status: ${ORDER_STATUS[o.status as (typeof OPEN_ORDER_STATUSES)[number]]}`,
        ownerUserIds: [],
        ownerEmployeeIds: [],
        alertDaysBefore: null,
        link: { type: "SalesOrder", id: o.id },
        refs: { orderId: o.id },
      }));
    }
    case "COMPLIANCE_EXPIRY": {
      const docs = await db.complianceDocument.findMany({
        where: {
          companyId,
          supersededAt: null,
          archivedAt: null,
          expiryDate: { not: null, lte: dateColumn(untilDay) },
        },
        orderBy: [{ expiryDate: "asc" }, { id: "asc" }],
        take: limit,
      });
      return docs.map((d) => ({
        type,
        recordId: d.id,
        dueDay: dateOnly(d.expiryDate!),
        dueTime: null,
        title: [d.title, d.number].filter(Boolean).join(" "),
        detail: join(
          COMPLIANCE_TYPE_LABELS[d.type],
          d.issuingAuthority && `Issued by ${d.issuingAuthority}`,
        ),
        ownerUserIds: [],
        ownerEmployeeIds: [],
        alertDaysBefore: d.alertDaysBefore,
        link: { type: "ComplianceDocument", id: d.id },
        refs: { complianceDocumentId: d.id },
      }));
    }
    case "LEAD_FOLLOW_UP": {
      const leads = await dueLeads(companyId, untilDay, db, limit);
      return leads.map((l) => ({
        type,
        recordId: l.id,
        dueDay: dateOnly(l.nextActionOn!),
        dueTime: null,
        title: `${l.number} ${l.name}`,
        detail: join(
          l.nextActionKind && `Next: ${NEXT_WORDS[l.nextActionKind]}`,
          l.nextActionNote,
          `Stage: ${LEAD_STAGE_LABELS[l.stage]}`,
          !l.ownerUserId && "Not given to anyone yet",
        ),
        ownerUserIds: l.ownerUserId ? [l.ownerUserId] : l.createdById ? [l.createdById] : [],
        ownerEmployeeIds: [],
        alertDaysBefore: null,
        openToAll: l.ownerUserId === null,
        link: { type: "Lead", id: l.id },
        refs: {},
      }));
    }
    case "TASK_DUE": {
      const tasks = await db.task.findMany({
        where: {
          companyId,
          status: { in: ["TODO", "IN_PROGRESS"] },
          dueAt: { not: null, lt: endInstant },
        },
        select: {
          id: true,
          title: true,
          priority: true,
          dueAt: true,
          createdById: true,
          assignee: { select: { id: true, name: true } },
          project: { select: { code: true } },
        },
        orderBy: [{ dueAt: "asc" }, { id: "asc" }],
        take: limit,
      });
      return tasks.map((t) => {
        const time = localTime(t.dueAt!, timeZone);
        return {
          type,
          recordId: t.id,
          dueDay: localDay(t.dueAt!, timeZone),
          dueTime: time === "00:00" ? null : time,
          title: t.title,
          detail: join(
            t.assignee ? `Assigned to ${t.assignee.name}` : "Not assigned yet",
            t.project && `Project ${t.project.code}`,
            PRIORITY_NOTE[t.priority],
          ),
          ownerUserIds: t.createdById ? [t.createdById] : [],
          ownerEmployeeIds: t.assignee ? [t.assignee.id] : [],
          alertDaysBefore: null,
          link: { type: "Task", id: t.id },
          refs: { taskId: t.id },
        };
      });
    }
    case "QUOTATION_EXPIRY": {
      const quotes = await db.quotation.findMany({
        where: {
          companyId,
          status: { in: [...LIVE_QUOTATIONS] },
          // Kept as the typed day at midnight UTC (like the other date-only columns).
          validUntil: { not: null, lte: dateColumn(untilDay) },
        },
        select: {
          id: true,
          number: true,
          status: true,
          validUntil: true,
          party: { select: { name: true } },
        },
        orderBy: [{ validUntil: "asc" }, { id: "asc" }],
        take: limit,
      });
      const items = quotes.map((q): DueItem => {
        const day = dateOnly(q.validUntil!);
        return {
          type,
          recordId: q.id,
          dueDay: day,
          dueTime: null,
          title: `Quotation ${q.number} for ${q.party.name}`,
          detail: q.status === "DRAFT" ? "Still a draft" : "Sent to the buyer",
          ownerUserIds: [],
          ownerEmployeeIds: [],
          alertDaysBefore: null,
          link: { type: "Quotation", id: q.id },
          markKey: followUpKey(type, q.id, day),
          refs: {},
        };
      });
      return applyMarks(db, companyId, items, untilDay);
    }
    case "PAYMENT_DUE":
    case "PROMISED_PAYMENT": {
      const promised = type === "PROMISED_PAYMENT";
      const [invoices, currency] = await Promise.all([
        db.invoice.findMany({
          where: {
            companyId,
            status: { in: [...OPEN_INVOICES] },
            dueAmount: { gt: 0 },
            ...(promised
              ? { promisedPayOn: { not: null, lte: dateColumn(untilDay) } }
              : { dueDate: { not: null, lt: endInstant } }),
          },
          select: {
            id: true,
            number: true,
            dueDate: true,
            promisedPayOn: true,
            promiseNote: true,
            dueAmount: true,
            orderId: true,
            party: { select: { name: true } },
            order: { select: { customerName: true } },
          },
          orderBy: [promised ? { promisedPayOn: "asc" } : { dueDate: "asc" }, { id: "asc" }],
          take: limit,
        }),
        currencyOf(db, companyId),
      ]);
      // Who wrote down each promise (the person to remind first).
      const promisers = promised
        ? await db.auditLog.findMany({
            where: {
              companyId,
              entityType: "InvoicePromise",
              entityId: { in: invoices.map((i) => i.id) },
            },
            select: { entityId: true, userId: true },
            orderBy: { createdAt: "desc" },
          })
        : [];
      const items = invoices.map((inv): DueItem => {
        const day = promised ? dateOnly(inv.promisedPayOn!) : localDay(inv.dueDate!, timeZone);
        const promiser = promisers.find((a) => a.entityId === inv.id)?.userId;
        return {
          type,
          recordId: inv.id,
          dueDay: day,
          dueTime: null,
          title: `Invoice ${inv.number} for ${inv.party?.name ?? inv.order.customerName ?? "walk-in customer"}`,
          detail: join(
            `${formatAmount(inv.dueAmount, 2, currency)} ${currency} still due`,
            promised && inv.promiseNote,
          ),
          ownerUserIds: promiser ? [promiser] : [],
          ownerEmployeeIds: [],
          alertDaysBefore: null,
          link: { type: "Invoice", id: inv.id },
          markKey: followUpKey(type, inv.id, day),
          refs: { orderId: inv.orderId },
        };
      });
      return applyMarks(db, companyId, items, untilDay);
    }
    case "FOLLOW_UP": {
      const rows = await db.followUp.findMany({
        where: {
          companyId,
          kind: "MANUAL",
          status: "OPEN",
          OR: [
            { snoozedUntil: null, dueOn: { lte: dateColumn(untilDay) } },
            { snoozedUntil: { lte: dateColumn(untilDay) } },
          ],
        },
        orderBy: [{ dueOn: "asc" }, { id: "asc" }],
        take: limit,
      });
      const [parties, quotes, orders] = await Promise.all([
        db.party.findMany({
          where: { companyId, id: { in: rows.flatMap((r) => (r.partyId ? [r.partyId] : [])) } },
          select: { id: true, name: true },
        }),
        db.quotation.findMany({
          where: {
            companyId,
            id: { in: rows.flatMap((r) => (r.quotationId ? [r.quotationId] : [])) },
          },
          select: { id: true, number: true, party: { select: { name: true } } },
        }),
        db.salesOrder.findMany({
          where: { companyId, id: { in: rows.flatMap((r) => (r.orderId ? [r.orderId] : [])) } },
          select: { id: true, number: true, customerName: true, party: { select: { name: true } } },
        }),
      ]);
      return rows.flatMap((r): DueItem[] => {
        const day = dateOnly(r.snoozedUntil ?? r.dueOn);
        let title: string;
        let link: DueItem["link"];
        let refs: DueItem["refs"] = {};
        if (r.quotationId) {
          const q = quotes.find((x) => x.id === r.quotationId);
          if (!q) return [];
          title = `Quotation ${q.number} for ${q.party.name}`;
          link = { type: "Quotation", id: q.id };
        } else if (r.orderId) {
          const o = orders.find((x) => x.id === r.orderId);
          if (!o) return [];
          title = `Order ${o.number} for ${o.party?.name ?? o.customerName ?? "walk-in customer"}`;
          link = { type: "SalesOrder", id: o.id };
          refs = { orderId: o.id };
        } else {
          const party = parties.find((x) => x.id === r.partyId);
          if (!party) return [];
          title = party.name;
          link = { type: "Party", id: party.id };
        }
        return [
          {
            type,
            recordId: r.id,
            dueDay: day,
            dueTime: null,
            title,
            detail: r.note ?? "",
            ownerUserIds: r.createdById ? [r.createdById] : [],
            ownerEmployeeIds: [],
            alertDaysBefore: null,
            link,
            markKey: `MANUAL:${r.id}`,
            refs,
          },
        ];
      });
    }
  }
}

const SUBJECT: Record<AutoType, string> = {
  PRODUCTION_DEADLINE: "Production deadline",
  GOODS_IN_HOUSE: "Goods due in-house",
  SHIPMENT: "Shipment due",
  COMPLIANCE_EXPIRY: "Renewal due",
  TASK_DUE: "Task due",
  QUOTATION_EXPIRY: "Quotation ends",
  PAYMENT_DUE: "Payment due",
  PROMISED_PAYMENT: "Promised payment",
  FOLLOW_UP: "Follow up",
  LEAD_FOLLOW_UP: "Lead follow-up",
};

const DATE_LABEL: Record<AutoType, string> = {
  PRODUCTION_DEADLINE: "Target date",
  GOODS_IN_HOUSE: "Expected in-house",
  SHIPMENT: "Ship by",
  COMPLIANCE_EXPIRY: "Expires",
  TASK_DUE: "Due",
  QUOTATION_EXPIRY: "Valid until",
  PAYMENT_DUE: "Due",
  PROMISED_PAYMENT: "Promised for",
  FOLLOW_UP: "Follow up on",
  LEAD_FOLLOW_UP: "Next step",
};

/** "today", "tomorrow", "in 3 days", "1 day ago". */
export function relativeDays(daysLeft: number): string {
  if (daysLeft === 0) return "today";
  if (daysLeft === 1) return "tomorrow";
  if (daysLeft > 1) return `in ${daysLeft} days`;
  return daysLeft === -1 ? "1 day ago" : `${-daysLeft} days ago`;
}

/** A licence that has run out is "expired", not "overdue". */
const EXPIRED = { subject: "Licence expired", label: "Expired" };

/**
 * The reminder's subject and text: what, when (and how far off), and the details.
 * `daysLeft` counts to the record's own date (before any snooze).
 */
export function reminderText(item: DueItem, daysLeft: number) {
  const day = item.originalDay ?? item.dueDay;
  if (item.type === "QUOTATION_EXPIRY" && daysLeft < 0) {
    return {
      subject: `Quotation expired: ${item.title}`,
      body: `Its validity ended on ${formatDay(day)} (${relativeDays(daysLeft)}). ${item.detail}`.trim(),
    };
  }
  const expired = item.type === "COMPLIANCE_EXPIRY" && daysLeft < 0;
  const label = expired ? EXPIRED.label : DATE_LABEL[item.type];
  const when = `${label} ${formatDay(day)}${item.dueTime ? ` ${item.dueTime}` : ""}`;
  const relative =
    daysLeft < 0 && !expired ? `overdue, ${relativeDays(daysLeft)}` : relativeDays(daysLeft);
  return {
    subject: `${expired ? EXPIRED.subject : SUBJECT[item.type]}: ${item.title}`,
    body: `${when} (${relative}). ${item.detail}`.trim(),
  };
}
