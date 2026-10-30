import { type PaymentMethod, Prisma } from "@prisma/client";

import { localDay, startOfDayInZone } from "@/lib/dates";
import { prisma } from "@/lib/prisma";
import { lockRow } from "@/lib/row-lock";
import { returnCreditOnOrder } from "@/modules/sales/credit.service";
import { deliveredByVariant } from "@/modules/sales/documents.service";
import { receivePaymentTx } from "@/modules/sales/payment.service";
import { receivePaymentSchema } from "@/modules/sales/schemas";
import { money } from "@/modules/sales/totals";

import { EcommerceApiError } from "./errors";
import { goneForStore, retailStoreOf } from "./retail-mode";
import type { ShopCall } from "./route";
import { paymentSchema, type ShopPaymentMethod } from "./schemas";

/*
 * POST /payments (CN-005): money the shop collected on one of its orders, a
 * bKash, Nagad or card payment at checkout, or the courier's cash on delivery.
 * It is recorded through the ERP's own receipt (receivePaymentTx), in the
 * shop's account, so every rule holds and the ERP posts the journal itself:
 * before the invoice it is the order's advance (Dr cash/bank/wallet, Cr
 * Customer Advance), after it the receivable goes down; a sale without a buyer
 * names the Walk-in customers account on those lines. The invoice issued later
 * uses the advance, as for the ERP's own walk-in orders.
 *
 * Besides the Idempotency-Key, the same order, method and reference is taken
 * only once (409 PAYMENT_EXISTS): a shop that lost its key and sends the
 * payment again under a new one does not record the money twice. So bKash,
 * Nagad and card money needs its transaction id (reference); a cash on
 * delivery sent without one is taken once per amount on an order (a second
 * COD of the same amount needs its own reference, such as the courier's
 * invoice). An order whose parcel came back undelivered takes no money (409
 * ORDER_LOCKED): nothing is owed on it.
 */

/** The ERP's payment method for the shop's (each goes to its method's default account). */
const ERP_METHOD: Record<ShopPaymentMethod, PaymentMethod> = {
  COD: "COURIER_COD",
  BKASH: "BKASH",
  NAGAD: "NAGAD",
  CARD: "CARD",
};

const amount = (value: Prisma.Decimal.Value) => Number(money(value).toFixed(2));

/** This integration's order with that externalOrderId, or 404. */
export async function shopOrderOf(
  call: Pick<ShopCall, "ctx" | "integration">,
  externalOrderId: string,
) {
  const order = await call.ctx.db.salesOrder.findFirst({
    where: { integrationId: call.integration.id, externalOrderId },
    select: { id: true, number: true },
  });
  if (!order) {
    throw new EcommerceApiError(
      404,
      "NOT_FOUND",
      `There is no order ${externalOrderId} from this shop. Send the order first.`,
    );
  }
  return order;
}

const invalid = (field: string, message: string): never => {
  throw new EcommerceApiError(422, "VALIDATION", message, { [field]: [message] });
};

/** When the money came: a day (its start in company time, or now for today) or a time; never later. */
function receivedAt(date: string | undefined, timeZone: string) {
  const now = new Date();
  if (!date) return now;
  if (/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    const today = localDay(now, timeZone);
    if (date > today) invalid("date", "The money cannot have come on a later day than today.");
    return date === today ? now : startOfDayInZone(date, timeZone);
  }
  const at = new Date(date);
  // A few minutes' grace for the shop's clock.
  if (at.getTime() > now.getTime() + 5 * 60_000) {
    invalid("date", "The money cannot have come at a later time than now.");
  }
  return at;
}

export async function recordShopPayment(call: ShopCall) {
  if (await retailStoreOf(call)) {
    throw goneForStore(
      "POST /payments",
      "the store pays the ERP on account and Accounts records it in the ERP (see GET /account).",
    );
  }
  const input = paymentSchema.parse(call.body);
  const { ctx } = call;
  const paymentDate = receivedAt(input.date, ctx.company.timezone);
  const order = await shopOrderOf(call, input.externalOrderId);
  const method = ERP_METHOD[input.method];
  const reference = input.reference || undefined;

  return prisma.$transaction(
    async (tx) => {
      // The order first, as the receipt locks it: the checks below then hold until it is recorded.
      await lockRow(tx, "SalesOrder", order.id);
      // The same transaction id, or (COD without one) the same amount, is the same payment.
      const same = await tx.payment.findFirst({
        where: {
          companyId: ctx.company.id,
          orderId: order.id,
          direction: "RECEIVED",
          method,
          ...(reference ? { reference } : { amount: money(input.amount), reference: null }),
        },
        select: { id: true, number: true },
      });
      if (same) {
        throw new EcommerceApiError(
          409,
          "PAYMENT_EXISTS",
          reference
            ? `This payment (${input.method} ${reference}) is already recorded on the order as ${same.number}.`
            : `A ${input.method} payment of ${money(input.amount).toFixed(2)} is already recorded on the order as ${same.number}. Send another one with its own reference.`,
          { erpPaymentId: same.id },
        );
      }
      const current = await tx.salesOrder.findUniqueOrThrow({
        where: { id: order.id },
        select: { number: true, status: true, total: true, paidAmount: true },
      });
      if (current.status === "RETURNED") {
        const delivered = [...(await deliveredByVariant(tx, order.id)).values()];
        if (!delivered.some((pieces) => pieces > 0)) {
          throw new EcommerceApiError(
            409,
            "ORDER_LOCKED",
            `${current.number} came back undelivered, so nothing is owed on it.`,
          );
        }
      }
      // A cancelled order is refused by the receipt itself (409). A return's credit on the
      // order steps aside for money paid for the same pieces (payment.service.ts).
      if (current.status !== "CANCELLED") {
        const due = Prisma.Decimal.max(current.total.minus(current.paidAmount), 0).plus(
          await returnCreditOnOrder(tx, order.id),
        );
        if (money(input.amount).gt(due)) {
          const most = due.isNegative() ? "0.00" : due.toFixed(2);
          throw new EcommerceApiError(
            422,
            "VALIDATION",
            `Only ${most} is due on ${current.number}.`,
            { amount: [`At most ${most}`] },
          );
        }
      }
      const { payment } = await receivePaymentTx(
        tx,
        ctx,
        receivePaymentSchema.parse({
          orderId: order.id,
          amount: input.amount,
          method,
          paymentDate,
          reference,
          notes: input.note || undefined,
        }),
        call.meta,
      );
      const after = await tx.salesOrder.findUniqueOrThrow({
        where: { id: order.id },
        select: { total: true, paidAmount: true },
      });
      return {
        erpPaymentId: payment.id,
        erpPaymentNumber: payment.number,
        externalOrderId: input.externalOrderId,
        amount: amount(payment.amount),
        method: input.method,
        orderPaid: amount(after.paidAmount),
        orderDue: Math.max(amount(after.total.minus(after.paidAmount)), 0),
      };
    },
    { timeout: 30_000 },
  );
}
