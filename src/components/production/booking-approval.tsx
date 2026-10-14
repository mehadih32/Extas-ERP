"use client";

import { CheckIcon, SendIcon, ShieldCheckIcon, TriangleAlertIcon, XIcon } from "lucide-react";
import { useState } from "react";

import { FormAlert } from "@/components/forms/field";
import { FormDialog } from "@/components/sales/dialogs";
import { Button } from "@/components/ui/button";
import { formatDay } from "@/lib/display";
import { atRiskText, revisionLabel } from "@/modules/production/booking-revisions";
import type { Booking } from "@/modules/production/booking.service";
import { approveBookingAction, markBookingSentAction } from "@/server/actions/booking.actions";

/*
 * Where a booking stands on its way to the supplier: a draft waits for the
 * owner's approval (with the checks it must pass), an approved one is printed
 * and marked as sent. A revision lists what changed from the last approved one,
 * in red while it waits, with the fabric then at risk; a style whose fabric
 * changed after the booking was approved shows in red too.
 */

const day = (d: string | null) => (d ? formatDay(d) : "");

const CHECK_ICON = {
  ok: <CheckIcon aria-hidden className="mt-0.5 size-4 shrink-0 text-primary" />,
  warn: <TriangleAlertIcon aria-hidden className="mt-0.5 size-4 shrink-0 text-amber-600" />,
  block: <XIcon aria-hidden className="mt-0.5 size-4 shrink-0 text-destructive" />,
};

const CHECK_WORD = { ok: "Passed", warn: "Warning", block: "To put right" } as const;

