import type { TaskPriority } from "@prisma/client";

import type { Db } from "@/lib/db-types";
import { dateColumn, dateOnly, localDay, localTime, nextDay, startOfDayInZone } from "@/lib/dates";
import { formatAmount, formatDay } from "@/lib/format";
import { prisma } from "@/lib/prisma";
import { COMPLIANCE_TYPE_LABELS } from "@/modules/compliance/status";
import { STAGE_LABELS } from "@/modules/production/timeline";
import type { AutoType } from "@/modules/reminders/rules";

/*
 * The dates automatic reminders watch, read straight from the records so that a
 * moved date, a finished project or a delivered order is seen at once:
 *   PRODUCTION_DEADLINE  planned and active projects' target dates (on hold = paused)
 *   GOODS_IN_HOUSE       open purchase orders' expected dates
 *   SHIPMENT             open sales orders' shipment dates
 *   COMPLIANCE_EXPIRY    current licences' expiry dates
 *   TASK_DUE             open tasks' due dates
 * The same list feeds the "coming up" agenda.
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

const join = (...parts: Array<string | null | undefined | false>) =>
  parts.filter(Boolean).join(" · ");

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
  }
}

const SUBJECT: Record<AutoType, string> = {
  PRODUCTION_DEADLINE: "Production deadline",
  GOODS_IN_HOUSE: "Goods due in-house",
  SHIPMENT: "Shipment due",
  COMPLIANCE_EXPIRY: "Renewal due",
  TASK_DUE: "Task due",
};

const DATE_LABEL: Record<AutoType, string> = {
  PRODUCTION_DEADLINE: "Target date",
  GOODS_IN_HOUSE: "Expected in-house",
  SHIPMENT: "Ship by",
  COMPLIANCE_EXPIRY: "Expires",
  TASK_DUE: "Due",
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

/** The reminder's subject and text: what, when (and how far off), and the details. */
export function reminderText(item: DueItem, daysLeft: number) {
  const expired = item.type === "COMPLIANCE_EXPIRY" && daysLeft < 0;
  const label = expired ? EXPIRED.label : DATE_LABEL[item.type];
  const when = `${label} ${formatDay(item.dueDay)}${item.dueTime ? ` ${item.dueTime}` : ""}`;
  const relative =
    daysLeft < 0 && !expired ? `overdue, ${relativeDays(daysLeft)}` : relativeDays(daysLeft);
  return {
    subject: `${expired ? EXPIRED.subject : SUBJECT[item.type]}: ${item.title}`,
    body: `${when} (${relative}). ${item.detail}`.trim(),
  };
}
