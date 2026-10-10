"use client";

import {
  CalendarPlusIcon,
  HandCoinsIcon,
  KeyRoundIcon,
  PencilIcon,
  Trash2Icon,
  TrendingUpIcon,
  UndoIcon,
  UserMinusIcon,
  UserXIcon,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { Field, FormAlert } from "@/components/forms/field";
import { ChoiceList } from "@/components/parties/choice-list";
import { AMOUNT_HINT, readAmount, textOf } from "@/components/products/form-values";
import { FormDialog, problem } from "@/components/sales/dialogs";
import { money } from "@/components/sales/labels";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { formatDay } from "@/lib/display";
import type { EmployeeScreen } from "@/modules/hr/screens.service";
import {
  adjustLeaveBalanceAction,
  deleteEmployeeAction,
  deleteSalaryRevisionAction,
  exitEmployeeAction,
  grantPortalAccessAction,
  reinstateEmployeeAction,
  reviseSalaryAction,
  revokePortalAccessAction,
} from "@/server/actions/hr.actions";

import { dayCount, hrHref } from "./labels";
import { useNotice } from "./use-notice";

type Open = "salary" | "exit" | "reinstate" | "login" | "logout" | "remove" | null;

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * What HR can do with an employee, each offered from the flags the screen came
 * with (screen.can, from hr/rules.ts): change their details or salary, record
 * leave, give an advance (Accounts), give or remove their login, record that
 * they left or undo it, and remove someone added by mistake.
 */
export function EmployeeActions({
  screen,
  currency,
  notice: initialNotice,
}: {
  screen: EmployeeScreen;
  currency: string;
  notice?: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState<Open>(null);
  const [notice, setNotice] = useNotice(initialNotice);
  const [login, setLogin] = useState<{ email: string; password?: string } | null>(null);
  const { employee: e, can } = screen;
  const close = () => setOpen(null);
  const done = (message: string) => {
    setNotice(message);
    close();
  };
  const leaving = Boolean(e.exitDate);

  const any =
    can.edit ||
    can.changeSalary ||
    can.recordLeave ||
    can.giveAdvance ||
    can.giveLogin ||
    can.removeLogin ||
    can.exit ||
    can.reinstate ||
    can.remove;
  if (!any && !notice) return null;

  return (
    <div className="grid gap-4">
      {any && (
        <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
          {can.edit && (
            <Button asChild className="w-full sm:w-auto">
              <Link href={hrHref.editEmployee(e.id)}>
                <PencilIcon aria-hidden />
                Change details
              </Link>
            </Button>
          )}
          {can.changeSalary && !leaving && (
            <Button
              type="button"
              variant="outline"
              className="w-full sm:w-auto"
              onClick={() => setOpen("salary")}
            >
              <TrendingUpIcon aria-hidden />
              Change salary
            </Button>
          )}
          {can.recordLeave && (
            <Button asChild variant="outline" className="w-full sm:w-auto">
              <Link href={hrHref.newLeave(e.id)}>
                <CalendarPlusIcon aria-hidden />
                Record leave
              </Link>
            </Button>
          )}
          {can.giveAdvance && (
            <Button asChild variant="outline" className="w-full sm:w-auto">
              <Link href={hrHref.newAdvance(e.id)}>
                <HandCoinsIcon aria-hidden />
                Give an advance
              </Link>
            </Button>
          )}
          {can.giveLogin && !leaving && (
            <Button
              type="button"
              variant="outline"
              className="w-full sm:w-auto"
              onClick={() => setOpen("login")}
            >
              <KeyRoundIcon aria-hidden />
              Give a login
            </Button>
          )}
          {can.removeLogin && (
            <Button
              type="button"
              variant="outline"
              className="w-full sm:w-auto"
              onClick={() => setOpen("logout")}
            >
              <UserXIcon aria-hidden />
              Remove the login
            </Button>
          )}
          {can.exit && (
            <Button
              type="button"
              variant="outline"
              className="w-full sm:w-auto"
              onClick={() => setOpen("exit")}
            >
              <UserMinusIcon aria-hidden />
              {leaving ? "Change the leaving day" : "Record leaving"}
            </Button>
          )}
          {can.reinstate && (
            <Button
              type="button"
              variant="outline"
              className="w-full sm:w-auto"
              onClick={() => setOpen("reinstate")}
            >
              <UndoIcon aria-hidden />
              Reinstate
            </Button>
          )}
          {can.remove && (
            <Button
              type="button"
              variant="outline"
              className="w-full text-destructive hover:text-destructive sm:w-auto"
              onClick={() => setOpen("remove")}
            >
              <Trash2Icon aria-hidden />
              Remove
            </Button>
          )}
        </div>
      )}

      {notice && <FormAlert tone="success">{notice}</FormAlert>}
      {login && (
        <FormAlert tone="success">
          {e.name} now signs in as {login.email}.
          {login.password ? (
            <>
              {" "}
              Their temporary password is{" "}
              <span className="rounded-sm bg-card px-1.5 py-0.5 font-mono tracking-wide">
                {login.password}
              </span>
              . Hand it over now: it is shown once, and they choose their own when they first sign
              in.
            </>
          ) : (
            " They sign in with the password they already have."
          )}
        </FormAlert>
      )}

      {open === "salary" && (
        <FormDialog
          title={`Change ${e.name}'s salary`}
          description={
            screen.pay
              ? `Now ${money(screen.pay.salary, currency)} a month. The new salary counts from the day you choose; payroll shares out a month that changes part way.`
              : "The new salary counts from the day you choose."
          }
          submitLabel="Save the salary"
          pendingLabel="Saving"
          errorTitle="We could not change the salary"
          onClose={close}
          onSubmit={async (form) => {
            const amount = readAmount(textOf(form, "amount"));
            if (amount === null) return problem({ amount: "Enter the new monthly salary." });
            if (amount === "invalid") return problem({ amount: AMOUNT_HINT });
            const effectiveFrom = textOf(form, "effectiveFrom");
            if (!effectiveFrom) return problem({ effectiveFrom: "Choose the day it starts." });
            const result = await reviseSalaryAction(e.id, {
              amount,
              effectiveFrom,
              reason: textOf(form, "reason") || null,
            });
            if (!result.ok) return result.error;
            done(
              `${e.name}'s salary is ${money(amount.toFixed(2), currency)} from ${formatDay(effectiveFrom)}.`,
            );
          }}
        >
          {(fieldError) => (
            <>
              <div className="grid items-start gap-5 sm:grid-cols-2">
                <Field
                  id="salary-amount"
                  label={`New monthly salary (${currency})`}
                  error={fieldError("amount")}
                >
                  <Input
                    id="salary-amount"
                    name="amount"
                    inputMode="decimal"
                    autoComplete="off"
                    placeholder="0.00"
                    aria-invalid={Boolean(fieldError("amount"))}
                    aria-describedby={fieldError("amount") ? "salary-amount-error" : undefined}
                    autoFocus
                  />
                </Field>
                <Field id="salary-from" label="From" error={fieldError("effectiveFrom")}>
                  <Input
                    id="salary-from"
                    name="effectiveFrom"
                    type="date"
                    defaultValue={`${screen.today.slice(0, 7)}-01`}
                    min={e.joinDate}
                    aria-invalid={Boolean(fieldError("effectiveFrom"))}
                  />
                </Field>
              </div>
              <Field id="salary-reason" label="Why (optional)" hint="Yearly raise, promotion…">
                <Input
                  id="salary-reason"
                  name="reason"
                  maxLength={300}
                  autoComplete="off"
                  aria-describedby="salary-reason-hint"
                />
              </Field>
            </>
          )}
        </FormDialog>
      )}

      {open === "exit" && (
        <FormDialog
          title={leaving ? `Change ${e.name}'s leaving day` : `Record that ${e.name} is leaving`}
          description="They are paid up to and including their last working day, and leave booked after it is cancelled. What they still owe on advances is taken from their last salary."
          submitLabel="Save"
          pendingLabel="Saving"
          errorTitle="We could not record the leaving day"
          onClose={close}
          onSubmit={async (form) => {
            const exitDate = textOf(form, "exitDate");
            if (!exitDate) return problem({ exitDate: "Choose their last working day." });
            const result = await exitEmployeeAction(e.id, {
              exitDate,
              status: textOf(form, "status") || "RESIGNED",
              reason: textOf(form, "reason") || null,
            });
            if (!result.ok) return result.error;
            done(`${e.name}'s last working day is ${formatDay(exitDate)}.`);
          }}
        >
          {(fieldError) => (
            <>
              <ChoiceList
                name="status"
                legend="Why they are leaving"
                defaultValue={e.status === "TERMINATED" ? "TERMINATED" : "RESIGNED"}
                options={[
                  { value: "RESIGNED", label: "They resigned" },
                  { value: "TERMINATED", label: "Their job was ended" },
                ]}
              />
              <Field id="exit-date" label="Last working day" error={fieldError("exitDate")}>
                <Input
                  id="exit-date"
                  name="exitDate"
                  type="date"
                  defaultValue={e.exitDate ?? screen.today}
                  min={e.joinDate}
                  aria-invalid={Boolean(fieldError("exitDate"))}
                />
              </Field>
              <Field id="exit-reason" label="Note (optional)" error={fieldError("reason")}>
                <Textarea
                  id="exit-reason"
                  name="reason"
                  rows={2}
                  maxLength={300}
                  defaultValue={e.exitReason ?? undefined}
                />
              </Field>
            </>
          )}
        </FormDialog>
      )}

      {open === "reinstate" && (
        <FormDialog
          title={`Reinstate ${e.name}?`}
          description={`Their leaving day (${formatDay(e.exitDate!)}) is cleared and they are working here again. Leave cancelled when they left stays cancelled.`}
          submitLabel="Reinstate"
          pendingLabel="Reinstating"
          errorTitle="We could not reinstate them"
          onClose={close}
          onSubmit={async () => {
            const result = await reinstateEmployeeAction(e.id);
            if (!result.ok) return result.error;
            done(`${e.name} is working here again.`);
          }}
        >
          {() => null}
        </FormDialog>
      )}

      {open === "login" && (
        <FormDialog
          title={`Give ${e.name} a login`}
          description="With a login they check in from their phone, ask for leave, and see their payslips and advances, and nothing else of the company's. Someone new gets a temporary password to hand over."
          submitLabel="Give the login"
          pendingLabel="Giving"
          errorTitle="We could not give the login"
          onClose={close}
          onSubmit={async (form) => {
            const email = textOf(form, "email");
            if (!EMAIL_PATTERN.test(email)) {
              return problem({ email: "Enter an email like name@example.com." });
            }
            const result = await grantPortalAccessAction(e.id, {
              email,
              phone: textOf(form, "phone") || undefined,
            });
            if (!result.ok) return result.error;
            setLogin({
              email: result.data.email ?? email,
              password: result.data.temporaryPassword,
            });
            close();
          }}
        >
          {(fieldError) => (
            <>
              <Field
                id="login-email"
                label="Email they sign in with"
                hint="Someone already in the company keeps their role and password."
                error={fieldError("email")}
              >
                <Input
                  id="login-email"
                  name="email"
                  type="email"
                  inputMode="email"
                  autoCapitalize="none"
                  autoComplete="off"
                  defaultValue={e.email ?? undefined}
                  aria-invalid={Boolean(fieldError("email"))}
                  aria-describedby={fieldError("email") ? "login-email-error" : "login-email-hint"}
                  autoFocus
                />
              </Field>
              <Field id="login-phone" label="Phone (optional)" error={fieldError("phone")}>
                <Input
                  id="login-phone"
                  name="phone"
                  type="tel"
                  maxLength={30}
                  defaultValue={e.phone ?? undefined}
                />
              </Field>
            </>
          )}
        </FormDialog>
      )}

      {open === "logout" && (
        <FormDialog
          title={`Remove ${e.name}'s login?`}
          description={`${e.login?.email ?? "Their login"} stops opening their HR records. A login that only had the Employee role is switched off for this company; anyone with another role keeps it.`}
          submitLabel="Remove the login"
          pendingLabel="Removing"
          destructive
          errorTitle="We could not remove the login"
          onClose={close}
          onSubmit={async () => {
            const result = await revokePortalAccessAction(e.id);
            if (!result.ok) return result.error;
            setLogin(null);
            done(`${e.name} no longer has a login.`);
          }}
        >
          {() => null}
        </FormDialog>
      )}

      {open === "remove" && (
        <FormDialog
          title={`Remove ${e.name}?`}
          description="Only for someone added by mistake: they have no attendance, leave, payroll or advances. This cannot be undone."
          submitLabel="Remove"
          pendingLabel="Removing"
          destructive
          errorTitle="We could not remove the employee"
          onClose={close}
          onSubmit={async () => {
            const result = await deleteEmployeeAction(e.id);
            if (!result.ok) return result.error;
            router.push(hrHref.employees);
          }}
        >
          {() => null}
        </FormDialog>
      )}
    </div>
  );
}

type Revision = NonNullable<EmployeeScreen["pay"]>["salaryHistory"][number];

/** The salary over time, newest first, with removing a revision entered by mistake. */
export function SalaryHistory({
  employeeId,
  revisions,
  currency,
}: {
  employeeId: string;
  revisions: Revision[];
  currency: string;
}) {
  const [removing, setRemoving] = useState<Revision | null>(null);
  const [notice, setNotice] = useNotice();
  const newest = [...revisions].reverse();

  return (
    <div className="grid gap-3">
      <ul className="grid divide-y" aria-label="Salary history">
        {newest.map((r, index) => (
          <li
            key={r.id}
            className="flex items-start justify-between gap-3 py-2.5 first:pt-0 last:pb-0"
          >
            <span className="min-w-0">
              <span className="block text-sm tabular-nums">{money(r.amount, currency)}</span>
              <span className="block text-[0.8125rem] text-muted-foreground">
                {index === newest.length - 1 ? "Joined" : "From"} {formatDay(r.effectiveFrom)}
                {r.reason ? ` · ${r.reason}` : ""}
              </span>
            </span>
            {r.canRemove && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="text-destructive hover:text-destructive"
                onClick={() => setRemoving(r)}
                aria-label={`Remove the salary from ${formatDay(r.effectiveFrom)}`}
              >
                Remove
              </Button>
            )}
          </li>
        ))}
      </ul>
      {notice && <FormAlert tone="success">{notice}</FormAlert>}
      {removing && (
        <FormDialog
          title="Remove this salary change?"
          description={`${money(removing.amount, currency)} from ${formatDay(removing.effectiveFrom)} is removed, and the salary before it applies again. For a change entered by mistake.`}
          submitLabel="Remove it"
          pendingLabel="Removing"
          destructive
          errorTitle="We could not remove the salary change"
          onClose={() => setRemoving(null)}
          onSubmit={async () => {
            const result = await deleteSalaryRevisionAction(employeeId, removing.id);
            if (!result.ok) return result.error;
            setRemoving(null);
            setNotice("The salary change was removed.");
          }}
        >
          {() => null}
        </FormDialog>
      )}
    </div>
  );
}

type Balance = EmployeeScreen["leave"]["balances"][number];

/** Leave allowed, taken, waiting and left for a year, with HR setting a different allowance. */
export function LeaveAllowances({
  employeeId,
  balances,
}: {
  employeeId: string;
  balances: Balance[];
}) {
  const [editing, setEditing] = useState<Balance | null>(null);
  const [notice, setNotice] = useNotice();

  return (
    <div className="grid gap-3">
      <ul className="grid divide-y" aria-label="Leave allowances">
        {balances.map((b) => (
          <li
            key={b.leaveType.id}
            className="flex items-start justify-between gap-3 py-2.5 first:pt-0 last:pb-0"
          >
            <span className="min-w-0">
              <span className="block text-sm font-medium">
                {b.leaveType.name}
                {!b.leaveType.isActive && (
                  <span className="font-normal text-muted-foreground"> (retired)</span>
                )}
              </span>
              <span className="block text-[0.8125rem] text-muted-foreground">
                {b.entitled === null
                  ? `Unpaid · ${dayCount(b.used)} taken`
                  : `${dayCount(b.used)} taken of ${dayCount(b.entitled)}${b.adjusted ? " (set by HR)" : ""}`}
                {b.pending > 0 ? ` · ${dayCount(b.pending)} waiting` : ""}
              </span>
              {b.note && (
                <span className="block text-[0.8125rem] text-muted-foreground">{b.note}</span>
              )}
            </span>
            <span className="flex shrink-0 items-center gap-1">
              {b.remaining !== null && (
                <span
                  className={`text-sm whitespace-nowrap tabular-nums ${b.remaining < 0 ? "text-destructive" : ""}`}
                >
                  {dayCount(b.remaining)} left
                </span>
              )}
              {b.canAdjust && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => setEditing(b)}
                  aria-label={`Set the ${b.leaveType.name} allowance`}
                >
                  Set
                </Button>
              )}
            </span>
          </li>
        ))}
      </ul>
      {notice && <FormAlert tone="success">{notice}</FormAlert>}
      {editing && (
        <FormDialog
          title={`${editing.leaveType.name} in ${editing.year}`}
          description={`The usual allowance is ${dayCount(editing.leaveType.daysPerYear)} a year, shared out by the months worked for people who join or leave during the year. Set a different number for this employee, or leave it empty to go back to the usual.`}
          submitLabel="Save"
          pendingLabel="Saving"
          errorTitle="We could not save the allowance"
          onClose={() => setEditing(null)}
          onSubmit={async (form) => {
            const text = textOf(form, "entitled");
            const entitled = text === "" ? null : Number(text);
            if (entitled !== null && (!/^\d{1,3}(\.5)?$/.test(text) || entitled > 366)) {
              return problem({ entitled: "Enter whole or half days, like 12 or 12.5." });
            }
            const result = await adjustLeaveBalanceAction({
              employeeId,
              leaveTypeId: editing.leaveType.id,
              year: editing.year,
              entitled,
              note: textOf(form, "note") || null,
            });
            if (!result.ok) return result.error;
            setEditing(null);
            setNotice(
              entitled === null
                ? `${editing.leaveType.name} is back to the usual allowance.`
                : `${editing.leaveType.name} allowance set to ${dayCount(entitled)}.`,
            );
          }}
        >
          {(fieldError) => (
            <>
              <Field
                id="allowance-days"
                label="Days allowed"
                hint="Whole or half days."
                error={fieldError("entitled")}
              >
                <Input
                  id="allowance-days"
                  name="entitled"
                  inputMode="decimal"
                  autoComplete="off"
                  defaultValue={editing.adjusted ? String(editing.entitled) : ""}
                  placeholder={String(editing.entitled ?? "")}
                  aria-invalid={Boolean(fieldError("entitled"))}
                  aria-describedby={
                    fieldError("entitled") ? "allowance-days-error" : "allowance-days-hint"
                  }
                  autoFocus
                />
              </Field>
              <Field id="allowance-note" label="Why (optional)" error={fieldError("note")}>
                <Input
                  id="allowance-note"
                  name="note"
                  maxLength={200}
                  autoComplete="off"
                  defaultValue={editing.note ?? undefined}
                />
              </Field>
            </>
          )}
        </FormDialog>
      )}
    </div>
  );
}
