import type {
  InvoiceStatus,
  ProformaStatus,
  QuotationStatus,
  SalesChannel,
  SalesOrderStatus,
} from "@prisma/client";

import { dayParam } from "@/components/parties/route";

/*
 * The Sales lists' filters, kept in the address bar so a refresh or a shared
 * link shows the same list: "/sales/orders?q=rahim&status=CONFIRMED". Empty
 * filters stay out of the address; anything malformed is ignored.
 */

export type OrderListView = {
  list: "orders";
  /** Order number, buyer, customer name or phone. */
  q: string;
  status?: SalesOrderStatus;
  channel?: SalesChannel;
};

export type QuotationListView = {
  list: "quotations";
  /** Quotation number or buyer. */
  q: string;
  status?: QuotationStatus;
};

export type ProformaListView = { list: "proformas"; status?: ProformaStatus };

export type InvoiceListView = {
  list: "invoices";
  /** Invoice or order number, buyer or customer. */
  q: string;
  status?: InvoiceStatus | "OVERDUE";
};

export type PaymentListView = {
  list: "payments";
  /** Money received, or money refunded. */
  show: "received" | "refunds";
  from?: string;
  to?: string;
};

export type SalesListView =
  OrderListView | QuotationListView | ProformaListView | InvoiceListView | PaymentListView;

type SearchParams = Record<string, string | string[] | undefined>;

/** Rows shown at first and per "Show more". */
export const SALES_PAGE_SIZE = 30;

export const ORDER_STATUSES: readonly SalesOrderStatus[] = [
  "CONFIRMED",
  "PACKED",
  "PROCESSING",
  "DELIVERED",
  "CANCELLED",
];
export const ORDER_CHANNEL_FILTERS: readonly SalesChannel[] = [
  "WHOLESALE",
  "B2B_PREORDER",
  "POS",
  "SOCIAL_COMMERCE",
];
export const QUOTATION_STATUSES: readonly QuotationStatus[] = [
  "DRAFT",
  "SENT",
  "ACCEPTED",
  "REJECTED",
  "CONVERTED",
];
export const PROFORMA_STATUSES: readonly ProformaStatus[] = [
  "ISSUED",
  "IN_PRODUCTION",
  "CONVERTED",
  "CANCELLED",
];
export const INVOICE_FILTERS: ReadonlyArray<InvoiceStatus | "OVERDUE"> = [
  "UNPAID",
  "PARTIALLY_PAID",
  "OVERDUE",
  "PAID",
  "VOID",
];

const one = (params: SearchParams, key: string) => {
  const value = params[key];
  return typeof value === "string" ? value.trim() : "";
};

const pick = <T extends string>(choices: readonly T[], value: string): T | undefined =>
  (choices as readonly string[]).includes(value) ? (value as T) : undefined;

export function orderViewFrom(params: SearchParams): OrderListView {
  return {
    list: "orders",
    q: one(params, "q").slice(0, 100),
    status: pick(ORDER_STATUSES, one(params, "status")),
    channel: pick(ORDER_CHANNEL_FILTERS, one(params, "channel")),
  };
}

export function quotationViewFrom(params: SearchParams): QuotationListView {
  return {
    list: "quotations",
    q: one(params, "q").slice(0, 100),
    status: pick(QUOTATION_STATUSES, one(params, "status")),
  };
}

export function proformaViewFrom(params: SearchParams): ProformaListView {
  return { list: "proformas", status: pick(PROFORMA_STATUSES, one(params, "status")) };
}

export function invoiceViewFrom(params: SearchParams): InvoiceListView {
  return {
    list: "invoices",
    q: one(params, "q").slice(0, 100),
    status: pick(INVOICE_FILTERS, one(params, "status")),
  };
}

export function paymentViewFrom(params: SearchParams): PaymentListView {
  let from = dayParam(params.from);
  let to = dayParam(params.to);
  if (from && to && from > to) [from, to] = [to, from];
  return {
    list: "payments",
    show: one(params, "show") === "refunds" ? "refunds" : "received",
    from,
    to,
  };
}

/** The address-bar query for these filters: "?q=rahim&status=SENT", or "" when none are set. */
export function salesListSearch(view: SalesListView): string {
  const params = new URLSearchParams();
  if ("q" in view && view.q.trim()) params.set("q", view.q.trim());
  if (view.list === "payments") {
    if (view.show === "refunds") params.set("show", "refunds");
    if (view.from) params.set("from", view.from);
    if (view.to) params.set("to", view.to);
  } else {
    if (view.status) params.set("status", view.status);
    if (view.list === "orders" && view.channel) params.set("channel", view.channel);
  }
  const query = params.toString();
  return query ? `?${query}` : "";
}

/** Whether any filter narrows the list (the payments' received / refunds switch does not). */
export function isSalesFiltered(view: SalesListView): boolean {
  if (view.list === "payments") return Boolean(view.from || view.to);
  if (view.list === "proformas") return Boolean(view.status);
  if (view.list === "orders") return Boolean(view.q.trim() || view.status || view.channel);
  return Boolean(view.q.trim() || view.status);
}

/** The same view with its filters cleared. */
export function clearedView<T extends SalesListView>(view: T): T {
  if (view.list === "payments") return { list: "payments", show: view.show } as T;
  if (view.list === "proformas") return { list: "proformas" } as T;
  return { list: view.list, q: "" } as T;
}

/** The list query for these filters (listOrdersSchema and the others). */
export function orderListQuery(view: OrderListView, cursor?: string) {
  return {
    search: view.q.trim() || undefined,
    status: view.status,
    channel: view.channel,
    cursor,
    take: SALES_PAGE_SIZE,
  };
}

export function quotationListQuery(view: QuotationListView, cursor?: string) {
  return { search: view.q.trim() || undefined, status: view.status, cursor, take: SALES_PAGE_SIZE };
}

export function proformaListQuery(view: ProformaListView, cursor?: string) {
  return { status: view.status, cursor, take: SALES_PAGE_SIZE };
}

export function invoiceListQuery(view: InvoiceListView, cursor?: string) {
  return {
    search: view.q.trim() || undefined,
    status: view.status === "OVERDUE" ? undefined : view.status,
    overdue: view.status === "OVERDUE" || undefined,
    cursor,
    take: SALES_PAGE_SIZE,
  };
}

export function paymentListQuery(view: PaymentListView, cursor?: string) {
  return { from: view.from, to: view.to, cursor, take: SALES_PAGE_SIZE };
}
