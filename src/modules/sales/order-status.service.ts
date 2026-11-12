import { randomBytes } from "node:crypto";

import type { ProductionStage, SalesOrderStatus } from "@prisma/client";
import { z } from "zod";

import { hashText } from "@/lib/crypto";
import type { Db } from "@/lib/db-types";
import { localDay } from "@/lib/dates";
import { AppError } from "@/lib/errors";
import { prisma } from "@/lib/prisma";
import { readOnlyReason } from "@/lib/read-only";
import type { RequestMeta } from "@/lib/request-meta";
import { ROUTES } from "@/lib/routes";
import { tenantDb, type TenantDb } from "@/lib/tenant-db";
import { auditInCompany } from "@/modules/audit/audit.service";
import type { CompanyContext } from "@/modules/auth/context";
import { loadPrintLogo } from "@/modules/companies/logo.service";
import { cutByCell } from "@/modules/production/cutting.service";
import { addUpGrades, readGradeLines } from "@/modules/production/finishing";
import { STAGE_LABELS, STAGE_ORDER } from "@/modules/production/timeline";

/*
 * Share order status (Release 2): a read-only link to one order's progress
 * for its buyer. Someone with sales.order.share makes it on the order's page
 * and copies or shares it themselves; nothing is ever sent by the ERP. The
 * link carries a random token; only its SHA-256 hash is kept, so the link is
 * shown once. It may end after some days and can be stopped at any time;
 * making and stopping are in the activity log.
 *
 * The buyer's page (/order-status/<token>, no sign-in) shows only the company's
 * name and logo, the order's number, its styles and pieces, the cutting,
 * sewing, finishing and packing progress from the production records, and
 * the planned and actual ship dates: never a price, a cost, a profit, a
 * factory or supplier, or anything of another order. The link names its
 * company; everything after is read through that company's locked client.
 */

/** Where the buyer's page lives (src/proxy.ts lets it through without a sign-in). */
export const ORDER_STATUS_PATH = ROUTES.orderStatus;

/** The choices for how long a link works; null: until it is stopped. */
export const LINK_DAYS = [7, 30, 90] as const;

export const makeLinkSchema = z.object({
  days: z
    .union([z.literal(7), z.literal(30), z.literal(90)])
    .nullable()
    .default(null),
});

/** A token as made here: 32 bytes, base64url (43 characters). */
const TOKEN = /^[A-Za-z0-9_-]{43}$/;

const SHARE_KEYS = ["sales.view", "sales.order.share"] as const;

/** Whether this person may make and stop status links (and see them on the order). */
export const canShareOrderStatus = (ctx: Pick<CompanyContext, "can">) =>
  SHARE_KEYS.every((key) => ctx.can(key));

function assertCanShare(ctx: CompanyContext) {
  if (!canShareOrderStatus(ctx)) {
    throw new AppError("FORBIDDEN", "You do not have permission to share an order's status.");
  }
}

async function orderOf(ctx: CompanyContext, orderId: string) {
  const order = await ctx.db.salesOrder.findUnique({
    where: { id: orderId },
    select: { id: true, number: true, status: true },
  });
  if (!order) throw new AppError("NOT_FOUND", "Order not found.");
  return order;
}

export type StatusLinkState = "ACTIVE" | "ENDED" | "STOPPED";

/** The order's status links, newest first, for the people who may share them. */
export async function listStatusLinks(ctx: CompanyContext, orderId: string) {
  assertCanShare(ctx);
  const order = await orderOf(ctx, orderId);
  const tz = ctx.company.timezone;
  const now = new Date();
  const rows = await ctx.db.orderStatusLink.findMany({
    where: { orderId: order.id },
    select: {
      id: true,
      createdAt: true,
      expiresAt: true,
      stoppedAt: true,
      lastOpenedAt: true,
      createdBy: { select: { name: true } },
      stoppedBy: { select: { name: true } },
    },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: 20,
  });
  return rows.map((r) => ({
    id: r.id,
    madeOn: localDay(r.createdAt, tz),
    madeBy: r.createdBy?.name ?? null,
    endsOn: r.expiresAt ? localDay(r.expiresAt, tz) : null,
    stoppedOn: r.stoppedAt ? localDay(r.stoppedAt, tz) : null,
    stoppedBy: r.stoppedBy?.name ?? null,
    /** The day the buyer last opened it; null: never opened. */
    lastOpenedOn: r.lastOpenedAt ? localDay(r.lastOpenedAt, tz) : null,
    state: (r.stoppedAt
      ? "STOPPED"
      : r.expiresAt && r.expiresAt <= now
        ? "ENDED"
        : "ACTIVE") as StatusLinkState,
  }));
}

