import { type MeasurementUnit, Prisma, type PurchaseOrderStatus } from "@prisma/client";

import { aiTextOn } from "@/lib/ai-text";
import { dateOnly, localDay } from "@/lib/dates";
import { AppError } from "@/lib/errors";
import { prisma } from "@/lib/prisma";
import type { CompanyContext } from "@/modules/auth/context";
import { OPEN_ORDER } from "@/modules/materials/material.service";
import { batchMaterialPlan } from "@/modules/production/batch-orders.service";
import {
  getMaterialNeeds,
  gridAxes,
  perPieceText,
} from "@/modules/production/material-need.service";
import { isProjectClosed } from "@/modules/production/project-costs";

/*
 * What the materials screens show, as plain values (quantities as "12.5", in the
 * material's unit): a style's "Materials per piece" panel and form, and the
 * batch's materials with the "Make purchase orders" form. No prices anywhere
 * but the order form's price boxes, which buyers fill in or leave for receive.
 */

const qty = (d: Prisma.Decimal) => {
  const text = d.toFixed(3).replace(/\.?0+$/, "");
  return text === "-0" ? "0" : text;
};
const trim = (d: Prisma.Decimal, places: number) => d.toFixed(places).replace(/\.?0+$/, "") || "0";

const materialHref = (id: string) => `/materials/stock/${id}`;
const orderHref = (id: string) => `/materials/orders/${id}`;

/**
 * A style's "Materials per piece": each need, what the pieces need of it (per
 * colour, or colour and size, when split) and how much is on order; the batch
 * orders the style has a share of; and what this person may do.
 */
export async function getNeedsPanel(ctx: CompanyContext, projectId: string) {
  const data = await getMaterialNeeds(ctx, projectId);
  const p = data.project;
  const shares = await prisma.purchaseOrderLineShare.findMany({
    where: { projectId: p.id, line: { order: { status: { not: "CANCELLED" } } } },
    select: {
      quantity: true,
      line: {
        select: {
          rawMaterial: { select: { code: true, unit: true } },
          order: {
            select: {
              id: true,
              number: true,
              status: true,
              expectedDate: true,
              supplier: { select: { name: true } },
            },
          },
        },
      },
    },
    orderBy: { id: "asc" },
  });
  const orders = new Map<
    string,
    {
      id: string;
      number: string;
      status: PurchaseOrderStatus;
      supplier: string;
      expectedOn: string | null;
      href: string | null;
      lines: Map<string, { code: string; unit: MeasurementUnit; quantity: Prisma.Decimal }>;
    }
  >();
  for (const s of shares) {
    const o = s.line.order;
    const order = orders.get(o.id) ?? {
      id: o.id,
      number: o.number,
      status: o.status,
      supplier: o.supplier.name,
      expectedOn: dateOnly(o.expectedDate),
      href: ctx.can("materials.view") ? orderHref(o.id) : null,
      lines: new Map(),
    };
    const m = s.line.rawMaterial;
    const line = order.lines.get(m.code) ?? {
      code: m.code,
      unit: m.unit,
      quantity: new Prisma.Decimal(0),
    };
    line.quantity = line.quantity.plus(s.quantity);
    order.lines.set(m.code, line);
    orders.set(o.id, order);
  }
  const open = !isProjectClosed(p);
  const { colours, sizes } = gridAxes(data.grid);
  return {
    project: { id: p.id, code: p.code, status: p.status, batch: p.batch },
    hasGrid: data.grid.length > 0,
    colours,
    sizes,
    needs: data.needs.map((n) => ({
      id: n.id,
      material: {
        id: n.material.id,
        code: n.material.code,
        name: n.material.name,
        kind: n.material.kind,
        href: ctx.can("materials.view") ? materialHref(n.material.id) : null,
      },
      unit: n.material.unit,
      perPiece: perPieceText(n),
      split: n.split,
      placement: n.placement,
      imageId: n.imageId,
      notes: n.notes,
      total: qty(n.total),
      ordered: qty(n.covered),
      toOrder: qty(n.toOrder),
      parts: n.parts.map((pt) => ({
        colorName: pt.colorName,
        sizeName: pt.sizeName,
        pieces: pt.pieces,
        quantity: qty(pt.quantity),
      })),
    })),
    orders: [...orders.values()].map(({ lines, ...o }) => ({
      ...o,
      lines: [...lines.values()].map((l) => ({ ...l, quantity: qty(l.quantity) })),
    })),
    techPackNotes: p.techPackNotes,
    can: {
      edit: ctx.can("production.manage") && open,
      /** Make purchase orders for the style's batch. */
      orderForBatch: Boolean(p.batch) && ctx.can("materials.purchase") && open,
    },
  };
}

