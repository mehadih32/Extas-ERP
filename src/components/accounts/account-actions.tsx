"use client";

import { ArchiveIcon, ArchiveRestoreIcon, PencilIcon, ScaleIcon } from "lucide-react";
import { useState, useTransition } from "react";

import { ActionErrorDialog } from "@/components/feedback/action-error-dialog";
import { Field, FormAlert } from "@/components/forms/field";
import { dayOrNow } from "@/components/production/cost-dialogs";
import { AMOUNT_HINT, readAmount, textOf } from "@/components/products/form-values";
import { FormDialog, problem } from "@/components/sales/dialogs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { ActionError } from "@/lib/result";
import type { AccountScreen } from "@/modules/accounts/screens.service";
import {
  setAccountOpeningBalanceAction,
  updateAccountAction,
} from "@/server/actions/accounts.actions";

import { signedMoney } from "./labels";
import { useNotice } from "./money-actions";

type Open = "rename" | "opening" | null;

/**
 * What can be done with an account, each offered from the screen's flags
 * (accounts.manage): renaming it, archiving or bringing it back, and setting
 * the balance brought forward from before the books started here.
 */
export function AccountActions({
  screen,
  currency,
  notice: initialNotice,
}: {
  screen: AccountScreen;
  currency: string;
  notice?: string;
}) {
  const [open, setOpen] = useState<Open>(null);
  const [notice, setNotice] = useNotice(initialNotice);
  const [error, setError] = useState<ActionError>();
  const [pending, startTransition] = useTransition();
  const { account: a, can, notes, today } = screen;
  const close = () => setOpen(null);
  const any = can.rename || can.archive || can.reactivate || can.openingBalance;

  if (!any && !notes.archive && !notice) return null;

  function setActive(isActive: boolean) {
    startTransition(async () => {
      const result = await updateAccountAction(a.id, { isActive });
      if (!result.ok) return setError(result.error);
      setNotice(isActive ? `${a.name} is back in use.` : `${a.name} is archived.`);
    });
  }

  return (
    <div className="grid gap-4">
      {any && (
        <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
          {can.openingBalance && (
            <Button
              type="button"
              variant="outline"
              className="w-full sm:w-auto"
              onClick={() => setOpen("opening")}
            >
              <ScaleIcon aria-hidden />
              Balance brought forward
            </Button>
          )}
          {can.rename && (
            <Button
              type="button"
              variant="outline"
              className="w-full sm:w-auto"
              onClick={() => setOpen("rename")}
            >
              <PencilIcon aria-hidden />
              Rename
            </Button>
          )}
          {can.archive && (
            <Button
              type="button"
              variant="outline"
              className="w-full sm:w-auto"
              disabled={pending}
              onClick={() => setActive(false)}
            >
              <ArchiveIcon aria-hidden />
              Archive
            </Button>
          )}
          {can.reactivate && (
            <Button
              type="button"
              variant="outline"
              className="w-full sm:w-auto"
              disabled={pending}
              onClick={() => setActive(true)}
            >
              <ArchiveRestoreIcon aria-hidden />
              Bring back into use
            </Button>
          )}
        </div>
      )}
      {notes.archive && <FormAlert tone="note">{notes.archive}</FormAlert>}
      {notice && <FormAlert tone="success">{notice}</FormAlert>}

      {open === "rename" && (
        <FormDialog
          title={`Rename ${a.name}`}
          description="Its code, kind and entries stay the same."
          submitLabel="Save"
          pendingLabel="Saving"
          errorTitle="We could not rename the account"
          onClose={close}
          onSubmit={async (form) => {
            const name = textOf(form, "name");
            if (name.length < 2) return problem({ name: "Give it a name." });
            const result = await updateAccountAction(a.id, { name });
            if (!result.ok) return result.error;
            setNotice(`Renamed to ${result.data.name}.`);
            close();
          }}
        >
          {(fieldError) => (
            <Field id="rename-name" label="Name" error={fieldError("name")}>
              <Input
                id="rename-name"
                name="name"
                defaultValue={a.name}
                maxLength={120}
                autoComplete="off"
                aria-invalid={Boolean(fieldError("name"))}
                aria-describedby={fieldError("name") ? "rename-name-error" : undefined}
                autoFocus
              />
            </Field>
          )}
        </FormDialog>
      )}

      {open === "opening" && (
        <FormDialog
          title="Balance brought forward"
          description={`What ${a.name} held on the day the books started here. It is now ${signedMoney(
            a.openingBalance,
            currency,
          )}; saving replaces it, against Opening Balance Equity.`}
          submitLabel="Save the balance"
          pendingLabel="Saving"
          errorTitle="We could not set the balance"
          onClose={close}
          onSubmit={async (form) => {
            const amount = readAmount(textOf(form, "amount"));
            if (amount === "invalid") return problem({ amount: AMOUNT_HINT });
            const below = form.get("below") === "on";
            const result = await setAccountOpeningBalanceAction(a.id, {
              amount: below ? -(amount ?? 0) : (amount ?? 0),
              asOf: dayOrNow(form, "asOf", today),
            });
            if (!result.ok) return result.error;
            setNotice(`The balance brought forward for ${a.name} was saved.`);
            close();
          }}
        >
          {(fieldError) => (
            <>
              <div className="grid items-start gap-5 sm:grid-cols-2">
                <Field
                  id="opening-amount"
                  label={`Amount (${currency})`}
                  error={fieldError("amount")}
                >
                  <Input
                    id="opening-amount"
                    name="amount"
                    inputMode="decimal"
                    placeholder="0.00"
                    defaultValue={a.openingBalance.replace(/^-/, "")}
                    autoComplete="off"
                    aria-invalid={Boolean(fieldError("amount"))}
                    aria-describedby={fieldError("amount") ? "opening-amount-error" : undefined}
                    autoFocus
                  />
                </Field>
                <Field id="opening-date" label="As of" error={fieldError("asOf")}>
                  <Input
                    id="opening-date"
                    name="asOf"
                    type="date"
                    defaultValue={today}
                    max={today}
                  />
                </Field>
              </div>
              <label className="flex cursor-pointer items-start gap-2 text-sm">
                <input
                  type="checkbox"
                  name="below"
                  defaultChecked={a.openingBalance.startsWith("-")}
                  className="mt-0.5 size-4 shrink-0 cursor-pointer accent-primary"
                />
                <span>
                  It was below zero
                  <span className="block text-[0.8125rem] text-muted-foreground">
                    Like a wallet or cash box that was overdrawn.
                  </span>
                </span>
              </label>
            </>
          )}
        </FormDialog>
      )}

      <ActionErrorDialog
        error={error}
        title="We could not change the account"
        onClose={() => setError(undefined)}
      />
    </div>
  );
}
