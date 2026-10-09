import type { JournalSource } from "@prisma/client";

import { ACCOUNTS_PAGE_SIZE } from "@/modules/accounts/choices";
import type { ExpenseStatus } from "@/modules/expenses/schemas";

import { EXPENSE_STATUSES, SOURCE_FILTERS } from "./labels";

/*
 * The Accounts lists' filters, kept in the address bar so a refresh or a
 * shared link shows the same list: "/accounts/expenses?status=PENDING".
 * Empty filters stay out of the address; anything malformed is ignored.
 */

export type JournalListView = {
  list: "journal";
  /** Voucher number or description. */
  q: string;
  source?: JournalSource;
};

export type ExpenseListView = {
  list: "expenses";
  /** Expense number, purpose or details. */
  q: string;
  status?: ExpenseStatus;
  head?: string;
  /** Only the ones I recorded (for people who see everyone's). */
  mine?: boolean;
};

export type PaymentListView = { list: "payments"; supplier?: string };

export type AccountsListView = JournalListView | ExpenseListView | PaymentListView;

type SearchParams = Record<string, string | string[] | undefined>;

const one = (params: SearchParams, key: string) => {
  const value = params[key];
  return typeof value === "string" ? value.trim() : "";
};

const pick = <T extends string>(choices: readonly T[], value: string): T | undefined =>
  (choices as readonly string[]).includes(value) ? (value as T) : undefined;

/** A record id from the address (letters, digits, dashes), or undefined. */
const idParam = (value: string) => (/^[A-Za-z0-9_-]{1,40}$/.test(value) ? value : undefined);

export function journalViewFrom(params: SearchParams): JournalListView {
  return {
    list: "journal",
    q: one(params, "q").slice(0, 100),
    source: pick(SOURCE_FILTERS, one(params, "source")),
  };
}

export function expenseViewFrom(params: SearchParams): ExpenseListView {
  return {
    list: "expenses",
    q: one(params, "q").slice(0, 100),
    status: pick(EXPENSE_STATUSES, one(params, "status")),
    head: idParam(one(params, "head")),
    mine: one(params, "mine") === "1" || undefined,
  };
}

export function paymentViewFrom(params: SearchParams): PaymentListView {
  return { list: "payments", supplier: idParam(one(params, "supplier")) };
}

/** The address-bar query for these filters: "?status=PENDING&mine=1", or "" when none are set. */
export function accountsListSearch(view: AccountsListView): string {
  const params = new URLSearchParams();
  if (view.list !== "payments" && view.q.trim()) params.set("q", view.q.trim());
  if (view.list === "journal" && view.source) params.set("source", view.source);
  if (view.list === "expenses") {
    if (view.status) params.set("status", view.status);
    if (view.head) params.set("head", view.head);
    if (view.mine) params.set("mine", "1");
  }
  if (view.list === "payments" && view.supplier) params.set("supplier", view.supplier);
  const query = params.toString();
  return query ? `?${query}` : "";
}

export function isAccountsFiltered(view: AccountsListView): boolean {
  switch (view.list) {
    case "journal":
      return Boolean(view.q.trim() || view.source);
    case "expenses":
      return Boolean(view.q.trim() || view.status || view.head || view.mine);
    case "payments":
      return Boolean(view.supplier);
  }
}

/** The same view with its filters cleared. */
export function clearedAccountsView<T extends AccountsListView>(view: T): T {
  return (view.list === "payments" ? { list: view.list } : { list: view.list, q: "" }) as T;
}

export function journalListQuery(view: JournalListView, cursor?: string) {
  return {
    search: view.q.trim() || undefined,
    sourceType: view.source,
    cursor,
    take: ACCOUNTS_PAGE_SIZE,
  };
}

export function expenseListQuery(view: ExpenseListView, cursor?: string) {
  return {
    search: view.q.trim() || undefined,
    status: view.status,
    headId: view.head,
    mine: view.mine,
    cursor,
    take: ACCOUNTS_PAGE_SIZE,
  };
}

export function paymentListQuery(view: PaymentListView, cursor?: string) {
  return { supplierId: view.supplier, cursor, take: ACCOUNTS_PAGE_SIZE };
}
