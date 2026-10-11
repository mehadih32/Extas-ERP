import type { AssetStatus } from "@prisma/client";

import { StatusBadge, type Tone } from "@/components/sales/badges";
import type { ExpenseStatus } from "@/modules/expenses/schemas";

import { ASSET_STATUS_LABELS, EXPENSE_STATUS_LABELS } from "./labels";

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

const ASSET_TONES: Record<AssetStatus, Tone> = {
  IN_USE: "done",
  UNDER_REPAIR: "open",
  DISPOSED: "closed",
};

export function AssetBadge({ status }: { status: AssetStatus }) {
  return <StatusBadge tone={ASSET_TONES[status]}>{ASSET_STATUS_LABELS[status]}</StatusBadge>;
}
