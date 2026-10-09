"use client";

import { Field } from "@/components/forms/field";
import { dayOrNow, readPositive } from "@/components/production/cost-dialogs";
import { textOf } from "@/components/products/form-values";
import { FormDialog, problem } from "@/components/sales/dialogs";
import { money } from "@/components/sales/labels";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import type { MoneyAccountOption } from "@/modules/accounts/screens.service";
import { createTransferAction } from "@/server/actions/accounts.actions";

import { KIND_LABELS, signedMoney } from "./labels";

function AccountOptions({
  accounts,
  currency,
}: {
  accounts: readonly MoneyAccountOption[];
  currency: string;
}) {
  return (
    <>
      {(["CASH", "BANK", "MOBILE_WALLET"] as const).map((kind) => {
        const ofKind = accounts.filter((a) => a.kind === kind);
        return ofKind.length === 0 ? null : (
          <optgroup key={kind} label={KIND_LABELS[kind]}>
            {ofKind.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name} · {signedMoney(a.balance, currency)}
              </option>
            ))}
          </optgroup>
        );
      })}
    </>
  );
}

/**
 * Moves money between two cash, bank or wallet accounts (Accounts): a deposit
 * of cash into the bank, a withdrawal, a bKash cash-out. Only the two balances
 * change; the profit does not.
 */
export function MoveMoneyDialog({
  accounts,
  currency,
  today,
  fromId,
  onDone,
  onClose,
}: {
  accounts: readonly MoneyAccountOption[];
  currency: string;
  today: string;
  /** The account the money leaves, when opened from it. */
  fromId?: string;
  onDone: (message: string) => void;
  onClose: () => void;
}) {
  const from = fromId ?? accounts[0]?.id ?? "";
  const to = accounts.find((a) => a.id !== from)?.id ?? "";
  const nameOf = (id: string) => accounts.find((a) => a.id === id)?.name ?? "the account";
  return (
    <FormDialog
      title="Move money"
      description="Cash into the bank, a withdrawal, a bKash cash-out. Both balances change; the profit does not."
      submitLabel="Move the money"
      pendingLabel="Moving"
      errorTitle="We could not move the money"
      onClose={onClose}
      onSubmit={async (form) => {
        const fromAccountId = textOf(form, "fromAccountId");
        const toAccountId = textOf(form, "toAccountId");
        if (!fromAccountId) return problem({ fromAccountId: "Choose where the money comes from." });
        if (!toAccountId || toAccountId === fromAccountId) {
          return problem({ toAccountId: "Choose another account for the money to go into." });
        }
        const amount = readPositive(form, "amount");
        if (typeof amount !== "number") return amount;
        const result = await createTransferAction({
          fromAccountId,
          toAccountId,
          amount,
          date: dayOrNow(form, "date", today),
          reference: textOf(form, "reference") || undefined,
          notes: textOf(form, "notes") || undefined,
        });
        if (!result.ok) return result.error;
        onDone(
          `${money(amount.toFixed(2), currency)} moved from ${nameOf(fromAccountId)} to ${nameOf(
            toAccountId,
          )} (${result.data.number}).`,
        );
      }}
    >
      {(fieldError) => (
        <>
          <div className="grid items-start gap-5 sm:grid-cols-2">
            <Field id="move-from" label="From" error={fieldError("fromAccountId")}>
              <NativeSelect
                id="move-from"
                name="fromAccountId"
                defaultValue={from}
                containerClassName="sm:w-full"
                aria-invalid={Boolean(fieldError("fromAccountId"))}
              >
                <AccountOptions accounts={accounts} currency={currency} />
              </NativeSelect>
            </Field>
            <Field id="move-to" label="Into" error={fieldError("toAccountId")}>
              <NativeSelect
                id="move-to"
                name="toAccountId"
                defaultValue={to}
                containerClassName="sm:w-full"
                aria-invalid={Boolean(fieldError("toAccountId"))}
              >
                <AccountOptions accounts={accounts} currency={currency} />
              </NativeSelect>
            </Field>
            <Field id="move-amount" label={`Amount (${currency})`} error={fieldError("amount")}>
              <Input
                id="move-amount"
                name="amount"
                inputMode="decimal"
                placeholder="0.00"
                autoComplete="off"
                aria-invalid={Boolean(fieldError("amount"))}
                aria-describedby={fieldError("amount") ? "move-amount-error" : undefined}
              />
            </Field>
            <Field id="move-date" label="Date" error={fieldError("date")}>
              <Input id="move-date" name="date" type="date" defaultValue={today} max={today} />
            </Field>
          </div>
          <Field
            id="move-reference"
            label="Reference (optional)"
            hint="Deposit slip, cheque number, transaction ID…"
          >
            <Input
              id="move-reference"
              name="reference"
              maxLength={120}
              autoComplete="off"
              aria-describedby="move-reference-hint"
            />
          </Field>
          <Field id="move-notes" label="Notes (optional)">
            <Textarea id="move-notes" name="notes" rows={2} maxLength={500} />
          </Field>
        </>
      )}
    </FormDialog>
  );
}
