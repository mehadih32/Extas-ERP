"use client";

import { XIcon } from "lucide-react";
import { useState } from "react";

import { Field } from "@/components/forms/field";
import { SearchList } from "@/components/sales/pickers";
import { METHOD_LABELS } from "@/components/sales/labels";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { METHODS_BY_KIND } from "@/modules/accounts/choices";
import type { MoneyAccountOption, PartyOption } from "@/modules/accounts/screens.service";
import { findAccountsPartiesAction } from "@/server/actions/accounts.actions";

import { KIND_LABELS, signedMoney } from "./labels";

/**
 * Where money is paid from (or into): the cash, bank or wallet account with its
 * balance, how it moved (the methods that account takes: bKash for a wallet,
 * cheque or transfer for a bank) and a reference. Named accountId, method and
 * reference.
 */
export function PaidFromFields({
  idPrefix,
  accounts,
  currency,
  fieldError,
  label = "Paid from",
  defaultAccountId,
}: {
  idPrefix: string;
  accounts: readonly MoneyAccountOption[];
  currency: string;
  fieldError: (name: string) => string | undefined;
  label?: string;
  defaultAccountId?: string;
}) {
  const [accountId, setAccountId] = useState(defaultAccountId ?? accounts[0]?.id ?? "");
  const account = accounts.find((a) => a.id === accountId);
  const methods = METHODS_BY_KIND[account?.kind ?? "CASH"];
  return (
    <>
      <Field id={`${idPrefix}-account`} label={label} error={fieldError("accountId")}>
        <NativeSelect
          id={`${idPrefix}-account`}
          name="accountId"
          value={accountId}
          onChange={(e) => setAccountId(e.target.value)}
          containerClassName="sm:w-full"
          aria-invalid={Boolean(fieldError("accountId"))}
        >
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
        </NativeSelect>
      </Field>
      <Field id={`${idPrefix}-method`} label="How" error={fieldError("method")}>
        <NativeSelect
          key={account?.kind ?? "CASH"}
          id={`${idPrefix}-method`}
          name="method"
          defaultValue={methods[0]}
          containerClassName="sm:w-full"
        >
          {methods.map((m) => (
            <option key={m} value={m}>
              {METHOD_LABELS[m]}
            </option>
          ))}
        </NativeSelect>
      </Field>
      <Field
        id={`${idPrefix}-reference`}
        label="Reference (optional)"
        hint="Cheque number, bKash transaction ID…"
      >
        <Input
          id={`${idPrefix}-reference`}
          name="reference"
          maxLength={120}
          autoComplete="off"
          aria-describedby={`${idPrefix}-reference-hint`}
        />
      </Field>
    </>
  );
}

/**
 * A supplier to pay or to owe, or the buyer or supplier on a journal line: the
 * chosen one with "Change", or a search. Walk-in customers is never offered.
 */
export function AccountsPartyPicker({
  id,
  kind,
  purpose,
  value,
  onChange,
  invalid,
  describedBy,
  autoFocus,
}: {
  id: string;
  kind: "SUPPLIER" | "BUYER";
  purpose: "PAY" | "DUE" | "JOURNAL";
  value: { id: string; code: string; name: string } | null;
  onChange: (party: PartyOption | null) => void;
  invalid?: boolean;
  describedBy?: string;
  autoFocus?: boolean;
}) {
  const noun = kind === "SUPPLIER" ? "the supplier" : "the buyer";
  if (value) {
    return (
      <div className="flex min-w-0 items-center justify-between gap-3 rounded-md border bg-card px-3 py-2">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium">{value.name}</p>
          <p className="truncate text-[0.8125rem] text-muted-foreground">{value.code}</p>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => onChange(null)}
          aria-label={`Change ${noun} (${value.name})`}
        >
          <XIcon aria-hidden />
          Change
        </Button>
      </div>
    );
  }
  return (
    <SearchList<PartyOption>
      id={id}
      label={kind === "SUPPLIER" ? "Find a supplier" : "Find a buyer"}
      placeholder="Name, code or phone"
      invalid={invalid}
      describedBy={describedBy}
      autoFocus={autoFocus}
      search={async (text) => {
        const result = await findAccountsPartiesAction({ kind, purpose, search: text });
        return result.ok ? result.data : result.error.message;
      }}
      onPick={onChange}
      renderOption={(p) => (
        <span className="grid gap-0.5">
          <span className="truncate text-sm font-medium">{p.name}</span>
          <span className="truncate text-[0.8125rem] text-muted-foreground">
            {[p.code, p.phone, p.city].filter(Boolean).join(" · ")}
          </span>
        </span>
      )}
    />
  );
}
