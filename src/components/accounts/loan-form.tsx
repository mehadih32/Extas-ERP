"use client";

import type { CapitalLenderKind } from "@prisma/client";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { usePinPrompt } from "@/components/ai/pin-prompt";
import { Field, FormAlert } from "@/components/forms/field";
import { ChoiceList } from "@/components/parties/choice-list";
import { AMOUNT_HINT, readAmount, textOf } from "@/components/products/form-values";
import { money } from "@/components/sales/labels";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import type { LoanFormOptions } from "@/modules/accounts/loans.service";
import { addLoanAction } from "@/server/actions/accounts.actions";

import { FormFooter, usePageForm } from "./form-bits";
import { LENDER_KIND_LABELS, loansHref } from "./labels";
import { PaidFromFields } from "./money-fields";

/** The lender select's "Someone new" choice. */
const NEW = "new";

const KIND_HINTS: Record<CapitalLenderKind, string> = {
  BANK: "Paid back by a fixed installment every month.",
  NGO: "Like a bank: a fixed installment every month.",
  PERSON: "Profit every few months, then renewed or returned.",
};

const checkboxClass = "mt-0.5 size-4 shrink-0 cursor-pointer accent-primary";

/** A number typed in a box, or a problem on that field. */
function readNumber(
  form: FormData,
  name: string,
  found: Record<string, string>,
  { whole = false, required = true } = {},
) {
  const amount = readAmount(textOf(form, name));
  if (amount === null) {
    if (required) found[name] = "Enter it.";
    return undefined;
  }
  if (amount === "invalid" || amount <= 0 || (whole && !Number.isInteger(amount))) {
    found[name] = whole ? "Write a whole number, like 12." : AMOUNT_HINT;
    return undefined;
  }
  return amount;
}

/**
 * Adding a loan (Accounts): from a bank, an NGO or a person, new or already on
 * the list. Money received now goes into cash or a bank; a loan running before
 * the ERP is entered at what is still owed today. A bank or NGO loan gets its
 * installments (the interest worked out from them, no rate maths), a person's
 * money its profit every few months. "Pay by itself" asks for the PIN.
 */
