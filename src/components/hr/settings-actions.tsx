"use client";

import { PencilIcon, PlusIcon, Trash2Icon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { Field, FormAlert } from "@/components/forms/field";
import { textOf } from "@/components/products/form-values";
import { FormDialog, problem } from "@/components/sales/dialogs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatDay } from "@/lib/display";
import type { HrSettingsScreen } from "@/modules/hr/screens.service";
import {
  createHolidaysAction,
  createLeaveTypeAction,
  deleteHolidayAction,
  updateHrSettingsAction,
  updateLeaveTypeAction,
} from "@/server/actions/hr.actions";

import { hrHref, leaveTypeText, WEEKDAYS } from "./labels";
import { useNotice } from "./use-notice";

type Rules = HrSettingsScreen["rules"];
type Holiday = HrSettingsScreen["holidays"][number];
type LeaveType = HrSettingsScreen["leaveTypes"][number];

const checkboxClass = "size-4 cursor-pointer accent-primary disabled:cursor-not-allowed";
const smallText = "block text-[0.8125rem] text-muted-foreground";

/** A whole number from a form field, or NaN when it is empty or not a whole number. */
function wholeOf(form: FormData, name: string) {
  const text = textOf(form, name);
  return /^\d{1,3}$/.test(text) ? Number(text) : Number.NaN;
}

/**
 * The working week and the late rules, with "Change the rules" for HR
 * (hr.manage). Changing the weekly days off re-counts leave in months whose
 * payroll is not yet approved.
 */
export function HrRules({ rules, canManage }: { rules: Rules; canManage: boolean }) {
  const [open, setOpen] = useState(false);
  const [notice, setNotice] = useNotice();

  return (
    <div className="grid gap-4">
      {canManage && (
        <div>
          <Button
            type="button"
            variant="outline"
            className="w-full sm:w-auto"
            onClick={() => setOpen(true)}
          >
            <PencilIcon aria-hidden />
            Change the rules
          </Button>
        </div>
      )}
      {notice && <FormAlert tone="success">{notice}</FormAlert>}
      {open && (
        <FormDialog
          title="Working week and late rules"
          description="Changing the weekly days off also re-counts the days of leave in months whose payroll is not yet approved."
          submitLabel="Save the rules"
          pendingLabel="Saving"
          errorTitle="We could not save the rules"
          onClose={() => setOpen(false)}
          onSubmit={async (form) => {
            const weeklyOffDays = form.getAll("weeklyOffDays").map(Number);
            const officeStartTime = textOf(form, "officeStartTime");
            const lateGraceMinutes = wholeOf(form, "lateGraceMinutes");
            const latesPerDeductionDay = wholeOf(form, "latesPerDeductionDay");
            const errors: Record<string, string> = {};
            if (weeklyOffDays.length > 6) errors.weeklyOffDays = "Keep at least one working day.";
            if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(officeStartTime)) {
              errors.officeStartTime = "Choose the time the office starts.";
            }
            if (!(lateGraceMinutes <= 240)) {
              errors.lateGraceMinutes = "Write the minutes, from 0 to 240.";
            }
            if (!(latesPerDeductionDay <= 31)) {
              errors.latesPerDeductionDay = "Write a number from 0 to 31.";
            }
            if (Object.keys(errors).length > 0) return problem(errors);
            const result = await updateHrSettingsAction({
              weeklyOffDays,
              officeStartTime,
              lateGraceMinutes,
              latesPerDeductionDay,
              selfCheckIn: form.get("selfCheckIn") === "on",
            });
            if (!result.ok) return result.error;
            setNotice("The rules are saved.");
            setOpen(false);
          }}
        >
          {(fieldError) => (
            <>
              <fieldset className="grid gap-2">
                <legend className="mb-1 text-sm font-medium">Weekly days off</legend>
                <div className="grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-3">
                  {WEEKDAYS.map((name, day) => (
                    <label key={name} className="flex cursor-pointer items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        name="weeklyOffDays"
                        value={day}
                        defaultChecked={rules.weeklyOffDays.includes(day)}
                        className={checkboxClass}
                      />
                      {name}
                    </label>
                  ))}
                </div>
                {fieldError("weeklyOffDays") && (
                  <p className="text-[0.8125rem] text-destructive">{fieldError("weeklyOffDays")}</p>
                )}
              </fieldset>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <Field
                  id="rules-start"
                  label="Office starts at"
                  error={fieldError("officeStartTime")}
                >
                  <Input
                    id="rules-start"
                    name="officeStartTime"
                    type="time"
                    required
                    defaultValue={rules.officeStartTime}
                    aria-invalid={Boolean(fieldError("officeStartTime"))}
                  />
                </Field>
                <Field
                  id="rules-grace"
                  label="Minutes of grace"
                  hint="Arriving within these minutes is not late."
                  error={fieldError("lateGraceMinutes")}
                >
                  <Input
                    id="rules-grace"
                    name="lateGraceMinutes"
                    inputMode="numeric"
                    required
                    defaultValue={rules.lateGraceMinutes}
                    aria-invalid={Boolean(fieldError("lateGraceMinutes"))}
                  />
                </Field>
              </div>
              <Field
                id="rules-lates"
                label="Lates that cost a day's salary"
                hint="Every this many lates in a month take one day's salary off. 0 means lates cost nothing."
                error={fieldError("latesPerDeductionDay")}
              >
                <Input
                  id="rules-lates"
                  name="latesPerDeductionDay"
                  inputMode="numeric"
                  required
                  defaultValue={rules.latesPerDeductionDay}
                  aria-invalid={Boolean(fieldError("latesPerDeductionDay"))}
                />
              </Field>
              <label className="flex cursor-pointer items-start gap-2 text-sm">
                <input
                  type="checkbox"
                  name="selfCheckIn"
                  defaultChecked={rules.selfCheckIn}
                  className={`${checkboxClass} mt-0.5`}
                />
                <span>
                  Staff check in and out themselves
                  <span className={smallText}>
                    From My HR on their phone. HR can still correct any day.
                  </span>
                </span>
              </label>
            </>
          )}
        </FormDialog>
      )}
    </div>
  );
}

