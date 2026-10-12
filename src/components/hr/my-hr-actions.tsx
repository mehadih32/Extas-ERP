"use client";

import {
  LoaderCircleIcon,
  LogInIcon,
  LogOutIcon,
  MapPinIcon,
  PlusIcon,
  Undo2Icon,
} from "lucide-react";
import { useState, useTransition } from "react";

import { ErrorDialog } from "@/components/feedback/error-dialog";
import { FormAlert } from "@/components/forms/field";
import { FormDialog, problem } from "@/components/sales/dialogs";
import { Button } from "@/components/ui/button";
import type { ActionError } from "@/lib/result";
import { distanceText } from "@/modules/hr/geo";
import {
  cancelMyLeaveAction,
  checkInAction,
  checkOutAction,
  requestMyLeaveAction,
  uploadMyLeaveFileAction,
} from "@/server/actions/portal.actions";

import { dayCount } from "./labels";
import {
  currentPosition,
  dutyChanged,
  noPositionText,
  type Position,
  type PositionSource,
} from "./location-client";
import { LeaveFields, readLeave } from "./leave-fields";
import { useNotice } from "./use-notice";

/**
 * Checking in and out for today from the phone, when HR allows it. The time is
 * the server's, in company time; checking in after the start time plus the
 * grace minutes counts as late. With GPS attendance on, the phone's location
 * goes with it: checking in needs it, checking out takes it when it can.
 * `openSince` is a night shift's check-in from yesterday, still open.
 */
export function CheckInButtons({
  canCheckIn,
  canCheckOut,
  gps = false,
  openSince = null,
}: {
  canCheckIn: boolean;
  canCheckOut: boolean;
  gps?: boolean;
  openSince?: string | null;
}) {
  const [pending, startTransition] = useTransition();
  const [locating, setLocating] = useState(false);
  const [error, setError] = useState<ActionError>();
  const [notice, setNotice] = useNotice();

  function run(which: "in" | "out") {
    setError(undefined);
    startTransition(async () => {
      let where: { position?: Position; source?: PositionSource } = {};
      if (gps) {
        setLocating(true);
        const found = await currentPosition();
        setLocating(false);
        if (found.ok) where = { position: found.position, source: found.source };
        else if (which === "in") {
          return setError({ code: "VALIDATION", message: noPositionText(found.reason) });
        }
      }
      const result = which === "in" ? await checkInAction(where) : await checkOutAction(where);
      if (!result.ok) return setError(result.error);
      dutyChanged();
      const { mark, place } = result.data;
      const time = which === "in" ? mark?.checkIn : mark?.checkOut;
      const at = place
        ? place.away
          ? `. You are ${distanceText(place.distance)} from ${place.name}, so HR will see a location mismatch`
          : ` at ${place.name}`
        : "";
      setNotice(
        which === "in"
          ? `Checked in${time ? ` at ${time}` : ""}${mark?.status === "LATE" ? ", late" : ""}${at}.`
          : `Checked out${time ? ` at ${time}` : ""}${at}. See you tomorrow.`,
      );
    });
  }

  if (!canCheckIn && !canCheckOut && !notice && !error) return null;
  // Both at once only when last night's shift is still open: out of it first.
  const which: "in" | "out" = canCheckOut && (openSince || !canCheckIn) ? "out" : "in";
  const busy = pending || locating;

  return (
    <div className="grid gap-3">
      {openSince && canCheckOut && (
        <p className="text-sm">You are still checked in from yesterday at {openSince}.</p>
      )}
      {(canCheckIn || canCheckOut) && (
        <div className="flex flex-col gap-2 sm:flex-row">
          <Button
            type="button"
            size="lg"
            className="w-full sm:w-auto"
            disabled={busy}
            onClick={() => run(which)}
          >
            {busy ? (
              <LoaderCircleIcon className="animate-spin" aria-hidden />
            ) : which === "in" ? (
              <LogInIcon aria-hidden />
            ) : (
              <LogOutIcon aria-hidden />
            )}
            {locating
              ? "Finding your location"
              : pending
                ? "Saving"
                : which === "in"
                  ? "Check in"
                  : "Check out"}
          </Button>
          {which === "out" && canCheckIn && (
            <Button
              type="button"
              size="lg"
              variant="outline"
              className="w-full sm:w-auto"
              disabled={busy}
              onClick={() => run("in")}
            >
              <LogInIcon aria-hidden />
              Check in for today
            </Button>
          )}
        </div>
      )}
      {gps && (canCheckIn || canCheckOut) && !error && (
        <p className="flex items-start gap-1.5 text-[0.8125rem] text-muted-foreground">
          <MapPinIcon className="mt-0.5 size-3.5 shrink-0" aria-hidden />
          {which === "in"
            ? "Checking in shares your location. While you are checked in, your phone keeps sharing it until you check out."
            : "Your location is shared until you check out."}
        </p>
      )}
      {notice && <FormAlert tone="success">{notice}</FormAlert>}
      {error && error.code !== "INTERNAL" && <FormAlert>{error.message}</FormAlert>}
      {error?.code === "INTERNAL" && (
        <ErrorDialog
          code={error.errorId ?? "ERR-UNKNOWN"}
          title="We could not save your check-in"
          onClose={() => setError(undefined)}
        />
      )}
    </div>
  );
}

