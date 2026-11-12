import type { SalesOrderStatus, TaFact } from "@prisma/client";
import { randomBytes } from "node:crypto";
import { z } from "zod";

import { addDays, dateColumn, dateOnly, localDay, weekday } from "@/lib/dates";
import type { Db } from "@/lib/db-types";
import { AppError } from "@/lib/errors";
import { prisma } from "@/lib/prisma";
import type { RequestMeta } from "@/lib/request-meta";
import { auditInCompany } from "@/modules/audit/audit.service";
import type { CompanyContext } from "@/modules/auth/context";
import { activeMembers } from "@/modules/reminders/audience";
import { sendInApp } from "@/modules/reminders/notification.service";
import {
  DEFAULT_TA_STEPS,
  FACT_LABELS,
  shipAtRisk,
  stepDay,
  TA_FACTS,
  type TaColour,
  taColour,
  type TaTemplateLike,
} from "@/modules/ta/ta-rules";

/*
 * The T&A calendar of every order (no AI). The company has one T&A template
 * (steps so many days before the ship date); each order with a ship date gets
 * its own copy, whose days can be changed on the order (audit-logged). Steps
 * finish by themselves from the ERP's facts (tech pack approved, booking
 * approved, fabric received, cutting report, sewing done, packing list, shipped)
 * or are ticked by hand. A late step tells the order's maker and the owner once
 * (inbox and bot alarm, sent with the AI on or off).
 */

/** Orders whose T&A still runs: not shipped, delivered, returned or cancelled. */
export const TA_OPEN_STATUSES: readonly SalesOrderStatus[] = [
  "DRAFT",
  "CONFIRMED",
  "PROCESSING",
  "PACKED",
];
const SHIPPED_STATUSES: readonly SalesOrderStatus[] = [
  "SHIPPED",
  "DELIVERED",
  "PARTIALLY_RETURNED",
  "RETURNED",
];

export function taAccess(ctx: CompanyContext) {
  const view = ctx.can("sales.view") || ctx.can("production.view");
  return {
    view,
    manage: view && (ctx.can("sales.order.create") || ctx.can("production.manage")),
    template: ctx.can("company.settings"),
  };
}

function mustView(ctx: CompanyContext) {
  if (!taAccess(ctx).view) {
    throw new AppError("FORBIDDEN", "The T&A calendar is not part of your role.");
  }
}

function mustManage(ctx: CompanyContext) {
  mustView(ctx);
  if (!taAccess(ctx).manage) {
    throw new AppError("FORBIDDEN", "Changing T&A steps is not part of your role.");
  }
}

const todayOf = (ctx: CompanyContext, now = new Date()) => localDay(now, ctx.company.timezone);

// ------------------------------------------------------------------ template and settings

/** The company's active T&A template, in order (the starting one until it is saved). */
export async function taTemplateOf(companyId: string, db: Db = prisma): Promise<TaTemplateLike[]> {
  const rows = await db.taTemplateStep.findMany({
    where: { companyId },
    orderBy: [{ position: "asc" }, { createdAt: "asc" }],
  });
  if (rows.length === 0) return DEFAULT_TA_STEPS.map((s) => ({ ...s }));
  return rows
    .filter((r) => r.active)
    .map((r) => ({
      key: r.key,
      name: r.name,
      daysBeforeShip: r.daysBeforeShip,
      fact: r.fact,
      critical: r.critical,
    }));
}

export async function taSettingsOf(companyId: string, db: Db = prisma) {
  const row = await db.taSettings.findUnique({ where: { companyId } });
  return { dueSoonDays: row?.dueSoonDays ?? 3 };
}

