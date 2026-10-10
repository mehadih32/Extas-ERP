import type { BuyerType, PartyGrade, PartyStatus, SupplierCategory } from "@prisma/client";

import type { PartyListName } from "./labels";

/*
 * The Buyers and Suppliers tabs' filters, kept in the address bar so a refresh
 * or a shared link shows the same list:
 * "/parties/buyers?q=rahman&status=ACTIVE&grade=A_PLUS&type=WHOLESALE&verified=1", and
 * "/parties/suppliers?category=FOB" for suppliers of one category.
 * Empty filters stay out of the address.
 */

export type PartyListView = {
  list: PartyListName;
  /** Name, code, contact person, phone or email. */
  q: string;
  status?: PartyStatus;
  grade?: PartyGrade;
  /** Buyers only. */
  type?: BuyerType;
  /** Suppliers only. */
  category?: SupplierCategory;
  /** Blue Verified only. */
  verified: boolean;
};

type SearchParams = Record<string, string | string[] | undefined>;

/** Buyers or suppliers shown at first and per "Show more". */
export const PARTY_PAGE_SIZE = 30;

const STATUSES: readonly PartyStatus[] = ["ACTIVE", "SETTLING", "DORMANT", "CLOSED"];
const GRADES: readonly PartyGrade[] = ["A_PLUS", "A", "B", "C"];
const TYPES: readonly BuyerType[] = ["RETAIL", "WHOLESALE", "B2B_CORPORATE"];
const CATEGORIES: readonly SupplierCategory[] = ["FABRIC", "ACCESSORIES", "FOB", "CM"];

const one = (params: SearchParams, key: string) => {
  const value = params[key];
  return typeof value === "string" ? value.trim() : "";
};

const pick = <T extends string>(choices: readonly T[], value: string): T | undefined =>
  (choices as readonly string[]).includes(value) ? (value as T) : undefined;

/** Reads the filters from the address bar; anything malformed is ignored. */
export function partyListViewFrom(list: PartyListName, params: SearchParams): PartyListView {
  return {
    list,
    q: one(params, "q").slice(0, 100),
    status: pick(STATUSES, one(params, "status")),
    grade: pick(GRADES, one(params, "grade")),
    type: list === "buyers" ? pick(TYPES, one(params, "type")) : undefined,
    category: list === "suppliers" ? pick(CATEGORIES, one(params, "category")) : undefined,
    verified: one(params, "verified") === "1",
  };
}

/** The address-bar query for these filters: "?q=rahman&verified=1", or "" when none are set. */
export function partyListSearch(view: PartyListView): string {
  const params = new URLSearchParams();
  if (view.q.trim()) params.set("q", view.q.trim());
  if (view.status) params.set("status", view.status);
  if (view.grade) params.set("grade", view.grade);
  if (view.list === "buyers" && view.type) params.set("type", view.type);
  if (view.list === "suppliers" && view.category) params.set("category", view.category);
  if (view.verified) params.set("verified", "1");
  const query = params.toString();
  return query ? `?${query}` : "";
}

/** Whether any filter narrows the list. */
export function isFiltered(view: PartyListView): boolean {
  return Boolean(
    view.q.trim() || view.status || view.grade || view.type || view.category || view.verified,
  );
}

/** The party list query (listPartiesSchema) for these filters. */
export function partyListQuery(view: PartyListView, cursor?: string) {
  return {
    kind: view.list === "buyers" ? ("BUYER" as const) : ("SUPPLIER" as const),
    search: view.q.trim() || undefined,
    status: view.status,
    grade: view.grade,
    buyerType: view.list === "buyers" ? view.type : undefined,
    category: view.list === "suppliers" ? view.category : undefined,
    verified: view.verified || undefined,
    cursor,
    take: PARTY_PAGE_SIZE,
  };
}
