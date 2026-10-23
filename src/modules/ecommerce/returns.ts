import { AppError } from "@/lib/errors";
import { prisma } from "@/lib/prisma";
import { assertAllowed } from "@/lib/verdict";
import { createSalesReturn, returnPosition } from "@/modules/sales/return.service";
import { canReturnOnInvoice } from "@/modules/sales/rules";

import { EcommerceApiError } from "./errors";
import { shopOrderOf } from "./payments";
import type { ShopCall } from "./route";
import { returnSchema } from "./schemas";

/*
 * POST /returns (CN-005): pieces that came back to the shop from one of its
 * delivered orders, with what the shop's check found per item. It is recorded
 * as the ERP's own sales return (credit note) in the shop's account, with
 * every rule it checks: delivered pieces on a live invoice, no more than were
 * delivered and have not come back yet. Items name their SKU; each goes to the
 * order's lines with that SKU in turn. QC per item (return.service.ts):
 *   GOOD      back into sellable stock at the cost it left at
 *   B_GRADE   into B-grade stock at that cost
 *   DAMAGED   to Damage & QC Rejects, as the ERP's own return screen does
 * The money credited stays on the Walk-in customers account (a website order
 * has no buyer profile): the API never pays money out.
 */

export async function recordShopReturn(call: ShopCall) {
  const input = returnSchema.parse(call.body);
  const { ctx } = call;
  const found = await shopOrderOf(call, input.externalOrderId);
  const order = await ctx.db.salesOrder.findUniqueOrThrow({
    where: { id: found.id },
    select: {
      id: true,
      number: true,
      status: true,
      invoice: { select: { id: true, number: true, status: true, partyId: true } },
    },
  });
  if (!order.invoice) {
    throw new AppError(
      "CONFLICT",
      `${order.number} has no invoice yet, so nothing can come back: it is invoiced when it is delivered.`,
    );
  }
  // The return's own rules first (void invoice, cancelled order, nothing delivered), with their words.
  const position = await returnPosition(prisma, order.id);
  assertAllowed(canReturnOnInvoice(order.invoice, order, position, { walkInCredit: true }));

  // Each item to the order's lines with its SKU, filling the first line before the next.
  const linesOf = new Map<string, typeof position.lines>();
  for (const line of position.lines) {
    linesOf.set(line.variant.sku, [...(linesOf.get(line.variant.sku) ?? []), line]);
  }
  const taken = new Map<string, number>();
  const items = input.items.flatMap((item, i) => {
    const lines = linesOf.get(item.sku);
    if (!lines) {
      throw new EcommerceApiError(
        422,
        "VALIDATION",
        `${item.sku} is not on order ${input.externalOrderId}.`,
        { [`items.${i}.sku`]: ["Not on this order"] },
      );
    }
    let left = item.quantity;
    const parts = [];
    for (const line of lines) {
      const take = Math.min(line.returnable - (taken.get(line.id) ?? 0), left);
      if (take <= 0) continue;
      taken.set(line.id, (taken.get(line.id) ?? 0) + take);
      parts.push({ orderItemId: line.id, quantity: take, qc: item.qc, qcNote: item.note });
      left -= take;
    }
    if (left > 0) {
      const returnable = lines.reduce((s, l) => s + l.returnable, 0);
      throw new EcommerceApiError(
        422,
        "VALIDATION",
        returnable === 0
          ? `No delivered pieces of ${item.sku} are left to come back.`
          : `Only ${returnable} delivered pcs of ${item.sku} can come back.`,
        { [`items.${i}.quantity`]: [`At most ${item.quantity - left}`] },
      );
    }
    return parts;
  });

  const credit = await createSalesReturn(
    ctx,
    {
      invoiceId: order.invoice.id,
      items,
      reason: input.reason,
      returnDate: input.returnDate,
    },
    call.meta,
    { walkInCredit: true },
  );
  return {
    erpReturnId: credit.id,
    erpReturnNumber: credit.number,
    externalOrderId: input.externalOrderId,
    credited: Number(credit.amount.toFixed(2)),
    orderStatus: credit.order.status,
    items: input.items.map(({ sku, quantity, qc }) => ({ sku, quantity, qc })),
  };
}