/** The template screen (company.settings): every step, switched off ones too. */
export async function getTaTemplate(ctx: CompanyContext) {
  if (!taAccess(ctx).template) {
    throw new AppError("FORBIDDEN", "Changing the T&A template is not part of your role.");
  }
  const rows = await ctx.db.taTemplateStep.findMany({
    orderBy: [{ position: "asc" }, { createdAt: "asc" }],
  });
  const steps =
    rows.length > 0
      ? rows.map((r) => ({
          id: r.id as string | null,
          name: r.name,
          daysBeforeShip: r.daysBeforeShip,
          fact: r.fact,
          critical: r.critical,
          active: r.active,
        }))
      : DEFAULT_TA_STEPS.map((s) => ({
          id: null as string | null,
          key: s.key,
          name: s.name,
          daysBeforeShip: s.daysBeforeShip,
          fact: s.fact,
          critical: s.critical,
          active: true,
        }));
  const settings = await taSettingsOf(ctx.company.id);
  return { steps, dueSoonDays: settings.dueSoonDays, facts: TA_FACTS, factLabels: FACT_LABELS };
}

export const templateSchema = z.object({
  steps: z
    .array(
      z.object({
        id: z.string().min(1).nullable().optional(),
        name: z.string().trim().min(1, "Give the step a name.").max(80),
        daysBeforeShip: z.coerce
          .number()
          .int("Whole days only.")
          .min(0, "0 or more days before the ship date.")
          .max(365, "At most 365 days."),
        fact: z.enum(TA_FACTS as [TaFact, ...TaFact[]]).nullable(),
        critical: z.boolean(),
        active: z.boolean(),
      }),
    )
    .min(1, "Keep at least one step.")
    .max(30, "At most 30 steps."),
  dueSoonDays: z.coerce.number().int().min(0).max(30),
});

/**
 * Saves the template (company.settings). Orders keep the T&A they already have:
 * the template is used for orders that get their T&A after this. Steps are never
 * deleted, only switched off, so old orders' steps keep their names.
 */
export async function saveTaTemplate(ctx: CompanyContext, raw: unknown, meta?: RequestMeta) {
  if (!taAccess(ctx).template) {
    throw new AppError("FORBIDDEN", "Changing the T&A template is not part of your role.");
  }
  const input = templateSchema.parse(raw);
  const companyId = ctx.company.id;
  await prisma.$transaction(async (tx) => {
    const existing = await tx.taTemplateStep.findMany({ where: { companyId } });
    // The first save writes the starting steps with their own keys (the AI order runs read them).
    const starting = existing.length === 0;
    const usedKeys = new Set(existing.map((e) => e.key));
    for (const [position, step] of input.steps.entries()) {
      const found = step.id ? existing.find((e) => e.id === step.id) : undefined;
      if (step.id && !found) throw new AppError("NOT_FOUND", "A step was not found.");
      const data = {
        name: step.name,
        daysBeforeShip: step.daysBeforeShip,
        fact: step.fact,
        critical: step.critical,
        active: step.active,
        position,
      };
      if (found) {
        await tx.taTemplateStep.update({ where: { id: found.id }, data });
      } else {
        const starter = starting
          ? DEFAULT_TA_STEPS.find((d) => d.name === step.name && !usedKeys.has(d.key))
          : undefined;
        const key = starter?.key ?? `STEP-${randomBytes(4).toString("hex").toUpperCase()}`;
        usedKeys.add(key);
        await tx.taTemplateStep.create({ data: { ...data, companyId, key } });
      }
    }
    await tx.taSettings.upsert({
      where: { companyId },
      create: { companyId, dueSoonDays: input.dueSoonDays, updatedById: ctx.user.id },
      update: { dueSoonDays: input.dueSoonDays, updatedById: ctx.user.id },
    });
  });
  await auditInCompany(ctx, meta, {
    action: "UPDATE",
    entityType: "TaTemplate",
    entityId: companyId,
    summary: `T&A template saved: ${input.steps
      .filter((s) => s.active)
      .map((s) => `${s.name} ${s.daysBeforeShip}d`)
      .join(", ")}; due soon within ${input.dueSoonDays} days`,
  });
  return { saved: true };
}

// ------------------------------------------------------------------ each order's steps

/**
 * Gives orders with a ship date their T&A from the template (once), and moves
 * the days of steps not changed by hand when the ship date moved.
 */
