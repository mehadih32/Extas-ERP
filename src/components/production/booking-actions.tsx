"use client";

import { BanIcon, CircleStopIcon, LinkIcon, PencilIcon, TruckIcon, UnlinkIcon } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";

import { OrientationDownload } from "@/components/documents/orientation-download";
import { Field, FormAlert } from "@/components/forms/field";
import { materialsHref } from "@/components/materials/labels";
import { FormDialog, problem, readReason, ReasonField } from "@/components/sales/dialogs";
import { Button } from "@/components/ui/button";
import { NativeSelect } from "@/components/ui/native-select";
import type { Orientation } from "@/modules/documents/model";
import type { Booking } from "@/modules/production/booking.service";
import {
  attachBookingAction,
  cancelBookingAction,
  closeBookingAction,
  detachBookingAction,
  listAttachableBatchesAction,
} from "@/server/actions/booking.actions";

import { productionHref } from "./labels";

type Open = "attach" | "detach" | "cancel" | "close" | null;
type BatchOption = { id: string; code: string; name: string };

/** The batches a booking can go on, loaded when the window opens. */
function BatchSelect({ error }: { error?: string }) {
  const [batches, setBatches] = useState<BatchOption[] | null>(null);
  const [failed, setFailed] = useState<string>();
  useEffect(() => {
    let live = true;
    void listAttachableBatchesAction().then((result) => {
      if (!live) return;
      if (result.ok) setBatches(result.data);
      else setFailed(result.error.message);
    });
    return () => {
      live = false;
    };
  }, []);
  if (failed) return <FormAlert>{failed}</FormAlert>;
  if (batches && batches.length === 0) {
    return (
      <FormAlert tone="note">
        No master batch has an open style to book for. Start a batch and add its styles first.
      </FormAlert>
    );
  }
  return (
    <Field
      id="attach-batch"
      label="Master batch"
      error={error}
      hint="Only batches with an open style are listed."
    >
      <NativeSelect
        id="attach-batch"
        name="batchId"
        containerClassName="sm:w-full"
        disabled={!batches}
        defaultValue=""
        aria-invalid={Boolean(error)}
      >
        <option value="" disabled>
          {batches ? "Choose a batch" : "Loading the batches"}
        </option>
        {batches?.map((b) => (
          <option key={b.id} value={b.id}>
            {b.code} · {b.name}
          </option>
        ))}
      </NativeSelect>
    </Field>
  );
}

/**
 * What can be done with a booking, each offered from the flags it came with
 * (booking.can, from the purchase order rules): print its PDF, change it
 * (everything while nothing has arrived, the paperwork after), receive its
 * goods, put it on a master batch or take it off, close or cancel it.
 */
