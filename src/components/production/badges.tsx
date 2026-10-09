import type { BillStatus, IntakeStatus, ProductionStage, ProductionStatus } from "@prisma/client";

import { StatusBadge, type Tone } from "@/components/sales/badges";

import {
  BILL_STATUS_LABELS,
  DELIVERY_STATUS_LABELS,
  PROJECT_STATUS_LABELS,
  remainingText,
  STAGE_LABELS,
} from "./labels";

const PROJECT_TONES: Record<ProductionStatus, Tone> = {
  PLANNED: "plain",
  ACTIVE: "open",
  ON_HOLD: "warn",
  COMPLETED: "done",
  CANCELLED: "closed",
};

export function ProjectBadge({ status }: { status: ProductionStatus }) {
  return <StatusBadge tone={PROJECT_TONES[status]}>{PROJECT_STATUS_LABELS[status]}</StatusBadge>;
}

/** The stage badge: "Cutting · 2 of 5". */
export function StageBadge({
  stage,
}: {
  stage: { key: ProductionStage; number: number; of: number };
}) {
  if (stage.key === "COMPLETED") return null;
  return (
    <StatusBadge tone="plain">
      {STAGE_LABELS[stage.key]}
      <span className="font-normal text-muted-foreground">
        · {stage.number} of {stage.of}
      </span>
    </StatusBadge>
  );
}

/** Red once the target day has passed, amber in its last week. */
export function TimelineBadge({
  timeline,
}: {
  timeline: {
    remainingDays: number | null;
    overdueDays: number;
    isOverdue: boolean;
    dueSoon: boolean;
  };
}) {
  const text = remainingText(timeline);
  if (!text) return null;
  if (timeline.isOverdue) return <StatusBadge tone="warn">{text}</StatusBadge>;
  if (timeline.dueSoon) {
    return (
      <StatusBadge tone="plain" className="border-amber-300 bg-amber-50 text-amber-800">
        {text}
      </StatusBadge>
    );
  }
  return null;
}

const DELIVERY_TONES: Record<IntakeStatus, Tone> = {
  DRAFT: "plain",
  PARSED: "plain",
  CONFIRMED: "done",
  CANCELLED: "closed",
  REVERSED: "closed",
};

export function DeliveryBadge({ status }: { status: IntakeStatus }) {
  return <StatusBadge tone={DELIVERY_TONES[status]}>{DELIVERY_STATUS_LABELS[status]}</StatusBadge>;
}

const BILL_TONES: Record<BillStatus, Tone> = {
  UNPAID: "open",
  PARTIALLY_PAID: "open",
  PAID: "done",
  VOID: "closed",
};

export function BillBadge({ status }: { status: BillStatus }) {
  return <StatusBadge tone={BILL_TONES[status]}>{BILL_STATUS_LABELS[status]}</StatusBadge>;
}
