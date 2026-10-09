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

const isClosedProforma = (status: ProformaStatus) =>
  status === "CANCELLED" || status === "CONVERTED";

/** A proforma that has not become an order can be cancelled (money held is settled first). */
export function canCancelProforma(p: Pick<ProformaState, "number" | "status">): Verdict {
  if (p.status === "CONVERTED") {
    return refuse("CONFLICT", `${p.number} became an order; cancel the order instead.`);
  }
  if (p.status === "CANCELLED") return refuse("CONFLICT", `${p.number} is already cancelled.`);
  return ALLOWED;
}

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

export function canVoidInvoice(invoice: Pick<InvoiceState, "status">): Verdict {
  if (invoice.status === "VOID") return refuse("CONFLICT", "This invoice is already void.");
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
 * Lines and charges change before anything has left the warehouse and while the
 * order has no live invoice (void it first).
 */
export function canEditOrder(
  o: OrderState & { warehouseId: string | null },
  deliveredPieces: number,
): Verdict {
  if (o.status !== "CONFIRMED" && o.status !== "PACKED") {
    return refuse("CONFLICT", `A ${lower(o.status)} order cannot be edited.`);
  }
  const invoice = liveInvoice(o.invoice);
  if (invoice) {
    return refuse("CONFLICT", `Void invoice ${invoice.number} before editing the order.`);
  }
  if (deliveredPieces > 0) {
    return refuse("CONFLICT", "Part of this order is already delivered.");
  }
  if (!o.warehouseId) return refuse("CONFLICT", "The order has no warehouse.");
  return ALLOWED;
}

/** An order nothing of which has been delivered can be cancelled. */
export function canCancelOrder(o: OrderState, deliveredPieces: number): Verdict {
  if (o.status === "CANCELLED") return refuse("CONFLICT", "This order is already cancelled.");
  if (deliveredPieces > 0) {
    return refuse("CONFLICT", "Goods on this order were delivered; record a return instead.");
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

/** Money comes in on an order that is not cancelled, up to what is due. */
export function canReceiveOnOrder(
  o: Pick<OrderState, "number" | "status"> & { total: Amount; paidAmount: Amount },
): Verdict {
  if (o.status === "CANCELLED") return refuse("CONFLICT", "This order is cancelled.");
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