/** Asking HR for leave: the type, the days, why, and a paper such as a doctor's note. */
export function AskForLeave({
  leaveTypes,
  today,
}: {
  leaveTypes: ReadonlyArray<{ id: string; name: string; isPaid: boolean }>;
  today: string;
}) {
  const [open, setOpen] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [notice, setNotice] = useNotice();

  if (leaveTypes.length === 0) return null;

  return (
    <div className="grid gap-3">
      <div>
        <Button
          type="button"
          className="w-full sm:w-auto"
          onClick={() => {
            setFile(null);
            setOpen(true);
          }}
        >
          <PlusIcon aria-hidden />
          Ask for leave
        </Button>
      </div>
      {notice && <FormAlert tone="success">{notice}</FormAlert>}
      {open && (
        <FormDialog
          title="Ask for leave"
          description="HR sees your request and approves or rejects it. Days off and holidays inside it don't count."
          submitLabel="Send the request"
          pendingLabel="Sending"
          errorTitle="We could not send your request"
          onClose={() => setOpen(false)}
          onSubmit={async (form) => {
            const read = await readLeave(form, file, uploadMyLeaveFileAction);
            if ("problems" in read) return problem(read.problems);
            const result = await requestMyLeaveAction(read.input);
            if (!result.ok) return result.error;
            setNotice(`Your request for ${dayCount(result.data.days)} is sent to HR.`);
            setOpen(false);
          }}
        >
          {(fieldError) => (
            <LeaveFields
              idPrefix="my-leave"
              leaveTypes={leaveTypes}
              today={today}
              fieldError={fieldError}
              onFile={setFile}
            />
          )}
        </FormDialog>
      )}
    </div>
  );
}

/** Taking back a request HR has not decided yet; approved leave is cancelled by HR. */
export function WithdrawLeave({ id, what }: { id: string; what: string }) {
  const [open, setOpen] = useState(false);
  const [notice, setNotice] = useNotice();

  if (notice) return <FormAlert tone="success">{notice}</FormAlert>;

  return (
    <>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="text-destructive hover:text-destructive"
        onClick={() => setOpen(true)}
        aria-label={`Withdraw ${what}`}
      >
        <Undo2Icon aria-hidden />
        Withdraw
      </Button>
      {open && (
        <FormDialog
          title="Withdraw this leave?"
          description={`${what}. HR sees that you withdrew it.`}
          submitLabel="Withdraw"
          pendingLabel="Withdrawing"
          destructive
          errorTitle="We could not withdraw the request"
          onClose={() => setOpen(false)}
          onSubmit={async () => {
            const result = await cancelMyLeaveAction(id);
            if (!result.ok) return result.error;
            setOpen(false);
            setNotice("Withdrawn.");
          }}
        >
          {() => null}
        </FormDialog>
      )}
    </>
  );
}