export async function syncOrderTa(companyId: string, orderIds: readonly string[]) {
  if (orderIds.length === 0) return;
  const orders = await prisma.salesOrder.findMany({
    where: { companyId, id: { in: [...orderIds] }, shipmentDate: { not: null } },
    select: {
      id: true,
      shipmentDate: true,
      status: true,
      taSteps: {
        select: { id: true, daysBeforeShip: true, plannedOn: true, dueChanged: true, doneAt: true },
      },
    },
  });
  let template: TaTemplateLike[] | null = null;
  for (const order of orders) {
    const ship = dateOnly(order.shipmentDate!);
    if (order.taSteps.length === 0) {
      if (order.status === "CANCELLED") continue;
      template ??= await taTemplateOf(companyId);
      await prisma.orderTaStep.createMany({
        data: template.map((step, position) => {
          const day = dateColumn(stepDay(ship, step.daysBeforeShip));
          return {
            companyId,
            salesOrderId: order.id,
            key: step.key,
            name: step.name,
            position,
            fact: step.fact,
            critical: step.critical,
            daysBeforeShip: step.daysBeforeShip,
            plannedOn: day,
            dueOn: day,
          };
        }),
        skipDuplicates: true,
      });
      continue;
    }
    for (const step of order.taSteps) {
      const planned = stepDay(ship, step.daysBeforeShip);
      if (dateOnly(step.plannedOn) === planned) continue;
      await prisma.orderTaStep.update({
        where: { id: step.id },
        data:
          step.dueChanged || step.doneAt
            ? { plannedOn: dateColumn(planned) }
            : { plannedOn: dateColumn(planned), dueOn: dateColumn(planned), lateNotifiedAt: null },
      });
    }
  }
}

/** What the ERP already shows for each order (the facts that finish steps by themselves). */
export async function orderFacts(
  companyId: string,
  orderIds: readonly string[],
): Promise<Map<string, Set<TaFact>>> {
  const facts = new Map<string, Set<TaFact>>(orderIds.map((id) => [id, new Set<TaFact>()]));
  if (orderIds.length === 0) return facts;
  const [orders, projects] = await Promise.all([
    prisma.salesOrder.findMany({
      where: { companyId, id: { in: [...orderIds] } },
      select: { id: true, status: true, packingList: { select: { id: true } } },
    }),
    prisma.productionProject.findMany({
      where: { companyId, salesOrderId: { in: [...orderIds] }, status: { not: "CANCELLED" } },
      select: {
        id: true,
        salesOrderId: true,
        batchId: true,
        stage: true,
        status: true,
        techPack: { select: { status: true } },
        _count: { select: { cuttingReports: true } },
      },
    }),
  ]);
  const projectIds = projects.map((p) => p.id);
  const batchIds = [...new Set(projects.map((p) => p.batchId).filter((b): b is string => !!b))];
  const linked = projectIds.length
    ? await prisma.purchaseOrder.findMany({
        where: {
          companyId,
          status: { not: "CANCELLED" },
          OR: [
            { projectId: { in: projectIds } },
            ...(batchIds.length ? [{ batchId: { in: batchIds } }] : []),
          ],
        },
        select: {
          projectId: true,
          batchId: true,
          booking: { select: { stage: true } },
          lines: {
            where: { rawMaterial: { kind: "FABRIC" } },
            select: { quantity: true, receivedQty: true },
          },
        },
      })
    : [];

  for (const order of orders) {
    const set = facts.get(order.id)!;
    const mine = projects.filter((p) => p.salesOrderId === order.id);
    const ids = new Set(mine.map((p) => p.id));
    const batches = new Set(mine.map((p) => p.batchId).filter(Boolean));
    const pos = linked.filter(
      (po) => (po.projectId && ids.has(po.projectId)) || (po.batchId && batches.has(po.batchId)),
    );
    if (mine.length > 0 && mine.every((p) => p.techPack?.status === "APPROVED")) {
      set.add("TECH_PACK_APPROVED");
    }
    if (pos.some((po) => po.booking && po.booking.stage !== "DRAFT")) set.add("BOOKING_APPROVED");
    const fabric = pos.flatMap((po) => po.lines);
    if (fabric.length > 0 && fabric.every((l) => l.receivedQty.gte(l.quantity))) {
      set.add("FABRIC_IN_HOUSE");
    }
    if (mine.some((p) => p._count.cuttingReports > 0)) set.add("CUTTING_STARTED");
    if (
      mine.length > 0 &&
      mine.every(
        (p) => p.status === "COMPLETED" || ["WASH_QC", "FINISHING", "COMPLETED"].includes(p.stage),
      )
    ) {
      set.add("SEWING_DONE");
    }
    const shipped = SHIPPED_STATUSES.includes(order.status);
    if (order.packingList || order.status === "PACKED" || shipped) set.add("PACKED");
    if (shipped) set.add("SHIPPED");
  }
  return facts;
}

