import type { Prisma } from "@prisma/client";

import { dayRange } from "@/lib/dates";
import { AppError } from "@/lib/errors";
import { nextDocumentNumber } from "@/lib/numbering";
import { prisma } from "@/lib/prisma";
import type { RequestMeta } from "@/lib/request-meta";
import { lockRow } from "@/lib/row-lock";
import { ensureControlAccounts } from "@/modules/accounts/control-accounts";
import {
  type JournalLineInput,
  postJournalEntry,
  reverseJournalEntry,
} from "@/modules/accounts/journal.service";
import { settleSupplierBills } from "@/modules/accounts/supplier-settlement";
import { auditInCompany } from "@/modules/audit/audit.service";
import type { CompanyContext } from "@/modules/auth/context";
import { assertAnyPermission, assertCanSeeMaterialCosts } from "@/modules/materials/access";
import {
  createSupplierReturnSchema,
  listSupplierReturnsSchema,
  voidSchema,
} from "@/modules/materials/schemas";
import {
  assertUnitFits,
  describeLines,
  documentDate,
  lineMemo,
  linkMovementsToEntry,
  lockMaterials,
  materialLabel,
  resolveStore,
  stockIn,
  stockOut,
} from "@/modules/materials/stock";
import { formatQuantity, money, qty, ZERO } from "@/modules/materials/valuation";
import { recordPartyActivity } from "@/modules/parties/party.service";

/*
 * Returns to a supplier (debit notes, DN-): goods from one of their bills go
 * back at the bill price. The supplier owes us that much (it comes off what we
 * owe them, oldest due first) and the goods leave the store:
 *   Dr Payable (supplier)   Cr Raw Materials   ± Production & Inventory Losses
 * The losses line carries the cost difference when the stock's average has
 * moved away from the bill price since the goods arrived.
 */

const TX_OPTIONS = { timeout: 30_000 };

const assertCanReturn = (ctx: CompanyContext) =>
  assertAnyPermission(
    ctx,
    ["materials.purchase", "accounts.manage"],
    "Only buyers (materials.purchase) or Accounts can send goods back to a supplier.",
  );

