import type { AccountSubType, PaymentMethod } from "@prisma/client";

/*
 * Choices the Accounts screens offer, shared by the server and the browser.
 */

/** The cash, bank and wallet account kinds money is paid from or into. */
export type MoneyAccountKind = "CASH" | "BANK" | "MOBILE_WALLET";

/** How money leaves or enters each kind of account. */
export const METHODS_BY_KIND: Record<MoneyAccountKind, readonly PaymentMethod[]> = {
  CASH: ["CASH"],
  BANK: ["BANK_TRANSFER", "CHEQUE", "CARD"],
  MOBILE_WALLET: ["BKASH", "NAGAD", "ROCKET"],
};

export function isMoneyAccountKind(subType: AccountSubType): subType is MoneyAccountKind {
  return subType === "CASH" || subType === "BANK" || subType === "MOBILE_WALLET";
}

/** Rows shown at first and per "Show more" in the Accounts lists. */
export const ACCOUNTS_PAGE_SIZE = 30;

/** The latest lines a ledger or bank statement shows on screen. */
export const LEDGER_LINES_SHOWN = 300;
