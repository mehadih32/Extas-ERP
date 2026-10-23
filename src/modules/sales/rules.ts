import {
  type InvoiceStatus,
  Prisma,
  type ProformaStatus,
  type QuotationStatus,
  type RefundKind,
  type SalesOrderStatus,
} from "@prisma/client";

import { ALLOWED, refuse, type Verdict } from "@/lib/verdict";
import type { CompanyContext } from "@/modules/auth/context";
import type { PermissionKey } from "@/modules/rbac/permissions";

/*
 * What may be done with a quotation, proforma, order, invoice or refund from
 * where it stands. The sales services refuse with these answers and the Sales
 * screens read the same answers to decide what to offer. The permission each
 * action needs is checked before these (sales.actions.ts).
 */

type Amount = Prisma.Decimal | string | number;
const dec = (v: Amount) => new Prisma.Decimal(v);
const fixed = (v: Amount) => dec(v).toFixed(2);
const lower = (status: string) => status.toLowerCase().replace(/_/g, " ");

// --- Quotations ------------------------------------------------------------------

type QuotationState = { status: QuotationStatus };

/** Quotations still being worked on, which can change. */
const QUOTATION_EDITABLE: readonly QuotationStatus[] = ["DRAFT", "SENT"];

export function canEditQuotation(q: QuotationState): Verdict {
  if (QUOTATION_EDITABLE.includes(q.status)) return ALLOWED;
  return refuse("CONFLICT", `A ${lower(q.status)} quotation cannot be edited.`);
}

/** The statuses a person marks a quotation with, and where each may come from. */
export type QuotationMark = "SENT" | "ACCEPTED" | "REJECTED";
const QUOTATION_MARK_FROM: Record<QuotationMark, readonly QuotationStatus[]> = {
  SENT: ["DRAFT"],
  ACCEPTED: ["DRAFT", "SENT"],
  REJECTED: ["DRAFT", "SENT", "ACCEPTED"],
};

/** Sent, then accepted or rejected. Converted quotations are final. */
export function canMarkQuotation(q: QuotationState, status: QuotationMark): Verdict {
  if (QUOTATION_MARK_FROM[status].includes(q.status)) return ALLOWED;
  return refuse(
    "CONFLICT",
    `Cannot mark a ${lower(q.status)} quotation as ${status.toLowerCase()}.`,
  );
}

/** The marks a screen offers from where the quotation is. */
export function quotationMarks(q: QuotationState): QuotationMark[] {
  return (["SENT", "ACCEPTED", "REJECTED"] as const).filter((s) => canMarkQuotation(q, s).ok);
}

export function canDeleteQuotation(q: QuotationState): Verdict {
  if (q.status === "DRAFT") return ALLOWED;
  return refuse("CONFLICT", "Only draft quotations can be deleted; reject it instead.");
}

/** Draft, sent and accepted quotations become a proforma invoice (once). */
export function canConvertQuotation(q: QuotationState): Verdict {
  if (q.status === "DRAFT" || q.status === "SENT" || q.status === "ACCEPTED") return ALLOWED;
  return refuse("CONFLICT", `A ${lower(q.status)} quotation cannot be converted.`);
}

// --- Proforma invoices -------------------------------------------------------------

type ProformaState = {
  number: string;
  status: ProformaStatus;
  total: Amount;
  advanceAmount: Amount;
  advancePaid: Amount;
};

export const isClosedProforma = (status: ProformaStatus) =>
  status === "CANCELLED" || status === "CONVERTED";

/** A proforma that has not become an order can be cancelled (money held is settled first). */
export function canCancelProforma(p: Pick<ProformaState, "number" | "status">): Verdict {
  if (p.status === "CONVERTED") {
    return refuse("CONFLICT", `${p.number} became an order; cancel the order instead.`);
  }
  if (p.status === "CANCELLED") return refuse("CONFLICT", `${p.number} is already cancelled.`);
  return ALLOWED;
}

