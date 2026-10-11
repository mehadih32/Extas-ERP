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

/** What the dialog needs of each cash, bank or wallet account. */
export type MoveMoneyAccount = Pick<MoneyAccountOption, "id" | "name" | "kind" | "balance">;

function AccountOptions({
  accounts,
  currency,
}: {
  accounts: readonly MoveMoneyAccount[];
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

/** One side of the move: a choice of account, or the one account it must be. */
function AccountField({
  side,
  label,
  accounts,
  value,
  locked,
  currency,
  error,
}: {
  side: "from" | "to";
  label: string;
  accounts: readonly MoveMoneyAccount[];
  value: string;
  locked: boolean;
  currency: string;
  error?: string;
}) {
  const id = `move-${side}`;
  const name = `${side}AccountId`;
  const fixed = locked ? accounts.find((a) => a.id === value) : undefined;
  return (
    <Field id={id} label={label} error={error}>
      {fixed ? (
        <>
          <input type="hidden" name={name} value={fixed.id} />
          <Input
            id={id}
            readOnly
            value={`${fixed.name} · ${signedMoney(fixed.balance, currency)}`}
            className="bg-muted/50"
          />
        </>
      ) : (
        <NativeSelect
          id={id}
          name={name}
          defaultValue={value}
          containerClassName="sm:w-full"
          aria-invalid={Boolean(error)}
        >
          <AccountOptions accounts={accounts} currency={currency} />
        </NativeSelect>
      )}
    </Field>
  );
}

/**
 * Moves money between two cash, bank or wallet accounts (Accounts): a deposit
 * of cash into the bank, a withdrawal, a bKash cash-out, a petty cash top-up.
 * Only the two balances change; the profit does not.
 */
export function MoveMoneyDialog({
  accounts,
  currency,
  today,
  fromId,
  toId,
  locked,
  title = "Move money",
  description = "Cash into the bank, a withdrawal, a bKash cash-out. Both balances change; the profit does not.",
  submitLabel = "Move the money",
  defaultAmount,
  onDone,
  onClose,
}: {
  accounts: readonly MoveMoneyAccount[];
  currency: string;
  today: string;
  /** The account the money leaves, when opened from it. */
  fromId?: string;
  /** The account the money goes into, when opened for it. */
  toId?: string;
  /** The side that cannot change (a petty cash box's top-up or take-back). */
  locked?: "from" | "to";
  title?: string;
  description?: string;
  submitLabel?: string;
  /** The amount filled in at first ("2500.00"). */
  defaultAmount?: string;
  onDone: (message: string) => void;
  onClose: () => void;
}) {
  const from = fromId ?? accounts.find((a) => a.id !== toId)?.id ?? "";
  const to = toId ?? accounts.find((a) => a.id !== from)?.id ?? "";
  const nameOf = (id: string) => accounts.find((a) => a.id === id)?.name ?? "the account";
  const lockedId = locked === "from" ? from : locked === "to" ? to : undefined;
  const choices = lockedId ? accounts.filter((a) => a.id !== lockedId) : accounts;
  return (
    <FormDialog
      title={title}
      description={description}
      submitLabel={submitLabel}
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
            <AccountField
              side="from"
              label="From"
              accounts={locked === "from" ? accounts : choices}
              value={from}
              locked={locked === "from"}
              currency={currency}
              error={fieldError("fromAccountId")}
            />
            <AccountField
              side="to"
              label="Into"
              accounts={locked === "to" ? accounts : choices}
              value={to}
              locked={locked === "to"}
              currency={currency}
              error={fieldError("toAccountId")}
            />
            <Field id="move-amount" label={`Amount (${currency})`} error={fieldError("amount")}>
              <Input
                id="move-amount"
                name="amount"
                inputMode="decimal"
                placeholder="0.00"
                defaultValue={defaultAmount}
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
