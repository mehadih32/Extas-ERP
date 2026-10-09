"use client";

import {
  BanknoteIcon,
  CalculatorIcon,
  CheckCheckIcon,
  GiftIcon,
  PlayIcon,
  RotateCcwIcon,
  Trash2Icon,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { PaidFromFields } from "@/components/accounts/money-fields";
import { Field, FormAlert } from "@/components/forms/field";
import { ChoiceList } from "@/components/parties/choice-list";
import { AMOUNT_HINT, readAmount, textOf } from "@/components/products/form-values";
import { FormDialog, problem, readReason, ReasonField } from "@/components/sales/dialogs";
import { RowLink } from "@/components/sales/load-more";
import { isZero, METHOD_LABELS, money } from "@/components/sales/labels";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatDay } from "@/lib/display";
import type { PayrollScreen } from "@/modules/hr/screens.service";
import {
  approvePayrollRunAction,
  createPayrollRunAction,
  deletePayrollRunAction,
  payPayrollRunAction,
  recalculatePayrollRunAction,
  reopenPayrollRunAction,
  setPayrollBonusAction,
  updatePayrollItemAction,
  voidPayrollPaymentAction,
} from "@/server/actions/hr.actions";

import { FlagBadge } from "./badges";
import { hrHref } from "./labels";
import { useNotice } from "./use-notice";

type Line = PayrollScreen["run"]["items"][number];
type Open = "recalculate" | "bonus" | "approve" | "remove" | "reopen" | "pay" | null;

/** Starts a month's payroll from attendance, leave, salaries and advances (hr.payroll). */
export function StartPayroll({
  startable,
}: {
  startable: ReadonlyArray<{ month: string; label: string }>;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button type="button" className="w-full sm:w-auto" onClick={() => setOpen(true)}>
        <PlayIcon aria-hidden />
        Prepare a payroll
      </Button>
      {open && (
        <FormDialog
          title="Prepare a payroll"
          description="Each employee's line is worked out from their salary, attendance, leave and advances for the month. It stays a draft to check and change until it is approved."
          submitLabel="Prepare"
          pendingLabel="Preparing"
          errorTitle="We could not prepare the payroll"
          onClose={() => setOpen(false)}
          onSubmit={async (form) => {
            const month = textOf(form, "month");
            if (!month) return problem({ month: "Choose the month." });
            const result = await createPayrollRunAction({
              month,
              notes: textOf(form, "notes") || null,
            });
            if (!result.ok) return result.error;
            router.push(`${hrHref.payrollRun(result.data.id)}?created=1`);
          }}
        >
          {(fieldError) => (
            <>
              <Field id="start-month" label="Month" error={fieldError("month")}>
                <NativeSelect
                  id="start-month"
                  name="month"
                  defaultValue={startable[0]?.month}
                  containerClassName="sm:w-full"
                >
                  {startable.map((m) => (
                    <option key={m.month} value={m.month}>
                      {m.label}
                    </option>
                  ))}
                </NativeSelect>
              </Field>
              <Field id="start-notes" label="Notes (optional)" error={fieldError("notes")}>
                <Textarea id="start-notes" name="notes" rows={2} maxLength={500} />
              </Field>
            </>
          )}
        </FormDialog>
      )}
    </>
  );
}

/**
 * What can be done with a month's payroll, each offered from the flags its
 * screen came with (screen.can, from hr/rules.ts): while a draft, work it out
 * again, add a bonus, approve it (posting it to the books) or delete it; once
 * approved, pay the salaries (Accounts) or reopen it to change it.
 */
