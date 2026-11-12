/*
 * The kinds of approval the bot brings (approvals.ts) and their one-letter
 * codes on a button (Telegram allows 64 bytes). Pure: no database.
 */

export const APPROVAL_KINDS = ["booking", "payroll", "leave", "expense"] as const;
export type ApprovalKind = (typeof APPROVAL_KINDS)[number];

export const KIND_CODE: Record<ApprovalKind, string> = {
  booking: "b",
  payroll: "p",
  leave: "l",
  expense: "e",
};

export const KIND_OF_CODE: Record<string, ApprovalKind> = Object.fromEntries(
  APPROVAL_KINDS.map((k) => [KIND_CODE[k], k]),
);