export function BookingApproval({ booking: b }: { booking: Booking }) {
  const [asking, setAsking] = useState<"approve" | "sent" | null>(null);
  const [notice, setNotice] = useState<string>();
  const ended = b.status === "CLOSED" || b.status === "CANCELLED";
  const blocks = b.checks.filter((c) => c.state === "block");
  const changes = b.changes && b.revision > 0 ? b.changes : null;
  const waiting = b.stage === "DRAFT";

  return (
    <div className="grid gap-4">
      {!ended && (
        <section
          aria-labelledby="approval-heading"
          className={`rounded-lg border p-5 sm:p-6 ${waiting ? "border-destructive/30 bg-destructive/5" : "bg-card"}`}
        >
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div className="grid min-w-0 gap-1">
              <h2 id="approval-heading" className="text-base font-semibold">
                {waiting
                  ? `Draft ${b.docNo}: waiting for approval`
                  : b.stage === "APPROVED"
                    ? `${b.docNo} is approved`
                    : `${b.docNo} was sent to the supplier`}
              </h2>
              <p className="text-sm leading-relaxed text-muted-foreground">
                {waiting
                  ? "Nothing goes to the supplier and no goods can be received until it is approved."
                  : b.stage === "APPROVED"
                    ? `Approved${b.approvedBy ? ` by ${b.approvedBy.name}` : ""} on ${day(b.approvedOn)}. Print it, send it to ${b.supplier.name}, then mark it as sent.`
                    : `Sent${b.sentBy ? ` by ${b.sentBy.name}` : ""} on ${day(b.sentOn)}. A change to its items makes a new revision, approved again.`}
              </p>
            </div>
            <div className="flex shrink-0 flex-col gap-2 sm:flex-row">
              {b.can.approve && (
                <Button
                  type="button"
                  onClick={() => setAsking("approve")}
                  disabled={blocks.length > 0}
                  title={blocks.length > 0 ? "Put the red items right first" : undefined}
                >
                  <ShieldCheckIcon aria-hidden />
                  Approve booking
                </Button>
              )}
              {b.can.markSent && (
                <Button type="button" onClick={() => setAsking("sent")}>
                  <SendIcon aria-hidden />
                  Mark as sent to the supplier
                </Button>
              )}
            </div>
          </div>
          {waiting && b.checks.length > 0 && (
            <ul className="mt-4 grid gap-2 text-sm" aria-label="Checks before approval">
              {b.checks.map((c) => (
                <li key={c.text} className="flex gap-2">
                  {CHECK_ICON[c.state]}
                  <span className="sr-only">{CHECK_WORD[c.state]}: </span>
                  <span
                    className={
                      c.state === "block"
                        ? "text-destructive"
                        : c.state === "warn"
                          ? "text-amber-700 dark:text-amber-500"
                          : undefined
                    }
                  >
                    {c.text}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {notice && <FormAlert tone="success">{notice}</FormAlert>}

      {changes && changes.changes.length > 0 && (
        <section
          aria-labelledby="changes-heading"
          className={`rounded-lg border p-5 sm:p-6 ${waiting ? "border-destructive/30" : ""}`}
        >
          <h2
            id="changes-heading"
            className={`text-base font-semibold ${waiting ? "text-destructive" : ""}`}
          >
            Changes from {revisionLabel(changes.from)}
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {waiting
              ? `${b.revisionLabel} changes what was approved${changes.wasSent ? " and sent" : ""}: approve it, then send it to replace ${revisionLabel(changes.from)}.`
              : `${b.revisionLabel} replaced ${revisionLabel(changes.from)}.`}
          </p>
          <ul className="mt-4 grid gap-2 text-sm">
            {changes.changes.map((c) => (
              <li
                key={`${c.item}|${c.was}|${c.now}`}
                className="grid gap-0.5 sm:grid-cols-[minmax(0,2fr)_minmax(0,3fr)] sm:gap-3"
              >
                <span className="min-w-0 font-medium break-words">{c.item}</span>
                <span className="min-w-0 break-words tabular-nums">
                  <span className="text-muted-foreground line-through">{c.was}</span>{" "}
                  <span aria-hidden>→</span>
                  <span className="sr-only">now</span>{" "}
                  <span className={waiting ? "text-destructive" : undefined}>{c.now}</span>
                </span>
              </li>
            ))}
          </ul>
          {changes.wasSent && changes.atRisk.length > 0 && (
            <p className="mt-4 text-sm font-medium text-destructive">
              Fabric at risk: {atRiskText(changes.atRisk)}. The supplier may have started on{" "}
              {revisionLabel(changes.from)}: agree with them what happens to it.
            </p>
          )}
        </section>
      )}

      {b.styleChanges.length > 0 && (
        <section
          aria-labelledby="style-changes-heading"
          className="rounded-lg border border-destructive/30 bg-destructive/5 p-5 sm:p-6"
        >
          <h2 id="style-changes-heading" className="text-base font-semibold text-destructive">
            Fabric changed after this booking was approved
          </h2>
          <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
            {b.stage === "SENT"
              ? "The supplier may be making the old fabric. Change the booking to send a new revision, or tell them it stays."
              : "Change the booking before it is sent, so the supplier gets the new fabric."}
          </p>
          <ul className="mt-4 grid gap-3 text-sm">
            {b.styleChanges.map((s) => (
              <li key={s.project.id} className="grid gap-1">
                <p className="font-medium">
                  {s.project.code} · {s.project.name}
                </p>
                <ul className="grid gap-0.5 text-[0.8125rem]">
                  {s.changes.map((c) => (
                    <li key={`${c.item}|${c.was}|${c.now}`} className="break-words">
                      {c.item}: <span className="text-muted-foreground line-through">{c.was}</span>{" "}
                      <span aria-hidden>→</span>
                      <span className="sr-only">now</span>{" "}
                      <span className="text-destructive">{c.now}</span>
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        </section>
      )}

      {asking === "approve" && (
        <FormDialog
          title={`Approve ${b.docNo}?`}
          description={`It is kept as ${b.revisionLabel} as it is now, and its goods can be received from then on. Print it and send it to ${b.supplier.name}, then mark it as sent.`}
          submitLabel="Approve booking"
          pendingLabel="Approving"
          errorTitle="We could not approve the booking"
          onClose={() => setAsking(null)}
          onSubmit={async () => {
            const result = await approveBookingAction(b.id);
            if (!result.ok) return result.error;
            setNotice(`${b.docNo} was approved. Print it and send it to ${b.supplier.name}.`);
            setAsking(null);
          }}
        >
          {() =>
            b.checks.some((c) => c.state === "warn") ? (
              <ul className="grid gap-1.5 text-sm">
                {b.checks
                  .filter((c) => c.state === "warn")
                  .map((c) => (
                    <li key={c.text} className="flex gap-2">
                      {CHECK_ICON.warn}
                      <span>{c.text}</span>
                    </li>
                  ))}
              </ul>
            ) : null
          }
        </FormDialog>
      )}

      {asking === "sent" && (
        <FormDialog
          title={`Mark ${b.docNo} as sent?`}
          description={`Only once the printed booking has gone to ${b.supplier.name}. A change to its items after this makes a new revision.`}
          submitLabel="Mark as sent"
          pendingLabel="Saving"
          errorTitle="We could not mark the booking as sent"
          onClose={() => setAsking(null)}
          onSubmit={async () => {
            const result = await markBookingSentAction(b.id);
            if (!result.ok) return result.error;
            setNotice(`${b.docNo} is marked as sent to ${b.supplier.name}.`);
            setAsking(null);
          }}
        >
          {() => null}
        </FormDialog>
      )}
    </div>
  );
}
