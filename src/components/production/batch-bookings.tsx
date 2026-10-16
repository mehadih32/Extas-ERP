"use client";

import { LinkIcon, ScrollTextIcon, UnlinkIcon } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";

import { OrientationDownload } from "@/components/documents/orientation-download";
import { FormAlert } from "@/components/forms/field";
import { ChoiceList } from "@/components/parties/choice-list";
import { Panel } from "@/components/sales/detail-bits";
import { FormDialog, problem } from "@/components/sales/dialogs";
import { Button } from "@/components/ui/button";
import { formatDay } from "@/lib/display";
import type { Orientation } from "@/modules/documents/model";
import { CATEGORY_LABELS } from "@/modules/production/booking-presets";
import type { BatchBookings } from "@/modules/production/booking.service";
import {
  attachBookingAction,
  detachBookingAction,
  setFabricFirstAction,
} from "@/server/actions/booking.actions";

import { BookingBadges, fabricText, SOURCE_SHORT } from "./booking-bits";
import { productionHref } from "./labels";

type Row = BatchBookings["attached"][number];

const detail = (b: Row, currency: string) =>
  [
    b.supplier.name,
    CATEGORY_LABELS[b.category],
    fabricText(b.fabric, currency) ?? `${b.itemCount} ${b.itemCount === 1 ? "item" : "items"}`,
  ].join(" · ");

type Style = BatchBookings["styles"][number];

/** "Tech pack approved", "Fabric part locked" or "Tech pack in draft". */
function techPackText(s: Style) {
  if (s.status === "APPROVED") return "Tech pack approved";
  if (s.fabricLocked) return "Fabric part locked";
  return s.hasFabric ? "Tech pack in draft" : "No fabric in its materials yet";
}

/**
 * Fabric first, the owner's call for the batch, and where each style's tech
 * pack stands: with it on, fabric bookings are approved once each style's
 * fabric part is locked, and trims once its tech pack is approved.
 */
function FabricFirst({
  data,
  onNotice,
}: {
  data: BatchBookings;
  onNotice: (message: string) => void;
}) {
  const [asking, setAsking] = useState(false);
  const { batch, fabricFirst, styles, can } = data;
  const on = Boolean(fabricFirst);
  return (
    <div className="mt-5 grid gap-3 border-t pt-4" aria-labelledby="fabric-first-heading">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="grid min-w-0 gap-1">
          <h3 id="fabric-first-heading" className="text-sm font-medium">
            Fabric first: {on ? "on" : "off"}
          </h3>
          <p className="text-[0.8125rem] leading-relaxed text-muted-foreground">
            {on
              ? `Fabric is booked once each style's fabric part is locked; trims wait for the approved tech pack.${
                  fabricFirst?.by ? ` Chosen by ${fabricFirst.by}.` : ""
                }`
              : "Bookings are approved as usual; a tech pack not yet approved is only a warning."}
          </p>
        </div>
        {can.fabricFirst && (
          <Button type="button" size="sm" variant="outline" onClick={() => setAsking(true)}>
            {on ? "Turn off Fabric first" : "Send fabric first"}
          </Button>
        )}
      </div>
      {styles.length > 0 && (
        <ul className="grid gap-1.5 text-[0.8125rem]" aria-label="Tech packs of the styles">
          {styles.map((s) => (
            <li key={s.id} className="flex flex-wrap items-baseline justify-between gap-x-3">
              <Link
                href={productionHref.project(s.id)}
                className="min-w-0 break-words text-primary underline-offset-4 hover:underline"
              >
                {s.code} · {s.name}
              </Link>
              <span
                className={s.status === "APPROVED" ? "text-foreground" : "text-muted-foreground"}
              >
                {techPackText(s)}
                {s.changed > 0 && (
                  <span className="text-destructive">
                    {" "}
                    · {s.changed} fabric change{s.changed === 1 ? "" : "s"} since
                  </span>
                )}
              </span>
            </li>
          ))}
        </ul>
      )}
      {asking && (
        <FormDialog
          title={
            on ? `Turn off Fabric first for ${batch.code}?` : `Send fabric first for ${batch.code}?`
          }
          description={
            on
              ? "Bookings are then approved as usual, with a warning while a tech pack is not approved."
              : "Its fabric can then be approved and sent once each style's fabric part is locked, before the tech packs are approved. Trims still wait for the approved tech pack."
          }
          submitLabel={on ? "Turn it off" : "Send fabric first"}
          pendingLabel="Saving"
          errorTitle="We could not change Fabric first"
          onClose={() => setAsking(false)}
          onSubmit={async () => {
            const result = await setFabricFirstAction(batch.id, !on);
            if (!result.ok) return result.error;
            onNotice(
              on
                ? `Fabric first is off for ${batch.code}.`
                : `Fabric first is on for ${batch.code}: lock each style's fabric part on its page.`,
            );
            setAsking(false);
          }}
        >
          {() => null}
        </FormDialog>
      )}
    </div>
  );
}

