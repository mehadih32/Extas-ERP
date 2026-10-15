import type {
  BookingSource,
  BookingStage,
  MeasurementUnit,
  PurchaseOrderStatus,
} from "@prisma/client";

import { FlagBadge, OrderBadge } from "@/components/materials/badges";
import { quantity } from "@/components/materials/labels";
import { StatusBadge } from "@/components/sales/badges";
import { SOURCE_SHORT_LABELS } from "@/modules/production/booking-presets";
import { revisionLabel, STAGE_LABELS } from "@/modules/production/booking-revisions";

/*
 * Small pieces the booking screens share: the badges on a booking (its stage,
 * order status, supplier PO or market purchase, late) and its fabric in one line.
 */

/** Short names for the list and the badges. */
export const SOURCE_SHORT = SOURCE_SHORT_LABELS;

export function SourceBadge({ source }: { source: BookingSource }) {
  // A kind, not a warning: both read plain.
  return <StatusBadge tone="plain">{SOURCE_SHORT[source]}</StatusBadge>;
}

const STAGE_TONES = { DRAFT: "warn", APPROVED: "open", SENT: "plain" } as const;

/** Draft (waiting for approval), Approved or Sent, with the revision once it has one ("Draft · R1"). */
export function StageBadge({ stage, revision }: { stage: BookingStage; revision: number }) {
  return (
    <StatusBadge tone={STAGE_TONES[stage]}>
      {STAGE_LABELS[stage]}
      {revision > 0 ? ` · ${revisionLabel(revision)}` : ""}
    </StatusBadge>
  );
}

export function BookingBadges({
  status,
  stage,
  revision = 0,
  source,
  late,
}: {
  status: PurchaseOrderStatus;
  /** Shown while the booking is open (a closed or cancelled one shows its status only). */
  stage?: BookingStage;
  revision?: number;
  source?: BookingSource;
  late?: boolean;
}) {
  const ended = status === "CLOSED" || status === "CANCELLED";
  return (
    <>
      {stage && !ended && <StageBadge stage={stage} revision={revision} />}
      <OrderBadge status={status} />
      {source && <SourceBadge source={source} />}
      {late && <FlagBadge>Late</FlagBadge>}
    </>
  );
}

/** "1,200 kg + 300 yd of fabric", or null when it books no fabric. */
export function fabricText(
  fabric: ReadonlyArray<{ unit: MeasurementUnit; quantity: string }>,
  currency: string,
): string | null {
  if (fabric.length === 0) return null;
  return `${fabric.map((f) => quantity(f.quantity, f.unit, currency)).join(" + ")} of fabric`;
}
