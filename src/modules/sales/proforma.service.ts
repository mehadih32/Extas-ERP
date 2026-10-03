import { Prisma } from "@prisma/client";

import { AppError } from "@/lib/errors";
import { nextDocumentNumber } from "@/lib/numbering";
import { prisma } from "@/lib/prisma";
import type { RequestMeta } from "@/lib/request-meta";
import { lockRow } from "@/lib/row-lock";
import { auditInCompany } from "@/modules/audit/audit.service";
import type { CompanyContext } from "@/modules/auth/context";
import { letterhead } from "@/modules/companies/letterhead";
import { getDefaultWarehouse } from "@/modules/inventory/stock.service";
import { assertPartyCanTransact } from "@/modules/parties/party.service";
import { createOrderTx, getOrder } from "@/modules/sales/order.service";
import { refreshOrderPayments } from "@/modules/sales/posting";
import { assertStockOrOverride, resolveOrderLines } from "@/modules/sales/pricing";
import {
  cancelOrderSchema,
  convertProformaToOrderSchema,
  convertToProformaSchema,
  listProformasSchema,
} from "@/modules/sales/schemas";
import { advanceAmount, orderTotals } from "@/modules/sales/totals";

/*
 * B2B pre-order flow:
 *   Quotation -> Proforma Invoice (advance, default 30%)
 *   advance received -> production project starts (see payment.service)
 *   goods ready -> Proforma converts to a sales order; the advance moves with it.
 */

/** One-click conversion of a quotation into a proforma invoice. */
export async function convertQuotationToProforma(
  ctx: CompanyContext,
  quotationId: string,
  raw: unknown = {},
  meta?: RequestMeta,
) {
  const input = convertToProformaSchema.parse(raw);
  const quotation = await ctx.db.quotation.findUnique({ where: { id: quotationId } });
  if (!quotation) throw new AppError("NOT_FOUND", "Quotation not found.");
  const party = await assertPartyCanTransact(ctx, quotation.partyId, "SALE");
  const percent = new Prisma.Decimal(input.advancePercent ?? ctx.company.defaultAdvancePercent);

  const proforma = await prisma.$transaction(async (tx) => {
    // Claim the quotation so it cannot be converted twice.
    const { count } = await tx.quotation.updateMany({
      where: { id: quotation.id, status: { in: ["DRAFT", "SENT", "ACCEPTED"] } },
      data: { status: "CONVERTED" },
    });
    if (count === 0) {
      throw new AppError(
        "CONFLICT",
        `A ${quotation.status.toLowerCase()} quotation cannot be converted.`,
      );
    }
    const created = await tx.proformaInvoice.create({
      data: {
        companyId: ctx.company.id,
        number: await nextDocumentNumber(tx, ctx.company.id, "PROFORMA_INVOICE"),
        quotationId: quotation.id,
        partyId: party.id,
        issueDate: input.issueDate ?? new Date(),
        total: quotation.total,
        advancePercent: percent,
        advanceAmount: advanceAmount(quotation.total, percent),
      },
    });
    await auditInCompany(
      ctx,
      meta,
      {
        action: "CREATE",
        entityType: "ProformaInvoice",
        entityId: created.id,
        summary: `Converted ${quotation.number} to ${created.number}: total ${created.total.toFixed(2)}, advance ${created.advanceAmount.toFixed(2)} (${percent.toFixed(0)}%)`,
      },
      tx,
    );
    return created;
  });
  return getProforma(ctx, proforma.id);
}

export async function getProforma(ctx: CompanyContext, proformaId: string) {
  const proforma = await ctx.db.proformaInvoice.findUnique({
    where: { id: proformaId },
    include: {
      party: {
        select: {
          id: true,
          code: true,
          name: true,
          contactPerson: true,
          phone: true,
          email: true,
          address: true,
          taxId: true,
        },
      },
      quotation: {
        include: {
          items: {
            orderBy: { sortOrder: "asc" },
            include: {
              category: { select: { id: true, name: true } },
              style: { select: { id: true, code: true, name: true } },
            },
          },
          stylingRules: { orderBy: { sortOrder: "asc" } },
        },
      },
      payments: {
        orderBy: { paymentDate: "asc" },
        select: {
          id: true,
          number: true,
          amount: true,
          method: true,
          paymentDate: true,
          reference: true,
        },
      },
      productionProjects: {
        select: { id: true, code: true, name: true, stage: true, targetDate: true },
      },
      salesOrder: { select: { id: true, number: true, status: true } },
    },
  });
  if (!proforma) throw new AppError("NOT_FOUND", "Proforma invoice not found.");
  return {
    ...proforma,
    advanceDue: Prisma.Decimal.max(proforma.advanceAmount.minus(proforma.advancePaid), 0),
    balanceDue: Prisma.Decimal.max(proforma.total.minus(proforma.advancePaid), 0),
    letterhead: letterhead(ctx.company),
  };
}