export async function createSupplierReturn(ctx: CompanyContext, raw: unknown, meta?: RequestMeta) {
  const input = createSupplierReturnSchema.parse(raw);
  assertCanReturn(ctx);
  const companyId = ctx.company.id;
  const found = await ctx.db.supplierBill.findFirst({
    where: { id: input.billId, items: { some: {} } },
    select: { id: true, warehouseId: true },
  });
  if (!found) throw new AppError("NOT_FOUND", "Material purchase not found.");
  const store = await resolveStore(ctx, input.warehouseId ?? found.warehouseId);
  const date = documentDate(ctx, input.date);

  const returnId = await prisma.$transaction(async (tx) => {
    await lockRow(tx, "SupplierBill", found.id);
    const bill = await tx.supplierBill.findFirstOrThrow({
      where: { id: found.id, companyId },
      include: {
        supplier: { select: { id: true, name: true } },
        items: {
          include: {
            rawMaterial: { select: { code: true, name: true, unit: true } },
            returnLines: {
              where: { purchaseReturn: { voidedAt: null } },
              select: { quantity: true, amount: true },
            },
          },
        },
      },
    });
    if (bill.status === "VOID") throw new AppError("CONFLICT", `${bill.number} is void.`);
    const itemsById = new Map(bill.items.map((i) => [i.id, i]));
    const planned = input.lines.map((line, i) => {
      const item = itemsById.get(line.billItemId);
      if (!item) {
        throw new AppError("VALIDATION", `Line ${i + 1} is not on ${bill.number}.`, {
          [`lines.${i}.billItemId`]: ["Choose a line of this bill"],
        });
      }
      const quantity = qty(line.quantity);
      assertUnitFits(item.rawMaterial, quantity, `lines.${i}.quantity`);
      const returnedQty = item.returnLines.reduce((t, l) => t.plus(l.quantity), ZERO);
      const returnedAmount = item.returnLines.reduce((t, l) => t.plus(l.amount), ZERO);
      const left = item.quantity.minus(returnedQty);
      if (quantity.gt(left)) {
        throw new AppError(
          "VALIDATION",
          `Only ${formatQuantity(left, item.rawMaterial.unit)} of ${materialLabel(
            item.rawMaterial,
          )} from ${bill.number} can still go back.`,
          { [`lines.${i}.quantity`]: [`At most ${left.toString()}`] },
        );
      }
      // The last of a line takes what is left of its amount, so the line returns in full.
      const amount = quantity.equals(left)
        ? item.amount.minus(returnedAmount)
        : money(quantity.times(item.unitPrice));
      return { item, quantity, amount };
    });

    const state = await lockMaterials(
      tx,
      companyId,
      planned.map((p) => p.item.rawMaterialId),
    );
    const totalAmount = planned.reduce((t, p) => t.plus(p.amount), ZERO);
    const created = await tx.purchaseReturn.create({
      data: {
        companyId,
        number: await nextDocumentNumber(tx, companyId, "PURCHASE_RETURN"),
        supplierId: bill.supplierId,
        billId: bill.id,
        warehouseId: store.id,
        date,
        reason: input.reason,
        totalAmount,
        stockValue: 0,
        createdById: ctx.user.id,
      },
    });
    let stockValue = ZERO;
    const movementIds: string[] = [];
    const lines: Prisma.PurchaseReturnLineCreateManyInput[] = [];
    const removed: Prisma.Decimal[] = [];
    for (const p of planned) {
      const out = await stockOut(tx, state, {
        companyId,
        createdById: ctx.user.id,
        materialId: p.item.rawMaterialId,
        warehouseId: store.id,
        type: "RETURN_TO_SUPPLIER",
        quantity: p.quantity,
        atValue: p.amount,
        date,
        note: input.reason,
        links: { supplierBillId: bill.id, purchaseReturnId: created.id },
      });
      stockValue = stockValue.plus(out.value);
      movementIds.push(out.movement.id);
      removed.push(out.value);
      lines.push({
        purchaseReturnId: created.id,
        billItemId: p.item.id,
        rawMaterialId: p.item.rawMaterialId,
        quantity: p.quantity,
        unitPrice: p.item.unitPrice,
        amount: p.amount,
        stockValue: out.value,
      });
    }
    await tx.purchaseReturnLine.createMany({ data: lines });

    let journalEntryId: string | null = null;
    if (totalAmount.gt(0) || stockValue.gt(0)) {
      const acc = await ensureControlAccounts(companyId, tx);
      const difference = totalAmount.minus(stockValue);
      const entryLines: JournalLineInput[] = [
        {
          accountId: acc.PAYABLE,
          partyId: bill.supplierId,
          debit: totalAmount,
          memo: `${created.number} · ${bill.number}`,
        },
        ...planned.map((p, i) => ({
          accountId: acc.RAW_MATERIALS,
          credit: removed[i],
          memo: lineMemo(p.item.rawMaterial, p.quantity),
        })),
      ];
      if (difference.gt(0)) {
        entryLines.push({
          accountId: acc.PRODUCTION_LOSS,
          credit: difference,
          memo: "Cost difference",
        });
      } else if (difference.lt(0)) {
        entryLines.push({
          accountId: acc.PRODUCTION_LOSS,
          debit: difference.neg(),
          memo: "Cost difference",
        });
      }
      const entry = await postJournalEntry(tx, {
        companyId,
        date,
        description: `Return ${created.number} to ${bill.supplier.name} — ${bill.number}: ${input.reason}`,
        sourceType: "PURCHASE_RETURN",
        sourceId: created.id,
        postedById: ctx.user.id,
        lines: entryLines,
      });
      journalEntryId = entry.id;
      await linkMovementsToEntry(tx, movementIds, entry.id);
    }
    await tx.purchaseReturn.update({
      where: { id: created.id },
      data: { stockValue, journalEntryId },
    });
    // The credit settles what is owed to the supplier, oldest due first.
    await settleSupplierBills(tx, companyId, bill.supplierId);
    await recordPartyActivity(bill.supplierId, date, tx);
    await auditInCompany(
      ctx,
      meta,
      {
        action: "CREATE",
        entityType: "PurchaseReturn",
        entityId: created.id,
        summary: `Returned to ${bill.supplier.name} on ${created.number} (${bill.number}): ${describeLines(
          planned.map((p) => ({ material: p.item.rawMaterial, quantity: p.quantity })),
        )}; ${totalAmount.toFixed(2)} credited — ${input.reason}`,
      },
      tx,
    );
    return created.id;
  }, TX_OPTIONS);
  return getSupplierReturn(ctx, returnId);
}

