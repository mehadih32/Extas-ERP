"use client";

import type { PartyKind } from "@prisma/client";
import { LoaderCircleIcon } from "lucide-react";
import { useState, useTransition } from "react";

import { ErrorDialog } from "@/components/feedback/error-dialog";
import { Field, FormAlert } from "@/components/forms/field";
import { AMOUNT_HINT, readAmount, textOf } from "@/components/products/form-values";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { groupAmount } from "@/lib/display";
import type { ActionError } from "@/lib/result";
import { setOpeningBalanceAction } from "@/server/actions/parties.actions";

import { ChoiceList } from "./choice-list";

type Direction = "OWED" | "OWING";

/**
 * The balance brought forward from before the ERP: what the account owed the
 * company (or had paid in advance, or was owed) on the day it starts here. It
 * posts an entry against opening equity; setting it again replaces the earlier
 * one. For accounts.manage, the permission setOpeningBalanceAction checks. A
 * supplier's is always what the company owed it (parties/rules.ts).
 */
export function OpeningBalanceDialog({
  party,
  current,
  currency,
  onSaved,
  onClose,
}: {
  party: { id: string; name: string; kind: PartyKind };
  /** The opening balance now ("-3000.00" when the company owed them). */
  current: string;
  currency: string;
  onSaved: (balance: string) => void;
  onClose: () => void;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<ActionError>();
  const [problem, setProblem] = useState<string>();
  const supplier = party.kind === "SUPPLIER";
  const initial: Direction = current.startsWith("-") || supplier ? "OWING" : "OWED";
  const [direction, setDirection] = useState<Direction>(initial);
  const amountError = problem ?? error?.fieldErrors?.amount?.[0];

  const options = [
    {
      value: "OWED" as const,
      label: `${party.name} owed you`,
      hint: "Unpaid invoices from before.",
    },
    {
      value: "OWING" as const,
      label: `You owed ${party.name}`,
      hint:
        party.kind === "BUYER"
          ? "An advance they had paid you."
          : "Unpaid bills, or an advance they had paid you.",
    },
  ];

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const amount = readAmount(textOf(form, "opening-amount"));
    if (amount === "invalid") {
      setProblem(AMOUNT_HINT);
      return;
    }
    setProblem(undefined);
    const signed = (amount ?? 0) * (direction === "OWING" ? -1 : 1);
    const asOf = textOf(form, "opening-day") || undefined;
    startTransition(async () => {
      const result = await setOpeningBalanceAction(party.id, { amount: signed, asOf });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      onSaved(result.data.balance);
    });
  }

  const shownAmount = /[1-9]/.test(current) ? current.replace("-", "") : "";

  return (
    <Dialog open onOpenChange={(open) => !open && !pending && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Opening balance</DialogTitle>
          <DialogDescription>
            What was owed either way on the day {party.name} starts in the ERP. It goes into the
            books against opening equity, and saving again replaces it.
            {shownAmount &&
              ` It is ${currency} ${groupAmount(shownAmount, currency)} ${current.startsWith("-") ? "owed to them" : "owed to you"} now.`}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="grid gap-5" noValidate>
          {!supplier && (
            <ChoiceList
              name="direction"
              legend="Which way"
              options={options}
              defaultValue={initial}
              onChange={setDirection}
            />
          )}
          <div className="grid gap-5 sm:grid-cols-2">
            <Field
              id="opening-amount"
              label={`Amount (${currency})`}
              hint={supplier ? "What you owed them. 0 removes it." : "0 removes it."}
              error={amountError}
            >
              <Input
                id="opening-amount"
                name="opening-amount"
                inputMode="decimal"
                defaultValue={shownAmount}
                placeholder="0.00"
                autoComplete="off"
                aria-invalid={Boolean(amountError)}
                aria-describedby={amountError ? "opening-amount-error" : "opening-amount-hint"}
                autoFocus
              />
            </Field>
            <Field id="opening-day" label="As of" hint="Today if left empty.">
              <Input
                id="opening-day"
                name="opening-day"
                type="date"
                aria-describedby="opening-day-hint"
              />
            </Field>
          </div>
          {error && error.code !== "INTERNAL" && !error.fieldErrors?.amount && (
            <FormAlert>{error.message}</FormAlert>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose} disabled={pending}>
              Cancel
            </Button>
            <Button type="submit" disabled={pending}>
              {pending && <LoaderCircleIcon className="animate-spin" aria-hidden />}
              {pending ? "Saving" : "Save the opening balance"}
            </Button>
          </DialogFooter>
        </form>
        {error?.code === "INTERNAL" && (
          <ErrorDialog
            code={error.errorId ?? "ERR-UNKNOWN"}
            title="We could not save the opening balance"
            onClose={() => setError(undefined)}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}
