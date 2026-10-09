"use client";

import { PlusIcon, Trash2Icon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { Field, FormAlert } from "@/components/forms/field";
import { AMOUNT_HINT, readAmount } from "@/components/products/form-values";
import { money } from "@/components/sales/labels";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { cn } from "@/lib/utils";
import type {
  PartyOption,
  VoucherForm as VoucherFormData,
} from "@/modules/accounts/screens.service";
import { createJournalVoucherAction } from "@/server/actions/accounts.actions";

import { FormFooter, usePageForm } from "./form-bits";
import { ACCOUNT_TYPE_LABELS, ACCOUNT_TYPES, accountsHref } from "./labels";
import { AccountsPartyPicker } from "./money-fields";

type Account = VoucherFormData["accounts"][number];
type Party = { id: string; code: string; name: string };
type Line = {
  key: number;
  accountId: string;
  debit: string;
  credit: string;
  party: Party | null;
  memo: string;
};

const MAX_LINES = 50;
const blank = (key: number): Line => ({
  key,
  accountId: "",
  debit: "",
  credit: "",
  party: null,
  memo: "",
});

/** An amount box's value in paisa: 0 when empty, null when it is not an amount. */
function cents(text: string): number | null {
  const amount = readAmount(text);
  if (amount === "invalid") return null;
  return amount === null ? 0 : Math.round(amount * 100);
}
const fixed = (paisa: number) => (paisa / 100).toFixed(2);

/**
 * A journal voucher written by hand (accounts.manage): a description, the day,
 * and at least two lines, each a debit or a credit on one account, naming the
 * buyer or supplier on Receivable, Payable and Advance lines. Debits must
 * equal credits. Lines on cash, bank and wallet accounts move money, so they
 * also need the matching money permission, as the server checks.
 */
export function VoucherForm({ form: data, currency }: { form: VoucherFormData; currency: string }) {
  const router = useRouter();
  const form = usePageForm();
  const { fieldError } = form;
  const [lines, setLines] = useState<Line[]>(() => [blank(0), blank(1)]);
  const [nextKey, setNextKey] = useState(2);
  // Said beside the totals, not as a highlighted field.
  const [unbalanced, setUnbalanced] = useState<string>();
  const byId = new Map(data.accounts.map((a) => [a.id, a]));
  // Cash lines a person may not post are left out of the choices.
  const offered = data.accounts.filter((a) => !a.isCash || data.can.receive || data.can.pay);

  const debits = lines.reduce((s, l) => s + (cents(l.debit) ?? 0), 0);
  const credits = lines.reduce((s, l) => s + (cents(l.credit) ?? 0), 0);
  const difference = debits - credits;

  function change(key: number, patch: Partial<Line>) {
    setLines((all) => all.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  }

  function addLine() {
    setLines((all) => [...all, blank(nextKey)]);
    setNextKey((k) => k + 1);
  }

  function lineProblems(line: Line, i: number, found: Record<string, string>) {
    const at = (name: string) => `lines.${i}.${name}`;
    const account = byId.get(line.accountId);
    if (!account) found[at("accountId")] = "Choose the account.";
    const debit = cents(line.debit);
    const credit = cents(line.credit);
    if (debit === null) found[at("debit")] = AMOUNT_HINT;
    if (credit === null) found[at("credit")] = AMOUNT_HINT;
    if (debit !== null && credit !== null && debit > 0 === credit > 0) {
      found[at("debit")] =
        debit > 0 ? "Enter a debit or a credit, not both." : "Enter a debit or a credit.";
    }
    if (account?.party && !line.party) {
      found[at("partyId")] =
        account.party === "SUPPLIER" ? "Choose the supplier." : "Choose the buyer.";
    }
    if (account?.isCash && (debit ?? 0) > 0 && !data.can.receive) {
      found[at("debit")] = "Only Accounts can record money received.";
    }
    if (account?.isCash && (credit ?? 0) > 0 && !data.can.pay) {
      found[at("credit")] = "Only Accounts can record money paid out.";
    }
  }

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const values = new FormData(event.currentTarget);
    const description = String(values.get("description") ?? "").trim();
    const day = String(values.get("date") ?? "").trim();
    const found: Record<string, string> = {};
    if (description.length < 3) found.description = "Say what the voucher is for.";
    lines.forEach((l, i) => lineProblems(l, i, found));
    form.setProblems(found);
    form.setError(undefined);
    setUnbalanced(
      Object.keys(found).length === 0 && difference !== 0
        ? `Debits and credits must be equal; they differ by ${money(
            fixed(Math.abs(difference)),
            currency,
          )}.`
        : undefined,
    );
    if (Object.keys(found).length > 0 || difference !== 0) return;
    form.startTransition(async () => {
      const result = await createJournalVoucherAction({
        description,
        date: day && day !== data.today ? day : undefined,
        lines: lines.map((l) => ({
          accountId: l.accountId,
          debit: (cents(l.debit) ?? 0) > 0 ? Number(fixed(cents(l.debit)!)) : undefined,
          credit: (cents(l.credit) ?? 0) > 0 ? Number(fixed(cents(l.credit)!)) : undefined,
          partyId: byId.get(l.accountId)?.party ? l.party?.id : undefined,
          memo: l.memo.trim() || undefined,
        })),
      });
      if (!result.ok) return form.setError(result.error);
      router.push(`${accountsHref.entry(result.data.id)}?created=1`);
    });
  }

  return (
    <form onSubmit={submit} className="grid max-w-4xl gap-6" noValidate>
      <div className="grid items-start gap-5 sm:grid-cols-[minmax(0,1fr)_12rem]">
        <Field id="voucher-description" label="What it is for" error={fieldError("description")}>
          <Input
            id="voucher-description"
            name="description"
            maxLength={300}
            autoComplete="off"
            placeholder="Like: Office deposit returned by the landlord"
            aria-invalid={Boolean(fieldError("description"))}
            aria-describedby={fieldError("description") ? "voucher-description-error" : undefined}
            autoFocus
          />
        </Field>
        <Field id="voucher-date" label="Date" error={fieldError("date")}>
          <Input
            id="voucher-date"
            name="date"
            type="date"
            defaultValue={data.today}
            max={data.today}
          />
        </Field>
      </div>

      <fieldset className="grid gap-3">
        <legend className="mb-3 text-sm font-medium">Lines</legend>
        <ol className="grid gap-3">
          {lines.map((line, i) => {
            const account = byId.get(line.accountId);
            const at = (name: string) => `lines.${i}.${name}`;
            const id = (name: string) => `line-${line.key}-${name}`;
            return (
              <li key={line.key} className="grid gap-4 rounded-lg border bg-card p-4">
                <div className="flex items-center justify-between gap-3">
                  <p className="text-sm font-medium text-muted-foreground">Line {i + 1}</p>
                  {lines.length > 2 && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => setLines((all) => all.filter((l) => l.key !== line.key))}
                      aria-label={`Remove line ${i + 1}`}
                    >
                      <Trash2Icon aria-hidden />
                      Remove
                    </Button>
                  )}
                </div>
                <div className="grid items-start gap-4 md:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)]">
                  <Field id={id("account")} label="Account" error={fieldError(at("accountId"))}>
                    <NativeSelect
                      id={id("account")}
                      value={line.accountId}
                      onChange={(event) =>
                        change(line.key, { accountId: event.target.value, party: null })
                      }
                      containerClassName="sm:w-full"
                      aria-invalid={Boolean(fieldError(at("accountId")))}
                    >
                      <option value="">Choose an account</option>
                      {ACCOUNT_TYPES.map((type) => {
                        const group = offered.filter((a) => a.type === type);
                        if (group.length === 0) return null;
                        return (
                          <optgroup key={type} label={ACCOUNT_TYPE_LABELS[type]}>
                            {group.map((a: Account) => (
                              <option key={a.id} value={a.id}>
                                {a.code} {a.name}
                              </option>
                            ))}
                          </optgroup>
                        );
                      })}
                    </NativeSelect>
                  </Field>
                  <Field
                    id={id("debit")}
                    label={`Debit (${currency})`}
                    error={fieldError(at("debit"))}
                  >
                    <Input
                      id={id("debit")}
                      inputMode="decimal"
                      placeholder="0.00"
                      autoComplete="off"
                      value={line.debit}
                      onChange={(event) => change(line.key, { debit: event.target.value })}
                      aria-invalid={Boolean(fieldError(at("debit")))}
                      aria-describedby={
                        fieldError(at("debit")) ? `${id("debit")}-error` : undefined
                      }
                    />
                  </Field>
                  <Field
                    id={id("credit")}
                    label={`Credit (${currency})`}
                    error={fieldError(at("credit"))}
                  >
                    <Input
                      id={id("credit")}
                      inputMode="decimal"
                      placeholder="0.00"
                      autoComplete="off"
                      value={line.credit}
                      onChange={(event) => change(line.key, { credit: event.target.value })}
                      aria-invalid={Boolean(fieldError(at("credit")))}
                      aria-describedby={
                        fieldError(at("credit")) ? `${id("credit")}-error` : undefined
                      }
                    />
                  </Field>
                </div>
                {account?.party && (
                  <Field
                    id={id("party")}
                    label={account.party === "SUPPLIER" ? "Supplier" : "Buyer"}
                    error={fieldError(at("partyId"))}
                  >
                    <AccountsPartyPicker
                      id={id("party")}
                      kind={account.party}
                      purpose="JOURNAL"
                      value={line.party}
                      onChange={(party: PartyOption | null) => change(line.key, { party })}
                      invalid={Boolean(fieldError(at("partyId")))}
                      describedBy={fieldError(at("partyId")) ? `${id("party")}-error` : undefined}
                    />
                  </Field>
                )}
                <Field id={id("memo")} label="Note on this line (optional)">
                  <Input
                    id={id("memo")}
                    maxLength={200}
                    autoComplete="off"
                    value={line.memo}
                    onChange={(event) => change(line.key, { memo: event.target.value })}
                  />
                </Field>
              </li>
            );
          })}
        </ol>
        {lines.length < MAX_LINES && (
          <div>
            <Button type="button" variant="outline" className="w-full sm:w-auto" onClick={addLine}>
              <PlusIcon aria-hidden />
              Add a line
            </Button>
          </div>
        )}
      </fieldset>

      <dl
        className="grid grid-cols-1 gap-3 rounded-lg border bg-card p-4 text-sm sm:grid-cols-3"
        aria-live="polite"
      >
        <div className="flex justify-between gap-3 sm:block">
          <dt className="text-muted-foreground">Debits</dt>
          <dd className="font-medium tabular-nums">{money(fixed(debits), currency)}</dd>
        </div>
        <div className="flex justify-between gap-3 sm:block">
          <dt className="text-muted-foreground">Credits</dt>
          <dd className="font-medium tabular-nums">{money(fixed(credits), currency)}</dd>
        </div>
        <div className="flex justify-between gap-3 sm:block">
          <dt className="text-muted-foreground">Difference</dt>
          <dd
            className={cn(
              "font-medium tabular-nums",
              difference === 0 ? "text-success" : "text-destructive",
            )}
          >
            {difference === 0 ? "Balanced" : money(fixed(Math.abs(difference)), currency)}
          </dd>
        </div>
      </dl>
      {unbalanced && difference !== 0 && <FormAlert>{unbalanced}</FormAlert>}

      <FormFooter
        form={form}
        cancelHref="/accounts/journal"
        submitLabel="Post the voucher"
        pendingLabel="Posting"
        errorTitle="We could not post the voucher"
      />
    </form>
  );
}