/** Undoes a return entered by mistake: the goods come back into the store as they left. */
export async function voidSupplierReturn(
  ctx: CompanyContext,
  returnId: string,
  raw: unknown,
  meta?: RequestMeta,
) {
  const { reason } = voidSchema.parse(raw);
  assertCanReturn(ctx);
  const companyId = ctx.company.id;
  const found = await ctx.db.purchaseReturn.findUnique({
    where: { id: returnId },
    select: { billId: true },
  });
  if (!found) throw new AppError("NOT_FOUND", "Supplier return not found.");
  await prisma.$transaction(async (tx) => {
    // The bill first, like a new return from it.
    await lockRow(tx, "SupplierBill", found.billId);
    await lockRow(tx, "PurchaseReturn", returnId);
    const ret = await tx.purchaseReturn.findFirstOrThrow({
      where: { id: returnId, companyId },
      include: {
        lines: { orderBy: { id: "asc" } },
        supplier: { select: { name: true } },
      },
    });
    if (ret.voidedAt) throw new AppError("CONFLICT", `${ret.number} is already void.`);
    const state = await lockMaterials(
      tx,
      companyId,
      ret.lines.map((l) => l.rawMaterialId),
    );
    const reversal = ret.journalEntryId
      ? await reverseJournalEntry(tx, ret.journalEntryId, {
          description: `Void return ${ret.number}: ${reason}`,
          postedById: ctx.user.id,
        })
      : null;
    for (const line of ret.lines) {
      await stockIn(tx, state, {
        companyId,
        createdById: ctx.user.id,
        materialId: line.rawMaterialId,
        warehouseId: ret.warehouseId,
        type: "SUPPLIER_RETURN_VOID",
        quantity: line.quantity,
        value: line.stockValue,
        date: new Date(),
        note: reason,
        links: {
          supplierBillId: ret.billId,
          purchaseReturnId: ret.id,
          journalEntryId: reversal?.id,
        },
      });
    }
    await tx.purchaseReturn.update({
      where: { id: ret.id },
      data: { voidedAt: new Date(), voidReason: reason },
    });
    await settleSupplierBills(tx, companyId, ret.supplierId);
    await auditInCompany(
      ctx,
      meta,
      {
        action: "STATUS_CHANGE",
        entityType: "PurchaseReturn",
        entityId: ret.id,
        summary: `Voided return ${ret.number} to ${ret.supplier.name} (${ret.totalAmount.toFixed(
          2,
        )}); the goods are back in the store: ${reason}`,
      },
      tx,
    );
  }, TX_OPTIONS);
  return getSupplierReturn(ctx, returnId);
}

export async function getSupplierReturn(ctx: CompanyContext, returnId: string) {
  assertCanSeeMaterialCosts(ctx);
  const ret = await ctx.db.purchaseReturn.findUnique({
    where: { id: returnId },
    include: {
      supplier: { select: { id: true, code: true, name: true } },
      bill: { select: { id: true, number: true, supplierRef: true, billDate: true, status: true } },
      warehouse: { select: { id: true, name: true } },
      createdBy: { select: { id: true, name: true } },
      lines: {
        orderBy: { id: "asc" },
        include: {
          rawMaterial: { select: { id: true, code: true, name: true, kind: true, unit: true } },
        },
      },
    },
  });
  if (!ret) throw new AppError("NOT_FOUND", "Supplier return not found.");
  return ret;
}

export async function listSupplierReturns(ctx: CompanyContext, raw: unknown = {}) {
  assertCanSeeMaterialCosts(ctx);
  const q = listSupplierReturnsSchema.parse(raw);
  const take = q.take ?? 50;
  const { start, end } = dayRange(q.from, q.to, ctx.company.timezone);
  const rows = await ctx.db.purchaseReturn.findMany({
    where: {
      ...(q.supplierId ? { supplierId: q.supplierId } : {}),
      ...(q.billId ? { billId: q.billId } : {}),
      ...(q.includeVoid ? {} : { voidedAt: null }),
      ...(start || end
        ? { date: { ...(start ? { gte: start } : {}), ...(end ? { lt: end } : {}) } }
        : {}),
    },
    include: {
      supplier: { select: { id: true, code: true, name: true } },
      bill: { select: { id: true, number: true } },
      warehouse: { select: { id: true, name: true } },
      _count: { select: { lines: true } },
    },
    orderBy: [{ date: "desc" }, { id: "desc" }],
    take: take + 1,
    ...(q.cursor ? { cursor: { id: q.cursor }, skip: 1 } : {}),
  });
  const hasMore = rows.length > take;
  const items = hasMore ? rows.slice(0, take) : rows;
  return { items, nextCursor: hasMore ? items[items.length - 1]?.id : undefined };
}