export async function listProformas(ctx: CompanyContext, raw: unknown = {}) {
  const q = listProformasSchema.parse(raw);
  const take = q.take ?? 50;
  const rows = await ctx.db.proformaInvoice.findMany({
    where: {
      ...(q.status ? { status: q.status } : {}),
      ...(q.partyId ? { partyId: q.partyId } : {}),
    },
    include: { party: { select: { id: true, code: true, name: true } } },
    orderBy: [{ issueDate: "desc" }, { id: "desc" }],
    take: take + 1,
    ...(q.cursor ? { cursor: { id: q.cursor }, skip: 1 } : {}),
  });
  const hasMore = rows.length > take;
  const items = hasMore ? rows.slice(0, take) : rows;
  return { items, nextCursor: hasMore ? items[items.length - 1]?.id : undefined };
}

/** Cancels a proforma with no advance paid; its quotation can be converted again. */
export async function cancelProforma(
  ctx: CompanyContext,
  proformaId: string,
  raw: unknown,
  meta?: RequestMeta,
) {
  const { reason } = cancelOrderSchema.parse(raw);
  const proforma = await ctx.db.proformaInvoice.findUnique({ where: { id: proformaId } });
  if (!proforma) throw new AppError("NOT_FOUND", "Proforma invoice not found.");
  await prisma.$transaction(async (tx) => {
    await lockRow(tx, "ProformaInvoice", proforma.id);
    const current = await tx.proformaInvoice.findUniqueOrThrow({ where: { id: proforma.id } });
    if (current.status !== "ISSUED") {
      throw new AppError(
        "CONFLICT",
        `A proforma that is ${current.status.toLowerCase()} cannot be cancelled.`,
      );
    }
    if (current.advancePaid.gt(0)) {
      throw new AppError("CONFLICT", "An advance was paid on this proforma; refund it first.");
    }
    await tx.proformaInvoice.update({
      where: { id: proforma.id },
      data: { status: "CANCELLED", quotationId: null },
    });
    if (proforma.quotationId) {
      await tx.quotation.update({
        where: { id: proforma.quotationId },
        data: { status: "ACCEPTED" },
      });
    }
    await auditInCompany(
      ctx,
      meta,
      {
        action: "STATUS_CHANGE",
        entityType: "ProformaInvoice",
        entityId: proforma.id,
        summary: `Cancelled ${proforma.number}: ${reason}`,
      },
      tx,
    );
  });
  return getProforma(ctx, proforma.id);
}

/**
 * Goods are ready: turns the proforma into a sales order (matrix lines from
 * stock). Advance payments move to the order and count towards its invoice.
 */
export async function convertProformaToOrder(
  ctx: CompanyContext,
  proformaId: string,
  raw: unknown,
  meta?: RequestMeta,
) {
  const input = convertProformaToOrderSchema.parse(raw);
  const proforma = await ctx.db.proformaInvoice.findUnique({ where: { id: proformaId } });
  if (!proforma) throw new AppError("NOT_FOUND", "Proforma invoice not found.");
  if (proforma.status === "CANCELLED" || proforma.status === "CONVERTED") {
    throw new AppError("CONFLICT", `This proforma is already ${proforma.status.toLowerCase()}.`);
  }
  if (proforma.advancePaid.lt(proforma.advanceAmount)) {
    throw new AppError(
      "CONFLICT",
      `The advance of ${proforma.advanceAmount.toFixed(2)} is not fully received yet (${proforma.advancePaid.toFixed(2)} paid).`,
    );
  }
  const warehouse = input.warehouseId
    ? await ctx.db.warehouse.findUnique({ where: { id: input.warehouseId } })
    : await getDefaultWarehouse(ctx);
  if (!warehouse) throw new AppError("NOT_FOUND", "Warehouse not found.");
  const lines = await resolveOrderLines(ctx, input, "B2B_PREORDER", warehouse.id);
  assertStockOrOverride(ctx, lines, input.forceOverride);
  const { total } = orderTotals(lines, input);
  // The advance is already on the buyer's ledger, so the whole total is checked.
  await assertPartyCanTransact(ctx, proforma.partyId, "SALE", Number(total));
  if (total.lt(proforma.advancePaid)) {
    throw new AppError(
      "VALIDATION",
      `The order total ${total.toFixed(2)} is less than the advance already paid (${proforma.advancePaid.toFixed(2)}).`,
    );
  }

  const orderId = await prisma.$transaction(
    async (tx) => {
      await lockRow(tx, "ProformaInvoice", proforma.id);
      const { count } = await tx.proformaInvoice.updateMany({
        where: { id: proforma.id, status: { notIn: ["CANCELLED", "CONVERTED"] } },
        data: { status: "CONVERTED" },
      });
      if (count === 0) throw new AppError("CONFLICT", "This proforma was already converted.");
      const order = await createOrderTx(
        tx,
        ctx,
        {
          channel: "B2B_PREORDER",
          partyId: proforma.partyId,
          proformaId: proforma.id,
          warehouseId: warehouse.id,
          orderDate: input.orderDate,
          shipmentDate: input.shipmentDate,
          lines,
          charges: input,
          notes: input.notes,
          customerName: input.customerName,
          customerPhone: input.customerPhone,
          shippingAddress: input.shippingAddress,
          overrideReason: input.forceOverride?.reason,
        },
        meta,
      );
      await tx.payment.updateMany({
        where: { proformaId: proforma.id },
        data: { orderId: order.id },
      });
      await refreshOrderPayments(tx, order.id);
      return order.id;
    },
    { timeout: 30_000 },
  );
  return getOrder(ctx, orderId);
}
