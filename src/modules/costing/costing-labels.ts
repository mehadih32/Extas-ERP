/*
 * Words for the costing sheet, shared by the screens and the server (no
 * database). The buyer's way of paying is one of TT, a direct bank transfer
 * or an LC, set on the buyer and changeable per order; there is no default.
 */

export const TRADE_PAYMENTS = ["TT", "BANK_TRANSFER", "LC"] as const;
export type TradePaymentKey = (typeof TRADE_PAYMENTS)[number];

export const TRADE_PAYMENT_LABELS: Record<TradePaymentKey, string> = {
  TT: "TT",
  BANK_TRANSFER: "Direct bank transfer",
  LC: "LC",
};

export const CM_PER_LABELS = { PIECE: "per piece", DOZEN: "per dozen" } as const;
export const FABRIC_UNIT_LABELS = { KG: "kg", YARD: "yard" } as const;
export const DECISION_LABELS = { TAKE: "Taken", DECLINE: "Declined" } as const;
