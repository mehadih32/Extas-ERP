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
import { Amount } from "@/components/accounts/privacy";
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
  retrySalaryPayoutsAction,
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
  const { run, can } = screen;
  const close = () => setOpen(null);
  const done = (message: string) => {
    setNotice(message);
    close();
  };
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
        <ApproveDialog run={run} currency={currency} onClose={close} onDone={done} />
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
        <PayDialog screen={screen} currency={currency} onClose={close} onDone={done} />
      )}
    </div>
  );
}

/**
 * Approving a draft. Every line with other deductions needs a reason before
 * the salaries go to the books: the ones not given yet are asked for here, and
 * the ones given can be put better. Each prints on the payslip.
 */
function ApproveDialog({
  run,
  currency,
  onClose,
  onDone,
}: {
  run: PayrollScreen["run"];
  currency: string;
  onClose: () => void;
  onDone: (message: string) => void;
}) {
  const deducted = run.items.filter((i) => !isZero(i.otherDeductions));
  return (
    <FormDialog
      title={`Approve ${run.label}?`}
      description={`${run.employees} ${run.employees === 1 ? "employee" : "employees"}, ${money(run.totals.net, currency)} to take home. Approving posts the salaries to the books, takes advance recoveries off what employees owe and makes the month's attendance and leave final.`}
      submitLabel="Approve"
      pendingLabel="Approving"
      errorTitle="We could not approve the payroll"
      onClose={onClose}
      onSubmit={async (form) => {
        const reasons: Record<string, string> = {};
        const found: Record<string, string> = {};
        for (const i of deducted) {
          const reason = textOf(form, `reason-${i.id}`);
          if (!reason) found[`reason-${i.id}`] = "Say why it is taken.";
          else reasons[i.id] = reason;
        }
        if (Object.keys(found).length > 0) return problem(found);
        const result = await approvePayrollRunAction(run.id, { reasons });
        if (!result.ok) return result.error;
        onDone(
          result.data.status === "PAID"
            ? `${run.label} is approved. Nothing is left to pay.`
            : `${run.label} is approved. Accounts can now pay the salaries.`,
        );
      }}
    >
      {(fieldError) =>
        deducted.length > 0 && (
          <fieldset className="grid gap-4">
            <legend className="mb-1 text-sm">
              Why are other deductions taken? Each reason prints on the payslip.
            </legend>
            {deducted.map((i) => (
              <Field
                key={i.id}
                id={`approve-reason-${i.id}`}
                label={`${i.employee.name}, ${money(i.otherDeductions, currency)}`}
                error={fieldError(`reason-${i.id}`)}
              >
                <Input
                  id={`approve-reason-${i.id}`}
                  name={`reason-${i.id}`}
                  maxLength={200}
                  autoComplete="off"
                  required
                  defaultValue={i.deductionReason ?? undefined}
                  placeholder="For example: a damaged machine part"
                  aria-invalid={Boolean(fieldError(`reason-${i.id}`))}
                />
              </Field>
            ))}
          </fieldset>
        )
      }
    </FormDialog>
  );
}

type Unpaid = PayrollScreen["unpaid"][number];
const WALLET_METHODS = new Set(["BKASH", "NAGAD", "ROCKET"]);

/**
 * Paying salaries: everyone still owed, chosen people, or part of a salary (the
 * amount typed is less than what is left; the rest is paid later). With wallet
 * payouts connected, a bKash, Nagad or Rocket payment can go straight to each
 * person's wallet.
 */
