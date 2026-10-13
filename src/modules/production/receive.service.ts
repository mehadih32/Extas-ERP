import { Prisma } from "@prisma/client";
import { z } from "zod";

import { UNIT_LABELS } from "@/components/materials/labels";
import { groupAmount } from "@/lib/display";
import { dateColumn, dateOnly, localDay } from "@/lib/dates";
import { AppError } from "@/lib/errors";
import { nextDocumentNumber } from "@/lib/numbering";
import type { RequestMeta } from "@/lib/request-meta";
import { auditInCompany } from "@/modules/audit/audit.service";
import type { CompanyContext } from "@/modules/auth/context";
import { assertCanBuyMaterials } from "@/modules/materials/access";
import { OPEN_ORDER } from "@/modules/materials/material.service";
import { createPurchase } from "@/modules/materials/purchase.service";
import { listStores } from "@/modules/materials/screens.service";
import { pendingQuantity } from "@/modules/materials/valuation";
import { SHORT_ALLOWANCE, shortExtra } from "@/modules/production/short-extra";
import { activeMembers, membersWith } from "@/modules/reminders/audience";
import { sendInApp } from "@/modules/reminders/notification.service";

/*
 * The batch's central receive: one supplier's delivery on one of the batch's
 * purchase orders, with what the challan says and what was actually weighed or
 * counted for each line (Challan vs Actual). The store takes in what actually
 * came, as a Due bill on the order (a line priced at receive gets its agreed
 * price now). A short beyond the allowance (2% for fabric, 1% for the rest, as
 * the batch's contracts say) goes into the supplier's Fault Log at the line's
 * price and raises an instant red alert to the Production Managers and buyers;
 * a short inside it, or extra, is shown but not logged (short-extra.ts).
 */

const id = z.string().min(1);
const amountOf = z.number().min(0).max(100_000_000);

export const batchReceiveSchema = z.object({
  orderId: id,
  warehouseId: id.optional(),
  billDate: z.iso.date().optional(),
  /** The supplier's challan or bill number. */
  supplierRef: z.string().trim().max(60).nullish(),
  notes: z.string().trim().max(2000).nullish(),
  lines: z
    .array(
      z.object({
        lineId: id,
        /** What the challan says came (empty: no challan figure). */
        challanQuantity: amountOf.multipleOf(0.001).nullish(),
        /** What was actually weighed or counted (0: nothing of it came). */
        quantity: amountOf.multipleOf(0.001),
        /** The agreed price, for a line priced at receive (or a different bill price). */
        unitPrice: amountOf.multipleOf(0.0001).nullish(),
      }),
    )
    .min(1)
    .max(100)
    .refine((lines) => new Set(lines.map((l) => l.lineId)).size === lines.length, "Each line once"),
});

async function loadBatch(ctx: CompanyContext, batchId: string) {
  const batch = await ctx.db.productionBatch.findUnique({
    where: { id: batchId },
    select: { id: true, code: true, name: true },
  });
  if (!batch) throw new AppError("NOT_FOUND", "Master batch not found.");
  return batch;
}

const orderSelect = {
  id: true,
  number: true,
  status: true,
  expectedDate: true,
  supplierRef: true,
  supplier: { select: { id: true, code: true, name: true } },
  lines: {
    select: {
      id: true,
      quantity: true,
      receivedQty: true,
      unitPrice: true,
      priceLater: true,
      rawMaterial: { select: { id: true, code: true, name: true, kind: true, unit: true } },
    },
    orderBy: { id: "asc" },
  },
} satisfies Prisma.PurchaseOrderSelect;

/**
 * The receive screen: the batch's orders with goods still to come and, for the
 * chosen one, each line with what is still to come and its price (blank when
 * priced at receive).
 */
