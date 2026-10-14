"use client";

import { LinkIcon, ScrollTextIcon, UnlinkIcon } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";

import { FormAlert } from "@/components/forms/field";
import { ChoiceList } from "@/components/parties/choice-list";
import { Panel } from "@/components/sales/detail-bits";
import { FormDialog, problem } from "@/components/sales/dialogs";
import { Button } from "@/components/ui/button";
import { formatDay } from "@/lib/display";
import { CATEGORY_LABELS } from "@/modules/production/booking-presets";
import type { BatchBookings } from "@/modules/production/booking.service";
import { attachBookingAction, detachBookingAction } from "@/server/actions/booking.actions";

import { BookingBadges, fabricText, SOURCE_SHORT } from "./booking-bits";
import { productionHref } from "./labels";

type Row = BatchBookings["attached"][number];

const detail = (b: Row, currency: string) =>
  [
    b.supplier.name,
    CATEGORY_LABELS[b.category],
    fabricText(b.fabric, currency) ?? `${b.itemCount} ${b.itemCount === 1 ? "item" : "items"}`,
  ].join(" · ");

/**
 * The batch's fabric bookings (on the batch page and its edit page): those on
 * the batch, "Book fabric" for a new one, and "Attach a booking" for an open
 * one made on its own. A booking comes off again while nothing has arrived.
 * A batch's fabric is only ordered this way.
 */
export function BatchBookingsPanel({ data, currency }: { data: BatchBookings; currency: string }) {
  const [open, setOpen] = useState<"attach" | { detach: Row } | null>(null);
  const [notice, setNotice] = useState<string>();
  const { batch, attached, attachable, can } = data;
  const close = () => setOpen(null);

  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(undefined), 12_000);
    return () => clearTimeout(timer);
  }, [notice]);

  return (
    <Panel
      title="Fabric bookings"
      id="batch-bookings-heading"
      action={
        attached.length > 0 ? (
          <Link
            href={productionHref.bookings({ batchId: batch.id })}
            className="text-sm font-medium text-primary underline-offset-4 hover:underline"
          >
            All {attached.length}
          </Link>
        ) : undefined
      }
    >
      {attached.length === 0 ? (
        <p className="mt-4 text-sm leading-relaxed text-muted-foreground">
          No booking yet. The batch&apos;s fabric is booked with a booking: book it here, or attach
          one made on its own.
        </p>
      ) : (
        <ul className="mt-4 grid divide-y" aria-label="Bookings on the batch">
          {attached.map((b) => (
            <li key={b.id} className="grid gap-1.5 py-3 first:pt-0 last:pb-0">
              <div className="flex items-start justify-between gap-3">
                <Link
                  href={productionHref.booking(b.id)}
                  className="min-w-0 text-sm font-medium break-words text-primary underline-offset-4 hover:underline"
                >
                  {b.number}
                  {b.title ? ` · ${b.title}` : ""}
                </Link>
                {b.canDetach && (
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    className="-my-1 shrink-0 text-muted-foreground"
                    onClick={() => setOpen({ detach: b })}
                    aria-label={`Take ${b.number} off ${batch.code}`}
                  >
                    <UnlinkIcon aria-hidden />
                    Take off
                  </Button>
                )}
              </div>
              <p className="text-[0.8125rem] break-words text-muted-foreground">
                {detail(b, currency)}
              </p>
              <div className="flex flex-wrap items-center gap-1.5">
                <BookingBadges status={b.status} source={b.source} />
                {b.expectedDate && (
                  <span className="text-[0.8125rem] text-muted-foreground">
                    by {formatDay(b.expectedDate)}
                  </span>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}

      {notice && (
        <div className="mt-4">
          <FormAlert tone="success">{notice}</FormAlert>
        </div>
      )}

      {(can.create || can.attach) && (
        <div className="mt-5 flex flex-wrap gap-2 border-t pt-4">
          {can.create && (
            <Button asChild size="sm">
              <Link href={productionHref.newBooking(batch.id)}>
                <ScrollTextIcon aria-hidden />
                Book fabric
              </Link>
            </Button>
          )}
          {can.attach && (
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => setOpen("attach")}
              disabled={attachable.length === 0}
              title={attachable.length === 0 ? "No open booking is free to attach" : undefined}
            >
              <LinkIcon aria-hidden />
              Attach a booking
            </Button>
          )}
        </div>
      )}

      {open === "attach" && (
        <FormDialog
          title={`Attach a booking to ${batch.code}`}
          description="Open bookings not on a batch. Its items are shared out over the batch's styles, colours and sizes, so they count as ordered for them."
          submitLabel="Attach"
          pendingLabel="Attaching"
          errorTitle="We could not attach the booking"
          className="sm:max-w-xl"
          onClose={close}
          onSubmit={async (form) => {
            const bookingId = String(form.get("bookingId") ?? "");
            if (!bookingId) return problem({ bookingId: "Choose the booking to attach." });
            const result = await attachBookingAction(bookingId, { batchId: batch.id });
            if (!result.ok) return result.error;
            setNotice(
              result.data.unmatched.length > 0
                ? `${result.data.number} was attached. Not needed by the batch's styles, so not counted for them: ${result.data.unmatched.join(", ")}.`
                : `${result.data.number} was attached; every item counts for the batch's styles.`,
            );
            close();
          }}
        >
          {(fieldError) => (
            <>
              <ChoiceList
                name="bookingId"
                legend="Booking"
                className="max-h-[50dvh] overflow-y-auto pr-1"
                options={attachable.map((b) => ({
                  value: b.id,
                  label: `${b.number}${b.title ? ` · ${b.title}` : ""}`,
                  hint: `${SOURCE_SHORT[b.source]} · ${detail(b, currency)}`,
                }))}
              />
              {fieldError("bookingId") && (
                <p className="text-[0.8125rem] text-destructive">{fieldError("bookingId")}</p>
              )}
            </>
          )}
        </FormDialog>
      )}

      {open && typeof open === "object" && (
        <FormDialog
          title={`Take ${open.detach.number} off ${batch.code}?`}
          description="Nothing has arrived on it yet. Its items stop counting as ordered for the batch's styles; the booking itself stays as it is."
          submitLabel="Take it off"
          pendingLabel="Taking it off"
          errorTitle="We could not take the booking off the batch"
          onClose={close}
          onSubmit={async () => {
            const result = await detachBookingAction(open.detach.id);
            if (!result.ok) return result.error;
            setNotice(`${open.detach.number} was taken off ${batch.code}.`);
            close();
          }}
        >
          {() => null}
        </FormDialog>
      )}
    </Panel>
  );
}
