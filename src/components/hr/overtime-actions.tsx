"use client";

import { CheckCheckIcon, CheckIcon, PencilIcon, XIcon } from "lucide-react";
import { useState, useTransition } from "react";

import { ErrorDialog } from "@/components/feedback/error-dialog";
import { Field, FormAlert } from "@/components/forms/field";
import { textOf } from "@/components/products/form-values";
import { FormDialog, problem, readReason, ReasonField } from "@/components/sales/dialogs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatDay } from "@/lib/display";
import type { ActionError } from "@/lib/result";
import { readHours } from "@/modules/hr/overtime";
import type { OvertimeLedger } from "@/modules/hr/overtime.service";
import { approveAllOvertimeAction, decideOvertimeAction } from "@/server/actions/hr.actions";

import { minutesText } from "./labels";
import { useNotice } from "./use-notice";

type Row = OvertimeLedger["rows"][number];

/** "1.5" for 90 minutes: how the hours box starts. */
const hoursValue = (minutes: number) => String(Math.round((minutes / 60) * 100) / 100);

type Dialog = "change" | "reject" | null;

/**
 * HR's buttons on one overtime entry: approve it as found, approve what the
 * location trail suggests, change the hours (with a reason) or reject it
 * (with a reason). A decided entry can be changed until the month's payroll
 * is approved.
 */
export function OvertimeDecisions({ row }: { row: Row }) {
  const [dialog, setDialog] = useState<Dialog>(null);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<ActionError>();
  const [notice, setNotice] = useNotice();
  const name = row.employee.name;
  const found = minutesText(row.detectedMinutes);
  const suggested =
    row.suggestedMinutes !== null && row.suggestedMinutes > 0 ? row.suggestedMinutes : null;

  function approve(minutes: number, reason?: string) {
    setError(undefined);
    startTransition(async () => {
      const result = await decideOvertimeAction(row.id, {
        decision: "APPROVE",
        minutes,
        ...(reason ? { reason } : {}),
      });
      if (!result.ok) return setError(result.error);
      setNotice(`${minutesText(minutes)} approved for ${name}.`);
    });
  }

  const quick = (
    <>
      {row.status !== "APPROVED" && (
        <Button
          type="button"
          size="sm"
          variant={suggested ? "outline" : "default"}
          disabled={pending}
          onClick={() => approve(row.detectedMinutes)}
          aria-label={`Approve ${found} for ${name} on ${formatDay(row.date)}`}
        >
          <CheckIcon aria-hidden />
          Approve {found}
        </Button>
      )}
      {suggested !== null && row.status !== "APPROVED" && (
        <Button
          type="button"
          size="sm"
          disabled={pending}
          onClick={() =>
            approve(
              suggested,
              `Until ${row.lastAtPlace}, when the location trail shows ${name} left ${
                row.placeName ?? "the work place"
              }.`,
            )
          }
          aria-label={`Approve ${minutesText(suggested)} for ${name} on ${formatDay(row.date)}, as the trail suggests`}
        >
          <CheckIcon aria-hidden />
          Approve {minutesText(suggested)}
        </Button>
      )}
    </>
  );

  return (
    <div className="grid gap-2">
      <div className="flex flex-wrap gap-2">
        {quick}
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={pending}
          onClick={() => setDialog("change")}
          aria-label={`Change the hours for ${name} on ${formatDay(row.date)}`}
        >
          <PencilIcon aria-hidden />
          Change hours
        </Button>
        {row.status !== "REJECTED" && (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="text-destructive hover:text-destructive"
            disabled={pending}
            onClick={() => setDialog("reject")}
            aria-label={`Reject the overtime for ${name} on ${formatDay(row.date)}`}
          >
            <XIcon aria-hidden />
            Reject
          </Button>
        )}
      </div>
      {notice && <FormAlert tone="success">{notice}</FormAlert>}
      {error && error.code !== "INTERNAL" && <FormAlert>{error.message}</FormAlert>}
      {error?.code === "INTERNAL" && (
        <ErrorDialog
          code={error.errorId ?? "ERR-UNKNOWN"}
          title="We could not save the overtime"
          onClose={() => setError(undefined)}
        />
      )}

      {dialog === "change" && (
        <FormDialog
          title={`Change ${name}'s overtime`}
          description={`The app found ${found} on ${row.weekday}, ${formatDay(row.date)}${
            suggested !== null ? `; the location trail suggests ${minutesText(suggested)}` : ""
          }. Only the hours you approve are paid.`}
          submitLabel="Approve these hours"
          pendingLabel="Saving"
          errorTitle="We could not save the overtime"
          onClose={() => setDialog(null)}
          onSubmit={async (form) => {
            const minutes = readHours(textOf(form, "hours"));
            const reason = textOf(form, "reason");
            const errors: Record<string, string> = {};
            if (minutes === null) {
              errors.hours = "Write the hours, like 1.5 or 1:30, up to 16.";
            }
            if (minutes !== null && minutes !== row.detectedMinutes && reason.length < 5) {
              errors.reason = "Say why the hours differ from what the app found.";
            }
            if (Object.keys(errors).length > 0) return problem(errors);
            const result = await decideOvertimeAction(row.id, {
              decision: "APPROVE",
              minutes: minutes!,
              ...(reason ? { reason } : {}),
            });
            if (!result.ok) return result.error;
            setNotice(`${minutesText(minutes!)} approved for ${name}.`);
            setDialog(null);
          }}
        >
          {(fieldError) => (
            <>
              <Field
                id={`ot-hours-${row.id}`}
                label="Hours to pay"
                hint="Like 1.5 or 1:30."
                error={fieldError("hours")}
              >
                <Input
                  id={`ot-hours-${row.id}`}
                  name="hours"
                  inputMode="decimal"
                  autoComplete="off"
                  required
                  defaultValue={hoursValue(
                    row.status === "APPROVED" && row.approvedMinutes
                      ? row.approvedMinutes
                      : (suggested ?? row.detectedMinutes),
                  )}
                  aria-invalid={Boolean(fieldError("hours"))}
                />
              </Field>
              <Field
                id={`ot-reason-${row.id}`}
                label="Reason"
                hint="Needed when the hours differ from what the app found. Kept in the activity log."
                error={fieldError("reason")}
              >
                <Input
                  id={`ot-reason-${row.id}`}
                  name="reason"
                  maxLength={300}
                  defaultValue={row.status === "APPROVED" ? (row.reason ?? "") : ""}
                  aria-invalid={Boolean(fieldError("reason"))}
                />
              </Field>
            </>
          )}
        </FormDialog>
      )}

      {dialog === "reject" && (
        <FormDialog
          title={`Reject ${name}'s overtime?`}
          description={
            row.status === "APPROVED"
              ? `${minutesText(row.approvedMinutes ?? 0)} approved for ${formatDay(row.date)} comes off payroll.`
              : `${found} found on ${formatDay(row.date)} will not be paid.`
          }
          submitLabel="Reject"
          pendingLabel="Rejecting"
          destructive
          errorTitle="We could not reject the overtime"
          onClose={() => setDialog(null)}
          onSubmit={async (form) => {
            const reason = readReason(form, 5);
            if (typeof reason !== "string") return reason;
            const result = await decideOvertimeAction(row.id, { decision: "REJECT", reason });
            if (!result.ok) return result.error;
            setNotice(`The overtime for ${name} is rejected.`);
            setDialog(null);
          }}
        >
          {(fieldError) => (
            <ReasonField id={`ot-reject-${row.id}`} min={5} error={fieldError("reason")} />
          )}
        </FormDialog>
      )}
    </div>
  );
}

