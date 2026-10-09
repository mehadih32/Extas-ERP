"use client";

import { LoaderCircleIcon, LogInIcon, LogOutIcon, PlusIcon, Undo2Icon } from "lucide-react";
import { useState, useTransition } from "react";

import { ErrorDialog } from "@/components/feedback/error-dialog";
import { FormAlert } from "@/components/forms/field";
import { FormDialog, problem } from "@/components/sales/dialogs";
import { Button } from "@/components/ui/button";
import type { ActionError } from "@/lib/result";
import {
  cancelMyLeaveAction,
  checkInAction,
  checkOutAction,
  requestMyLeaveAction,
  uploadMyLeaveFileAction,
} from "@/server/actions/portal.actions";

import { dayCount } from "./labels";
import { LeaveFields, readLeave } from "./leave-fields";
import { useNotice } from "./use-notice";

/**
 * Checking in and out for today from the phone, when HR allows it. The time is
 * the server's, in company time; checking in after the start time plus the
 * grace minutes counts as late.
 */
export function CheckInButtons({
  canCheckIn,
  canCheckOut,
}: {
  canCheckIn: boolean;
  canCheckOut: boolean;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<ActionError>();
  const [notice, setNotice] = useNotice();

  function run(which: "in" | "out") {
    setError(undefined);
    startTransition(async () => {
      const result = which === "in" ? await checkInAction() : await checkOutAction();
      if (!result.ok) return setError(result.error);
      const time = which === "in" ? result.data.mark?.checkIn : result.data.mark?.checkOut;
      setNotice(
        which === "in"
          ? `Checked in${time ? ` at ${time}` : ""}${result.data.mark?.status === "LATE" ? ", late" : ""}.`
          : `Checked out${time ? ` at ${time}` : ""}. See you tomorrow.`,
      );
    });
  }

  if (!canCheckIn && !canCheckOut && !notice && !error) return null;

  return (
    <div className="grid gap-3">
      {(canCheckIn || canCheckOut) && (
        <div>
          <Button
            type="button"
            size="lg"
            className="w-full sm:w-auto"
            disabled={pending}
            onClick={() => run(canCheckIn ? "in" : "out")}
          >
            {pending ? (
              <LoaderCircleIcon className="animate-spin" aria-hidden />
            ) : canCheckIn ? (
              <LogInIcon aria-hidden />
            ) : (
              <LogOutIcon aria-hidden />
            )}
            {pending ? "Saving" : canCheckIn ? "Check in" : "Check out"}
          </Button>
        </div>
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