/**
 * The year's holidays, each with "Remove" for HR while its month's payroll is
 * not approved, and "Add holidays" (one day or several at once). A holiday
 * added in another year opens that year.
 */
export function Holidays({
  year,
  holidays,
  canManage,
}: {
  year: number;
  holidays: Holiday[];
  canManage: boolean;
}) {
  const router = useRouter();
  const [adding, setAdding] = useState(false);
  const [rows, setRows] = useState(1);
  const [removing, setRemoving] = useState<Holiday | null>(null);
  const [notice, setNotice] = useNotice();

  return (
    <div className="grid gap-4">
      {holidays.length === 0 ? (
        <p className="text-sm text-muted-foreground">No holidays set for {year} yet.</p>
      ) : (
        <ul className="grid divide-y" aria-label={`Holidays in ${year}`}>
          {holidays.map((h) => (
            <li
              key={h.id}
              className="flex items-center justify-between gap-3 py-2.5 first:pt-0 last:pb-0"
            >
              <span className="min-w-0">
                <span className="block text-sm font-medium break-words">{h.name}</span>
                <span className={smallText}>
                  {h.weekday}, {formatDay(h.date)}
                </span>
              </span>
              {h.canRemove && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="shrink-0 text-destructive hover:text-destructive"
                  onClick={() => setRemoving(h)}
                  aria-label={`Remove ${h.name} on ${formatDay(h.date)}`}
                >
                  <Trash2Icon aria-hidden />
                  Remove
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
      {canManage && (
        <div>
          <Button
            type="button"
            variant="outline"
            className="w-full sm:w-auto"
            onClick={() => {
              setRows(1);
              setAdding(true);
            }}
          >
            <PlusIcon aria-hidden />
            Add holidays
          </Button>
        </div>
      )}
      {notice && <FormAlert tone="success">{notice}</FormAlert>}

      {adding && (
        <FormDialog
          title="Add holidays"
          description="Holidays are paid days off for everyone. Leave that covers them is re-counted. Months whose payroll is approved can't change."
          submitLabel={rows === 1 ? "Add the holiday" : "Add the holidays"}
          pendingLabel="Adding"
          errorTitle="We could not add the holidays"
          onClose={() => setAdding(false)}
          onSubmit={async (form) => {
            const list = Array.from({ length: rows }, (_, i) => ({
              date: textOf(form, `date-${i}`),
              name: textOf(form, `name-${i}`),
            })).filter((h) => h.date || h.name);
            const errors: Record<string, string> = {};
            list.forEach((h, i) => {
              if (!h.date) errors[`date-${i}`] = "Choose the day.";
              if (h.name.length < 2) errors[`name-${i}`] = "Name the holiday.";
            });
            if (list.length === 0) errors["date-0"] = "Choose the day.";
            const dates = list.map((h) => h.date);
            dates.forEach((d, i) => {
              if (d && dates.indexOf(d) !== i) errors[`date-${i}`] = "This day is listed twice.";
            });
            if (Object.keys(errors).length > 0) return problem(errors);
            const result = await createHolidaysAction({ holidays: list });
            if (!result.ok) return result.error;
            setAdding(false);
            setNotice(list.length === 1 ? "The holiday is added." : "The holidays are added.");
            if (result.data.year !== year) router.push(hrHref.settings(result.data.year));
          }}
        >
          {(fieldError) => (
            <>
              {Array.from({ length: rows }, (_, i) => (
                <div
                  key={i}
                  className="grid grid-cols-1 gap-3 sm:grid-cols-[10rem_1fr]"
                  role="group"
                  aria-label={`Holiday ${i + 1}`}
                >
                  <Field id={`holiday-date-${i}`} label="Day" error={fieldError(`date-${i}`)}>
                    <Input
                      id={`holiday-date-${i}`}
                      name={`date-${i}`}
                      type="date"
                      required={i === 0}
                      aria-invalid={Boolean(fieldError(`date-${i}`))}
                    />
                  </Field>
                  <Field id={`holiday-name-${i}`} label="Name" error={fieldError(`name-${i}`)}>
                    <Input
                      id={`holiday-name-${i}`}
                      name={`name-${i}`}
                      maxLength={120}
                      placeholder={i === 0 ? "Victory Day" : undefined}
                      required={i === 0}
                      aria-invalid={Boolean(fieldError(`name-${i}`))}
                    />
                  </Field>
                </div>
              ))}
              {rows < 30 && (
                <div>
                  <Button type="button" variant="ghost" size="sm" onClick={() => setRows(rows + 1)}>
                    <PlusIcon aria-hidden />
                    Another day
                  </Button>
                </div>
              )}
            </>
          )}
        </FormDialog>
      )}

      {removing && (
        <FormDialog
          title={`Remove ${removing.name}?`}
          description={`${removing.weekday}, ${formatDay(removing.date)} becomes a normal day. Leave that covers it is re-counted.`}
          submitLabel="Remove"
          pendingLabel="Removing"
          destructive
          errorTitle="We could not remove the holiday"
          onClose={() => setRemoving(null)}
          onSubmit={async () => {
            const result = await deleteHolidayAction(removing.id);
            if (!result.ok) return result.error;
            setNotice(`${removing.name} is removed.`);
            setRemoving(null);
          }}
        >
          {() => null}
        </FormDialog>
      )}
    </div>
  );
}

type Editing = { mode: "new" } | { mode: "edit"; type: LeaveType };

/**
 * The kinds of leave and their yearly allowance, with "Change" and "Retire" or
 * "Bring back" for HR. Paid or unpaid is fixed once a type has approved leave,
 * since it decided past salaries.
 */
export function LeaveTypes({ types, canManage }: { types: LeaveType[]; canManage: boolean }) {
  const [editing, setEditing] = useState<Editing | null>(null);
  const [retiring, setRetiring] = useState<LeaveType | null>(null);
  const [notice, setNotice] = useNotice();
  const current = editing?.mode === "edit" ? editing.type : null;

  return (
    <div className="grid gap-4">
      <ul className="grid divide-y" aria-label="Leave types">
        {types.map((t) => (
          <li
            key={t.id}
            className="flex flex-col gap-2 py-2.5 first:pt-0 last:pb-0 sm:flex-row sm:items-center sm:justify-between"
          >
            <span className="min-w-0">
              <span className="block text-sm font-medium break-words">
                {t.name}
                {!t.isActive && (
                  <span className="font-normal text-muted-foreground"> (retired)</span>
                )}
              </span>
              <span className={smallText}>{leaveTypeText(t)}</span>
            </span>
            {canManage && (
              <span className="flex shrink-0 gap-1">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => setEditing({ mode: "edit", type: t })}
                  aria-label={`Change ${t.name}`}
                >
                  Change
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => setRetiring(t)}
                  aria-label={t.isActive ? `Retire ${t.name}` : `Bring back ${t.name}`}
                >
                  {t.isActive ? "Retire" : "Bring back"}
                </Button>
              </span>
            )}
          </li>
        ))}
      </ul>
      {canManage && (
        <div>
          <Button
            type="button"
            variant="outline"
            className="w-full sm:w-auto"
            onClick={() => setEditing({ mode: "new" })}
          >
            <PlusIcon aria-hidden />
            Add a leave type
          </Button>
        </div>
      )}
      {notice && <FormAlert tone="success">{notice}</FormAlert>}

      {editing && (
        <FormDialog
          title={current ? `Change ${current.name}` : "Add a leave type"}
          description={
            current
              ? "A new allowance applies to every year that has no allowance set by hand."
              : "For example sick leave, casual leave, earned leave or maternity leave."
          }
          submitLabel={current ? "Save" : "Add the leave type"}
          pendingLabel="Saving"
          errorTitle="We could not save the leave type"
          onClose={() => setEditing(null)}
          onSubmit={async (form) => {
            const name = textOf(form, "name");
            const isPaid = current?.paidFixed ? current.isPaid : form.get("isPaid") === "on";
            const daysPerYear = isPaid ? wholeOf(form, "daysPerYear") : 0;
            const errors: Record<string, string> = {};
            if (name.length < 2) errors.name = "Name the leave type.";
            if (!(daysPerYear <= 366)) errors.daysPerYear = "Write the days, from 0 to 366.";
            if (Object.keys(errors).length > 0) return problem(errors);
            const input = { name, daysPerYear, isPaid, prorate: form.get("prorate") === "on" };
            const result = current
              ? await updateLeaveTypeAction(current.id, input)
              : await createLeaveTypeAction(input);
            if (!result.ok) return result.error;
            setNotice(current ? `${result.data.name} is saved.` : `${result.data.name} is added.`);
            setEditing(null);
          }}
        >
          {(fieldError) => <LeaveTypeFields type={current} fieldError={fieldError} />}
        </FormDialog>
      )}

      {retiring && (
        <FormDialog
          title={retiring.isActive ? `Retire ${retiring.name}?` : `Bring back ${retiring.name}?`}
          description={
            retiring.isActive
              ? "Nobody can ask for it from now on. Leave already taken or waiting stays as it is."
              : "Staff can ask for it again."
          }
          submitLabel={retiring.isActive ? "Retire" : "Bring back"}
          pendingLabel="Saving"
          destructive={retiring.isActive}
          errorTitle="We could not save the leave type"
          onClose={() => setRetiring(null)}
          onSubmit={async () => {
            const result = await updateLeaveTypeAction(retiring.id, {
              isActive: !retiring.isActive,
            });
            if (!result.ok) return result.error;
            setNotice(
              retiring.isActive ? `${retiring.name} is retired.` : `${retiring.name} is back.`,
            );
            setRetiring(null);
          }}
        >
          {() => null}
        </FormDialog>
      )}
    </div>
  );
}

function LeaveTypeFields({
  type,
  fieldError,
}: {
  type: LeaveType | null;
  fieldError: (name: string) => string | undefined;
}) {
  const [paid, setPaid] = useState(type?.isPaid ?? true);
  return (
    <>
      <Field id="leave-type-name" label="Name" error={fieldError("name")}>
        <Input
          id="leave-type-name"
          name="name"
          maxLength={60}
          required
          defaultValue={type?.name}
          aria-invalid={Boolean(fieldError("name"))}
        />
      </Field>
      <label className="flex cursor-pointer items-start gap-2 text-sm">
        <input
          type="checkbox"
          name="isPaid"
          checked={paid}
          disabled={type?.paidFixed}
          onChange={(e) => setPaid(e.target.checked)}
          className={`${checkboxClass} mt-0.5`}
        />
        <span>
          Paid leave
          <span className={smallText}>
            {type?.paidFixed
              ? "Fixed: this leave has been taken already. Add a new type to change it."
              : "Unpaid leave is taken off the salary and has no yearly limit."}
          </span>
        </span>
      </label>
      {paid && (
        <>
          <Field id="leave-type-days" label="Days a year" error={fieldError("daysPerYear")}>
            <Input
              id="leave-type-days"
              name="daysPerYear"
              inputMode="numeric"
              required
              defaultValue={type?.daysPerYear ?? ""}
              aria-invalid={Boolean(fieldError("daysPerYear"))}
            />
          </Field>
          <label className="flex cursor-pointer items-start gap-2 text-sm">
            <input
              type="checkbox"
              name="prorate"
              defaultChecked={type?.prorate ?? true}
              className={`${checkboxClass} mt-0.5`}
            />
            <span>
              Share out by the months worked
              <span className={smallText}>
                People who join or leave during the year get a part of the allowance.
              </span>
            </span>
          </label>
        </>
      )}
    </>
  );
}