/**
 * "Approve all as found": the month's waiting overtime that has no flag.
 * Entries with a flag wait for HR to look at them one by one. The button
 * goes once nothing is left to approve this way; the notice stays.
 */
export function ApproveAllOvertime({
  month,
  label,
  count,
  needsLook,
}: {
  month: string;
  label: string;
  count: number;
  needsLook: number;
}) {
  const [open, setOpen] = useState(false);
  const [notice, setNotice] = useNotice();
  if (count === 0 && !notice) return null;
  return (
    <div className="grid gap-2">
      {count > 0 && (
        <div>
          <Button type="button" className="w-full sm:w-auto" onClick={() => setOpen(true)}>
            <CheckCheckIcon aria-hidden />
            Approve all as found ({count})
          </Button>
        </div>
      )}
      {notice && <FormAlert tone="success">{notice}</FormAlert>}
      {open && (
        <FormDialog
          title={`Approve ${count} ${count === 1 ? "entry" : "entries"} as found?`}
          description={`The overtime found in ${label} with nothing to check goes to payroll.${
            needsLook > 0
              ? ` ${needsLook} flagged ${needsLook === 1 ? "entry waits" : "entries wait"} for you to look at ${needsLook === 1 ? "it" : "them"} one by one.`
              : ""
          }`}
          submitLabel="Approve all"
          pendingLabel="Approving"
          errorTitle="We could not approve the overtime"
          onClose={() => setOpen(false)}
          onSubmit={async () => {
            const result = await approveAllOvertimeAction({ month });
            if (!result.ok) return result.error;
            setNotice(
              `${result.data.approved} ${result.data.approved === 1 ? "entry" : "entries"} approved.`,
            );
            setOpen(false);
          }}
        >
          {() => null}
        </FormDialog>
      )}
    </div>
  );
}