export function PayrollActions({
  screen,
  currency,
  notice: initial,
}: {
  screen: PayrollScreen;
  currency: string;
  notice?: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState<Open>(null);
  const [notice, setNotice] = useNotice(initial);
  const { run, can, unpaid } = screen;
  const close = () => setOpen(null);
  const done = (message: string) => {
    setNotice(message);
    close();
  };
  const unpaidTotal = unpaid.reduce((t, i) => t + Number(i.netPay), 0).toFixed(2);
  const any = can.change || can.approve || can.remove || can.reopen || can.pay;
  if (!any && !notice) return null;

  return (
    <div className="grid gap-4">
      {any && (
        <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
          {can.pay && (
            <Button type="button" className="w-full sm:w-auto" onClick={() => setOpen("pay")}>
              <BanknoteIcon aria-hidden />
              Pay salaries
            </Button>
          )}
          {can.approve && (
            <Button type="button" className="w-full sm:w-auto" onClick={() => setOpen("approve")}>
              <CheckCheckIcon aria-hidden />
              Approve
            </Button>
          )}
          {can.change && (
            <Button
              type="button"
              variant="outline"
              className="w-full sm:w-auto"
              onClick={() => setOpen("recalculate")}
            >
              <CalculatorIcon aria-hidden />
              Work it out again
            </Button>
          )}
          {can.change && (
            <Button
              type="button"
              variant="outline"
              className="w-full sm:w-auto"
              onClick={() => setOpen("bonus")}
            >
              <GiftIcon aria-hidden />
              Add a bonus
            </Button>
          )}
          {can.reopen && (
            <Button
              type="button"
              variant="outline"
              className="w-full sm:w-auto"
              onClick={() => setOpen("reopen")}
            >
              <RotateCcwIcon aria-hidden />
              Reopen
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
              Delete the draft
            </Button>
          )}
        </div>
      )}

      {notice && <FormAlert tone="success">{notice}</FormAlert>}

      {open === "recalculate" && (
        <FormDialog
          title={`Work out ${run.label} again?`}
          description="Every line is worked out again from today's salaries, attendance, leave and advances. Allowances, bonuses and deductions typed in by hand stay."
          submitLabel="Work it out again"
          pendingLabel="Working it out"
          errorTitle="We could not work the payroll out again"
          onClose={close}
          onSubmit={async () => {
            const result = await recalculatePayrollRunAction(run.id);
            if (!result.ok) return result.error;
            done(`${run.label} was worked out again.`);
          }}
        >
          {() => null}
        </FormDialog>
      )}

      {open === "bonus" && (
        <BonusDialog
          runId={run.id}
          label={run.label}
          currency={currency}
          onClose={close}
          onDone={done}
        />
      )}

      {open === "approve" && (
        <FormDialog
          title={`Approve ${run.label}?`}
          description={`${run.employees} ${run.employees === 1 ? "employee" : "employees"}, ${money(run.totals.net, currency)} to take home. Approving posts the salaries to the books, takes advance recoveries off what employees owe and makes the month's attendance and leave final.`}
          submitLabel="Approve"
          pendingLabel="Approving"
          errorTitle="We could not approve the payroll"
          onClose={close}
          onSubmit={async () => {
            const result = await approvePayrollRunAction(run.id);
            if (!result.ok) return result.error;
            done(
              result.data.status === "PAID"
                ? `${run.label} is approved. Nothing is left to pay.`
                : `${run.label} is approved. Accounts can now pay the salaries.`,
            );
          }}
        >
          {() => null}
        </FormDialog>
      )}

      {open === "remove" && (
        <FormDialog
          title={`Delete the ${run.label} draft?`}
          description="The draft and the changes made to it are deleted. A new one can be prepared for the month."
          submitLabel="Delete"
          pendingLabel="Deleting"
          destructive
          errorTitle="We could not delete the draft"
          onClose={close}
          onSubmit={async () => {
            const result = await deletePayrollRunAction(run.id);
            if (!result.ok) return result.error;
            router.push(hrHref.payroll);
          }}
        >
          {() => null}
        </FormDialog>
      )}

      {open === "reopen" && (
        <FormDialog
          title={`Reopen ${run.label}?`}
          description="Its entry in the books is reversed and advance recoveries go back to what employees owe, so it can be changed and approved again. Salary payments must be voided first."
          submitLabel="Reopen"
          pendingLabel="Reopening"
          destructive
          errorTitle="We could not reopen the payroll"
          onClose={close}
          onSubmit={async (form) => {
            const reason = readReason(form, 5);
            if (typeof reason !== "string") return reason;
            const result = await reopenPayrollRunAction(run.id, { reason });
            if (!result.ok) return result.error;
            done(`${run.label} is a draft again.`);
          }}
        >
          {(fieldError) => <ReasonField id="reopen-reason" min={5} error={fieldError("reason")} />}
        </FormDialog>
      )}

      {open === "pay" && (
        <FormDialog
          title={`Pay salaries for ${run.label}`}
          description={`${unpaid.length} ${unpaid.length === 1 ? "employee is" : "employees are"} still to be paid, ${money(unpaidTotal, currency)} in all. A salary payment is recorded for the ones ticked.`}
          submitLabel="Record the payment"
          pendingLabel="Recording"
          errorTitle="We could not record the payment"
          onClose={close}
          onSubmit={async (form) => {
            const itemIds = form.getAll("itemIds").map(String);
            if (itemIds.length === 0) return problem({ itemIds: "Tick who is paid." });
            const date = textOf(form, "date");
            const result = await payPayrollRunAction(run.id, {
              itemIds: itemIds.length === unpaid.length ? undefined : itemIds,
              accountId: textOf(form, "accountId") || undefined,
              method: textOf(form, "method") || "CASH",
              reference: textOf(form, "reference") || null,
              date: date && date !== screen.today ? date : undefined,
            });
            if (!result.ok) return result.error;
            done(
              `Payment ${result.data.number} recorded for ${itemIds.length} ${itemIds.length === 1 ? "employee" : "employees"}.`,
            );
          }}
        >
          {(fieldError) => (
            <>
              <fieldset className="grid gap-2">
                <legend className="mb-2 text-sm font-medium">Paid now</legend>
                <div className="grid max-h-64 gap-1 overflow-y-auto rounded-md border p-2">
                  {unpaid.map((i) => (
                    <label
                      key={i.id}
                      className="flex cursor-pointer items-center justify-between gap-3 rounded-sm px-2 py-1.5 text-sm hover:bg-muted"
                    >
                      <span className="flex min-w-0 items-center gap-2">
                        <input
                          type="checkbox"
                          name="itemIds"
                          value={i.id}
                          defaultChecked
                          className="size-4 shrink-0 cursor-pointer accent-primary"
                        />
                        <span className="truncate">
                          {i.employee.name}
                          <span className="text-muted-foreground">
                            {" "}
                            · {METHOD_LABELS[i.employee.salaryMethod]}
                          </span>
                        </span>
                      </span>
                      <span className="whitespace-nowrap tabular-nums">
                        {money(i.netPay, currency)}
                      </span>
                    </label>
                  ))}
                </div>
                {fieldError("itemIds") && (
                  <p className="text-[0.8125rem] text-destructive">{fieldError("itemIds")}</p>
                )}
              </fieldset>
              <div className="grid items-start gap-5 sm:grid-cols-2">
                <PaidFromFields
                  idPrefix="pay"
                  accounts={screen.moneyAccounts}
                  currency={currency}
                  fieldError={fieldError}
                />
                <Field id="pay-date" label="Paid on" error={fieldError("date")}>
                  <Input
                    id="pay-date"
                    name="date"
                    type="date"
                    defaultValue={screen.today}
                    max={screen.today}
                  />
                </Field>
              </div>
            </>
          )}
        </FormDialog>
      )}
    </div>
  );
}

function BonusDialog({
  runId,
  label,
  currency,
  onClose,
  onDone,
}: {
  runId: string;
  label: string;
  currency: string;
  onClose: () => void;
  onDone: (message: string) => void;
}) {
  const [kind, setKind] = useState<"percent" | "amount">("percent");
  return (
    <FormDialog
      title={`A bonus in ${label}`}
      description="For everyone on this payroll, such as a festival bonus. It replaces any bonus already on their lines; a single person's bonus is changed on their line."
      submitLabel="Add the bonus"
      pendingLabel="Adding"
      errorTitle="We could not add the bonus"
      onClose={onClose}
      onSubmit={async (form) => {
        const value = readAmount(textOf(form, "value"));
        if (value === null || value === "invalid") {
          return problem({ value: value === null ? "Enter the bonus." : AMOUNT_HINT });
        }
        if (kind === "percent" && value > 500) return problem({ value: "At most 500%." });
        const result = await setPayrollBonusAction(
          runId,
          kind === "percent" ? { percentOfSalary: value } : { amount: value },
        );
        if (!result.ok) return result.error;
        onDone(
          kind === "percent"
            ? `A bonus of ${value}% of salary was added for everyone.`
            : `A bonus of ${money(value.toFixed(2), currency)} was added for everyone.`,
        );
      }}
    >
      {(fieldError) => (
        <>
          <ChoiceList
            name="kind"
            legend="The bonus is"
            defaultValue="percent"
            onChange={setKind}
            options={[
              {
                value: "percent",
                label: "A share of each monthly salary",
                hint: "Like 50% for Eid.",
              },
              { value: "amount", label: "The same amount for everyone" },
            ]}
          />
          <Field
            id="bonus-value"
            label={kind === "percent" ? "Percent of salary" : `Amount (${currency})`}
            error={fieldError("value") ?? fieldError("amount")}
          >
            <Input
              id="bonus-value"
              name="value"
              inputMode="decimal"
              autoComplete="off"
              placeholder={kind === "percent" ? "50" : "0.00"}
              aria-invalid={Boolean(fieldError("value"))}
            />
          </Field>
        </>
      )}
    </FormDialog>
  );
}

const LINE_FIELDS = [
  ["allowances", "Allowances"],
  ["bonus", "Bonus"],
  ["taxDeduction", "Tax deducted (TDS)"],
  ["otherDeductions", "Other deductions"],
] as const;

function LineDialog({
  runId,
  line,
  currency,
  onClose,
  onDone,
}: {
  runId: string;
  line: Line;
  currency: string;
  onClose: () => void;
  onDone: (message: string) => void;
}) {
  return (
    <FormDialog
      title={`${line.employee.name}'s line`}
      description={`Salary for the days employed ${money(line.salary, currency)}, ${line.days.unpaid} unpaid ${line.days.unpaid === 1 ? "day" : "days"}. Leave overtime or the advance recovery empty to go back to what attendance and the advances give.`}
      submitLabel="Save the line"
      pendingLabel="Saving"
      errorTitle="We could not save the line"
      onClose={onClose}
      onSubmit={async (form) => {
        const found: Record<string, string> = {};
        const values: Record<string, number | null> = {};
        for (const [name] of LINE_FIELDS) {
          const v = readAmount(textOf(form, name));
          if (v === "invalid") found[name] = AMOUNT_HINT;
          else values[name] = v ?? 0;
        }
        const advanceText = textOf(form, "advanceDeduction");
        const advance = advanceText === "" ? null : readAmount(advanceText);
        if (advance === "invalid") found.advanceDeduction = AMOUNT_HINT;
        const hoursText = textOf(form, "overtimeHours");
        const hours = hoursText === "" ? null : Number(hoursText);
        if (hoursText !== "" && (!/^\d{1,3}(\.\d{1,2})?$/.test(hoursText) || hours! > 744)) {
          found.overtimeHours = "Enter hours like 12 or 12.5.";
        }
        if (Object.keys(found).length > 0) return problem(found);
        const result = await updatePayrollItemAction(runId, line.id, {
          ...values,
          advanceDeduction: advance as number | null,
          overtimeHours: hours,
          note: textOf(form, "note") || null,
        });
        if (!result.ok) return result.error;
        onDone(`${line.employee.name}'s line was saved.`);
      }}
    >
      {(fieldError) => (
        <>
          <div className="grid items-start gap-5 sm:grid-cols-2">
            {LINE_FIELDS.map(([name, label]) => (
              <Field key={name} id={`line-${name}`} label={label} error={fieldError(name)}>
                <Input
                  id={`line-${name}`}
                  name={name}
                  inputMode="decimal"
                  autoComplete="off"
                  defaultValue={isZero(line[name]) ? "" : line[name]}
                  placeholder="0.00"
                  aria-invalid={Boolean(fieldError(name))}
                />
              </Field>
            ))}
            <Field
              id="line-overtime"
              label="Overtime hours"
              hint={line.overtimeEdited ? "Typed in by hand." : "From attendance."}
              error={fieldError("overtimeHours")}
            >
              <Input
                id="line-overtime"
                name="overtimeHours"
                inputMode="decimal"
                autoComplete="off"
                defaultValue={line.overtimeEdited ? line.overtimeHours : ""}
                placeholder={line.overtimeHours}
                aria-invalid={Boolean(fieldError("overtimeHours"))}
                aria-describedby="line-overtime-hint"
              />
            </Field>
            <Field
              id="line-advance"
              label="Advance taken back"
              hint={line.advanceEdited ? "Typed in by hand." : "As the advances set it."}
              error={fieldError("advanceDeduction")}
            >
              <Input
                id="line-advance"
                name="advanceDeduction"
                inputMode="decimal"
                autoComplete="off"
                defaultValue={line.advanceEdited ? line.advanceDeduction : ""}
                placeholder={line.advanceDeduction}
                aria-invalid={Boolean(fieldError("advanceDeduction"))}
                aria-describedby="line-advance-hint"
              />
            </Field>
          </div>
          <Field id="line-note" label="Note on the payslip (optional)" error={fieldError("note")}>
            <Input
              id="line-note"
              name="note"
              maxLength={300}
              autoComplete="off"
              defaultValue={line.note ?? undefined}
            />
          </Field>
        </>
      )}
    </FormDialog>
  );
}

/**
 * Each employee's line: days, salary, additions, deductions and take-home pay,
 * as cards on phones and a table on computers, opening their payslip; while a
 * draft, people who prepare payroll change a line.
 */
export function PayrollLines({ screen, currency }: { screen: PayrollScreen; currency: string }) {
  const [editing, setEditing] = useState<Line | null>(null);
  const [notice, setNotice] = useNotice();
  const { run, can } = screen;
  const additions = (i: Line) =>
    (Number(i.allowances) + Number(i.overtime) + Number(i.bonus)).toFixed(2);
  const paidText = (i: Line) =>
    i.paid
      ? "Paid"
      : run.status === "DRAFT"
        ? null
        : isZero(i.netPay)
          ? "Nothing to pay"
          : "To pay";

  const change = (i: Line) =>
    can.change ? (
      <Button
        type="button"
        variant="ghost"
        size="sm"
        onClick={() => setEditing(i)}
        aria-label={`Change ${i.employee.name}'s line`}
      >
        Change
      </Button>
    ) : null;

  return (
    <div className="grid gap-4">
      {notice && <FormAlert tone="success">{notice}</FormAlert>}
      <ul className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:hidden" aria-label="Employees">
        {run.items.map((i) => (
          <li key={i.id} className="min-w-0 rounded-lg border bg-card p-4">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <Link
                  href={hrHref.payslip(run.id, i.id)}
                  className="font-serif text-lg leading-snug text-primary underline-offset-4 hover:underline"
                >
                  {i.employee.name}
                </Link>
                <p className="text-[0.8125rem] text-muted-foreground">
                  {i.employee.code} · {i.days.present} of {i.days.working} days
                  {i.days.unpaid > 0 ? ` · ${i.days.unpaid} unpaid` : ""}
                </p>
              </div>
              {paidText(i) && <FlagBadge tone={i.paid ? "done" : "open"}>{paidText(i)}</FlagBadge>}
            </div>
            <dl className="mt-3 grid grid-cols-3 gap-2 border-t pt-3 text-sm tabular-nums">
              <div>
                <dt className="text-[0.75rem] text-muted-foreground">Gross</dt>
                <dd>{money(i.grossPay, currency)}</dd>
              </div>
              <div>
                <dt className="text-[0.75rem] text-muted-foreground">Deductions</dt>
                <dd>{money(i.totalDeductions, currency)}</dd>
              </div>
              <div>
                <dt className="text-[0.75rem] text-muted-foreground">Take home</dt>
                <dd className="font-medium">{money(i.netPay, currency)}</dd>
              </div>
            </dl>
            {(i.note || can.change) && (
              <div className="mt-2 flex items-center justify-between gap-3">
                <p className="min-w-0 text-[0.8125rem] break-words text-muted-foreground">
                  {i.note}
                </p>
                {change(i)}
              </div>
            )}
          </li>
        ))}
      </ul>
      <div className="hidden lg:block">
        <Table aria-label="Employees">
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead>Employee</TableHead>
              <TableHead className="text-right">Days</TableHead>
              <TableHead className="text-right">Salary</TableHead>
              <TableHead className="text-right">Overtime, bonus</TableHead>
              <TableHead className="text-right">Deductions</TableHead>
              <TableHead className="text-right">Take home</TableHead>
              <TableHead>
                <span className="sr-only">Paid</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {run.items.map((i) => (
              <TableRow key={i.id}>
                <TableCell className="py-3">
                  <RowLink href={hrHref.payslip(run.id, i.id)}>{i.employee.name}</RowLink>
                  <div className="text-[0.8125rem] text-muted-foreground">
                    {i.employee.code}
                    {i.note ? ` · ${i.note}` : ""}
                  </div>
                </TableCell>
                <TableCell className="text-right whitespace-nowrap tabular-nums">
                  {i.days.present}/{i.days.working}
                  {i.days.unpaid > 0 && (
                    <div className="text-[0.8125rem] text-destructive">{i.days.unpaid} unpaid</div>
                  )}
                </TableCell>
                <TableCell className="text-right whitespace-nowrap tabular-nums">
                  {money(i.salary, currency)}
                </TableCell>
                <TableCell className="text-right whitespace-nowrap tabular-nums">
                  {isZero(additions(i)) ? "–" : money(additions(i), currency)}
                </TableCell>
                <TableCell className="text-right whitespace-nowrap tabular-nums">
                  {isZero(i.totalDeductions) ? "–" : money(i.totalDeductions, currency)}
                </TableCell>
                <TableCell className="text-right font-medium whitespace-nowrap tabular-nums">
                  {money(i.netPay, currency)}
                </TableCell>
                <TableCell className="text-right whitespace-nowrap">
                  {can.change
                    ? change(i)
                    : paidText(i) && (
                        <FlagBadge tone={i.paid ? "done" : "open"}>{paidText(i)}</FlagBadge>
                      )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      {editing && (
        <LineDialog
          runId={run.id}
          line={editing}
          currency={currency}
          onClose={() => setEditing(null)}
          onDone={(message) => {
            setEditing(null);
            setNotice(message);
          }}
        />
      )}
    </div>
  );
}

type Payment = PayrollScreen["payments"][number];

/** The salary payments made for the month, with voiding one recorded by mistake (Accounts). */
export function SalaryPayments({ screen, currency }: { screen: PayrollScreen; currency: string }) {
  const [voiding, setVoiding] = useState<Payment | null>(null);
  const [notice, setNotice] = useNotice();
  const { payments, can } = screen;
  if (payments.length === 0) {
    return <p className="mt-4 text-sm text-muted-foreground">No salaries paid yet.</p>;
  }
  return (
    <div className="mt-4 grid gap-3">
      <ul className="grid divide-y" aria-label="Salary payments">
        {payments.map((p) => (
          <li
            key={p.id}
            className="flex items-start justify-between gap-3 py-3 first:pt-0 last:pb-0"
          >
            <span className="min-w-0 text-sm">
              <span className="block font-medium">
                {can.openJournal && p.journalEntry ? (
                  <Link
                    href={hrHref.journal(p.journalEntry.id)}
                    className="text-primary underline-offset-4 hover:underline"
                  >
                    {p.number}
                  </Link>
                ) : (
                  p.number
                )}
                {p.voidedAt && <span className="font-normal text-muted-foreground"> (void)</span>}
              </span>
              <span className="block text-[0.8125rem] text-muted-foreground">
                {formatDay(p.paidOn)} · {METHOD_LABELS[p.method]}
                {p.account ? ` from ${p.account.name}` : ""} · {p.employeeCount}{" "}
                {p.employeeCount === 1 ? "employee" : "employees"}
                {p.reference ? ` · ${p.reference}` : ""}
              </span>
              {p.voidReason && (
                <span className="block text-[0.8125rem] text-muted-foreground">
                  Voided: {p.voidReason}
                </span>
              )}
            </span>
            <span className="flex shrink-0 flex-col items-end gap-1">
              <span
                className={`text-sm whitespace-nowrap tabular-nums ${p.voidedAt ? "text-muted-foreground line-through" : ""}`}
              >
                {money(p.amount, currency)}
              </span>
              {p.canVoid && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="text-destructive hover:text-destructive"
                  onClick={() => setVoiding(p)}
                >
                  Void
                </Button>
              )}
            </span>
          </li>
        ))}
      </ul>
      {notice && <FormAlert tone="success">{notice}</FormAlert>}
      {voiding && (
        <FormDialog
          title={`Void ${voiding.number}?`}
          description={`The ${money(voiding.amount, currency)} goes back into ${voiding.account?.name ?? "the account it came from"}, and those employees show as not paid again.`}
          submitLabel="Void the payment"
          pendingLabel="Voiding"
          destructive
          errorTitle="We could not void the payment"
          onClose={() => setVoiding(null)}
          onSubmit={async (form) => {
            const reason = readReason(form, 5);
            if (typeof reason !== "string") return reason;
            const result = await voidPayrollPaymentAction(voiding.id, { reason });
            if (!result.ok) return result.error;
            setVoiding(null);
            setNotice(`${voiding.number} was voided.`);
          }}
        >
          {(fieldError) => <ReasonField id="void-reason" min={5} error={fieldError("reason")} />}
        </FormDialog>
      )}
    </div>
  );
}
