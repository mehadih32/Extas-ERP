import type {
  InvoiceStatus,
  PaymentMethod,
  ProductionStage,
  ProformaStatus,
  QuotationStatus,
  RefundKind,
  SalesChannel,
  SalesOrderStatus,
} from "@prisma/client";

import { groupAmount } from "@/lib/display";

/*
 * Words and figures for the Sales screens: plain strings in, plain strings out,
 * so the browser and the tests share them.
 */

export const QUOTATION_STATUS_LABELS: Record<QuotationStatus, string> = {
  DRAFT: "Draft",
  SENT: "Sent",
  ACCEPTED: "Accepted",
  REJECTED: "Rejected",
  EXPIRED: "Expired",
  CONVERTED: "Proforma made",
};

export const PROFORMA_STATUS_LABELS: Record<ProformaStatus, string> = {
  ISSUED: "Awaiting advance",
  ADVANCE_RECEIVED: "Advance received",
  IN_PRODUCTION: "In production",
  CONVERTED: "Became an order",
  CANCELLED: "Cancelled",
};

export const ORDER_STATUS_LABELS: Record<SalesOrderStatus, string> = {
  DRAFT: "Draft",
  CONFIRMED: "Confirmed",
  PROCESSING: "Part delivered",
  PACKED: "Packed",
  SHIPPED: "Shipped",
  DELIVERED: "Delivered",
  PARTIALLY_RETURNED: "Part returned",
  RETURNED: "Returned",
  CANCELLED: "Cancelled",
};

export const INVOICE_STATUS_LABELS: Record<InvoiceStatus, string> = {
  UNPAID: "Unpaid",
  PARTIALLY_PAID: "Part paid",
  PAID: "Paid",
  VOID: "Void",
};

export const CHANNEL_LABELS: Record<SalesChannel, string> = {
  WHOLESALE: "Wholesale",
  B2B_PREORDER: "B2B pre-order",
  POS: "Counter sale",
  SOCIAL_COMMERCE: "Social commerce",
  WEBSITE: "Website",
};

/** What each channel an order is taken in by hand is for. */
export const CHANNEL_HINTS: Partial<Record<SalesChannel, string>> = {
  WHOLESALE: "A buyer's order at wholesale prices.",
  POS: "A sale at the counter, at retail prices.",
  SOCIAL_COMMERCE: "A Facebook, Instagram or WhatsApp order, at retail prices.",
  B2B_PREORDER: "Goods made for a buyer against a proforma invoice.",
};

export const METHOD_LABELS: Record<PaymentMethod, string> = {
  CASH: "Cash",
  BANK_TRANSFER: "Bank transfer",
  CHEQUE: "Cheque",
  BKASH: "bKash",
  NAGAD: "Nagad",
  ROCKET: "Rocket",
  CARD: "Card",
  COURIER_COD: "Courier cash on delivery",
  OTHER: "Other",
};

export const REFUND_KIND_LABELS: Record<RefundKind, string> = {
  CASH: "Paid back",
  CREDIT: "Kept as credit",
  FORFEIT: "Cancellation charge",
};

/** What each way of settling a buyer's money does, for the choice in a dialog. */
export const REFUND_KIND_HINTS: Record<RefundKind, string> = {
  CASH: "The money goes back to the buyer from cash, a bank or a wallet.",
  CREDIT: "It stays on the buyer's account and pays for their next orders.",
  FORFEIT: "The company keeps it as a cancellation charge.",
};

/** Retail channels default to retail prices; wholesale and pre-orders to wholesale prices. */
export function usesWholesalePrice(channel: SalesChannel): boolean {
  return channel === "WHOLESALE" || channel === "B2B_PREORDER";
}

/** "BDT 12,500.00" from "12500.00" ("-BDT …" never shows: amounts here are positive). */
export function money(fixed: string, currency: string): string {
  return `${currency} ${groupAmount(fixed, currency)}`;
}

export const isZero = (fixed: string) => !/[1-9]/.test(fixed);

/** Who an order or invoice is for: the buyer, or the walk-in customer's name. */
export function buyerName(buyer: { name: string } | null, customerName?: string | null): string {
  return buyer?.name ?? customerName ?? "Walk-in customer";
}

export const salesHref = {
  order: (id: string) => `/sales/orders/${encodeURIComponent(id)}`,
  quotation: (id: string) => `/sales/quotations/${encodeURIComponent(id)}`,
  proforma: (id: string) => `/sales/proformas/${encodeURIComponent(id)}`,
  invoice: (id: string) => `/sales/invoices/${encodeURIComponent(id)}`,
  payment: (id: string) => `/sales/payments/${encodeURIComponent(id)}`,
  buyer: (id: string) => `/parties/buyers/${encodeURIComponent(id)}`,
};

export const PRODUCTION_STAGE_LABELS: Record<ProductionStage, string> = {
  FABRIC_SOURCING: "Fabric sourcing",
  CUTTING: "Cutting",
  SEWING: "Sewing",
  WASH_QC: "Wash and QC",
  FINISHING: "Finishing",
  COMPLETED: "Completed",
};