export type NeedsPanel = Awaited<ReturnType<typeof getNeedsPanel>>;

/** The materials per piece form: the style, its colours and sizes, and its needs as text. */
export async function getNeedsForm(ctx: CompanyContext, projectId: string) {
  const data = await getMaterialNeeds(ctx, projectId);
  const p = data.project;
  if (isProjectClosed(p)) {
    throw new AppError(
      "CONFLICT",
      `${p.code} is ${p.status.toLowerCase()}; its materials can no longer change.`,
    );
  }
  const { colours, sizes } = gridAxes(data.grid);
  return {
    project: {
      id: p.id,
      code: p.code,
      name: p.name,
      targetQuantity: p.targetQuantity,
      batch: p.batch,
    },
    colours,
    sizes,
    needs: data.needs.map((n) => ({
      material: {
        id: n.material.id,
        code: n.material.code,
        name: n.material.name,
        kind: n.material.kind,
        unit: n.material.unit,
      },
      perPiece: trim(n.perPiece, 4),
      wastagePercent: n.wastagePercent.gt(0) ? trim(n.wastagePercent, 2) : "",
      split: n.split,
      placement: n.placement ?? "",
      imageId: n.imageId,
      notes: n.notes ?? "",
    })),
    techPackNotes: p.techPackNotes ?? "",
    /** Whether "Write with AI" uses AI (otherwise it drafts from rules). */
    aiOn: aiTextOn(),
  };
}

export type NeedsForm = Awaited<ReturnType<typeof getNeedsForm>>;

/**
 * The batch's materials: needed, on order and still to order by material, for
 * the batch screen (anyone in Production) and the order form (buyers).
 */
export async function getBatchMaterials(ctx: CompanyContext, batchId: string) {
  const plan = await batchMaterialPlan(ctx, batchId);
  const openOrders = await ctx.db.purchaseOrder.count({
    where: { batchId: plan.batch.id, status: { in: OPEN_ORDER } },
  });
  return {
    batch: plan.batch,
    styles: plan.styles.map((s) => ({ id: s.id, code: s.code, name: s.name, needs: s.needs })),
    materials: plan.materials.map((m) => ({
      material: {
        id: m.material.id,
        code: m.material.code,
        name: m.material.name,
        kind: m.material.kind,
        unit: m.material.unit,
        href: ctx.can("materials.view") ? materialHref(m.material.id) : null,
      },
      supplier: m.material.supplier,
      needed: qty(m.needed),
      ordered: qty(m.ordered),
      toOrder: qty(m.toOrder),
      placements: m.placements,
      imageId: m.imageId,
      styles: m.styles,
    })),
    openOrders,
    can: {
      order: ctx.can("materials.purchase") && plan.styles.length > 0,
      /** The central receive: buyers, once an order of the batch has goods to come. */
      receive: ctx.can("materials.purchase") && openOrders > 0,
      /** Issuing to the styles: the store, once the styles have materials per piece. */
      issue: ctx.can("materials.manage") && plan.materials.length > 0,
    },
  };
}

export type BatchMaterials = Awaited<ReturnType<typeof getBatchMaterials>>;

/**
 * The "Make purchase orders" form: the batch's materials grouped by their usual
 * supplier (the rest in a group to choose a supplier for), each with what is
 * still to order as the quantity to start from.
 */
export async function getBatchOrdersForm(ctx: CompanyContext, batchId: string) {
  const data = await getBatchMaterials(ctx, batchId);
  if (data.styles.length === 0) {
    throw new AppError("CONFLICT", `${data.batch.code} has no open style to buy materials for.`);
  }
  const groups = new Map<
    string,
    {
      key: string;
      supplier: { id: string; code: string; name: string } | null;
      rows: BatchMaterials["materials"];
    }
  >();
  for (const m of data.materials) {
    const key = m.supplier?.id ?? "none";
    const group = groups.get(key) ?? {
      key,
      supplier: m.supplier ? { ...m.supplier, code: m.supplier.code ?? "" } : null,
      rows: [],
    };
    group.rows.push(m);
    groups.set(key, group);
  }
  return {
    today: localDay(new Date(), ctx.company.timezone),
    batch: data.batch,
    styles: data.styles,
    /** Suppliers first by name, the materials without one last. */
    groups: [...groups.values()].sort((a, b) =>
      !a.supplier ? 1 : !b.supplier ? -1 : a.supplier.name.localeCompare(b.supplier.name),
    ),
  };
}

export type BatchOrdersForm = Awaited<ReturnType<typeof getBatchOrdersForm>>;
