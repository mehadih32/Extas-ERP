import type { Prisma } from "@prisma/client";

import { dayRange, toInstant } from "@/lib/dates";
import { AppError } from "@/lib/errors";
import { nextDocumentNumber } from "@/lib/numbering";
import { prisma } from "@/lib/prisma";
import type { RequestMeta } from "@/lib/request-meta";
import { lockRow } from "@/lib/row-lock";
import { ensureControlAccounts } from "@/modules/accounts/control-accounts";
import { assertCanPayMoney } from "@/modules/accounts/money-guards";
import { postJournalEntry, reverseJournalEntry } from "@/modules/accounts/journal.service";
import { settleSupplierBills } from "@/modules/accounts/supplier-settlement";
import { auditInCompany } from "@/modules/audit/audit.service";
import type { CompanyContext } from "@/modules/auth/context";
import { assertAnyPermission, assertCanSeeMaterialCosts } from "@/modules/materials/access";
import { OPEN_ORDER } from "@/modules/materials/material.service";
import { refreshPurchaseOrders } from "@/modules/materials/purchase-order.service";
import { createPurchaseSchema, listPurchasesSchema, voidSchema } from "@/modules/materials/schemas";
import {
  assertUnitFits,
  documentDate,
  lineMemo,
  linkMovementsToEntry,
  loadActiveMaterials,
  lockMaterials,
  resolveStore,
  stockIn,
  stockOut,
} from "@/modules/materials/stock";
import { money, qty, unitCost, ZERO } from "@/modules/materials/valuation";
import { assertPartyCanTransact, recordPartyActivity } from "@/modules/parties/party.service";
import { payBillTx } from "@/modules/production/cost.service";
import { payBillSchema } from "@/modules/production/schemas";

/*
 * Buying raw materials. The supplier's bill is the goods received note: its
 * lines come into the chosen store at the bill price and the supplier is owed
 * the total (Dr Raw Materials / Cr Payable). A bill paid now is paid in full by
 * Accounts straight away; a Due bill waits on the supplier's ledger. Bills
 * received against a purchase order count towards its lines.
 */

const TX_OPTIONS = { timeout: 30_000 };

/** Bills with raw material lines (production bills are split across projects instead). */
const isPurchase = { items: { some: {} } } satisfies Prisma.SupplierBillWhereInput;

async function assertPurchase(ctx: CompanyContext, billId: string) {
  const bill = await ctx.db.supplierBill.findFirst({
    where: { id: billId, ...isPurchase },
    select: { id: true, supplierId: true, purchaseOrderId: true, warehouseId: true },
  });
  if (!bill) throw new AppError("NOT_FOUND", "Material purchase not found.");
  return bill;
}

/**
 * Records a supplier's bill for raw materials and receives the goods into the
 * store. Due bills: buyers (materials.purchase) or Accounts. Paid now:
 * Accounts only (accounts.payments.record).
 */
