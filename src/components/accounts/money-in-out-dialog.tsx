"use client";

import { useState } from "react";

import { Field, FormAlert } from "@/components/forms/field";
import { ChoiceList } from "@/components/parties/choice-list";
import { dayOrNow, readPositive } from "@/components/production/cost-dialogs";
import { textOf } from "@/components/products/form-values";
import { FormDialog, problem } from "@/components/sales/dialogs";
import { money } from "@/components/sales/labels";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import type { MoneyInOutOptions } from "@/modules/accounts/money-in-out.service";
import {
  addFundAction,
  recordBankChargeAction,
  withdrawFundAction,
} from "@/server/actions/accounts.actions";

import { KIND_LABELS, signedMoney } from "./labels";
import type { MoveMoneyAccount } from "./move-money-dialog";

type Kind = "ADD_FUND" | "WITHDRAW" | "BANK_CHARGE";

/** The owner select's "Someone new" choice. */
const NEW_OWNER = "new";

const KINDS: ReadonlyArray<{
  value: Kind;
  allowed: keyof MoneyInOutOptions["can"];
  label: string;
  hint: string;
}> = [
  {
    value: "ADD_FUND",
    allowed: "addFund",
    label: "Add fund",
    hint: "The owner puts money into the business. It goes on their capital.",
  },
  {
    value: "WITHDRAW",
    allowed: "withdraw",
    label: "Withdraw",
    hint: "The owner takes money out for themselves. It goes to Owner's Drawings, not to expenses.",
  },
  {
    value: "BANK_CHARGE",
    allowed: "bankCharge",
    label: "Bank charge",
    hint: "A fee the bank or wallet took: SMS alerts, a cheque book, a transfer fee.",
  },
];

/**
 * The "Money in/out" window (Accounts): money the owner puts in (Add fund) or
 * takes out (Withdraw), and a fee the bank took (Bank charge). Each goes into
 * the books at once: capital, drawings, or the Bank Charges expense.
 */