export function BookingActions({
  booking: b,
  notice: initial,
  orientation,
}: {
  booking: Booking;
  notice?: string;
  /** Which way round this person prints a booking: their last pick, or the company's default. */
  orientation: Orientation;
}) {
  const [open, setOpen] = useState<Open>(null);
  const [notice, setNotice] = useState(initial);
  const close = () => setOpen(null);
  const done = (message: string) => {
    setNotice(message);
    close();
  };
  const { can } = b;

  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(undefined), 12_000);
    return () => clearTimeout(timer);
  }, [notice]);

  return (
    <div className="grid gap-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
        <OrientationDownload
          href={productionHref.bookingPdf(b.id)}
          label="Print booking (PDF)"
          title={`Print booking ${b.number}`}
          description="The PDF for the supplier, with a blank strip at the top for binding."
          orientation={orientation}
        />
        {(can.edit || can.editPaperwork) && (
          <Button asChild variant="outline" className="w-full sm:w-auto">
            <Link href={productionHref.editBooking(b.id)}>
              <PencilIcon aria-hidden />
              {can.edit ? "Change" : "Change the paperwork"}
            </Link>
          </Button>
        )}
        {can.receive && (
          <Button asChild variant="outline" className="w-full sm:w-auto">
            <Link
              href={
                b.batch
                  ? productionHref.receive(b.batch.id, b.orderId)
                  : materialsHref.newPurchase(b.orderId)
              }
            >
              <TruckIcon aria-hidden />
              Receive the goods
            </Link>
          </Button>
        )}
        {can.attach && (
          <Button
            type="button"
            variant="outline"
            className="w-full sm:w-auto"
            onClick={() => setOpen("attach")}
          >
            <LinkIcon aria-hidden />
            Attach to a batch
          </Button>
        )}
        {can.detach && (
          <Button
            type="button"
            variant="outline"
            className="w-full sm:w-auto"
            onClick={() => setOpen("detach")}
          >
            <UnlinkIcon aria-hidden />
            Take off the batch
          </Button>
        )}
        {can.close && (
          <Button
            type="button"
            variant="outline"
            className="w-full sm:w-auto"
            onClick={() => setOpen("close")}
          >
            <CircleStopIcon aria-hidden />
            Close: the rest will not come
          </Button>
        )}
        {can.cancel && (
          <Button
            type="button"
            variant="outline"
            className="w-full text-destructive hover:text-destructive sm:w-auto"
            onClick={() => setOpen("cancel")}
          >
            <BanIcon aria-hidden />
            Cancel the booking
          </Button>
        )}
      </div>

      {notice && <FormAlert tone="success">{notice}</FormAlert>}

      {open === "attach" && (
        <FormDialog
          title={`Attach ${b.number} to a master batch`}
          description="Its items are shared out over the batch's styles, colours and sizes, so they count as ordered for them, and its goods are received in the batch's central receive. An approved booking becomes its next revision and is approved again."
          submitLabel="Attach"
          pendingLabel="Attaching"
          errorTitle="We could not attach the booking"
          onClose={close}
          onSubmit={async (form) => {
            const batchId = String(form.get("batchId") ?? "");
            if (!batchId) return problem({ batchId: "Choose the batch." });
            const result = await attachBookingAction(b.id, { batchId });
            if (!result.ok) return result.error;
            const again = result.data.waiting
              ? ` ${result.data.waiting} now waits for approval again, with the batch's checks.`
              : "";
            done(
              (result.data.unmatched.length > 0
                ? `${b.number} was attached. Not needed by the batch's styles, so not counted for them: ${result.data.unmatched.join(", ")}.`
                : `${b.number} was attached; every item counts for the batch's styles.`) + again,
            );
          }}
        >
          {(fieldError) => <BatchSelect error={fieldError("batchId")} />}
        </FormDialog>
      )}

      {open === "detach" && b.batch && (
        <FormDialog
          title={`Take ${b.number} off ${b.batch.code}?`}
          description="Nothing has arrived on it yet. Its items stop counting as ordered for the batch's styles. An approved booking becomes its next revision and is approved again."
          submitLabel="Take it off"
          pendingLabel="Taking it off"
          errorTitle="We could not take the booking off the batch"
          onClose={close}
          onSubmit={async () => {
            const result = await detachBookingAction(b.id);
            if (!result.ok) return result.error;
            done(
              `${b.number} was taken off ${b.batch?.code}.${
                result.data.waiting ? ` ${result.data.waiting} now waits for approval again.` : ""
              }`,
            );
          }}
        >
          {() => null}
        </FormDialog>
      )}

      {open === "cancel" && (
        <FormDialog
          title={`Cancel ${b.number}?`}
          description={`Nothing has arrived on it. ${b.supplier.name} should be told it is off; it stays on record as cancelled.`}
          submitLabel="Cancel the booking"
          pendingLabel="Cancelling"
          destructive
          errorTitle="We could not cancel the booking"
          onClose={close}
          onSubmit={async (form) => {
            const reason = readReason(form, 5);
            if (typeof reason !== "string") return reason;
            const result = await cancelBookingAction(b.id, { reason });
            if (!result.ok) return result.error;
            done(`${b.number} was cancelled.`);
          }}
        >
          {(fieldError) => <ReasonField id="cancel-reason" min={5} error={fieldError("reason")} />}
        </FormDialog>
      )}

      {open === "close" && (
        <FormDialog
          title={`Close ${b.number}?`}
          description="What has arrived stays received; the rest is no longer expected from the supplier."
          submitLabel="Close the booking"
          pendingLabel="Closing"
          errorTitle="We could not close the booking"
          onClose={close}
          onSubmit={async (form) => {
            const reason = readReason(form, 5);
            if (typeof reason !== "string") return reason;
            const result = await closeBookingAction(b.id, { reason });
            if (!result.ok) return result.error;
            done(`${b.number} was closed.`);
          }}
        >
          {(fieldError) => <ReasonField id="close-reason" min={5} error={fieldError("reason")} />}
        </FormDialog>
      )}
    </div>
  );
}
