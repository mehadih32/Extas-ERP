"use client";

import { useRouter } from "next/navigation";

import { Field } from "@/components/forms/field";
import { ChoiceList } from "@/components/parties/choice-list";
import { AMOUNT_HINT, readAmount, textOf } from "@/components/products/form-values";
import { Input } from "@/components/ui/input";
import type { BankForm as BankFormData } from "@/modules/accounts/screens.service";
import {
  createBankAccountAction,
  updateBankAccountAction,
} from "@/server/actions/accounts.actions";

import { FormFooter, usePageForm } from "./form-bits";
import { accountsHref } from "./labels";

/**
 * A bank account's details: the bank, branch, account name and number, and the
 * routing and SWIFT codes. A new one can bring its balance forward from before
 * the ERP (in the account, or overdrawn) on the go-live day.
 */
export function BankForm({ form: data, currency }: { form: BankFormData; currency: string }) {
  const router = useRouter();
  const form = usePageForm();
  const bank = data.bank;
  const { fieldError } = form;

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const values = new FormData(event.currentTarget);
    const found: Record<string, string> = {};
    const text = (name: string) => textOf(values, name);
    if (text("bankName").length < 2) found.bankName = "Enter the bank's name.";
    if (text("accountName").length < 2) found.accountName = "Enter the name on the account.";
    if (!/^[0-9A-Za-z -]{4,40}$/.test(text("accountNumber"))) {
      found.accountNumber = "Use 4 to 40 digits, letters, spaces or dashes.";
    }
    const opening = bank ? null : readAmount(text("openingBalance"));
    if (opening === "invalid") found.openingBalance = AMOUNT_HINT;
    form.setProblems(found);
    form.setError(undefined);
    if (Object.keys(found).length > 0) return;

    const details = {
      bankName: text("bankName"),
      branch: text("branch") || null,
      accountName: text("accountName"),
      accountNumber: text("accountNumber"),
      routingNumber: text("routingNumber") || null,
      swiftCode: text("swiftCode") || null,
    };
    form.startTransition(async () => {
      if (bank) {
        const result = await updateBankAccountAction(bank.id, details);
        if (!result.ok) return form.setError(result.error);
        router.push(accountsHref.bank(bank.id));
        return;
      }
      const overdrawn = text("openingSide") === "OVERDRAWN";
      const amount = typeof opening === "number" ? opening : 0;
      const day = text("openingDate");
      const result = await createBankAccountAction({
        ...details,
        ...(amount > 0
          ? {
              openingBalance: overdrawn ? -amount : amount,
              openingDate: day && day !== data.today ? day : undefined,
            }
          : {}),
      });
      if (!result.ok) return form.setError(result.error);
      router.push(accountsHref.bank(result.data.id));
    });
  }

  const input = (name: string, extra: React.ComponentProps<typeof Input> = {}) => (
    <Input
      id={name}
      name={name}
      autoComplete="off"
      aria-invalid={Boolean(fieldError(name))}
      aria-describedby={fieldError(name) ? `${name}-error` : undefined}
      {...extra}
    />
  );

  return (
    <form onSubmit={submit} className="grid max-w-3xl gap-6" noValidate>
      <div className="grid items-start gap-5 sm:grid-cols-2">
        <Field id="bankName" label="Bank" error={fieldError("bankName")}>
          {input("bankName", {
            defaultValue: bank?.bankName,
            maxLength: 120,
            placeholder: "Dutch-Bangla Bank",
            autoFocus: true,
          })}
        </Field>
        <Field id="branch" label="Branch (optional)" error={fieldError("branch")}>
          {input("branch", { defaultValue: bank?.branch ?? "", maxLength: 120 })}
        </Field>
        <Field id="accountName" label="Name on the account" error={fieldError("accountName")}>
          {input("accountName", { defaultValue: bank?.accountName ?? data.holder, maxLength: 160 })}
        </Field>
        <Field id="accountNumber" label="Account number" error={fieldError("accountNumber")}>
          {input("accountNumber", {
            defaultValue: bank?.accountNumber,
            maxLength: 40,
            inputMode: "numeric",
          })}
        </Field>
        <Field
          id="routingNumber"
          label="Routing number (optional)"
          error={fieldError("routingNumber")}
        >
          {input("routingNumber", { defaultValue: bank?.routingNumber ?? "", maxLength: 20 })}
        </Field>
        <Field id="swiftCode" label="SWIFT code (optional)" error={fieldError("swiftCode")}>
          {input("swiftCode", { defaultValue: bank?.swiftCode ?? "", maxLength: 20 })}
        </Field>
      </div>

      {!bank && (
        <fieldset className="grid min-w-0 gap-4 rounded-lg border bg-card p-4 sm:p-5">
          <legend className="px-1 font-serif text-lg text-primary">Balance brought forward</legend>
          <p className="-mt-2 text-sm text-muted-foreground">
            What the bank showed on the day you start using the ERP. Leave it empty for a new
            account.
          </p>
          <ChoiceList<"IN" | "OVERDRAWN">
            name="openingSide"
            legend="The balance is"
            defaultValue="IN"
            options={[
              { value: "IN", label: "Money in the account" },
              { value: "OVERDRAWN", label: "Overdrawn", hint: "The bank is owed this amount." },
            ]}
          />
          <div className="grid items-start gap-5 sm:grid-cols-2">
            <Field
              id="openingBalance"
              label={`Amount (${currency})`}
              error={fieldError("openingBalance")}
            >
              {input("openingBalance", { inputMode: "decimal", placeholder: "0.00" })}
            </Field>
            <Field id="openingDate" label="On" error={fieldError("openingDate")}>
              {input("openingDate", { type: "date", defaultValue: data.today, max: data.today })}
            </Field>
          </div>
        </fieldset>
      )}

      <FormFooter
        form={form}
        cancelHref={bank ? accountsHref.bank(bank.id) : "/accounts/cash-bank"}
        submitLabel={bank ? "Save the changes" : "Add the bank account"}
        errorTitle="We could not save the bank account"
      />
    </form>
  );
}