export type StatusLinkRow = Awaited<ReturnType<typeof listStatusLinks>>[number];

/**
 * Makes a new link to the order's progress. The address comes back once, here:
 * only the token's hash is kept, so a lost link is stopped and a new one made.
 */
export async function makeStatusLink(
  ctx: CompanyContext,
  orderId: string,
  input: unknown,
  meta?: RequestMeta,
) {
  assertCanShare(ctx);
  const parsed = makeLinkSchema.safeParse(input ?? {});
  if (!parsed.success) {
    throw new AppError(
      "VALIDATION",
      "Choose how long the link works: 7, 30 or 90 days, or until stopped.",
    );
  }
  const order = await orderOf(ctx, orderId);
  if (order.status === "CANCELLED") {
    throw new AppError("CONFLICT", `${order.number} is cancelled: there is no progress to share.`);
  }
  const { days } = parsed.data;
  const token = randomBytes(32).toString("base64url");
  const expiresAt = days ? new Date(Date.now() + days * 86_400_000) : null;
  const link = await ctx.db.orderStatusLink.create({
    data: {
      companyId: ctx.company.id,
      orderId: order.id,
      tokenHash: hashText(token),
      expiresAt,
      createdById: ctx.user.id,
    },
    select: { id: true },
  });
  const endsOn = expiresAt ? localDay(expiresAt, ctx.company.timezone) : null;
  await auditInCompany(ctx, meta, {
    action: "CREATE",
    entityType: "OrderStatusLink",
    entityId: link.id,
    summary: `Made a read-only status link for order ${order.number}${endsOn ? ` (works until ${endsOn})` : " (works until stopped)"}`,
    after: { orderId: order.id, orderNumber: order.number, endsOn },
  });
  return { id: link.id, path: `${ORDER_STATUS_PATH}/${token}`, endsOn };
}

/** Stops a link at once: the buyer's page then answers "not found". */
export async function stopStatusLink(ctx: CompanyContext, linkId: string, meta?: RequestMeta) {
  assertCanShare(ctx);
  const link = await ctx.db.orderStatusLink.findUnique({
    where: { id: linkId },
    select: { id: true, stoppedAt: true, order: { select: { id: true, number: true } } },
  });
  if (!link) throw new AppError("NOT_FOUND", "Link not found.");
  if (link.stoppedAt) return { id: link.id, orderId: link.order.id, stopped: false };
  const { count } = await ctx.db.orderStatusLink.updateMany({
    where: { id: link.id, stoppedAt: null },
    data: { stoppedAt: new Date(), stoppedById: ctx.user.id },
  });
  if (count > 0) {
    await auditInCompany(ctx, meta, {
      action: "STATUS_CHANGE",
      entityType: "OrderStatusLink",
      entityId: link.id,
      summary: `Stopped a read-only status link for order ${link.order.number}`,
      before: { state: "ACTIVE" },
      after: { state: "STOPPED" },
    });
  }
  return { id: link.id, orderId: link.order.id, stopped: count > 0 };
}

/**
 * Stops every working link of an order being cancelled, inside its transaction
 * (sales/order.service.ts cancelOrder), with one line in the activity log.
 */
export async function stopLinksOfCancelledOrderTx(
  tx: Db,
  ctx: Pick<CompanyContext, "company" | "user" | "byAi">,
  order: { id: string; number: string },
  meta?: RequestMeta,
) {
  const { count } = await tx.orderStatusLink.updateMany({
    where: { companyId: ctx.company.id, orderId: order.id, stoppedAt: null },
    data: { stoppedAt: new Date(), stoppedById: ctx.user.id },
  });
  if (count > 0) {
    await auditInCompany(
      ctx,
      meta,
      {
        action: "STATUS_CHANGE",
        entityType: "SalesOrder",
        entityId: order.id,
        summary: `Stopped ${count} read-only status link${count === 1 ? "" : "s"} of order ${order.number}: the order was cancelled`,
      },
      tx,
    );
  }
  return count;
}

// --- The buyer's page --------------------------------------------------------------------

/** The buyer's opens are kept to the minute: one write a minute at most. */
const OPENED_EVERY_MS = 60_000;

/** Notes that the buyer opened the link; never on a Full check (it only reads), never failing the page. */
async function noteOpened(linkId: string) {
  try {
    if (await readOnlyReason()) return;
    const now = new Date();
    await prisma.orderStatusLink.updateMany({
      where: {
        id: linkId,
        OR: [
          { lastOpenedAt: null },
          { lastOpenedAt: { lt: new Date(now.getTime() - OPENED_EVERY_MS) } },
        ],
      },
      data: { lastOpenedAt: now },
    });
  } catch {
    // Seeing the page matters more than noting the visit.
  }
}