export async function createPurchase(ctx: CompanyContext, raw: unknown, meta?: RequestMeta) {
  const input = createPurchaseSchema.parse(raw);
  if (input.paymentType === "CASH_BANK") {
    assertCanPayMoney(
      ctx,
      "Only Accounts can record a purchase paid now. Save it as Due to the supplier and Accounts will pay it.",
    );
  } else {
    assertAnyPermission(
      ctx,
      ["materials.purchase", "accounts.payments.record"],
      "You do not have permission to buy raw materials (materials.purchase).",
    );
  }
  const companyId = ctx.company.id;

  const order = input.purchaseOrderId
    ? await ctx.db.purchaseOrder.findUnique({
        where: { id: input.purchaseOrderId },
        include: { lines: true },
      })
    : null;
  if (input.purchaseOrderId && !order) throw new AppError("NOT_FOUND", "Purchase order not found.");
  if (order && input.supplierId && input.supplierId !== order.supplierId) {
    throw new AppError("VALIDATION", `The goods on ${order.number} come from its own supplier.`, {
      supplierId: ["Leave empty or choose the order's supplier"],
    });
  }
  const supplier = await assertPartyCanTransact(
    ctx,
    order?.supplierId ?? input.supplierId!,
    "PURCHASE",
  );
  const orderLines = new Map((order?.lines ?? []).map((l) => [l.id, l]));
  const items = input.items.map((item, i) => {
    const line = item.purchaseOrderLineId ? orderLines.get(item.purchaseOrderLineId) : undefined;
    if (item.purchaseOrderLineId && !line) {
      throw new AppError("VALIDATION", `Line ${i + 1} is not on ${order!.number}.`, {
        [`items.${i}.purchaseOrderLineId`]: ["Choose a line of this order"],
      });
    }
    if (line && item.materialId && item.materialId !== line.rawMaterialId) {
      throw new AppError("VALIDATION", `Line ${i + 1} names a different material from the order.`, {
        [`items.${i}.materialId`]: ["Leave empty or choose the order line's material"],
      });
    }
    const quantity = qty(item.quantity);
    const unitPrice = unitCost(item.unitPrice ?? line!.unitPrice);
    return {
      purchaseOrderLineId: line?.id ?? null,
      rawMaterialId: line?.rawMaterialId ?? item.materialId!,
      quantity,
      unitPrice,
      amount: money(quantity.times(unitPrice)),
      description: item.description ?? null,
    };
  });
  const materials = await loadActiveMaterials(
    ctx,
    items.map((i) => i.rawMaterialId),
  );
  items.forEach((item, i) =>
    assertUnitFits(materials.get(item.rawMaterialId)!, item.quantity, `items.${i}.quantity`),
  );
  const total = items.reduce((t, i) => t.plus(i.amount), ZERO);
  if (total.lte(0)) {
    throw new AppError("VALIDATION", "The bill total must be more than zero.", {
      items: ["Enter the prices on the bill"],
    });
  }
  const store = await resolveStore(ctx, input.warehouseId);
  if (input.attachmentId) {
    const file = await ctx.db.fileAsset.findUnique({ where: { id: input.attachmentId } });
    if (!file) throw new AppError("NOT_FOUND", "Attachment not found.");
  }
  const billDate = documentDate(ctx, input.billDate);

  const billId = await prisma.$transaction(async (tx) => {
    if (order) {
      await lockRow(tx, "PurchaseOrder", order.id);
      const { status } = await tx.purchaseOrder.findUniqueOrThrow({
        where: { id: order.id },
        select: { status: true },
      });
      if (!OPEN_ORDER.includes(status)) {
        throw new AppError(
          "CONFLICT",
          `${order.number} is ${status === "RECEIVED" ? "received in full" : status.toLowerCase()}; goods can no longer arrive on it.`,
        );
      }
    }
    const state = await lockMaterials(
      tx,
      companyId,
      items.map((i) => i.rawMaterialId),
    );
    const bill = await tx.supplierBill.create({
      data: {
        companyId,
        number: await nextDocumentNumber(tx, companyId, "SUPPLIER_BILL"),
        supplierRef: input.supplierRef ?? null,
        supplierId: supplier.id,
        billDate,
        totalAmount: total,
        paymentType: input.paymentType,
        dueAmount: total,
        attachmentId: input.attachmentId ?? null,
        notes: input.notes ?? null,
        warehouseId: store.id,
        purchaseOrderId: order?.id ?? null,
        items: { create: items },
      },
    });
    const movementIds: string[] = [];
    for (const item of items) {
      const { movement } = await stockIn(tx, state, {
        companyId,
        createdById: ctx.user.id,
        materialId: item.rawMaterialId,
        warehouseId: store.id,
        type: "PURCHASE_IN",
        quantity: item.quantity,
        value: item.amount,
        date: billDate,
        links: { supplierBillId: bill.id },
      });
      movementIds.push(movement.id);
    }
    const acc = await ensureControlAccounts(companyId, tx);
    const entry = await postJournalEntry(tx, {
      companyId,
      date: billDate,
      description: `Bill ${bill.number} — ${supplier.name}${
        bill.supplierRef ? ` (${bill.supplierRef})` : ""
      }: raw materials into ${store.name}${order ? ` on ${order.number}` : ""}`,
      sourceType: "SUPPLIER_BILL",
      sourceId: bill.id,
      postedById: ctx.user.id,
      lines: [
        ...items.map((i) => ({
          accountId: acc.RAW_MATERIALS,
          debit: i.amount,
          memo: lineMemo(materials.get(i.rawMaterialId)!, i.quantity),
        })),
        {
          accountId: acc.PAYABLE,
          partyId: supplier.id,
          credit: total,
          memo: bill.supplierRef ?? undefined,
        },
      ],
    });
    await tx.supplierBill.update({ where: { id: bill.id }, data: { journalEntryId: entry.id } });
    await linkMovementsToEntry(tx, movementIds, entry.id);
    if (order) await refreshPurchaseOrders(tx, [order.id]);
    await auditInCompany(
      ctx,
      meta,
      {
        action: "CREATE",
        entityType: "SupplierBill",
        entityId: bill.id,
        summary: `Bill ${bill.number} from ${supplier.name}: ${items.length} raw material line(s) into ${
          store.name
        }, ${total.toFixed(2)} ${input.paymentType === "DUE" ? "due" : "paid now"}${
          order ? ` (${order.number})` : ""
        }`,
      },
      tx,
    );
    if (input.paymentType === "CASH_BANK") {
      await payBillTx(
        tx,
        ctx,
        bill.id,
        {
          amount: total,
          method: input.method ?? "CASH",
          accountId: input.accountId,
          reference: input.reference,
          paymentDate: billDate,
        },
        meta,
      );
    }
    // An advance already paid to the supplier settles a Due bill straight away.
    await settleSupplierBills(tx, companyId, supplier.id);
    await recordPartyActivity(supplier.id, billDate, tx);
    return bill.id;
  }, TX_OPTIONS);
  return getPurchase(ctx, billId);
}