/** Buyer PO, validity and bank details change while the proforma is open. */
export function canEditProformaDetails(p: Pick<ProformaState, "number" | "status">): Verdict {
  if (isClosedProforma(p.status)) {
    return refuse(
      "CONFLICT",
      `${p.number} is ${lower(p.status)}; its details are kept as printed.`,
    );
  }
  return ALLOWED;
}

/**
 * A proforma's offer has run out: `today` (company time) is past its last valid day
 * and no advance came in yet. Shown on screen only; nothing is blocked by it.
 */
export const isProformaExpired = (
  p: { status: ProformaStatus; validUntil: string | null },
  today: string,
) => Boolean(p.validUntil && p.validUntil < today && p.status === "ISSUED");

/** Goods ready and the advance received in full: the proforma becomes an order. */
export function canConvertProforma(
  p: Pick<ProformaState, "status" | "advanceAmount" | "advancePaid">,
): Verdict {
  if (isClosedProforma(p.status)) {
    return refuse("CONFLICT", `This proforma is already ${lower(p.status)}.`);
  }
  if (dec(p.advancePaid).lt(dec(p.advanceAmount))) {
    return refuse(
      "CONFLICT",
      `The advance of ${fixed(p.advanceAmount)} is not fully received yet (${fixed(p.advancePaid)} paid).`,
    );
  }
  return ALLOWED;
}

/** Money comes in on an open proforma up to its total. */
export function canReceiveOnProforma(p: ProformaState): Verdict {
  if (isClosedProforma(p.status)) {
    return refuse(
      "CONFLICT",
      `This proforma is ${lower(p.status)}; take payment on its order instead.`,
    );
  }
  if (dec(p.total).minus(dec(p.advancePaid)).lte(0)) {
    return refuse("CONFLICT", `${p.number} is paid in full.`);
  }
  return ALLOWED;
}

/** Money held on an open proforma can be refunded. */
export function canRefundProforma(
  p: Pick<ProformaState, "number" | "status">,
  held: Amount,
): Verdict {
  if (p.status === "CONVERTED") {
    return refuse(
      "CONFLICT",
      `${p.number} became an order and its advance moved with it; refund it on the order.`,
    );
  }
  if (p.status === "CANCELLED") return refuse("CONFLICT", `${p.number} is cancelled.`);
  if (dec(held).lte(0)) {
    return refuse("CONFLICT", `Nothing paid on ${p.number} is left to refund.`);
  }
  return ALLOWED;
}

// --- Orders ------------------------------------------------------------------------

type InvoiceState = { number: string; status: InvoiceStatus };
type OrderState = {
  number: string;
  status: SalesOrderStatus;
  invoice?: InvoiceState | null;
};

/** The invoice that counts: one that is not void. */
export const liveInvoice = <T extends InvoiceState>(invoice: T | null | undefined): T | null =>
  invoice && invoice.status !== "VOID" ? invoice : null;

/** Cancelled and returned orders take no more documents. */
const ORDER_CLOSED: readonly SalesOrderStatus[] = ["CANCELLED", "RETURNED"];

/** Orders whose goods have not all left yet: their shipment date can still change. */
export const SHIPMENT_OPEN: readonly SalesOrderStatus[] = [
  "DRAFT",
  "CONFIRMED",
  "PROCESSING",
  "PACKED",
];

export function canIssueInvoice(o: OrderState): Verdict {
  if (ORDER_CLOSED.includes(o.status)) {
    return refuse("CONFLICT", `This order is ${lower(o.status)}.`);
  }
  const invoice = liveInvoice(o.invoice);
  if (invoice) {
    return refuse("CONFLICT", `Invoice ${invoice.number} already exists for this order.`);
  }
  return ALLOWED;
}

/**
 * An invoice is voided while nothing came back on it: a sales return (not
 * void) holds its prices, so that return is voided first.
 */