export async function getBatchReceive(ctx: CompanyContext, batchId: string, orderId?: string) {
  assertCanBuyMaterials(ctx);
  const batch = await loadBatch(ctx, batchId);
  const tz = ctx.company.timezone;
  const orders = await ctx.db.purchaseOrder.findMany({
    where: { batchId: batch.id, status: { in: OPEN_ORDER } },
    select: orderSelect,
    orderBy: [{ expectedDate: { sort: "asc", nulls: "last" } }, { number: "asc" }],
  });
  const qtyText = (d: Prisma.Decimal) => d.toFixed(3).replace(/\.?0+$/, "") || "0";
  const listed = orders.map((o) => ({
    id: o.id,
    number: o.number,
    supplier: { id: o.supplier.id, code: o.supplier.code ?? "", name: o.supplier.name },
    expectedOn: dateOnly(o.expectedDate),
    lines: o.lines.length,
    toCome: o.lines.filter((l) => pendingQuantity(l).gt(0)).length,
  }));
  const chosen = orderId ? orders.find((o) => o.id === orderId) : undefined;
  if (orderId && !chosen) {
    throw new AppError("NOT_FOUND", `That order is not open on ${batch.code}.`);
  }
  const stores = await listStores(ctx);
  return {
    batch,
    today: localDay(new Date(), tz),
    stores,
    defaultStoreId: stores.find((s) => s.isDefault)?.id ?? stores[0]?.id ?? "",
    orders: listed,
    order: chosen
      ? {
          id: chosen.id,
          number: chosen.number,
          supplier: listed.find((o) => o.id === chosen.id)!.supplier,
          lines: chosen.lines
            .filter((l) => pendingQuantity(l).gt(0))
            .map((l) => ({
              id: l.id,
              material: l.rawMaterial,
              ordered: qtyText(l.quantity),
              received: qtyText(l.receivedQty),
              toCome: qtyText(pendingQuantity(l)),
              priceLater: l.priceLater,
              unitPrice: l.priceLater
                ? ""
                : l.unitPrice.toFixed(4).replace(/(\.\d\d[1-9]?)0+$/, "$1"),
            })),
        }
      : null,
    allowance: SHORT_ALLOWANCE,
  };
}

export type BatchReceive = Awaited<ReturnType<typeof getBatchReceive>>;

/**
 * Takes in one delivery on a batch order: a Due bill for what actually came,
 * the challan quantity kept on each line, and a fault (with an instant alert)
 * for each line short beyond the allowance, valued at the line's price.
 */