/**
 * The batch's fabric bookings (on the batch page and its edit page): those on
 * the batch, "Book fabric" for a new one, and "Attach a booking" for an open
 * one made on its own, the booking book with all of them, and Fabric first. A
 * booking comes off again while nothing has arrived. A batch's fabric is only
 * ordered this way.
 */
export function BatchBookingsPanel({
  data,
  currency,
  orientation,
}: {
  data: BatchBookings;
  currency: string;
  /** Which way round this person prints the booking book (shown on the batch page). */
  orientation?: Orientation;
}) {
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
                <BookingBadges
                  status={b.status}
                  stage={b.stage}
                  revision={b.revision}
                  source={b.source}
                  risk={b.fabricRisk}
                />
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

      {(can.create || can.attach || (orientation && attached.length > 0)) && (
        <div className="mt-5 flex flex-wrap gap-2 border-t pt-4">
          {orientation && attached.length > 0 && (
            <OrientationDownload
              href={productionHref.bookingBook(batch.id)}
              label="Booking book (PDF)"
              title={`Booking book of ${batch.code}`}
              description="Every booking of the batch in one book: who gets which part, the order, fabric, collars and cuffs, trims, the summary, sign-off and swatch lists. No prices."
              orientation={orientation}
              variant="outline"
              size="sm"
              className=""
            />
          )}
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

      {orientation && <FabricFirst data={data} onNotice={setNotice} />}

      {open === "attach" && (
        <FormDialog
          title={`Attach a booking to ${batch.code}`}
          description="Open bookings not on a batch. Its items are shared out over the batch's styles, colours and sizes, so they count as ordered for them. An approved booking becomes its next revision and is approved again."
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
            const again = result.data.waiting
              ? ` ${result.data.waiting} now waits for approval again, with the batch's checks.`
              : "";
            setNotice(
              (result.data.unmatched.length > 0
                ? `${result.data.number} was attached. Not needed by the batch's styles, so not counted for them: ${result.data.unmatched.join(", ")}.`
                : `${result.data.number} was attached; every item counts for the batch's styles.`) +
                again,
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
          description="Nothing has arrived on it yet. Its items stop counting as ordered for the batch's styles. An approved booking becomes its next revision and is approved again."
          submitLabel="Take it off"
          pendingLabel="Taking it off"
          errorTitle="We could not take the booking off the batch"
          onClose={close}
          onSubmit={async () => {
            const result = await detachBookingAction(open.detach.id);
            if (!result.ok) return result.error;
            setNotice(
              `${open.detach.number} was taken off ${batch.code}.${
                result.data.waiting ? ` ${result.data.waiting} now waits for approval again.` : ""
              }`,
            );
            close();
          }}
        >
          {() => null}
        </FormDialog>
      )}
    </Panel>
  );
}
