"use client";

import { RowCard, RowLink, ShowMore, useLoadMore } from "@/components/sales/load-more";
import { money } from "@/components/sales/labels";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatDay } from "@/lib/display";
import { CATEGORY_LABELS } from "@/modules/production/booking-presets";
import type { BookingList as BookingPage } from "@/modules/production/booking.service";
import { listBookingsAction } from "@/server/actions/booking.actions";

import { BookingBadges, fabricText } from "./booking-bits";
import { productionHref } from "./labels";

type Row = BookingPage["items"][number];

export type BookingListQuery = {
  search?: string;
  source?: string;
  category?: string;
  status?: string;
  batchId?: string;
};

const what = (b: Row, currency: string) =>
  [
    CATEGORY_LABELS[b.category],
    fabricText(b.fabric, currency),
    b.collarSets > 0 ? `${b.collarSets.toLocaleString("en")} collar sets` : null,
    `${b.lineCount} ${b.lineCount === 1 ? "item" : "items"}`,
  ]
    .filter(Boolean)
    .join(" · ");

/**
 * Bookings, newest first: cards on phones, a table on computers, each opening
 * the booking, with "Show more" for the next page. Amounts only for people who
 * see material prices (the server leaves them out for the rest).
 */
export function BookingList({
  initial,
  query,
  currency,
}: {
  initial: { items: Row[]; nextCursor?: string };
  query: BookingListQuery;
  currency: string;
}) {
  const list = useLoadMore(initial, (cursor) => listBookingsAction({ ...query, cursor }));
  const seeCosts = list.items.some((b) => b.totalAmount !== null);

  return (
    <div className="grid grid-cols-1 gap-5">
      <ul className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:hidden" aria-label="Bookings">
        {list.items.map((b) => (
          <RowCard
            key={b.id}
            href={productionHref.booking(b.id)}
            eyebrow={`${b.number} · ${formatDay(b.orderDate)}`}
            badges={
              <BookingBadges
                status={b.status}
                stage={b.stage}
                revision={b.revision}
                source={b.source}
                late={b.isOverdue}
              />
            }
            title={b.title || b.supplier.name}
            details={[b.title ? b.supplier.name : null, what(b, currency)]
              .filter(Boolean)
              .join(" · ")}
            footer={
              <>
                <span className="text-muted-foreground">
                  {b.batch ? `For ${b.batch.code}` : "Not on a batch"}
                  {b.expectedDate ? ` · by ${formatDay(b.expectedDate)}` : ""}
                </span>
                {b.totalAmount && Number(b.totalAmount) > 0 && (
                  <span className="font-medium">{money(b.totalAmount, currency)}</span>
                )}
              </>
            }
          />
        ))}
      </ul>
      <div className="hidden lg:block">
        <Table aria-label="Bookings">
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead>Booking</TableHead>
              <TableHead>Supplier</TableHead>
              <TableHead>What is booked</TableHead>
              <TableHead>Batch</TableHead>
              <TableHead>Deliver by</TableHead>
              {seeCosts && <TableHead className="text-right">Amount</TableHead>}
            </TableRow>
          </TableHeader>
          <TableBody>
            {list.items.map((b) => (
              <TableRow key={b.id}>
                <TableCell className="py-3">
                  <RowLink href={productionHref.booking(b.id)}>{b.number}</RowLink>
                  <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[0.8125rem] text-muted-foreground">
                    <span>{formatDay(b.orderDate)}</span>
                    <BookingBadges
                      status={b.status}
                      stage={b.stage}
                      revision={b.revision}
                      source={b.source}
                      late={b.isOverdue}
                    />
                  </div>
                </TableCell>
                <TableCell>
                  <div className="max-w-56 truncate">{b.supplier.name}</div>
                  {(b.title || b.styleRef) && (
                    <div className="max-w-56 truncate text-[0.8125rem] text-muted-foreground">
                      {[b.title, b.styleRef].filter(Boolean).join(" · ")}
                    </div>
                  )}
                </TableCell>
                <TableCell>
                  <div className="max-w-72 text-[0.8125rem] text-muted-foreground">
                    {what(b, currency)}
                  </div>
                </TableCell>
                <TableCell className="whitespace-nowrap text-muted-foreground">
                  {b.batch ? (
                    <RowLink href={productionHref.batch(b.batch.id)}>{b.batch.code}</RowLink>
                  ) : (
                    "–"
                  )}
                </TableCell>
                <TableCell className="whitespace-nowrap text-muted-foreground">
                  {b.expectedDate ? formatDay(b.expectedDate) : "–"}
                </TableCell>
                {seeCosts && (
                  <TableCell className="text-right font-medium whitespace-nowrap tabular-nums">
                    {b.totalAmount && Number(b.totalAmount) > 0
                      ? money(b.totalAmount, currency)
                      : "At receive"}
                  </TableCell>
                )}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      <ShowMore list={list} noun="bookings" />
    </div>
  );
}