/** Ticks, by themselves, the steps whose fact the ERP now shows. Returns how many. */
export async function completeFromFacts(
  companyId: string,
  orderIds: readonly string[],
  today: string,
  now: Date = new Date(),
) {
  const facts = await orderFacts(companyId, orderIds);
  let done = 0;
  for (const [orderId, set] of facts) {
    if (set.size === 0) continue;
    const { count } = await prisma.orderTaStep.updateMany({
      where: { companyId, salesOrderId: orderId, doneAt: null, fact: { in: [...set] } },
      data: { doneAt: now, doneOn: dateColumn(today), doneHow: "AUTO" },
    });
    done += count;
  }
  return done;
}

type StepRow = {
  id: string;
  key: string;
  name: string;
  position: number;
  fact: TaFact | null;
  critical: boolean;
  plannedOn: Date;
  dueOn: Date;
  dueChanged: boolean;
  doneAt: Date | null;
  doneOn: Date | null;
  doneHow: "AUTO" | "MANUAL" | null;
  doneBy: { name: string } | null;
};

function shapeStep(s: StepRow, today: string, dueSoonDays: number) {
  const dueOn = dateOnly(s.dueOn);
  const done = s.doneAt !== null;
  return {
    id: s.id,
    key: s.key,
    name: s.name,
    fact: s.fact,
    factLabel: s.fact ? FACT_LABELS[s.fact] : null,
    critical: s.critical,
    plannedOn: dateOnly(s.plannedOn),
    dueOn,
    dueChanged: s.dueChanged,
    done,
    doneOn: dateOnly(s.doneOn),
    doneHow: s.doneHow,
    doneBy: s.doneBy?.name ?? null,
    colour: taColour({ dueOn, done }, today, dueSoonDays) as TaColour,
  };
}

const STEP_SELECT = {
  id: true,
  key: true,
  name: true,
  position: true,
  fact: true,
  critical: true,
  plannedOn: true,
  dueOn: true,
  dueChanged: true,
  doneAt: true,
  doneOn: true,
  doneHow: true,
  doneBy: { select: { name: true } },
} as const;

/** One order's T&A for its page: the steps, their colours and whether the ship date is at risk. */
export async function orderTa(ctx: CompanyContext, orderId: string, now = new Date()) {
  mustView(ctx);
  const order = await ctx.db.salesOrder.findFirst({
    where: { id: orderId },
    select: { id: true, shipmentDate: true, status: true },
  });
  if (!order) throw new AppError("NOT_FOUND", "Order not found.");
  const today = todayOf(ctx, now);
  await syncOrderTa(ctx.company.id, [order.id]);
  await completeFromFacts(ctx.company.id, [order.id], today, now);
  const [rows, settings] = await Promise.all([
    ctx.db.orderTaStep.findMany({
      where: { salesOrderId: order.id },
      orderBy: { position: "asc" },
      select: STEP_SELECT,
    }),
    taSettingsOf(ctx.company.id),
  ]);
  const steps = rows.map((r) => shapeStep(r, today, settings.dueSoonDays));
  const running = TA_OPEN_STATUSES.includes(order.status);
  return {
    shipOn: dateOnly(order.shipmentDate),
    steps,
    atRisk: running && shipAtRisk(steps, today),
    today,
    can: { manage: taAccess(ctx).manage, template: taAccess(ctx).template },
  };
}

