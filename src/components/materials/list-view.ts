import type {
  BillStatus,
  MaterialIssueKind,
  PurchaseOrderStatus,
  RawMaterialKind,
} from "@prisma/client";

import { KINDS, ORDER_STATUSES } from "./labels";

/*
 * The Raw materials lists' filters, kept in the address bar so a refresh or a
 * shared link shows the same list: "/materials/stock?kind=FABRIC&low=1".
 * Empty filters stay out of the address; anything malformed is ignored.
 */

/** Rows shown at first and per "Show more". */
export const MATERIALS_PAGE_SIZE = 30;

export type StockListView = {
  list: "stock";
  /** Code, name, colour or specification. */
  q: string;
  kind?: RawMaterialKind;
  /** Quantities in this store only. */
  store?: string;
  /** At or below the reorder level. */
  low?: boolean;
  /** Archived materials too. */
  archived?: boolean;
};

export type OrderListView = {
  list: "orders";
  /** Order number or the supplier's reference. */
  q: string;
  status?: PurchaseOrderStatus;
  /** Still open past the expected day. */
  overdue?: boolean;
  supplier?: string;
  material?: string;
};

export const BILL_STATUSES: readonly BillStatus[] = ["UNPAID", "PARTIALLY_PAID", "PAID", "VOID"];

export type PurchaseListView = { list: "purchases"; status?: BillStatus; supplier?: string };

export type ReturnListView = { list: "returns"; supplier?: string };

export const ISSUE_KINDS: readonly MaterialIssueKind[] = ["ISSUE", "RETURN"];

export type IssueListView = { list: "issues"; kind?: MaterialIssueKind; project?: string };

export type MaterialsListView =
  StockListView | OrderListView | PurchaseListView | ReturnListView | IssueListView;

type SearchParams = Record<string, string | string[] | undefined>;

const one = (params: SearchParams, key: string) => {
  const value = params[key];
  return typeof value === "string" ? value.trim() : "";
};

const pick = <T extends string>(choices: readonly T[], value: string): T | undefined =>
  (choices as readonly string[]).includes(value) ? (value as T) : undefined;

/** A record id from the address (letters, digits, dashes), or undefined. */
const idParam = (value: string) => (/^[A-Za-z0-9_-]{1,40}$/.test(value) ? value : undefined);
const flag = (params: SearchParams, key: string) => one(params, key) === "1" || undefined;

export function stockViewFrom(params: SearchParams): StockListView {
  return {
    list: "stock",
    q: one(params, "q").slice(0, 100),
    kind: pick(KINDS, one(params, "kind")),
    store: idParam(one(params, "store")),
    low: flag(params, "low"),
    archived: flag(params, "archived"),
  };
}

export function orderViewFrom(params: SearchParams): OrderListView {
  return {
    list: "orders",
    q: one(params, "q").slice(0, 100),
    status: pick(ORDER_STATUSES, one(params, "status")),
    overdue: flag(params, "overdue"),
    supplier: idParam(one(params, "supplier")),
    material: idParam(one(params, "material")),
  };
}

export function purchaseViewFrom(params: SearchParams): PurchaseListView {
  return {
    list: "purchases",
    status: pick(BILL_STATUSES, one(params, "status")),
    supplier: idParam(one(params, "supplier")),
  };
}

export function returnViewFrom(params: SearchParams): ReturnListView {
  return { list: "returns", supplier: idParam(one(params, "supplier")) };
}

export function issueViewFrom(params: SearchParams): IssueListView {
  return {
    list: "issues",
    kind: pick(ISSUE_KINDS, one(params, "kind")),
    project: idParam(one(params, "project")),
  };
}

/** The address-bar query for these filters: "?kind=FABRIC&low=1", or "" when none are set. */
export function materialsListSearch(view: MaterialsListView): string {
  const params = new URLSearchParams();
  const set = (key: string, value: string | boolean | undefined) => {
    if (value === true) params.set(key, "1");
    else if (typeof value === "string" && value.trim()) params.set(key, value.trim());
  };
  switch (view.list) {
    case "stock":
      set("q", view.q);
      set("kind", view.kind);
      set("store", view.store);
      set("low", view.low);
      set("archived", view.archived);
      break;
    case "orders":
      set("q", view.q);
      set("status", view.status);
      set("overdue", view.overdue);
      set("supplier", view.supplier);
      set("material", view.material);
      break;
    case "purchases":
      set("status", view.status);
      set("supplier", view.supplier);
      break;
    case "returns":
      set("supplier", view.supplier);
      break;
    case "issues":
      set("kind", view.kind);
      set("project", view.project);
      break;
  }
  const query = params.toString();
  return query ? `?${query}` : "";
}

export function isMaterialsFiltered(view: MaterialsListView): boolean {
  return materialsListSearch(view) !== "";
}

/** The same view with its filters cleared. */
export function clearedMaterialsView<T extends MaterialsListView>(view: T): T {
  return (
    view.list === "stock" || view.list === "orders"
      ? { list: view.list, q: "" }
      : { list: view.list }
  ) as T;
}

export function stockListQuery(view: StockListView, cursor?: string) {
  return {
    search: view.q.trim() || undefined,
    kind: view.kind,
    warehouseId: view.store,
    lowStock: view.low,
    includeInactive: view.archived,
    cursor,
    take: MATERIALS_PAGE_SIZE,
  };
}

export function orderListQuery(view: OrderListView, cursor?: string) {
  return {
    search: view.q.trim() || undefined,
    status: view.status,
    overdue: view.overdue,
    supplierId: view.supplier,
    materialId: view.material,
    cursor,
    take: MATERIALS_PAGE_SIZE,
  };
}

export function purchaseListQuery(view: PurchaseListView, cursor?: string) {
  return { status: view.status, supplierId: view.supplier, cursor, take: MATERIALS_PAGE_SIZE };
}

export function returnListQuery(view: ReturnListView, cursor?: string) {
  return { supplierId: view.supplier, cursor, take: MATERIALS_PAGE_SIZE };
}

export function issueListQuery(view: IssueListView, cursor?: string) {
  return { kind: view.kind, projectId: view.project, cursor, take: MATERIALS_PAGE_SIZE };
}