/** Accounts pays a material bill, in full or in part (Dr Payable / Cr Cash, Bank or Wallet). */
export async function payPurchase(
  ctx: CompanyContext,
  billId: string,
  raw: unknown,
  meta?: RequestMeta,
) {
  const input = payBillSchema.parse(raw);
  assertCanPayMoney(ctx);
  await assertPurchase(ctx, billId);
  await prisma.$transaction(
    (tx) =>
      payBillTx(
        tx,
        ctx,
        billId,
        {
          ...input,
          paymentDate: input.paymentDate
            ? toInstant(input.paymentDate, ctx.company.timezone)
            : undefined,
        },
        meta,
      ),
    TX_OPTIONS,
  );
  return getPurchase(ctx, billId);
}

/**
 * Voids a material bill entered by mistake: the goods go back out of the store
 * at the bill price, the bill's entry is reversed and anything already paid
 * stays with the supplier as an advance. The goods must still be in the store,
 * and any return to the supplier from the bill must be voided first.
 */
export async function voidPurchase(
  ctx: CompanyContext,
  billId: string,
  raw: unknown,
  meta?: RequestMeta,
) {
  const { reason } = voidSchema.parse(raw);
  assertAnyPermission(
    ctx,
    ["materials.purchase", "accounts.manage"],
    "Only buyers (materials.purchase) or Accounts can void a material purchase.",
  );
  const companyId = ctx.company.id;
  const found = await assertPurchase(ctx, billId);
  await prisma.$transaction(async (tx) => {
    // Same order as receiving: the purchase order, then the bill, then the materials.
    if (found.purchaseOrderId) await lockRow(tx, "PurchaseOrder", found.purchaseOrderId);
    await lockRow(tx, "SupplierBill", billId);
    const bill = await tx.supplierBill.findFirstOrThrow({
      where: { id: billId, companyId },
      include: {
        items: { orderBy: { id: "asc" } },
        supplier: { select: { name: true } },
        purchaseReturns: { where: { voidedAt: null }, select: { number: true } },
      },
    });
    if (bill.status === "VOID") throw new AppError("CONFLICT", `${bill.number} is already void.`);
    if (bill.purchaseReturns.length > 0) {
      throw new AppError(
        "CONFLICT",
        `Goods from ${bill.number} went back to the supplier on ${bill.purchaseReturns
          .map((r) => r.number)
          .join(
            ", ",
          )}; void ${bill.purchaseReturns.length > 1 ? "those returns" : "that return"} first.`,
      );
    }
    if (!bill.warehouseId) {
      throw new AppError("CONFLICT", `The store ${bill.number} received into no longer exists.`);
    }
    const state = await lockMaterials(
      tx,
      companyId,
      bill.items.map((i) => i.rawMaterialId),
    );
    const reversal = bill.journalEntryId
      ? await reverseJournalEntry(tx, bill.journalEntryId, {
          description: `Void bill ${bill.number}: ${reason}`,
          postedById: ctx.user.id,
        })
      : null;
    // The goods leave at the bill price; what the stock no longer carries is a cost difference.
    let difference = ZERO;
    for (const item of bill.items) {
      const out = await stockOut(tx, state, {
        companyId,
        createdById: ctx.user.id,
        materialId: item.rawMaterialId,
        warehouseId: bill.warehouseId,
        type: "PURCHASE_VOID",
        quantity: item.quantity,
        atValue: item.amount,
        date: new Date(),
        note: reason,
        links: { supplierBillId: bill.id, journalEntryId: reversal?.id },
      });
      difference = difference.plus(out.difference);
    }
    // The reversal took the bill's amounts out of Raw Materials; the stock gave up a little
    // more or less than that when other purchases had changed its average.
    if (!difference.isZero()) {
      const acc = await ensureControlAccounts(companyId, tx);
      const amount = difference.abs();
      const memo = `${bill.number} cost difference`;
      await postJournalEntry(tx, {
        companyId,
        description: `Cost difference on voiding bill ${bill.number}`,
        sourceType: "SUPPLIER_BILL",
        sourceId: bill.id,
        postedById: ctx.user.id,
        lines: difference.gt(0)
          ? [
              { accountId: acc.RAW_MATERIALS, debit: amount, memo },
              { accountId: acc.PRODUCTION_LOSS, credit: amount, memo },
            ]
          : [
              { accountId: acc.PRODUCTION_LOSS, debit: amount, memo },
              { accountId: acc.RAW_MATERIALS, credit: amount, memo },
            ],
      });
    }
    await tx.payment.updateMany({
      where: { supplierBillId: bill.id },
      data: { supplierBillId: null, isAdvance: true },
    });
    await tx.supplierBill.update({
      where: { id: bill.id },
      data: { status: "VOID", paidAmount: 0, dueAmount: 0 },
    });
    // What was paid on it now settles the supplier's other open bills.
    await settleSupplierBills(tx, companyId, bill.supplierId);
    if (bill.purchaseOrderId) await refreshPurchaseOrders(tx, [bill.purchaseOrderId]);
    await auditInCompany(
      ctx,
      meta,
      {
        action: "STATUS_CHANGE",
        entityType: "SupplierBill",
        entityId: bill.id,
        summary: `Voided bill ${bill.number} (${bill.totalAmount.toFixed(2)}) and took its ${
          bill.items.length
        } raw material line(s) back out of the store: ${reason}${
          bill.paidAmount.gt(0)
            ? `; ${bill.paidAmount.toFixed(2)} already paid stays as an advance to ${bill.supplier.name}`
            : ""
        }`,
      },
      tx,
    );
  }, TX_OPTIONS);
  return getPurchase(ctx, billId);
}

