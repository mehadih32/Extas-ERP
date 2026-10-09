import type {
  InvoiceStatus,
  ProformaStatus,
  QuotationStatus,
  RefundKind,
  SalesOrderStatus,
} from "@prisma/client";

import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

import {
  INVOICE_STATUS_LABELS,
  ORDER_STATUS_LABELS,
  PROFORMA_STATUS_LABELS,
  QUOTATION_STATUS_LABELS,
  REFUND_KIND_LABELS,
} from "./labels";

export type Tone = "open" | "done" | "warn" | "closed" | "plain";

const TONE_STYLES: Record<Tone, string> = {
  /** Waiting on someone: the brand green outline. */
  open: "border-primary/30 bg-secondary text-primary",
  /** Finished well: solid green. */
  done: "border-transparent bg-primary text-primary-foreground",
  /** Needs attention: the alert red outline. */
  warn: "border-destructive/25 bg-destructive/5 text-destructive",
  /** Over without going ahead: greyed out. */
  closed: "border-border text-muted-foreground",
  plain: "border-border bg-muted text-foreground",
};

/** A status as a small outlined label in one of the tones above. */
export function StatusBadge({
  tone,
  children,
  className,
}: {
  tone: Tone;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <Badge variant="outline" className={cn(TONE_STYLES[tone], className)}>
      {children}
    </Badge>
  );
}

const QUOTATION_TONES: Record<QuotationStatus, Tone> = {
  DRAFT: "plain",
  SENT: "open",
  ACCEPTED: "done",
  REJECTED: "closed",
  EXPIRED: "closed",
  CONVERTED: "done",
};

export function QuotationBadge({
  status,
  isExpired = false,
}: {
  status: QuotationStatus;
  isExpired?: boolean;
}) {
  if (isExpired) return <StatusBadge tone="warn">Expired</StatusBadge>;
  return (
    <StatusBadge tone={QUOTATION_TONES[status]}>{QUOTATION_STATUS_LABELS[status]}</StatusBadge>
  );
}

const PROFORMA_TONES: Record<ProformaStatus, Tone> = {
  ISSUED: "open",
  ADVANCE_RECEIVED: "done",
  IN_PRODUCTION: "done",
  CONVERTED: "done",
  CANCELLED: "closed",
};

export function ProformaBadge({ status }: { status: ProformaStatus }) {
  return <StatusBadge tone={PROFORMA_TONES[status]}>{PROFORMA_STATUS_LABELS[status]}</StatusBadge>;
}

const ORDER_TONES: Record<SalesOrderStatus, Tone> = {
  DRAFT: "plain",
  CONFIRMED: "open",
  PROCESSING: "open",
  PACKED: "open",
  SHIPPED: "open",
  DELIVERED: "done",
  PARTIALLY_RETURNED: "warn",
  RETURNED: "closed",
  CANCELLED: "closed",
};

export function OrderBadge({ status }: { status: SalesOrderStatus }) {
  return <StatusBadge tone={ORDER_TONES[status]}>{ORDER_STATUS_LABELS[status]}</StatusBadge>;
}

const INVOICE_TONES: Record<InvoiceStatus, Tone> = {
  UNPAID: "open",
  PARTIALLY_PAID: "open",
  PAID: "done",
  VOID: "closed",
};

export function InvoiceBadge({
  status,
  isOverdue = false,
}: {
  status: InvoiceStatus;
  isOverdue?: boolean;
}) {
  if (isOverdue) return <StatusBadge tone="warn">Overdue</StatusBadge>;
  return <StatusBadge tone={INVOICE_TONES[status]}>{INVOICE_STATUS_LABELS[status]}</StatusBadge>;
}

export function RefundBadge({ kind, voided = false }: { kind: RefundKind; voided?: boolean }) {
  if (voided) return <StatusBadge tone="closed">Void</StatusBadge>;
  return <StatusBadge tone="plain">{REFUND_KIND_LABELS[kind]}</StatusBadge>;
}

/** Sold beyond the stock available, with the Force Override permission. */
export function OverrideBadge() {
  return <StatusBadge tone="warn">Force override</StatusBadge>;
}
