import type { MaterialIssueKind, PurchaseOrderStatus } from "@prisma/client";

import { StatusBadge, type Tone } from "@/components/sales/badges";

import { ISSUE_KIND_LABELS, ORDER_STATUS_LABELS } from "./labels";

const ORDER_TONES: Record<PurchaseOrderStatus, Tone> = {
  OPEN: "open",
  PARTIALLY_RECEIVED: "open",
  RECEIVED: "done",
  CLOSED: "closed",
  CANCELLED: "closed",
};

export function OrderBadge({ status }: { status: PurchaseOrderStatus }) {
  return <StatusBadge tone={ORDER_TONES[status]}>{ORDER_STATUS_LABELS[status]}</StatusBadge>;
}

export function IssueKindBadge({ kind }: { kind: MaterialIssueKind }) {
  return (
    <StatusBadge tone={kind === "ISSUE" ? "open" : "plain"}>{ISSUE_KIND_LABELS[kind]}</StatusBadge>
  );
}

/** Low stock, late, archived, void: a short warning or "no longer counts" mark. */
export function FlagBadge({ tone = "warn", children }: { tone?: Tone; children: React.ReactNode }) {
  return <StatusBadge tone={tone}>{children}</StatusBadge>;
}
