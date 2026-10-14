import type { BookingSource, MeasurementUnit, PurchaseOrderStatus } from "@prisma/client";

import { FlagBadge, OrderBadge } from "@/components/materials/badges";
import { quantity } from "@/components/materials/labels";
import { StatusBadge } from "@/components/sales/badges";
import { SOURCE_SHORT_LABELS } from "@/modules/production/booking-presets";

/*
 * Small pieces the booking screens share: the badges on a booking (its order
 * status, supplier PO or market purchase, late) and its fabric in one line.
 */

/** Short names for the list and the badges. */
export const SOURCE_SHORT = SOURCE_SHORT_LABELS;

export function SourceBadge({ source }: { source: BookingSource }) {
  // A kind, not a warning: both read plain.
  return <StatusBadge tone="plain">{SOURCE_SHORT[source]}</StatusBadge>;
}

export function BookingBadges({
  status,
  source,
  late,
}: {
  status: PurchaseOrderStatus;
  source?: BookingSource;
  late?: boolean;
}) {
  return (
    <>
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
