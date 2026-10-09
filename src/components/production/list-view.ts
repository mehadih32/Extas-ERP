import type { BillStatus, IntakeStatus, ProductionStage, ProductionStatus } from "@prisma/client";

/*
 * The Production lists' filters, kept in the address bar so a refresh or a
 * shared link shows the same list: "/production/projects?q=polo&stage=SEWING".
 * Empty filters stay out of the address; anything malformed is ignored.
 */

export type ProjectListView = {
  list: "projects";
  /** Project code or name, factory or buyer. */
  q: string;
  /** A status, or "OVERDUE": open projects past their target day. */
  status?: ProductionStatus | "OVERDUE";
  stage?: ProductionStage;
};

export type DeliveryListView = { list: "deliveries"; status?: IntakeStatus };

export type BillListView = { list: "bills"; status?: BillStatus };

export type ProductionListView = ProjectListView | DeliveryListView | BillListView;

type SearchParams = Record<string, string | string[] | undefined>;

/** Rows shown at first and per "Show more". */
export const PRODUCTION_PAGE_SIZE = 30;

export const PROJECT_FILTERS: ReadonlyArray<ProductionStatus | "OVERDUE"> = [
  "ACTIVE",
  "OVERDUE",
  "PLANNED",
  "ON_HOLD",
  "COMPLETED",
  "CANCELLED",
];
/** The working stages (a completed project shows under its status instead). */
export const STAGE_FILTERS: readonly ProductionStage[] = [
  "FABRIC_SOURCING",
  "CUTTING",
  "SEWING",
  "WASH_QC",
  "FINISHING",
];
export const DELIVERY_FILTERS: readonly IntakeStatus[] = [
  "DRAFT",
  "CONFIRMED",
  "REVERSED",
  "CANCELLED",
];
export const BILL_FILTERS: readonly BillStatus[] = ["UNPAID", "PARTIALLY_PAID", "PAID", "VOID"];

const one = (params: SearchParams, key: string) => {
  const value = params[key];
  return typeof value === "string" ? value.trim() : "";
};

const pick = <T extends string>(choices: readonly T[], value: string): T | undefined =>
  (choices as readonly string[]).includes(value) ? (value as T) : undefined;

export function projectViewFrom(params: SearchParams): ProjectListView {
  return {
    list: "projects",
    q: one(params, "q").slice(0, 100),
    status: pick(PROJECT_FILTERS, one(params, "status")),
    stage: pick(STAGE_FILTERS, one(params, "stage")),
  };
}

export function deliveryViewFrom(params: SearchParams): DeliveryListView {
  return { list: "deliveries", status: pick(DELIVERY_FILTERS, one(params, "status")) };
}

export function billViewFrom(params: SearchParams): BillListView {
  return { list: "bills", status: pick(BILL_FILTERS, one(params, "status")) };
}

/** The address-bar query for these filters: "?q=polo&stage=SEWING", or "" when none are set. */
export function productionListSearch(view: ProductionListView): string {
  const params = new URLSearchParams();
  if (view.list === "projects" && view.q.trim()) params.set("q", view.q.trim());
  if (view.status) params.set("status", view.status);
  if (view.list === "projects" && view.stage) params.set("stage", view.stage);
  const query = params.toString();
  return query ? `?${query}` : "";
}

export function isProductionFiltered(view: ProductionListView): boolean {
  if (view.list === "projects") return Boolean(view.q.trim() || view.status || view.stage);
  return Boolean(view.status);
}

/** The same view with its filters cleared. */
export function clearedProductionView<T extends ProductionListView>(view: T): T {
  return (view.list === "projects" ? { list: view.list, q: "" } : { list: view.list }) as T;
}

/** The list query for these filters (listProjectsSchema). */
export function projectListQuery(view: ProjectListView, cursor?: string) {
  return {
    search: view.q.trim() || undefined,
    status: view.status === "OVERDUE" ? undefined : view.status,
    overdue: view.status === "OVERDUE" || undefined,
    stage: view.stage,
    cursor,
    take: PRODUCTION_PAGE_SIZE,
  };
}

export function deliveryListQuery(view: DeliveryListView, cursor?: string) {
  return { status: view.status, cursor, take: PRODUCTION_PAGE_SIZE };
}

export function billListQuery(view: BillListView, cursor?: string) {
  return { status: view.status, cursor, take: PRODUCTION_PAGE_SIZE };
}
