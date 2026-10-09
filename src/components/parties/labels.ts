import type { BuyerType, PartyGrade, PartyKind, PartyStatus } from "@prisma/client";

import { groupAmount } from "@/lib/display";

/*
 * Words and figures for the Buyers & suppliers screens: plain strings in, plain
 * strings out, so the browser and the tests share them.
 */

export const KIND_LABELS: Record<PartyKind, string> = {
  BUYER: "Buyer",
  SUPPLIER: "Supplier",
  BOTH: "Buyer and supplier",
};

export const BUYER_TYPE_LABELS: Record<BuyerType, string> = {
  RETAIL: "Retail",
  WHOLESALE: "Wholesale",
  B2B_CORPORATE: "Corporate (B2B)",
};

export const GRADE_LABELS: Record<PartyGrade, string> = {
  A_PLUS: "A+",
  A: "A",
  B: "B",
  C: "C",
};

export const GRADES: readonly PartyGrade[] = ["A_PLUS", "A", "B", "C"];

export const STATUS_LABELS: Record<PartyStatus, string> = {
  ACTIVE: "Active",
  SETTLING: "Settling",
  DORMANT: "Dormant",
  CLOSED: "Closed",
};

/** What each status means for the business done with the account. */
export const STATUS_MEANINGS: Record<PartyStatus, string> = {
  ACTIVE: "Open for business.",
  SETTLING: "Closed to new business while what is owed is cleared. It closes once settled.",
  DORMANT: "No orders for a while. Its next order makes it active again.",
  CLOSED: "No new business. Reopen it to trade again.",
};

/** "Wholesale buyer", "Supplier", "Buyer and supplier". */
export function kindLabel(party: { kind: PartyKind; buyerType: BuyerType | null }): string {
  if (party.kind === "BUYER" && party.buyerType) {
    return `${BUYER_TYPE_LABELS[party.buyerType]} buyer`;
  }
  return KIND_LABELS[party.kind];
}

/** The list a buyer or supplier belongs to: "buyers" (buyers and both) or "suppliers". */
export type PartyListName = "buyers" | "suppliers";

export function listOf(kind: PartyKind): PartyListName {
  return kind === "SUPPLIER" ? "suppliers" : "buyers";
}

/** The profile's address: /parties/buyers/… or /parties/suppliers/…. */
export function partyHref(party: { id: string; kind: PartyKind }, page = ""): string {
  return `/parties/${listOf(party.kind)}/${encodeURIComponent(party.id)}${page}`;
}

/** "BDT 12,500.00" from "12500.00" (or "-12500.00"). */
export function money(fixed: string, currency: string): string {
  return `${currency} ${groupAmount(fixed.replace(/^-/, ""), currency)}`;
}

const isZero = (fixed: string) => !/[1-9]/.test(fixed);

/**
 * A balance in words, from the company's side: "Owes you BDT 12,500.00",
 * "You owe BDT 3,000.00" or "Settled". Positive balances are owed to the company.
 */
export function balanceText(balance: string, currency: string): string {
  if (isZero(balance)) return "Settled";
  return balance.startsWith("-")
    ? `You owe ${money(balance, currency)}`
    : `Owes you ${money(balance, currency)}`;
}

/** "owed" (to the company), "owing" (by the company) or "settled". */
export function balanceTone(balance: string): "owed" | "owing" | "settled" {
  if (isZero(balance)) return "settled";
  return balance.startsWith("-") ? "owing" : "owed";
}

/** A statement's running balance: "12,500.00 Dr" (they owe), "3,000.00 Cr" (owed to them). */
export function drCr(balance: string, currency: string): string {
  if (isZero(balance)) return groupAmount("0.00", currency);
  return `${groupAmount(balance.replace(/^-/, ""), currency)} ${balance.startsWith("-") ? "Cr" : "Dr"}`;
}

/** A debit or credit cell: the amount, or empty for zero. */
export function amountCell(fixed: string, currency: string): string {
  return isZero(fixed) ? "" : groupAmount(fixed, currency);
}