export type StepState = "NOT_STARTED" | "IN_PROGRESS" | "DONE";

/** One step of making the goods: pieces done of the pieces to make, when counted. */
export type ProgressStep = { state: StepState; pieces: number | null; percent: number | null };

export type StyleProgress = {
  code: string;
  name: string;
  /** Pieces of this style on the order. */
  pieces: number;
  /** Its production, when a production project was started for it. */
  production: {
    /** Pieces to make. */
    target: number;
    /** The stage the work is at ("Sewing"), or "Completed". */
    stage: string;
    cutting: ProgressStep;
    sewing: ProgressStep;
    finishing: ProgressStep;
    packing: ProgressStep;
  } | null;
};

export type OrderStatusView = {
  company: { name: string; logo: string | null };
  order: {
    number: string;
    status: string;
    orderedOn: string;
    pieces: number;
    plannedShipOn: string | null;
    /** The day of the latest delivery, once any piece went out. */
    shippedOn: string | null;
    shipped: number;
  };
  styles: StyleProgress[];
  /** The day the page was read, in the company's time. */
  asOf: string;
};

const ORDER_STATUS_WORDS: Record<SalesOrderStatus, string> = {
  DRAFT: "Draft",
  CONFIRMED: "Confirmed",
  PROCESSING: "In production",
  PACKED: "Packed",
  SHIPPED: "Shipped",
  DELIVERED: "Delivered",
  PARTIALLY_RETURNED: "Delivered",
  RETURNED: "Returned",
  CANCELLED: "Cancelled",
};

const counted = (pieces: number, target: number): ProgressStep => ({
  state: pieces <= 0 ? "NOT_STARTED" : pieces >= target ? "DONE" : "IN_PROGRESS",
  pieces,
  percent: target > 0 ? Math.min(100, Math.round((pieces * 100) / target)) : null,
});

const stageIndex = (stage: ProductionStage) => STAGE_ORDER.indexOf(stage);

/** A @db.Date column as its day ("2026-12-20"). */
const dateOnly = (value: Date) => value.toISOString().slice(0, 10);

function logoUri(bytes: Buffer) {
  const png = bytes.subarray(0, 4).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  return `data:${png ? "image/png" : "image/jpeg"};base64,${bytes.toString("base64")}`;
}

/**
 * The pieces made so far on one production project, from its own records. The
 * project was found through the company's locked client; its cutting reports
 * are read by its id, as the cutting screen reads them.
 */
async function projectProgress(db: TenantDb, companyId: string, projectId: string) {
  const [cut, finishing, delivered] = await Promise.all([
    cutByCell(prisma, projectId),
    db.finishingReport.findMany({
      where: { projectId },
      select: { lines: true, intake: { select: { status: true } } },
    }),
    db.stockIntakeLine.aggregate({
      where: { intake: { companyId, projectId, status: "CONFIRMED" } },
      _sum: { quantity: true },
    }),
  ]);
  const graded = addUpGrades(
    finishing.filter((r) => r.intake?.status !== "REVERSED").map((r) => readGradeLines(r.lines)),
  );
  return {
    cut: cut ? [...cut.values()].reduce((t, c) => t + Math.max(c.good, 0), 0) : 0,
    finished: [...graded.values()].reduce((t, g) => t + g.a + g.b + g.c + g.reject, 0),
    packed: delivered._sum.quantity ?? 0,
  };
}

/**
 * What the buyer's page shows, or null when the link is unknown, stopped or
 * ended (the page then answers "not found", the same for each, so a link's
 * fate is not told to whoever holds it).
 */
