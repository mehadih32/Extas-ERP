import { StatusBadge, type Tone } from "@/components/sales/badges";
import type { ExpenseStatus } from "@/modules/expenses/schemas";

import { EXPENSE_STATUS_LABELS } from "./labels";

const EXPENSE_TONES: Record<ExpenseStatus, Tone> = {
  PENDING: "open",
  POSTED: "done",
  REJECTED: "closed",
  VOID: "closed",
};

export function ExpenseBadge({ status }: { status: ExpenseStatus }) {
  return <StatusBadge tone={EXPENSE_TONES[status]}>{EXPENSE_STATUS_LABELS[status]}</StatusBadge>;
}

/** A payment, entry or account that no longer counts: "Void", "Reversed", "Archived". */
export function OffBadge({ children }: { children: React.ReactNode }) {
  return <StatusBadge tone="closed">{children}</StatusBadge>;
}