async function stepOrThrow(ctx: CompanyContext, stepId: string) {
  const step = await ctx.db.orderTaStep.findFirst({
    where: { id: stepId },
    include: { salesOrder: { select: { id: true, number: true } } },
  });
  if (!step) throw new AppError("NOT_FOUND", "T&A step not found.");
  return step;
}

export const changeDateSchema = z.object({
  stepId: z.string().min(1),
  dueOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Pick a day."),
  reason: z.string().trim().max(300).optional(),
});

/** Changes one step's day on one order (audit-logged with the old and new day). */
export async function changeTaDate(ctx: CompanyContext, raw: unknown, meta?: RequestMeta) {
  mustManage(ctx);
  const input = changeDateSchema.parse(raw);
  const step = await stepOrThrow(ctx, input.stepId);
  const was = dateOnly(step.dueOn);
  if (was === input.dueOn) return { changed: false };
  const today = todayOf(ctx);
  await ctx.db.orderTaStep.update({
    where: { id: step.id },
    data: {
      dueOn: dateColumn(input.dueOn),
      dueChanged: true,
      // A new day still ahead: once it passes, the late reminder may go out again (once).
      ...(input.dueOn >= today ? { lateNotifiedAt: null } : {}),
    },
  });
  await auditInCompany(ctx, meta, {
    action: "UPDATE",
    entityType: "SalesOrder",
    entityId: step.salesOrder.id,
    summary: `T&A ${step.salesOrder.number} "${step.name}": ${was} → ${input.dueOn}${
      input.reason ? ` (${input.reason})` : ""
    }`,
    before: { step: step.key, dueOn: was },
    after: { step: step.key, dueOn: input.dueOn },
  });
  return { changed: true };
}

export const markDoneSchema = z.object({ stepId: z.string().min(1), done: z.boolean() });

/** Ticks a step done by hand, or takes a hand tick back (a step the ERP ticked stays). */
export async function markTaDone(ctx: CompanyContext, raw: unknown, meta?: RequestMeta) {
  mustManage(ctx);
  const input = markDoneSchema.parse(raw);
  const step = await stepOrThrow(ctx, input.stepId);
  if (input.done === (step.doneAt !== null)) return { changed: false };
  if (!input.done && step.doneHow === "AUTO") {
    throw new AppError(
      "CONFLICT",
      "The ERP ticked this step from its records; it cannot be taken back by hand.",
    );
  }
  const today = todayOf(ctx);
  await ctx.db.orderTaStep.update({
    where: { id: step.id },
    data: input.done
      ? { doneAt: new Date(), doneOn: dateColumn(today), doneHow: "MANUAL", doneById: ctx.user.id }
      : { doneAt: null, doneOn: null, doneHow: null, doneById: null },
  });
  await auditInCompany(ctx, meta, {
    action: "STATUS_CHANGE",
    entityType: "SalesOrder",
    entityId: step.salesOrder.id,
    summary: `T&A ${step.salesOrder.number} "${step.name}": ${input.done ? "done" : "not done"}`,
  });
  return { changed: true };
}

// ------------------------------------------------------------------ the calendar page

export const calendarSchema = z.object({
  view: z.enum(["week", "month"]).default("week"),
  on: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  buyer: z.string().min(1).optional(),
  status: z.enum(["late", "soon", "open", "done"]).optional(),
});

/** The days a week or month view covers ([from, to], both inclusive). */
export function calendarWindow(view: "week" | "month", on: string) {
  if (view === "week") {
    const from = addDays(on, -((weekday(on) + 6) % 7)); // from Monday
    return { from, to: addDays(from, 6) };
  }
  const from = `${on.slice(0, 8)}01`;
  const next = addDays(`${on.slice(0, 8)}28`, 4);
  return { from, to: addDays(`${next.slice(0, 8)}01`, -1) };
}

/**
 * Every order's steps that fall in a week or a month, by day, with filters for
 * the buyer and the step's state. Late steps from before the window are listed
 * as well (they still need doing).
 */
