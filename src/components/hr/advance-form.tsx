"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { FormFooter, usePageForm } from "@/components/accounts/form-bits";
import { PaidFromFields } from "@/components/accounts/money-fields";
import { Field, FormAlert } from "@/components/forms/field";
import { ChoiceList } from "@/components/parties/choice-list";
import { AMOUNT_HINT, readAmount, textOf } from "@/components/products/form-values";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { formatMonth } from "@/lib/display";
import type { AdvanceForm as AdvanceFormData } from "@/modules/hr/screens.service";
import { giveAdvanceAction } from "@/server/actions/hr.actions";

import { hrHref, shiftMonth } from "./labels";

/**
 * Accounts pays an employee an advance (accounts.payments.record): the amount,
 * where the money came from, and how it is taken back from their salary (all
 * at the next payroll, or so much a month). Accounts managers also bring
 * forward advances owed from before the ERP, with no money moving now.
 */
export function AdvanceForm({ form: data, currency }: { form: AdvanceFormData; currency: string }) {
  const router = useRouter();
  const form = usePageForm();
  const { fieldError } = form;
  const [employeeId, setEmployeeId] = useState(data.employeeId ?? "");
  const [kind, setKind] = useState<"give" | "opening">(data.can.give ? "give" : "opening");
  const [plan, setPlan] = useState<"all" | "monthly">("all");
  const opening = kind === "opening";

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const values = new FormData(event.currentTarget);
    const found: Record<string, string> = {};
    if (!employeeId) found.employeeId = "Choose the employee.";
    const amount = readAmount(textOf(values, "amount"));
    if (amount === null || amount === 0) found.amount = "Enter the amount.";
    else if (amount === "invalid") found.amount = AMOUNT_HINT;
    const installment = plan === "monthly" ? readAmount(textOf(values, "installmentAmount")) : null;
    if (plan === "monthly" && (installment === null || installment === 0)) {
      found.installmentAmount = "Enter how much comes off each salary.";
    } else if (installment === "invalid") found.installmentAmount = AMOUNT_HINT;
    form.setProblems(found);
    form.setError(undefined);
    if (Object.keys(found).length > 0) return;
    const date = textOf(values, "date");
    form.startTransition(async () => {
      const result = await giveAdvanceAction({
        employeeId,
        amount,
        isOpening: opening,
        date: date && date !== data.today ? date : undefined,
        ...(opening
          ? {}
          : {
              accountId: textOf(values, "accountId") || undefined,
              method: textOf(values, "method") || "CASH",
              reference: textOf(values, "reference") || null,
            }),
        purpose: textOf(values, "purpose") || null,
        installmentAmount: installment as number | null,
        recoverFrom: textOf(values, "recoverFrom") || null,
      });
      if (!result.ok) return form.setError(result.error);
      router.push(`${hrHref.advance(result.data.id)}?created=1`);
    });
  }

  return (
    <form onSubmit={submit} className="grid max-w-2xl gap-5" noValidate>
      {data.can.give && data.can.bringForward && (
        <ChoiceList
          name="kind"
          legend="What is it?"
          defaultValue={kind}
          onChange={setKind}
          options={[
            {
              value: "give",
              label: "Money paid out now",
              hint: "From cash, the bank or a wallet.",
            },
            {
              value: "opening",
              label: "Owed from before Extas ERP",
              hint: "No money moves now; it is set against opening balances.",
            },
          ]}
        />
      )}
      <Field id="employeeId" label="Employee" error={fieldError("employeeId")}>
        <NativeSelect
          id="employeeId"
          value={employeeId}
          onChange={(e) => setEmployeeId(e.target.value)}
          containerClassName="sm:w-full"
          aria-invalid={Boolean(fieldError("employeeId"))}
        >
          <option value="">Choose…</option>
          {data.people.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name} ({p.code})
            </option>
          ))}
        </NativeSelect>
      </Field>
      <div className="grid items-start gap-5 sm:grid-cols-2">
        <Field id="amount" label={`Amount (${currency})`} error={fieldError("amount")}>
          <Input
            id="amount"
            name="amount"
            inputMode="decimal"
            autoComplete="off"
            placeholder="0.00"
            aria-invalid={Boolean(fieldError("amount"))}
            aria-describedby={fieldError("amount") ? "amount-error" : undefined}
          />
        </Field>
        <Field id="date" label={opening ? "Given on" : "Paid on"} error={fieldError("date")}>
          <Input id="date" name="date" type="date" defaultValue={data.today} max={data.today} />
        </Field>
        {!opening && (
          <PaidFromFields
            idPrefix="advance"
            accounts={data.moneyAccounts}
            currency={currency}
            fieldError={fieldError}
          />
        )}
      </div>
      <Field id="purpose" label="What for (optional)" error={fieldError("purpose")}>
        <Textarea id="purpose" name="purpose" rows={2} maxLength={300} />
      </Field>
      <ChoiceList
        name="plan"
        legend="Taken back from their salary"
        defaultValue="all"
        onChange={setPlan}
        options={[
          {
            value: "all",
            label: "All at once",
            hint: "From the first payroll it is taken back in.",
          },
          { value: "monthly", label: "So much a month", hint: "Until it is all taken back." },
        ]}
      />
      <div className="grid items-start gap-5 sm:grid-cols-2">
        {plan === "monthly" && (
          <Field
            id="installmentAmount"
            label={`Each month (${currency})`}
            error={fieldError("installmentAmount")}
          >
            <Input
              id="installmentAmount"
              name="installmentAmount"
              inputMode="decimal"
              autoComplete="off"
              placeholder="0.00"
              aria-invalid={Boolean(fieldError("installmentAmount"))}
            />
          </Field>
        )}
        <Field
          id="recoverFrom"
          label="Starting with the payroll for"
          error={fieldError("recoverFrom")}
        >
          <NativeSelect
            id="recoverFrom"
            name="recoverFrom"
            defaultValue=""
            containerClassName="sm:w-full"
          >
            <option value="">The month it is given</option>
            {[1, 2, 3, 4, 5, 6].map((n) => {
              const month = shiftMonth(data.today.slice(0, 7), n);
              return (
                <option key={month} value={month}>
                  {formatMonth(month)}
                </option>
              );
            })}
          </NativeSelect>
        </Field>
      </div>
      {!opening && (
        <FormAlert tone="note">
          A salary advance voucher is made, and the employee owes it until it is taken back from
          their salary, spent on a company expense or returned in cash.
        </FormAlert>
      )}
      <FormFooter
        form={form}
        cancelHref={hrHref.advances}
        submitLabel={opening ? "Bring it forward" : "Pay the advance"}
        pendingLabel="Saving"
        errorTitle="We could not record the advance"
      />
    </form>
  );
}