function PayDialog({
  screen,
  currency,
  onClose,
  onDone,
}: {
  screen: PayrollScreen;
  currency: string;
  onClose: () => void;
  onDone: (message: string) => void;
}) {
  const { run, unpaid, payouts } = screen;
  const [ticked, setTicked] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(unpaid.map((i) => [i.id, true])),
  );
  const [amounts, setAmounts] = useState<Record<string, string>>(() =>
    Object.fromEntries(unpaid.map((i) => [i.id, i.balance])),
  );
  const left = unpaid.reduce((t, i) => t + Number(i.balance), 0).toFixed(2);
  const chosen = unpaid.filter((i) => ticked[i.id]);
  const total = chosen
    .reduce((t, i) => {
      const a = readAmount(amounts[i.id]);
      return t + (typeof a === "number" ? a : 0);
    }, 0)
    .toFixed(2);
  const fieldOf = (i: Unpaid) => `amount-${i.id}`;
  // The amounts as last sent: an amount's problem goes away once it is changed.
  const [sent, setSent] = useState<Record<string, string>>({});

  return (
    <FormDialog
      title={`Pay salaries for ${run.label}`}
      description={`${unpaid.length} ${unpaid.length === 1 ? "employee is" : "employees are"} still owed ${money(left, currency)} in all. Tick who is paid now; type less than what is left to pay part of a salary, and the rest stays to pay later.`}
      submitLabel="Record the payment"
      pendingLabel="Recording"
      errorTitle="We could not record the payment"
      onClose={onClose}
      onSubmit={async (form) => {
        setSent(amounts);
        if (chosen.length === 0) return problem({ itemIds: "Tick who is paid." });
        const parts: { itemId: string; amount: number }[] = [];
        for (const i of chosen) {
          const amount = readAmount(amounts[i.id]);
          if (amount === "invalid" || amount === null)
            return problem({ [fieldOf(i)]: AMOUNT_HINT });
          if (amount <= 0) return problem({ [fieldOf(i)]: "Pay more than zero." });
          if (amount > Number(i.balance)) {
            return problem({ [fieldOf(i)]: `Only ${money(i.balance, currency)} is left to pay.` });
          }
          parts.push({ itemId: i.id, amount });
        }
        const isWhole = (p: (typeof parts)[number]) =>
          p.amount.toFixed(2) === unpaid.find((i) => i.id === p.itemId)?.balance;
        const whole = parts.every(isWhole);
        const everyone = whole && parts.length === unpaid.length;
        const date = textOf(form, "date");
        const method = textOf(form, "method") || "CASH";
        const sendToWallets = payouts.on && form.get("sendToWallets") === "on";
        if (sendToWallets && !WALLET_METHODS.has(method)) {
          return problem({ sendToWallets: "Pay by bKash, Nagad or Rocket to send it to wallets." });
        }
        const result = await payPayrollRunAction(run.id, {
          ...(everyone ? {} : whole ? { itemIds: parts.map((p) => p.itemId) } : { parts }),
          accountId: textOf(form, "accountId") || undefined,
          method,
          reference: textOf(form, "reference") || null,
          date: date && date !== screen.today ? date : undefined,
          sendToWallets: sendToWallets || undefined,
        });
        if (!result.ok) return result.error;
        const inPart = parts.filter((p) => !isWhole(p)).length;
        onDone(
          `Payment ${result.data.number} recorded for ${parts.length} ${parts.length === 1 ? "employee" : "employees"}${
            inPart > 0 ? `, ${inPart} in part` : ""
          }.${sendToWallets ? " The money is being sent to their wallets." : ""}`,
        );
      }}
    >
      {(fieldError) => (
        <>
          <fieldset className="grid gap-2">
            <legend className="mb-2 text-sm font-medium">Paid now</legend>
            <div className="grid max-h-72 gap-1 overflow-y-auto rounded-md border p-2">
              {unpaid.map((i) => {
                const field = fieldOf(i);
                const amountError = amounts[i.id] === sent[i.id] ? fieldError(field) : undefined;
                const partPaid = !isZero(i.paidAmount);
                return (
                  <div
                    key={i.id}
                    className="grid gap-1 rounded-sm px-2 py-1.5 text-sm hover:bg-muted"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <label className="flex min-w-0 cursor-pointer items-center gap-2">
                        <input
                          type="checkbox"
                          name="itemIds"
                          value={i.id}
                          checked={ticked[i.id] ?? false}
                          onChange={(e) => setTicked((t) => ({ ...t, [i.id]: e.target.checked }))}
                          className="size-4 shrink-0 cursor-pointer accent-primary"
                        />
                        <span className="min-w-0">
                          <span className="block break-words">
                            {i.employee.name}
                            <span className="text-muted-foreground">
                              {" "}
                              · {METHOD_LABELS[i.employee.salaryMethod]}
                            </span>
                          </span>
                          <span className="block text-[0.75rem] text-muted-foreground">
                            {partPaid
                              ? `${money(i.paidAmount, currency)} paid, ${money(i.balance, currency)} left`
                              : `Take home ${money(i.netPay, currency)}`}
                            {payouts.on && !i.employee.hasWallet ? " · no wallet number" : ""}
                          </span>
                        </span>
                      </label>
                      <Input
                        aria-label={`Amount for ${i.employee.name}`}
                        name={field}
                        inputMode="decimal"
                        value={amounts[i.id] ?? ""}
                        onChange={(e) => setAmounts((a) => ({ ...a, [i.id]: e.target.value }))}
                        disabled={!ticked[i.id]}
                        aria-invalid={Boolean(amountError)}
                        className="h-8 w-28 shrink-0 text-right tabular-nums"
                      />
                    </div>
                    {amountError && (
                      <p className="text-right text-[0.8125rem] text-destructive">{amountError}</p>
                    )}
                  </div>
                );
              })}
            </div>
            <p className="flex justify-between gap-3 text-sm">
              <span className="text-muted-foreground">
                {chosen.length} of {unpaid.length} ticked
              </span>
              <span className="font-medium tabular-nums">Paid now {money(total, currency)}</span>
            </p>
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
          {payouts.on && (
            <div className="grid gap-1">
              <label className="flex cursor-pointer items-start gap-2 text-sm">
                <input
                  type="checkbox"
                  name="sendToWallets"
                  className="mt-0.5 size-4 shrink-0 cursor-pointer accent-primary"
                />
                <span>
                  Send it to their wallets
                  <span className="block text-[0.8125rem] text-muted-foreground">
                    Pay by bKash, Nagad or Rocket and the app sends each person their money.
                    {payouts.test ? " Test mode: no money really moves." : ""}
                  </span>
                </span>
              </label>
              {fieldError("sendToWallets") && (
                <p className="text-[0.8125rem] text-destructive">{fieldError("sendToWallets")}</p>
              )}
            </div>
          )}
        </>
      )}
    </FormDialog>
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
        // The reason goes with the amount: taking the amount off drops the reason
        // kept from before, but a new reason needs an amount.
        let reason: string | null = textOf(form, "deductionReason") || null;
        if (!values.otherDeductions && reason) {
          if (reason === line.deductionReason) reason = null;
          else found.otherDeductions = "Give the amount deducted along with the reason.";
        }
        if (Object.keys(found).length > 0) return problem(found);
        const result = await updatePayrollItemAction(runId, line.id, {
          ...values,
          deductionReason: reason,
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
          <Field
            id="line-reason"
            label="Why other deductions are taken"
            hint="Printed on the payslip. Needed before the payroll is approved."
            error={fieldError("deductionReason")}
          >
            <Input
              id="line-reason"
              name="deductionReason"
              maxLength={200}
              autoComplete="off"
              defaultValue={line.deductionReason ?? undefined}
              placeholder="For example: a damaged machine part"
              aria-invalid={Boolean(fieldError("deductionReason"))}
              aria-describedby="line-reason-hint"
            />
          </Field>
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

/** ": a fine for a lost tool", or on a draft a reminder that a reason is needed. */
function DeductionReason({ line, draft }: { line: Line; draft: boolean }) {
  if (line.deductionReason) return <>: {line.deductionReason}</>;
  if (!draft) return null;
  return <span className="text-destructive">: say why before approving</span>;
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
    (
      Number(i.allowances) +
      Number(i.overtime) +
      Number(i.bonus) +
      Number(i.reimbursements)
    ).toFixed(2);
  const partPaid = (i: Line) => !i.paid && !isZero(i.paidAmount);
  const paidText = (i: Line) =>
    i.paid
      ? "Paid"
      : run.status === "DRAFT"
        ? null
        : partPaid(i)
          ? "Part paid"
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
              {paidText(i) && (
                <FlagBadge tone={i.paid ? "done" : partPaid(i) ? "warn" : "open"}>
                  {paidText(i)}
                </FlagBadge>
              )}
            </div>
            <dl className="mt-3 grid grid-cols-3 gap-2 border-t pt-3 text-sm tabular-nums">
              <div>
                <dt className="text-[0.75rem] text-muted-foreground">Gross</dt>
                <dd>
                  <Amount>{money(i.grossPay, currency)}</Amount>
                </dd>
              </div>
              <div>
                <dt className="text-[0.75rem] text-muted-foreground">Deductions</dt>
                <dd>
                  <Amount>{money(i.totalDeductions, currency)}</Amount>
                </dd>
              </div>
              <div>
                <dt className="text-[0.75rem] text-muted-foreground">Take home</dt>
                <dd className="font-medium">
                  <Amount>{money(i.netPay, currency)}</Amount>
                </dd>
              </div>
            </dl>
            {!isZero(i.reimbursements) && (
              <p className="mt-2 text-[0.8125rem] text-muted-foreground">
                Claims paid back <Amount>{money(i.reimbursements, currency)}</Amount>
              </p>
            )}
            {!isZero(i.otherDeductions) && (
              <p className="mt-2 text-[0.8125rem] break-words text-muted-foreground">
                Other deductions <Amount>{money(i.otherDeductions, currency)}</Amount>
                <DeductionReason line={i} draft={run.status === "DRAFT"} />
              </p>
            )}
            {partPaid(i) && (
              <p className="mt-2 text-[0.8125rem] text-muted-foreground">
                <Amount>{money(i.paidAmount, currency)}</Amount> paid,{" "}
                <Amount>{money(i.balance, currency)}</Amount> left
              </p>
            )}
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
              <TableHead className="text-right">Overtime, bonus, claims</TableHead>
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
                  <Amount>{money(i.salary, currency)}</Amount>
                </TableCell>
                <TableCell className="text-right whitespace-nowrap tabular-nums">
                  {isZero(additions(i)) ? "–" : <Amount>{money(additions(i), currency)}</Amount>}
                  {!isZero(i.reimbursements) && (
                    <div className="text-[0.8125rem] text-muted-foreground">
                      claims <Amount>{money(i.reimbursements, currency)}</Amount>
                    </div>
                  )}
                </TableCell>
                <TableCell className="text-right whitespace-nowrap tabular-nums">
                  {isZero(i.totalDeductions) ? (
                    "–"
                  ) : (
                    <Amount>{money(i.totalDeductions, currency)}</Amount>
                  )}
                  {!isZero(i.otherDeductions) && (
                    <div className="ml-auto max-w-56 text-[0.8125rem] break-words whitespace-normal text-muted-foreground">
                      other <Amount>{money(i.otherDeductions, currency)}</Amount>
                      <DeductionReason line={i} draft={run.status === "DRAFT"} />
                    </div>
                  )}
                </TableCell>
                <TableCell className="text-right font-medium whitespace-nowrap tabular-nums">
                  <Amount>{money(i.netPay, currency)}</Amount>
                </TableCell>
                <TableCell className="text-right whitespace-nowrap">
                  {can.change
                    ? change(i)
                    : paidText(i) && (
                        <FlagBadge tone={i.paid ? "done" : partPaid(i) ? "warn" : "open"}>
                          {paidText(i)}
                        </FlagBadge>
                      )}
                  {partPaid(i) && (
                    <div className="mt-1 text-[0.8125rem] text-muted-foreground tabular-nums">
                      <Amount>{money(i.balance, currency)}</Amount> left
                    </div>
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

/** Where a wallet payout stands. */
const PAYOUT_WORDS: Record<NonNullable<Payment["lines"][number]["payout"]>, string> = {
  QUEUED: "Sending to wallet",
  SENT: "Sent to wallet",
  FAILED: "Wallet payout failed",
  CANCELLED: "Wallet payout stopped",
};

/** The salary payments made for the month, with voiding one recorded by mistake (Accounts). */
export function SalaryPayments({ screen, currency }: { screen: PayrollScreen; currency: string }) {
  const [voiding, setVoiding] = useState<Payment | null>(null);
  const [retrying, setRetrying] = useState<string | null>(null);
  const [problemText, setProblem] = useState<string | null>(null);
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
              {p.lines.some((l) => l.payout) && (
                <span className="mt-1 block text-[0.8125rem]">
                  {p.lines
                    .filter((l) => l.payout)
                    .map((l) => (
                      <span key={l.id} className="block">
                        {l.employee.name}:{" "}
                        <span
                          className={
                            l.payout === "FAILED" ? "text-destructive" : "text-muted-foreground"
                          }
                        >
                          {PAYOUT_WORDS[l.payout!]}
                          {l.payout === "FAILED" && l.payoutError ? ` (${l.payoutError})` : ""}
                          {l.payout === "SENT" && l.payoutReference
                            ? ` · ${l.payoutReference}`
                            : ""}
                        </span>
                      </span>
                    ))}
                </span>
              )}
            </span>
            <span className="flex shrink-0 flex-col items-end gap-1">
              <span
                className={`text-sm whitespace-nowrap tabular-nums ${p.voidedAt ? "text-muted-foreground line-through" : ""}`}
              >
                <Amount>{money(p.amount, currency)}</Amount>
              </span>
              {p.canRetry && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={retrying !== null}
                  onClick={async () => {
                    setRetrying(p.id);
                    setProblem(null);
                    const result = await retrySalaryPayoutsAction(p.id);
                    setRetrying(null);
                    if (!result.ok) return setProblem(result.error.message);
                    setNotice(
                      `${result.data.queued} ${result.data.queued === 1 ? "payout is" : "payouts are"} being sent again.`,
                    );
                  }}
                >
                  {retrying === p.id ? "Sending" : "Try again"}
                </Button>
              )}
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
      {problemText && <FormAlert>{problemText}</FormAlert>}
      {voiding && (
        <FormDialog
          title={`Void ${voiding.number}?`}
          description={`The ${money(voiding.amount, currency)} goes back into ${voiding.account?.name ?? "the account it came from"}, and those employees are owed that money again.${
            voiding.lines.some((l) => l.payout === "SENT")
              ? " Money already sent to wallets is not taken back: ask for it back yourself."
              : voiding.lines.some((l) => l.payout === "QUEUED")
                ? " Wallet payouts not sent yet are stopped."
                : ""
          }`}
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