export function canVoidInvoice(invoice: Pick<InvoiceState, "status">, returns = 0): Verdict {
  if (invoice.status === "VOID") return refuse("CONFLICT", "This invoice is already void.");
  if (returns > 0) {
    return refuse(
      "CONFLICT",
      "Goods on this invoice came back on a sales return. Void the return first to void the invoice.",
    );
  }
  return ALLOWED;
}

export function canCreatePackingList(
  o: OrderState & { packingList?: { number: string } | null },
): Verdict {
  if (ORDER_CLOSED.includes(o.status)) {
    return refuse("CONFLICT", `This order is ${lower(o.status)}.`);
  }
  if (o.packingList) {
    return refuse("CONFLICT", `Packing list ${o.packingList.number} already exists.`);
  }
  return ALLOWED;
}

/** Goods leave on a challan while pieces remain to deliver. */
export function canCreateChallan(
  o: OrderState & { warehouseId: string | null },
  remainingPieces: number,
): Verdict {
  if (ORDER_CLOSED.includes(o.status) || o.status === "DRAFT") {
    return refuse("CONFLICT", `This order is ${lower(o.status)}.`);
  }
  if (!o.warehouseId) return refuse("CONFLICT", "The order has no warehouse.");
  if (remainingPieces <= 0) {
    return refuse("CONFLICT", "Everything on this order is delivered.");
  }
  return ALLOWED;
}

/**
 * Lines and charges change before anything has left the warehouse. With a live
 * invoice the edit revises that invoice under the same number (Smart Edit,
 * `revise`), which a fully paid invoice no longer allows; without `revise` the
 * invoice has to be voided first. A processing order is edited while nothing
 * of it was delivered (a website order the shop is working on, CN-005).
 * `beforePacking` (the online shops' API) also refuses a packed order.
 */
export function canEditOrder(
  o: OrderState & { warehouseId: string | null; packingList?: { number: string } | null },
  deliveredPieces: number,
  options: { revise?: boolean; beforePacking?: boolean } = {},
): Verdict {
  if (o.status !== "CONFIRMED" && o.status !== "PROCESSING" && o.status !== "PACKED") {
    return refuse("CONFLICT", `A ${lower(o.status)} order cannot be edited.`);
  }
  if (options.beforePacking && (o.status === "PACKED" || o.packingList)) {
    return refuse("CONFLICT", "This order is packed already, so it can no longer be edited.");
  }
  const invoice = liveInvoice(o.invoice);
  if (invoice && !options.revise) {
    return refuse("CONFLICT", `Void invoice ${invoice.number} before editing the order.`);
  }
  if (invoice?.status === "PAID") {
    return refuse(
      "CONFLICT",
      `Invoice ${invoice.number} is fully paid, so it is locked. Void it to correct it.`,
    );
  }
  if (deliveredPieces > 0) {
    return refuse("CONFLICT", "Part of this order is already delivered.");
  }
  if (!o.warehouseId) return refuse("CONFLICT", "The order has no warehouse.");
  return ALLOWED;
}

/**
 * An order nothing of which has been delivered can be cancelled. One with
 * delivered goods is cancelled only by taking them back into stock
 * (`returnDelivered`, Safe Void), and not once a return was recorded on it.
 */
export function canCancelOrder(
  o: OrderState,
  deliveredPieces: number,
  options: { returnDelivered?: boolean } = {},
): Verdict {
  if (o.status === "CANCELLED") return refuse("CONFLICT", "This order is already cancelled.");
  if (o.status === "RETURNED" && deliveredPieces <= 0) {
    // A website parcel that came back undelivered (CN-005): its stock was freed then.
    return refuse("CONFLICT", "This order came back undelivered; its stock is free already.");
  }
  if (deliveredPieces > 0) {
    if (!options.returnDelivered) {
      return refuse("CONFLICT", "Goods on this order were delivered; record a return instead.");
    }
    if (o.status === "RETURNED" || o.status === "PARTIALLY_RETURNED") {
      return refuse("CONFLICT", `Goods on this ${lower(o.status)} order already came back.`);
    }
  }
  return ALLOWED;
}