export async function taCalendar(ctx: CompanyContext, raw: unknown, now = new Date()) {
  mustView(ctx);
  const input = calendarSchema.parse(raw ?? {});
  const today = todayOf(ctx, now);
  const on = input.on ?? today;
  const { from, to } = calendarWindow(input.view, on);
  const template = await taTemplateOf(ctx.company.id);
  const longest = Math.max(0, ...template.map((s) => s.daysBeforeShip));

  // Orders whose T&A may reach into the window, and running orders with late steps.
  const orders = await ctx.db.salesOrder.findMany({
    where: {
      shipmentDate: { not: null, gte: dateColumn(from), lte: dateColumn(addDays(to, longest)) },
      status: { not: "CANCELLED" },
      ...(input.buyer ? { partyId: input.buyer } : {}),
    },
    select: { id: true },
    take: 500,
  });
  const ids = orders.map((o) => o.id);
  await syncOrderTa(ctx.company.id, ids);
  await completeFromFacts(ctx.company.id, ids, today, now);

  const settings = await taSettingsOf(ctx.company.id);
  const rows = await ctx.db.orderTaStep.findMany({
    where: {
      salesOrder: {
        status: { not: "CANCELLED" },
        ...(input.buyer ? { partyId: input.buyer } : {}),
      },
      OR: [
        { dueOn: { gte: dateColumn(from), lte: dateColumn(to) } },
        {
          dueOn: { lt: dateColumn(from) },
          doneAt: null,
          salesOrder: { status: { in: [...TA_OPEN_STATUSES] } },
        },
      ],
    },
    orderBy: [{ dueOn: "asc" }, { position: "asc" }],
    take: 1000,
    select: {
      ...STEP_SELECT,
      salesOrder: {
        select: {
          id: true,
          number: true,
          status: true,
          shipmentDate: true,
          customerName: true,
          party: { select: { id: true, name: true } },
        },
      },
    },
  });

  // Ship date at risk, per order, from all its steps (not only those shown).
  const orderIds = [...new Set(rows.map((r) => r.salesOrder.id))];
  const allSteps = orderIds.length
    ? await ctx.db.orderTaStep.findMany({
        where: { salesOrderId: { in: orderIds } },
        select: { salesOrderId: true, dueOn: true, doneAt: true, critical: true },
      })
    : [];
  const atRisk = new Set(
    orderIds.filter((id) => {
      const order = rows.find((r) => r.salesOrder.id === id)!.salesOrder;
      if (!TA_OPEN_STATUSES.includes(order.status)) return false;
      return shipAtRisk(
        allSteps
          .filter((s) => s.salesOrderId === id)
          .map((s) => ({
            dueOn: dateOnly(s.dueOn),
            done: s.doneAt !== null,
            critical: s.critical,
          })),
        today,
      );
    }),
  );

  const items = rows
    .map((r) => {
      const step = shapeStep(r, today, settings.dueSoonDays);
      return {
        ...step,
        orderId: r.salesOrder.id,
        orderNumber: r.salesOrder.number,
        buyer: r.salesOrder.party?.name ?? r.salesOrder.customerName ?? null,
        shipOn: dateOnly(r.salesOrder.shipmentDate),
        atRisk: atRisk.has(r.salesOrder.id),
      };
    })
    .filter((s) => {
      if (!input.status) return true;
      if (input.status === "late") return s.colour === "red";
      if (input.status === "soon") return s.colour === "yellow";
      if (input.status === "done") return s.done;
      return !s.done;
    });

  const buyers = await ctx.db.party.findMany({
    where: { salesOrders: { some: { shipmentDate: { not: null }, status: { not: "CANCELLED" } } } },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
    take: 300,
  });

  const days: Array<{ day: string; items: typeof items }> = [];
  for (let day = from; day <= to; day = addDays(day, 1)) {
    days.push({ day, items: items.filter((i) => i.dueOn === day) });
  }
  return {
    view: input.view,
    on,
    from,
    to,
    today,
    previous: input.view === "week" ? addDays(from, -7) : addDays(from, -1),
    next: addDays(to, 1),
    buyer: input.buyer ?? null,
    status: input.status ?? null,
    buyers,
    days,
    lateBefore: items.filter((i) => i.dueOn < from),
    late: items.filter((i) => i.colour === "red").length,
    atRiskOrders: atRisk.size,
    can: { template: taAccess(ctx).template },
  };
}

