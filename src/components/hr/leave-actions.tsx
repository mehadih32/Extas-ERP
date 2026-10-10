"use client";

import { BanIcon, CheckIcon, XIcon } from "lucide-react";
import { useState } from "react";

import { Field, FormAlert } from "@/components/forms/field";
import { textOf } from "@/components/products/form-values";
import { FormDialog, problem } from "@/components/sales/dialogs";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import type { LeaveScreen } from "@/modules/hr/screens.service";
import {
  approveLeaveAction,
  cancelLeaveAction,
  rejectLeaveAction,
} from "@/server/actions/hr.actions";

import { dayCount } from "./labels";
import { useNotice } from "./use-notice";

type Open = "approve" | "reject" | "cancel" | null;

function NoteField({
  id,
  label,
  hint,
  error,
}: {
  id: string;
  label: string;
  hint?: string;
  error?: string;
}) {
  return (
    <Field id={id} label={label} hint={hint} error={error}>
      <Textarea
        id={id}
        name="note"
        rows={2}
        maxLength={300}
        aria-invalid={Boolean(error)}
        aria-describedby={error ? `${id}-error` : hint ? `${id}-hint` : undefined}
      />
    </Field>
  );
}

/**
 * Deciding a leave request (hr.manage), each offered from the flags its screen
 * came with: approve or reject a waiting request, or cancel leave (approved
 * leave in a month whose payroll is approved stays until that payroll is
 * reopened). Nobody decides their own leave, a Super Admin aside.
 */
export function LeaveActions({
  screen,
  notice: initial,
}: {
  screen: LeaveScreen;
  notice?: string;
}) {
  const [open, setOpen] = useState<Open>(null);
  const [notice, setNotice] = useNotice(initial);
  const { leave: l, can, balance } = screen;
  const close = () => setOpen(null);
  const done = (message: string) => {
    setNotice(message);
    close();
  };
  const who = l.employee.name;
  const any = can.approve || can.reject || can.cancel;
  if (!any && !notice) return null;

  return (
    <div className="grid gap-4">
      {any && (
        <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
          {can.approve && (
            <Button type="button" className="w-full sm:w-auto" onClick={() => setOpen("approve")}>
              <CheckIcon aria-hidden />
              Approve
            </Button>
          )}
          {can.reject && (
            <Button
              type="button"
              variant="outline"
              className="w-full sm:w-auto"
              onClick={() => setOpen("reject")}
            >
              <XIcon aria-hidden />
              Reject
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
              Cancel the leave
            </Button>
          )}
        </div>
      )}

      {notice && <FormAlert tone="success">{notice}</FormAlert>}

      {open === "approve" && (
        <FormDialog
          title={`Approve ${who}'s leave?`}
          description={
            balance && balance.remaining !== null
              ? `${dayCount(l.days)} of ${l.leaveType.name}. ${who} has ${dayCount(balance.remaining)} left of ${dayCount(balance.entitled ?? 0)} this year.`
              : `${dayCount(l.days)} of ${l.leaveType.name}${l.leaveType.isPaid ? "" : ", taken off the salary"}.`
          }
          submitLabel="Approve"
          pendingLabel="Approving"
          errorTitle="We could not approve the leave"
          onClose={close}
          onSubmit={async (form) => {
            const result = await approveLeaveAction(l.id, { note: textOf(form, "note") || null });
            if (!result.ok) return result.error;
            done(`${who}'s leave is approved.`);
          }}
        >
          {(fieldError) => (
            <NoteField id="approve-note" label="Note (optional)" error={fieldError("note")} />
          )}
        </FormDialog>
      )}

      {open === "reject" && (
        <FormDialog
          title={`Reject ${who}'s leave?`}
          description={`Tell ${who} why; they see it with the request.`}
          submitLabel="Reject"
          pendingLabel="Rejecting"
          destructive
          errorTitle="We could not reject the leave"
          onClose={close}
          onSubmit={async (form) => {
            const note = textOf(form, "note");
            if (note.length < 3) return problem({ note: "Write why, in a few words." });
            const result = await rejectLeaveAction(l.id, { note });
            if (!result.ok) return result.error;
            done(`${who}'s leave was rejected.`);
          }}
        >
          {(fieldError) => <NoteField id="reject-note" label="Why" error={fieldError("note")} />}
        </FormDialog>
      )}

      {open === "cancel" && (
        <FormDialog
          title={`Cancel ${who}'s leave?`}
          description={
            l.status === "APPROVED"
              ? `The ${dayCount(l.days)} go back to ${who}'s allowance, and the days count as working days again.`
              : "The request is withdrawn."
          }
          submitLabel="Cancel the leave"
          pendingLabel="Cancelling"
          destructive
          errorTitle="We could not cancel the leave"
          onClose={close}
          onSubmit={async (form) => {
            const result = await cancelLeaveAction(l.id, { note: textOf(form, "note") || null });
            if (!result.ok) return result.error;
            done(`${who}'s leave was cancelled.`);
          }}
        >
          {(fieldError) => (
            <NoteField id="cancel-note" label="Why (optional)" error={fieldError("note")} />
          )}
        </FormDialog>
      )}
    </div>
  );
}