/** Cartons and the packer can be noted until an order is cancelled or returned. */
export function canSetLogistics(o: Pick<OrderState, "status">): Verdict {
  if (ORDER_CLOSED.includes(o.status)) {
    return refuse("CONFLICT", `This order is ${lower(o.status)}.`);
  }
  return ALLOWED;
}

export function canSetShipmentDate(o: Pick<OrderState, "status">): Verdict {
  if (SHIPMENT_OPEN.includes(o.status)) return ALLOWED;
  return refuse(
    "CONFLICT",
    `This order is ${lower(o.status)}; its shipment date can no longer change.`,
  );
}

/**
 * Closed with no sale: a cancelled order, or one that came back undelivered
 * (a website parcel the courier returned: RETURNED with nothing delivered).
 * Nothing is due on it and it takes no money. One place for the receipt,
 * the paid and due figures (posting.ts) and Bug Guard's totals check.
 */
export function closedWithNoSale(status: string, deliveredPieces: number): boolean {
  return status === "CANCELLED" || (status === "RETURNED" && deliveredPieces <= 0);
}

/** Money comes in on an order that is not closed with no sale, up to what is due. */
export function canReceiveOnOrder(
  o: Pick<OrderState, "number" | "status"> & { total: Amount; paidAmount: Amount },
  deliveredPieces: number,
): Verdict {
  if (o.status === "CANCELLED") return refuse("CONFLICT", "This order is cancelled.");
  if (closedWithNoSale(o.status, deliveredPieces)) {
    return refuse("CONFLICT", `${o.number} came back undelivered, so nothing is owed on it.`);
  }
  if (dec(o.total).minus(dec(o.paidAmount)).lte(0)) {
    return refuse("CONFLICT", `${o.number} is paid in full.`);
  }
  return ALLOWED;
}

/**
 * Money held on an order is refunded while it has no live invoice: money that
 * paid an invoice is refunded after voiding it.
 */
export function canRefundOrder(o: OrderState, held: Amount): Verdict {
  if (o.status === "CANCELLED") return refuse("CONFLICT", `${o.number} is cancelled.`);
  const invoice = liveInvoice(o.invoice);
  if (invoice) {
    return refuse(
      "CONFLICT",
      `The money paid on ${o.number} has paid invoice ${invoice.number}. Void the invoice first to refund it.`,
    );
  }
  if (dec(held).lte(0)) {
    return refuse("CONFLICT", `Nothing paid on ${o.number} is left to refund.`);
  }
  return ALLOWED;
}

// --- Refunds -----------------------------------------------------------------------

/** The Accounts key each way of settling a buyer's money needs. */
export const REFUND_PERMISSION: Record<RefundKind, { key: PermissionKey; message: string }> = {
  CASH: {
    key: "accounts.payments.record",
    message: "Only Accounts can pay money back to a buyer.",
  },
  CREDIT: {
    key: "accounts.receipts.record",
    message: "Only Accounts can keep a buyer's money as credit on their account.",
  },
  FORFEIT: {
    key: "accounts.manage",
    message: "Only Accounts can keep a buyer's money as a cancellation charge.",
  },
};

export function canRefundAs(ctx: Pick<CompanyContext, "can">, kind: RefundKind): Verdict {
  const rule = REFUND_PERMISSION[kind];
  return ctx.can(rule.key) ? ALLOWED : refuse("FORBIDDEN", rule.message);
}

/**
 * Voiding a refund needs the Accounts key for its kind, and for money paid
 * back also the right to record money received: the void puts it back into
 * the cash, bank or wallet account (as voiding a supplier payment does).
 */
export function canVoidRefundAs(ctx: Pick<CompanyContext, "can">, kind: RefundKind): Verdict {
  const own = canRefundAs(ctx, kind);
  if (!own.ok) return own;
  if (kind === "CASH" && !ctx.can("accounts.receipts.record")) {
    return refuse(
      "FORBIDDEN",
      "Only Accounts can record money received: voiding this refund puts the money back into the account.",
    );
  }
  return ALLOWED;
}