export function LoanForm({
  data,
  currency,
  lenderId,
}: {
  data: LoanFormOptions;
  currency: string;
  lenderId?: string;
}) {
  const router = useRouter();
  const form = usePageForm();
  const { fieldError } = form;
  const { withPin, dialog } = usePinPrompt();
  const preset = data.lenders.find((l) => l.id === lenderId);
  const [kind, setKind] = useState<CapitalLenderKind>(preset?.kind ?? "BANK");
  const ofKind = data.lenders.filter((l) => l.kind === kind);
  const [lender, setLender] = useState(preset?.id ?? NEW);
  const chosen = ofKind.some((l) => l.id === lender) ? lender : NEW;
  const [before, setBefore] = useState(!data.can.receive);
  const [autoPay, setAutoPay] = useState(false);
  const [profitAs, setProfitAs] = useState<"MONEY" | "PCT">("MONEY");
  const [plan, setPlan] = useState({ amount: "", owedNow: "", installment: "", count: "" });
  const person = kind === "PERSON";

  // The interest in each installment: what is paid beyond the loan, shared evenly.
  const owed = readAmount(before ? plan.owedNow : plan.amount);
  const installment = readAmount(plan.installment);
  const count = readAmount(plan.count);
  const split =
    typeof owed === "number" &&
    typeof installment === "number" &&
    typeof count === "number" &&
    count >= 1 &&
    Number.isInteger(count)
      ? (installment * count - owed) / count
      : null;

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const values = new FormData(event.currentTarget);
    const found: Record<string, string> = {};
    const name = textOf(values, "lenderName");
    if (chosen === NEW && name.length < 2) found.lenderName = "Write the name.";
    const amount = readNumber(values, "amount", found);
    const takenOn = textOf(values, "takenOn");
    if (!takenOn) found.takenOn = "Enter the date.";
    const owedNow = before ? readNumber(values, "owedNow", found) : undefined;
    if (owedNow && amount && owedNow > amount) found.owedNow = "More than the loan itself.";
    const paidBefore = before ? readAmount(textOf(values, "interestPaidBefore")) : null;
    if (paidBefore === "invalid") found.interestPaidBefore = "Write an amount, like 25000.";
    const interestRate = readAmount(textOf(values, "interestRate"));
    if (interestRate === "invalid") found.interestRate = "Write a number, like 12.5.";
    const loanFields = person
      ? {
          periodMonths: readNumber(values, "periodMonths", found, { whole: true }),
          ...(profitAs === "MONEY"
            ? { profitPerPeriod: readNumber(values, "profit", found) }
            : { profitPct: readNumber(values, "profit", found) }),
          nextDueDate: textOf(values, "nextDueDate") || undefined,
        }
      : {
          installmentAmount: readNumber(values, "installmentAmount", found),
          installmentsLeft: readNumber(values, "installmentsLeft", found, { whole: true }),
          nextDueDate: textOf(values, "nextDueDate") || undefined,
          interestRate: typeof interestRate === "number" ? interestRate : null,
          autoPay,
        };
    if (!person && !loanFields.nextDueDate) found.nextDueDate = "Enter the date.";
    form.setProblems(found);
    form.setError(undefined);
    if (Object.keys(found).length > 0) return;
    const input = {
      lenderKind: kind,
      ...(chosen === NEW ? { lenderName: name } : { lenderId: chosen }),
      contact: textOf(values, "contact") || null,
      amount,
      takenOn,
      ...(before && owedNow
        ? {
            before: {
              owedNow,
              ...(typeof paidBefore === "number" ? { interestPaid: paidBefore } : {}),
            },
          }
        : {}),
      method: textOf(values, "method") || undefined,
      accountId: textOf(values, "accountId") || undefined,
      reference: textOf(values, "reference") || undefined,
      keepInCapital: values.get("keepInCapital") === "on",
      notes: textOf(values, "notes") || null,
      ...loanFields,
    };
    form.startTransition(async () => {
      const result = await withPin((pin) => addLoanAction({ ...input, pin }));
      if (!result.ok) {
        const fields = result.error.fieldErrors ?? {};
        // The profit's two spellings, and what was owed before, belong on their own boxes.
        const moved = {
          ...(fields.profitPerPeriod || fields.profitPct
            ? { profit: fields.profitPerPeriod ?? fields.profitPct }
            : {}),
          ...(fields["before.owedNow"] || fields.before
            ? { owedNow: fields["before.owedNow"] ?? fields.before }
            : {}),
          ...(fields["before.interestPaid"]
            ? { interestPaidBefore: fields["before.interestPaid"] }
            : {}),
        };
        return form.setError(
          Object.keys(moved).length > 0
            ? { ...result.error, fieldErrors: { ...fields, ...moved } }
            : result.error,
        );
      }
      router.push(`${loansHref.lender(result.data.lenderId)}?added=1`);
    });
  }

  const showAccount = !before || (autoPay && !person);

  return (
    <form onSubmit={submit} className="grid max-w-3xl gap-6" noValidate>
      <ChoiceList<CapitalLenderKind>
        name="lenderKind"
        legend="Who lent it"
        defaultValue={kind}
        onChange={(value) => {
          setKind(value);
          setLender(NEW);
        }}
        options={(["BANK", "NGO", "PERSON"] as const).map((k) => ({
          value: k,
          label: LENDER_KIND_LABELS[k],
          hint: KIND_HINTS[k],
        }))}
      />

      <div className="grid items-start gap-5 sm:grid-cols-2">
        {ofKind.length > 0 && (
          <Field id="loan-lender" label={person ? "Person" : LENDER_KIND_LABELS[kind]}>
            <NativeSelect
              id="loan-lender"
              value={chosen}
              onChange={(e) => setLender(e.target.value)}
              containerClassName="sm:w-full"
            >
              {ofKind.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
              <option value={NEW}>Someone new</option>
            </NativeSelect>
          </Field>
        )}
        {chosen === NEW && (
          <>
            <Field
              id="loan-name"
              label="Name"
              hint={person ? "Who lent the money, like Shishir." : "Like BRAC Bank or ASA."}
              error={fieldError("lenderName")}
            >
              <Input
                id="loan-name"
                name="lenderName"
                maxLength={160}
                autoComplete="off"
                aria-invalid={Boolean(fieldError("lenderName"))}
                aria-describedby={fieldError("lenderName") ? "loan-name-error" : "loan-name-hint"}
              />
            </Field>
            <Field id="loan-contact" label="Phone or branch (optional)">
              <Input id="loan-contact" name="contact" maxLength={200} autoComplete="off" />
            </Field>
          </>
        )}
        <Field
          id="loan-amount"
          label={`Amount taken (${currency})`}
          hint="The whole loan, as it was given."
          error={fieldError("amount")}
        >
          <Input
            id="loan-amount"
            name="amount"
            inputMode="decimal"
            placeholder="1000000.00"
            autoComplete="off"
            onChange={(e) => setPlan((p) => ({ ...p, amount: e.target.value }))}
            aria-invalid={Boolean(fieldError("amount"))}
            aria-describedby={fieldError("amount") ? "loan-amount-error" : "loan-amount-hint"}
          />
        </Field>
        <Field id="loan-taken-on" label="Taken on" error={fieldError("takenOn")}>
          <Input
            id="loan-taken-on"
            name="takenOn"
            type="date"
            defaultValue={data.today}
            max={data.today}
            aria-invalid={Boolean(fieldError("takenOn"))}
          />
        </Field>
      </div>

      <div className="grid gap-4">
        <label className="flex cursor-pointer items-start gap-2 text-sm">
          <input
            type="checkbox"
            checked={before}
            disabled={!data.can.receive}
            onChange={(e) => setBefore(e.target.checked)}
            className={checkboxClass}
          />
          <span>
            <span className="font-medium">Taken before the ERP</span>
            <span className="block text-[0.8125rem] text-muted-foreground">
              The money came before these books started: no money moves now, only what is still owed
              is entered.
            </span>
          </span>
        </label>
        {before && (
          <div className="grid items-start gap-5 sm:grid-cols-2">
            <Field
              id="loan-owed-now"
              label={`Still owed today (${currency})`}
              hint="The remaining balance on the bank statement, or what the person is still owed."
              error={fieldError("owedNow")}
            >
              <Input
                id="loan-owed-now"
                name="owedNow"
                inputMode="decimal"
                placeholder="0.00"
                autoComplete="off"
                onChange={(e) => setPlan((p) => ({ ...p, owedNow: e.target.value }))}
                aria-invalid={Boolean(fieldError("owedNow"))}
                aria-describedby={
                  fieldError("owedNow") ? "loan-owed-now-error" : "loan-owed-now-hint"
                }
              />
            </Field>
            <Field
              id="loan-paid-before"
              label={`${person ? "Profit" : "Interest"} paid before the ERP (${currency}, optional)`}
              hint="Shown on the profile only. It was paid before these books, so it never changes Profit and loss."
              error={fieldError("interestPaidBefore")}
            >
              <Input
                id="loan-paid-before"
                name="interestPaidBefore"
                inputMode="decimal"
                placeholder="0.00"
                autoComplete="off"
                aria-invalid={Boolean(fieldError("interestPaidBefore"))}
                aria-describedby={
                  fieldError("interestPaidBefore")
                    ? "loan-paid-before-error"
                    : "loan-paid-before-hint"
                }
              />
            </Field>
          </div>
        )}
      </div>

      {person ? (
        <fieldset className="grid gap-4">
          <legend className="mb-1 text-sm font-medium">The terms</legend>
          <div className="grid items-start gap-5 sm:grid-cols-3">
            <Field
              id="loan-period"
              label="Profit every (months)"
              hint="Like 3 for every 3 months."
              error={fieldError("periodMonths")}
            >
              <Input
                id="loan-period"
                name="periodMonths"
                inputMode="numeric"
                placeholder="3"
                autoComplete="off"
                aria-invalid={Boolean(fieldError("periodMonths"))}
                aria-describedby={
                  fieldError("periodMonths") ? "loan-period-error" : "loan-period-hint"
                }
              />
            </Field>
            <Field id="loan-profit-as" label="Profit as">
              <NativeSelect
                id="loan-profit-as"
                value={profitAs}
                onChange={(e) => setProfitAs(e.target.value as "MONEY" | "PCT")}
                containerClassName="sm:w-full"
              >
                <option value="MONEY">An amount</option>
                <option value="PCT">A % of the money</option>
              </NativeSelect>
            </Field>
            <Field
              id="loan-profit"
              label={
                profitAs === "MONEY" ? `Profit each time (${currency})` : "Profit each time (%)"
              }
              hint={profitAs === "MONEY" ? "Like 30000." : "Like 3 for 3% each time."}
              error={fieldError("profit")}
            >
              <Input
                id="loan-profit"
                name="profit"
                inputMode="decimal"
                autoComplete="off"
                aria-invalid={Boolean(fieldError("profit"))}
                aria-describedby={fieldError("profit") ? "loan-profit-error" : "loan-profit-hint"}
              />
            </Field>
            <Field
              id="loan-next-profit"
              label="Next profit on (optional)"
              hint="Left empty: counted from the day it was taken."
            >
              <Input id="loan-next-profit" name="nextDueDate" type="date" />
            </Field>
          </div>
        </fieldset>
      ) : (
        <fieldset className="grid gap-4">
          <legend className="mb-1 text-sm font-medium">The installments</legend>
          <div className="grid items-start gap-5 sm:grid-cols-3">
            <Field
              id="loan-installment"
              label={`Installment (${currency})`}
              hint="What the bank takes each month."
              error={fieldError("installmentAmount")}
            >
              <Input
                id="loan-installment"
                name="installmentAmount"
                inputMode="decimal"
                placeholder="100000.00"
                autoComplete="off"
                onChange={(e) => setPlan((p) => ({ ...p, installment: e.target.value }))}
                aria-invalid={Boolean(fieldError("installmentAmount"))}
                aria-describedby={
                  fieldError("installmentAmount")
                    ? "loan-installment-error"
                    : "loan-installment-hint"
                }
              />
            </Field>
            <Field
              id="loan-count"
              label="Installments left"
              hint="All of them for a new loan, like 12."
              error={fieldError("installmentsLeft")}
            >
              <Input
                id="loan-count"
                name="installmentsLeft"
                inputMode="numeric"
                placeholder="12"
                autoComplete="off"
                onChange={(e) => setPlan((p) => ({ ...p, count: e.target.value }))}
                aria-invalid={Boolean(fieldError("installmentsLeft"))}
                aria-describedby={
                  fieldError("installmentsLeft") ? "loan-count-error" : "loan-count-hint"
                }
              />
            </Field>
            <Field id="loan-next-due" label="Next installment on" error={fieldError("nextDueDate")}>
              <Input
                id="loan-next-due"
                name="nextDueDate"
                type="date"
                aria-invalid={Boolean(fieldError("nextDueDate"))}
              />
            </Field>
            <Field
              id="loan-rate"
              label="Interest rate (% a year, optional)"
              hint="Only a note: the interest is worked out from the installments."
              error={fieldError("interestRate")}
            >
              <Input
                id="loan-rate"
                name="interestRate"
                inputMode="decimal"
                placeholder="12"
                autoComplete="off"
                aria-describedby="loan-rate-hint"
              />
            </Field>
          </div>
          {split !== null &&
            (split < 0 ? (
              <FormAlert>These installments do not cover what is owed.</FormAlert>
            ) : (
              <FormAlert tone="note">
                Each installment: {money(((installment as number) - split).toFixed(2), currency)} of
                the loan and {money(split.toFixed(2), currency)} interest (a cost).
              </FormAlert>
            ))}
          {data.can.pay && (
            <label className="flex cursor-pointer items-start gap-2 text-sm">
              <input
                type="checkbox"
                checked={autoPay}
                onChange={(e) => setAutoPay(e.target.checked)}
                className={checkboxClass}
              />
              <span>
                <span className="font-medium">Pay by itself on the due day</span>
                <span className="block text-[0.8125rem] text-muted-foreground">
                  Each night the ERP pays the installment that is due from the account below, in
                  your name. It asks for your PIN.
                </span>
              </span>
            </label>
          )}
        </fieldset>
      )}

      {showAccount && (
        <div className="grid items-start gap-5 sm:grid-cols-3">
          <PaidFromFields
            idPrefix="loan-account"
            accounts={data.accounts}
            currency={currency}
            fieldError={fieldError}
            label={before ? "Installments paid from" : "Received into"}
          />
        </div>
      )}

      <label className="flex cursor-pointer items-start gap-2 text-sm">
        <input type="checkbox" name="keepInCapital" className={checkboxClass} />
        <span>
          <span className="font-medium">Keep it in my capital for ever</span>
          <span className="block text-[0.8125rem] text-muted-foreground">
            The money working in the business keeps the whole loan, even as it is repaid; the
            repayments come out of profit, under Net profit. Left off, what is repaid comes off your
            capital. Interest or profit is a cost either way.
          </span>
        </span>
      </label>

      <Field id="loan-notes" label="Notes (optional)">
        <Textarea id="loan-notes" name="notes" rows={2} maxLength={2000} />
      </Field>

      <FormFooter
        form={form}
        cancelHref={preset ? loansHref.lender(preset.id) : loansHref.page}
        submitLabel="Add the loan"
        pendingLabel="Adding"
        errorTitle="We could not add the loan"
      />
      {dialog}
    </form>
  );
}