export async function receiveBatchDelivery(
  ctx: CompanyContext,
  batchId: string,
  raw: unknown,
  meta?: RequestMeta,
) {
  const input = batchReceiveSchema.parse(raw);
  assertCanBuyMaterials(ctx);
  const batch = await loadBatch(ctx, batchId);
  const order = await ctx.db.purchaseOrder.findUnique({
    where: { id: input.orderId },
    select: { ...orderSelect, batchId: true },
  });
  if (!order || order.batchId !== batch.id) {
    throw new AppError("NOT_FOUND", `That order is not one of ${batch.code}'s.`);
  }
  const lines = new Map(order.lines.map((l) => [l.id, l]));
  const checked = input.lines.map((l, i) => {
    const line = lines.get(l.lineId);
    if (!line) {
      throw new AppError("VALIDATION", `Line ${i + 1} is not on ${order.number}.`, {
        [`lines.${i}.lineId`]: ["Choose a line of this order"],
      });
    }
    const price =
      l.unitPrice === null || l.unitPrice === undefined
        ? line.priceLater
          ? null
          : line.unitPrice
        : new Prisma.Decimal(l.unitPrice);
    if (l.quantity > 0 && price === null) {
      throw new AppError(
        "VALIDATION",
        `${line.rawMaterial.code} is priced at receive: enter the agreed price.`,
        { [`lines.${i}.unitPrice`]: ["Enter the agreed price per unit"] },
      );
    }
    const check = shortExtra(l.challanQuantity ?? null, l.quantity, line.rawMaterial.kind);
    return { input: l, line, price, check };
  });
  const came = checked.filter((c) => c.input.quantity > 0);
  if (came.length === 0) {
    throw new AppError("VALIDATION", "Enter what actually came on at least one line.", {
      lines: ["Nothing came"],
    });
  }
  const shorts = checked.filter((c) => c.check.level === "SHORT");
  const today = localDay(new Date(), ctx.company.timezone);
  const day = input.billDate ?? today;
  const currency = ctx.company.currency;
  const faults: Array<{ number: string; material: string; text: string }> = [];

  const bill = await createPurchase(
    ctx,
    {
      purchaseOrderId: order.id,
      warehouseId: input.warehouseId,
      billDate: input.billDate,
      supplierRef: input.supplierRef ?? undefined,
      paymentType: "DUE",
      notes: input.notes ?? undefined,
      items: came.map((c) => ({
        purchaseOrderLineId: c.line.id,
        quantity: c.input.quantity,
        challanQuantity: c.input.challanQuantity ?? null,
        ...(c.input.unitPrice !== null && c.input.unitPrice !== undefined
          ? { unitPrice: c.input.unitPrice }
          : {}),
      })),
    },
    meta,
    async (tx, saved) => {
      for (const s of shorts) {
        const m = s.line.rawMaterial;
        const short = new Prisma.Decimal(s.input.challanQuantity!).minus(s.input.quantity);
        const unit = UNIT_LABELS[m.unit];
        const fault = await tx.supplierFault.create({
          data: {
            companyId: ctx.company.id,
            number: await nextDocumentNumber(tx, ctx.company.id, "SUPPLIER_FAULT"),
            supplierId: order.supplier.id,
            kind: "SHORT_RECEIVE",
            batchId: batch.id,
            rawMaterialId: m.id,
            billId: saved.id,
            quantity: short,
            amount: s.price ? short.times(s.price).toDecimalPlaces(2) : null,
            note:
              `${order.number}: challan ${s.input.challanQuantity} ${unit}, actual ` +
              `${s.input.quantity} ${unit} (${s.check.percent}% short)` +
              (input.supplierRef ? `, challan ${input.supplierRef}` : ""),
            occurredOn: dateColumn(day),
            createdById: ctx.user.id,
          },
          select: { id: true, number: true, amount: true },
        });
        faults.push({
          number: fault.number,
          material: `${m.code} ${m.name}`,
          text:
            `${m.code} ${m.name}: ${short.toFixed(3).replace(/\.?0+$/, "")} ${unit} short ` +
            `(${s.check.percent}%)` +
            (fault.amount ? `, ${currency} ${groupAmount(fault.amount.toFixed(2), currency)}` : ""),
        });
      }
      if (faults.length === 0) return;
      await auditInCompany(
        ctx,
        meta,
        {
          action: "CREATE",
          entityType: "SupplierFault",
          entityId: saved.id,
          summary: `Logged ${faults.map((f) => f.number).join(", ")} for ${order.supplier.name} on ${saved.number}: ${faults.map((f) => f.text).join("; ")}`,
        },
        tx,
      );
      const members = await activeMembers(ctx.company.id, tx);
      const to = membersWith(members, ["production.manage", "materials.purchase"]).map(
        (userId) => ({ userId }),
      );
      await sendInApp(tx, ctx.company.id, to, {
        subject: `Short delivery: ${order.supplier.name} on ${order.number}`,
        body:
          `${saved.number} for ${batch.code} came short against the challan: ` +
          `${faults.map((f) => f.text).join("; ")}. Logged in the fault log to deduct.`,
        entityType: "SupplierBill",
        entityId: saved.id,
      });
    },
  );
  return {
    bill: { id: bill.id, number: bill.number },
    shorts: faults,
    extras: checked.filter((c) => c.check.level === "EXTRA").length,
  };
}