export async function readOrderStatus(token: string): Promise<OrderStatusView | null> {
  if (!TOKEN.test(token)) return null;
  const link = await prisma.orderStatusLink.findUnique({
    where: { tokenHash: hashText(token) },
    select: { id: true, companyId: true, orderId: true, expiresAt: true, stoppedAt: true },
  });
  if (!link || link.stoppedAt || (link.expiresAt && link.expiresAt <= new Date())) return null;

  const db = tenantDb(link.companyId);
  const [company, order] = await Promise.all([
    prisma.company.findUnique({
      where: { id: link.companyId },
      select: { name: true, timezone: true, isActive: true },
    }),
    db.salesOrder.findUnique({
      where: { id: link.orderId },
      select: {
        id: true,
        number: true,
        status: true,
        orderDate: true,
        shipmentDate: true,
        proformaId: true,
        items: {
          select: {
            quantity: true,
            variant: { select: { style: { select: { id: true, code: true, name: true } } } },
          },
        },
      },
    }),
  ]);
  // A cancelled order has nothing to show (its links are stopped when it is cancelled).
  if (!company || !company.isActive || !order || order.status === "CANCELLED") return null;
  await noteOpened(link.id);
  const tz = company.timezone;

  const [challans, projects, logo] = await Promise.all([
    db.deliveryChallan.findMany({
      where: { orderId: order.id },
      select: { deliveryDate: true, items: { select: { quantity: true } } },
      orderBy: [{ deliveryDate: "asc" }, { id: "asc" }],
    }),
    db.productionProject.findMany({
      where: {
        OR: [
          { salesOrderId: order.id },
          ...(order.proformaId ? [{ proformaId: order.proformaId }] : []),
        ],
        status: { not: "CANCELLED" },
      },
      select: {
        id: true,
        stage: true,
        status: true,
        targetQuantity: true,
        style: { select: { id: true, code: true, name: true } },
      },
      orderBy: [{ startDate: "asc" }, { id: "asc" }],
    }),
    loadPrintLogo(link.companyId),
  ]);

  // The order's styles, in the order they appear on it.
  const styles = new Map<string, { code: string; name: string; pieces: number }>();
  for (const item of order.items) {
    const s = item.variant.style;
    const was = styles.get(s.id) ?? { code: s.code, name: s.name, pieces: 0 };
    styles.set(s.id, { ...was, pieces: was.pieces + item.quantity });
  }
  const made = await Promise.all(
    projects.map(async (p) => ({ ...p, done: await projectProgress(db, link.companyId, p.id) })),
  );
  const byStyle = new Map<string, typeof made>();
  for (const p of made) {
    const key = p.style?.id ?? "";
    if (p.style && !styles.has(p.style.id)) {
      styles.set(p.style.id, { code: p.style.code, name: p.style.name, pieces: 0 });
    }
    byStyle.set(key, [...(byStyle.get(key) ?? []), p]);
  }

  const progressOf = (list: typeof made): StyleProgress["production"] => {
    if (list.length === 0) return null;
    const target = list.reduce((t, p) => t + p.targetQuantity, 0);
    const sum = (pick: (p: (typeof made)[number]) => number) =>
      list.reduce((t, p) => t + pick(p), 0);
    const finished = sum((p) => p.done.finished);
    const allDone = list.every((p) => p.status === "COMPLETED" || p.stage === "COMPLETED");
    // Sewing is not counted in pieces: it shows where the work is.
    const sewn = list.every(
      (p) => p.status === "COMPLETED" || stageIndex(p.stage) > stageIndex("SEWING"),
    );
    const sewing = list.some((p) => stageIndex(p.stage) >= stageIndex("SEWING")) || finished > 0;
    const least = list.reduce((a, p) => (stageIndex(p.stage) < stageIndex(a.stage) ? p : a));
    return {
      target,
      stage: allDone ? STAGE_LABELS.COMPLETED : STAGE_LABELS[least.stage],
      cutting: counted(
        sum((p) => p.done.cut),
        target,
      ),
      sewing: {
        state: sewn || allDone ? "DONE" : sewing ? "IN_PROGRESS" : "NOT_STARTED",
        pieces: null,
        percent: null,
      },
      finishing: counted(finished, target),
      packing: counted(
        sum((p) => p.done.packed),
        target,
      ),
    };
  };

  const shipped = challans.reduce((t, c) => t + c.items.reduce((s, i) => s + i.quantity, 0), 0);
  const last = challans.at(-1);
  return {
    company: { name: company.name, logo: logo ? logoUri(logo.bytes) : null },
    order: {
      number: order.number,
      status: ORDER_STATUS_WORDS[order.status],
      orderedOn: localDay(order.orderDate, tz),
      pieces: order.items.reduce((t, i) => t + i.quantity, 0),
      plannedShipOn: order.shipmentDate ? dateOnly(order.shipmentDate) : null,
      shippedOn: shipped > 0 && last ? localDay(last.deliveryDate, tz) : null,
      shipped,
    },
    styles: [
      ...[...styles.entries()].map(([id, s]) => ({
        ...s,
        production: progressOf(byStyle.get(id) ?? []),
      })),
      // Production for no style in particular.
      ...(byStyle.has("")
        ? [{ code: "", name: "Other pieces", pieces: 0, production: progressOf(byStyle.get("")!) }]
        : []),
    ],
    asOf: localDay(new Date(), tz),
  };
}