export async function getPurchase(ctx: CompanyContext, billId: string) {
  assertCanSeeMaterialCosts(ctx);
  const bill = await ctx.db.supplierBill.findFirst({
    where: { id: billId, ...isPurchase },
    include: {
      supplier: { select: { id: true, code: true, name: true, phone: true } },
      warehouse: { select: { id: true, name: true } },
      purchaseOrder: { select: { id: true, number: true, status: true } },
      items: {
        orderBy: { id: "asc" },
        include: {
          rawMaterial: { select: { id: true, code: true, name: true, kind: true, unit: true } },
          returnLines: {
            where: { purchaseReturn: { voidedAt: null } },
            select: { quantity: true },
          },
        },
      },
      payments: {
        orderBy: [{ paymentDate: "asc" }, { id: "asc" }],
        select: {
          id: true,
          number: true,
          amount: true,
          method: true,
          paymentDate: true,
          reference: true,
          account: { select: { id: true, name: true } },
        },
      },
      purchaseReturns: {
        orderBy: [{ date: "asc" }, { id: "asc" }],
        select: {
          id: true,
          number: true,
          date: true,
          reason: true,
          totalAmount: true,
          voidedAt: true,
        },
      },
      attachment: { select: { id: true, fileName: true, mimeType: true, sizeBytes: true } },
    },
  });
  if (!bill) throw new AppError("NOT_FOUND", "Material purchase not found.");
  return {
    ...bill,
    items: bill.items.map(({ returnLines, ...item }) => {
      const returned = returnLines.reduce((t, l) => t.plus(l.quantity), ZERO);
      return {
        ...item,
        /** Sent back to the supplier on returns that are not void. */
        returnedQty: returned,
        /** What can still go back. */
        returnableQty: bill.status === "VOID" ? ZERO : item.quantity.minus(returned),
      };
    }),
  };
}

export async function listPurchases(ctx: CompanyContext, raw: unknown = {}) {
  assertCanSeeMaterialCosts(ctx);
  const q = listPurchasesSchema.parse(raw);
  const take = q.take ?? 50;
  const { start, end } = dayRange(q.from, q.to, ctx.company.timezone);
  const rows = await ctx.db.supplierBill.findMany({
    where: {
      AND: [
        isPurchase,
        q.supplierId ? { supplierId: q.supplierId } : {},
        q.purchaseOrderId ? { purchaseOrderId: q.purchaseOrderId } : {},
        q.warehouseId ? { warehouseId: q.warehouseId } : {},
        q.status ? { status: q.status } : {},
        q.materialId ? { items: { some: { rawMaterialId: q.materialId } } } : {},
        start || end
          ? { billDate: { ...(start ? { gte: start } : {}), ...(end ? { lt: end } : {}) } }
          : {},
      ],
    },
    include: {
      supplier: { select: { id: true, code: true, name: true } },
      warehouse: { select: { id: true, name: true } },
      purchaseOrder: { select: { id: true, number: true } },
      _count: { select: { items: true } },
    },
    orderBy: [{ billDate: "desc" }, { id: "desc" }],
    take: take + 1,
    ...(q.cursor ? { cursor: { id: q.cursor }, skip: 1 } : {}),
  });
  const hasMore = rows.length > take;
  const items = hasMore ? rows.slice(0, take) : rows;
  return { items, nextCursor: hasMore ? items[items.length - 1]?.id : undefined };
}