// ------------------------------------------------------------------ the late reminder

/** The owner(s): active members who are Super Admin. */
async function ownersOf(companyId: string) {
  const rows = await prisma.companyMembership.findMany({
    where: {
      companyId,
      isActive: true,
      user: { status: { not: "SUSPENDED" } },
      OR: [{ role: { systemRole: "SUPER_ADMIN" } }, { user: { isSuperAdmin: true } }],
    },
    select: { userId: true },
  });
  return rows.map((r) => r.userId);
}

/**
 * The hourly T&A clock: gives running orders their T&A, ticks what the ERP's
 * records show, and tells each late step once (the order's maker and the owner,
 * in the inbox, and the owner on the bot as an alarm). Works with the AI off.
 */
export async function runTaClock(now: Date = new Date()) {
  const companies = await prisma.company.findMany({
    where: { salesOrders: { some: { shipmentDate: { not: null } } } },
    select: { id: true, timezone: true },
  });
  let told = 0;
  for (const company of companies) {
    const today = localDay(now, company.timezone);
    const running = await prisma.salesOrder.findMany({
      where: {
        companyId: company.id,
        shipmentDate: { not: null },
        status: { in: [...TA_OPEN_STATUSES] },
      },
      select: { id: true },
      take: 2000,
    });
    const ids = running.map((o) => o.id);
    await syncOrderTa(company.id, ids);
    await completeFromFacts(company.id, ids, today, now);
    const late = await prisma.orderTaStep.findMany({
      where: {
        companyId: company.id,
        salesOrderId: { in: ids },
        doneAt: null,
        lateNotifiedAt: null,
        dueOn: { lt: dateColumn(today) },
      },
      include: {
        salesOrder: {
          select: {
            id: true,
            number: true,
            shipmentDate: true,
            customerName: true,
            party: { select: { name: true } },
          },
        },
      },
      orderBy: [{ dueOn: "asc" }, { position: "asc" }],
    });
    if (late.length === 0) continue;
    const members = new Set((await activeMembers(company.id)).map((m) => m.userId));
    const owners = (await ownersOf(company.id)).filter((id) => members.has(id));
    for (const step of late) {
      // Claimed first, so a second run (or a second server) never tells it twice.
      const claimed = await prisma.orderTaStep.updateMany({
        where: { id: step.id, lateNotifiedAt: null, doneAt: null },
        data: { lateNotifiedAt: now },
      });
      if (claimed.count === 0) continue;
      const maker = await prisma.auditLog.findFirst({
        where: {
          companyId: company.id,
          entityType: "SalesOrder",
          entityId: step.salesOrder.id,
          action: "CREATE",
        },
        select: { userId: true },
        orderBy: { createdAt: "asc" },
      });
      const people = [
        ...new Set([
          ...(maker?.userId && members.has(maker.userId) ? [maker.userId] : []),
          ...owners,
        ]),
      ];
      const order = step.salesOrder;
      const buyer = order.party?.name ?? order.customerName ?? "walk-in customer";
      const subject = `T&A late: ${order.number} ${step.name}`;
      const body = `${order.number} for ${buyer}: "${step.name}" was due ${dateOnly(step.dueOn)} and is not done. Ship date ${dateOnly(order.shipmentDate) ?? "not set"}${step.critical ? "; this step is on the critical path, so the ship date is at risk" : ""}. Open the order's T&A to tick it or change its day.`;
      try {
        await sendInApp(
          prisma,
          company.id,
          people.map((userId) => ({ userId })),
          { subject, body, entityType: "SalesOrder", entityId: order.id },
          now,
        );
      } catch (error) {
        console.error(
          "[ta] inbox message not sent",
          error instanceof Error ? error.message : error,
        );
      }
      try {
        const { pushToBot } = await import("@/modules/ai/bot/push");
        await pushToBot(company.id, { kind: "text", text: `${subject}. ${body}` }, { alarm: true });
      } catch (error) {
        console.error(
          "[ta] alarm not sent to the bot",
          error instanceof Error ? error.message : error,
        );
      }
      told += 1;
    }
  }
  return { told };
}