export function MoneyInOutDialog({
  options,
  accounts,
  currency,
  today,
  onDone,
  onClose,
}: {
  options: MoneyInOutOptions;
  accounts: readonly MoveMoneyAccount[];
  currency: string;
  today: string;
  onDone: (message: string) => void;
  onClose: () => void;
}) {
  const kinds = KINDS.filter((k) => options.can[k.allowed]);
  const [kind, setKind] = useState<Kind>(kinds[0]?.value ?? "ADD_FUND");
  const [owner, setOwner] = useState(options.owners[0]?.id ?? NEW_OWNER);
  const charge = kind === "BANK_CHARGE";
  const usable = charge ? accounts.filter((a) => a.kind !== "CASH") : accounts;
  const nameOf = (id: string) => usable.find((a) => a.id === id)?.name ?? "the account";
  const ownerOf = (id: string) => options.owners.find((o) => o.id === id)?.name ?? "";

  return (
    <FormDialog
      title="Money in/out"
      description="Money the owner puts in or takes out, and fees the bank takes. Each goes into the books at once."
      submitLabel={
        charge ? "Record the charge" : kind === "ADD_FUND" ? "Add the fund" : "Record it"
      }
      pendingLabel="Recording"
      errorTitle="We could not record the money"
      onClose={onClose}
      onSubmit={async (form) => {
        const accountId = textOf(form, "accountId");
        if (!accountId) return problem({ accountId: "Choose an account." });
        const amount = readPositive(form, "amount");
        if (typeof amount !== "number") return amount;
        const date = dayOrNow(form, "date", today);
        const notes = textOf(form, "notes") || undefined;
        const m = money(amount.toFixed(2), currency);
        if (charge) {
          const result = await recordBankChargeAction({ accountId, amount, date, notes });
          if (!result.ok) return result.error;
          onDone(`Bank charge of ${m} from ${nameOf(accountId)} recorded (${result.data.number}).`);
          return;
        }
        const ownerName = owner === NEW_OWNER ? textOf(form, "ownerName") : "";
        if (owner === NEW_OWNER && ownerName.length < 2) {
          return problem({ ownerName: "Write the owner's name." });
        }
        const input = {
          ...(owner === NEW_OWNER ? { ownerName } : { ownerId: owner }),
          accountId,
          amount,
          date,
          reference: textOf(form, "reference") || undefined,
          notes,
        };
        const result =
          kind === "ADD_FUND" ? await addFundAction(input) : await withdrawFundAction(input);
        if (!result.ok) return result.error;
        onDone(
          kind === "ADD_FUND"
            ? `${m} from ${result.data.owner} added to ${result.data.account}, on their capital.`
            : `${m} taken out of ${result.data.account} by ${result.data.owner}, as drawings.`,
        );
      }}
    >
      {(fieldError) => (
        <>
          {kinds.length > 1 && (
            <ChoiceList<Kind>
              name="kind"
              legend="What happened"
              defaultValue={kind}
              onChange={setKind}
              options={kinds.map((k) => ({ value: k.value, label: k.label, hint: k.hint }))}
            />
          )}
          {!charge && (
            <div className="grid items-start gap-5 sm:grid-cols-2">
              {options.owners.length > 0 && (
                <Field id="money-owner" label="Owner" error={fieldError("ownerId")}>
                  <NativeSelect
                    id="money-owner"
                    value={owner}
                    onChange={(e) => setOwner(e.target.value)}
                    containerClassName="sm:w-full"
                  >
                    {options.owners.map((o) => (
                      <option key={o.id} value={o.id}>
                        {o.name}
                      </option>
                    ))}
                    <option value={NEW_OWNER}>Someone new…</option>
                  </NativeSelect>
                </Field>
              )}
              {owner === NEW_OWNER && (
                <Field
                  id="money-owner-name"
                  label="Owner's name"
                  error={fieldError("ownerName") ?? fieldError("ownerId")}
                  hint={
                    options.owners.length === 0
                      ? "Their capital account is opened with this name."
                      : undefined
                  }
                >
                  <Input
                    id="money-owner-name"
                    name="ownerName"
                    maxLength={160}
                    autoComplete="off"
                    aria-invalid={Boolean(fieldError("ownerName"))}
                  />
                </Field>
              )}
            </div>
          )}
          {charge && usable.length === 0 ? (
            <FormAlert tone="note">
              There is no bank or wallet account yet. Add the bank account first.
            </FormAlert>
          ) : (
            <div className="grid items-start gap-5 sm:grid-cols-2">
              <Field
                id="money-account"
                label={kind === "ADD_FUND" ? "Into" : charge ? "Charged to" : "From"}
                error={fieldError("accountId")}
              >
                <NativeSelect
                  key={kind}
                  id="money-account"
                  name="accountId"
                  defaultValue={usable[0]?.id}
                  containerClassName="sm:w-full"
                  aria-invalid={Boolean(fieldError("accountId"))}
                >
                  {(["CASH", "BANK", "MOBILE_WALLET"] as const).map((k) => {
                    const ofKind = usable.filter((a) => a.kind === k);
                    return ofKind.length === 0 ? null : (
                      <optgroup key={k} label={KIND_LABELS[k]}>
                        {ofKind.map((a) => (
                          <option key={a.id} value={a.id}>
                            {a.name} · {signedMoney(a.balance, currency)}
                          </option>
                        ))}
                      </optgroup>
                    );
                  })}
                </NativeSelect>
              </Field>
              <Field id="money-amount" label={`Amount (${currency})`} error={fieldError("amount")}>
                <Input
                  id="money-amount"
                  name="amount"
                  inputMode="decimal"
                  placeholder="0.00"
                  autoComplete="off"
                  aria-invalid={Boolean(fieldError("amount"))}
                  aria-describedby={fieldError("amount") ? "money-amount-error" : undefined}
                />
              </Field>
              <Field id="money-date" label="Date" error={fieldError("date")}>
                <Input id="money-date" name="date" type="date" defaultValue={today} max={today} />
              </Field>
              {!charge && (
                <Field
                  id="money-reference"
                  label="Reference (optional)"
                  hint="Deposit slip, cheque number, transaction ID…"
                >
                  <Input
                    id="money-reference"
                    name="reference"
                    maxLength={120}
                    autoComplete="off"
                    aria-describedby="money-reference-hint"
                  />
                </Field>
              )}
            </div>
          )}
          <Field
            id="money-notes"
            label={charge ? "What it was for (optional)" : "Notes (optional)"}
            hint={charge ? "SMS alert fee, cheque book, transfer fee…" : undefined}
          >
            <Textarea
              id="money-notes"
              name="notes"
              rows={2}
              maxLength={charge ? 300 : 500}
              aria-describedby={charge ? "money-notes-hint" : undefined}
            />
          </Field>
          {kind === "WITHDRAW" && owner !== NEW_OWNER && ownerOf(owner) && (
            <p className="text-[0.8125rem] text-muted-foreground">
              What {ownerOf(owner)} put in stays as it is; the money taken out shows under
              Owner&apos;s Drawings on the balance sheet.
            </p>
          )}
        </>
      )}
    </FormDialog>
  );
}