/**
 * The ways this person may settle money held for a buyer: paid back, kept as
 * credit on their account (only for a buyer with an account, not a walk-in
 * customer) or kept as a cancellation charge.
 */
export function settleKinds(
  ctx: Pick<CompanyContext, "can">,
  options: { onAccount: boolean },
): RefundKind[] {
  return (["CASH", "CREDIT", "FORFEIT"] as const).filter(
    (kind) => canRefundAs(ctx, kind).ok && (kind !== "CREDIT" || options.onAccount),
  );
}

/**
 * A refund recorded by mistake is voided while what it came off is still open:
 * not once that order or proforma is cancelled (or converted), nor while the
 * order is invoiced again. The service also checks the money still adds up.
 */
export function canVoidRefund(
  refund: { voidedAt: Date | null },
  from: { order?: OrderState | null; proforma?: Pick<ProformaState, "number" | "status"> | null },
): Verdict {
  if (refund.voidedAt) return refuse("CONFLICT", "This refund is already void.");
  if (from.order) {
    const { order } = from;
    if (order.status === "CANCELLED") {
      return refuse(
        "CONFLICT",
        `${order.number} is cancelled, so its refunds can no longer be voided.`,
      );
    }
    const invoice = liveInvoice(order.invoice);
    if (invoice) {
      return refuse(
        "CONFLICT",
        `${order.number} has been invoiced again (${invoice.number}); void the invoice before voiding this refund.`,
      );
    }
  } else if (from.proforma && isClosedProforma(from.proforma.status)) {
    return refuse(
      "CONFLICT",
      `${from.proforma.number} is ${lower(from.proforma.status)}, so its refunds can no longer be voided.`,
    );
  }
  return ALLOWED;
}

// --- Sales returns -------------------------------------------------------------------

/**
 * Goods come back against a live invoice once some of it was delivered, while
 * delivered pieces are left that have not come back. The value becomes the
 * buyer's credit, so a walk-in sale (no buyer account) takes no return.
 */
export function canReturnOnInvoice(
  invoice: InvoiceState & { partyId: string | null },
  order: Pick<OrderState, "status">,
  pieces: { delivered: number; returned: number },
  /**
   * A website shop's return (e-commerce API): its credit stays on the Walk-in
   * customers account, which the shop settles with its customer itself.
   */
  options: { walkInCredit?: boolean } = {},
): Verdict {
  if (invoice.status === "VOID") return refuse("CONFLICT", `Invoice ${invoice.number} is void.`);
  if (order.status === "CANCELLED") return refuse("CONFLICT", "Its order is cancelled.");
  if (!invoice.partyId && !options.walkInCredit) {
    return refuse(
      "CONFLICT",
      "A walk-in sale has no buyer account to keep the credit on, so it takes no sales return.",
    );
  }
  if (pieces.delivered <= 0) {
    return refuse(
      "CONFLICT",
      `Nothing on ${invoice.number} has been delivered yet, so nothing can come back.`,
    );
  }
  if (pieces.returned >= pieces.delivered) {
    return refuse("CONFLICT", `Every piece delivered on ${invoice.number} has already come back.`);
  }
  return ALLOWED;
}

export function canVoidSalesReturn(r: { number: string; voidedAt: Date | null }): Verdict {
  if (r.voidedAt) return refuse("CONFLICT", `${r.number} is already void.`);
  return ALLOWED;
}

/**
 * An order's status from its pieces: Returned once every piece ordered came
 * back, Part returned while some did, otherwise Delivered or (part delivered)
 * Processing, as a delivery leaves it.
 */
export function statusAfterReturns(pieces: {
  ordered: number;
  delivered: number;
  returned: number;
}): SalesOrderStatus {
  if (pieces.returned > 0) {
    return pieces.returned >= pieces.ordered ? "RETURNED" : "PARTIALLY_RETURNED";
  }
  return pieces.delivered >= pieces.ordered ? "DELIVERED" : "PROCESSING";
}
