"use client";

import { BanIcon, PencilIcon, Undo2Icon } from "lucide-react";
import { useState } from "react";

import { PaidFromFields } from "@/components/accounts/money-fields";
import { Field, FormAlert } from "@/components/forms/field";
import { ChoiceList } from "@/components/parties/choice-list";
import { AMOUNT_HINT, readAmount, textOf } from "@/components/products/form-values";
import { FormDialog, problem, readReason, ReasonField } from "@/components/sales/dialogs";
import { money } from "@/components/sales/labels";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { formatMonth } from "@/lib/display";
import type { AdvanceScreen } from "@/modules/hr/screens.service";
import {
  returnAdvanceAction,
  updateAdvanceAction,
  voidAdvanceAction,
  voidAdvanceReturnAction,
} from "@/server/actions/hr.actions";

import { shiftMonth } from "./labels";
import { useNotice } from "./use-notice";

type Open = "change" | "return" | "void" | null;
type Settlement = AdvanceScreen["advance"]["settlements"][number];

/**
 * What can be done with a salary advance, each offered from the flags its
 * screen came with (screen.can, from hr/rules.ts): change how it is taken back
 * (Accounts or payroll), take unspent money back in cash (Accounts), or void
 * one recorded by mistake before anything settled it.
 */
export function AdvanceActions({
  screen,
  currency,
  notice: initial,
}: {
  screen: AdvanceScreen;
  currency: string;
  notice?: string;
}) {
  const [open, setOpen] = useState<Open>(null);
  const [notice, setNotice] = useNotice(initial);
  const [plan, setPlan] = useState<"all" | "monthly">(
    screen.advance.installmentAmount ? "monthly" : "all",
  );
  const { advance: a, can } = screen;
  const close = () => setOpen(null);
  const done = (message: string) => {
    setNotice(message);
    close();
  };
  const any = can.change || can.takeBack || can.void;
  if (!any && !notice) return null;
  const months = [0, 1, 2, 3, 4, 5, 6].map((n) => shiftMonth(screen.today.slice(0, 7), n));
  if (!months.includes(a.recoverFrom)) months.unshift(a.recoverFrom);

  return (
    <div className="grid gap-4">
      {any && (
        <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
          {can.takeBack && (
            <Button type="button" className="w-full sm:w-auto" onClick={() => setOpen("return")}>
              <Undo2Icon aria-hidden />
              Money returned
            </Button>
          )}
          {can.change && (
            <Button
              type="button"
              variant="outline"
              className="w-full sm:w-auto"
              onClick={() => {
                setPlan(a.installmentAmount ? "monthly" : "all");
                setOpen("change");
              }}
            >
              <PencilIcon aria-hidden />
              Change how it is taken back
            </Button>
          )}
          {can.void && (
            <Button
              type="button"
              variant="outline"
              className="w-full text-destructive hover:text-destructive sm:w-auto"
              onClick={() => setOpen("void")}
            >
              <BanIcon aria-hidden />
              Void
            </Button>
          )}
        </div>
      )}

      {notice && <FormAlert tone="success">{notice}</FormAlert>}

      {open === "change" && (
        <FormDialog
          title={`How ${a.number} is taken back`}
          description={`${money(a.outstanding, currency)} is still owed. Payroll takes it from ${a.employee.name}'s salary as set here.`}
          submitLabel="Save"
          pendingLabel="Saving"
          errorTitle="We could not change the advance"
          onClose={close}
          onSubmit={async (form) => {
            const installment =
              plan === "monthly" ? readAmount(textOf(form, "installmentAmount")) : null;
            if (plan === "monthly" && (installment === null || installment === 0)) {
              return problem({ installmentAmount: "Enter how much comes off each salary." });
            }
            if (installment === "invalid") return problem({ installmentAmount: AMOUNT_HINT });
            const result = await updateAdvanceAction(a.id, {
              installmentAmount: installment,
              recoverFrom: textOf(form, "recoverFrom") || null,
              purpose: textOf(form, "purpose") || null,
            });
            if (!result.ok) return result.error;
            done(`${a.number} was changed.`);
          }}
        >
          {(fieldError) => (
            <>
              <ChoiceList
                name="plan"
                legend="Taken back"
                defaultValue={plan}
                onChange={setPlan}
                options={[
                  { value: "all", label: "All at once" },
                  { value: "monthly", label: "So much a month" },
                ]}
              />
              <div className="grid items-start gap-5 sm:grid-cols-2">
                {plan === "monthly" && (
                  <Field
                    id="change-installment"
                    label={`Each month (${currency})`}
                    error={fieldError("installmentAmount")}
                  >
                    <Input
                      id="change-installment"
                      name="installmentAmount"
                      inputMode="decimal"
                      autoComplete="off"
                      defaultValue={a.installmentAmount ?? ""}
                      aria-invalid={Boolean(fieldError("installmentAmount"))}
                    />
                  </Field>
                )}
                <Field
                  id="change-from"
                  label="Starting with the payroll for"
                  error={fieldError("recoverFrom")}
                >
                  <NativeSelect
                    id="change-from"
                    name="recoverFrom"
                    defaultValue={a.recoverFrom}
                    containerClassName="sm:w-full"
                  >
                    {months.map((m) => (
                      <option key={m} value={m}>
                        {formatMonth(m)}
                      </option>
                    ))}
                  </NativeSelect>
                </Field>
              </div>
              <Field id="change-purpose" label="What for (optional)" error={fieldError("purpose")}>
                <Textarea
                  id="change-purpose"
                  name="purpose"
                  rows={2}
                  maxLength={300}
                  defaultValue={a.purpose ?? undefined}
                />
              </Field>
            </>
          )}
        </FormDialog>
      )}

      {open === "return" && (
        <FormDialog
          title={`Money returned on ${a.number}`}
          description={`${a.employee.name} gives back unspent money. ${money(a.outstanding, currency)} is still owed.`}
          submitLabel="Record it"
          pendingLabel="Recording"
          errorTitle="We could not record the return"
          onClose={close}
          onSubmit={async (form) => {
            const amount = readAmount(textOf(form, "amount"));
            if (amount === null || amount === 0) return problem({ amount: "Enter the amount." });
            if (amount === "invalid") return problem({ amount: AMOUNT_HINT });
            if (amount > Number(a.outstanding)) {
              return problem({ amount: `At most ${a.outstanding}.` });
            }
            const date = textOf(form, "date");
            const result = await returnAdvanceAction(a.id, {
              amount,
              accountId: textOf(form, "accountId") || undefined,
              method: textOf(form, "method") || "CASH",
              reference: textOf(form, "reference") || null,
              note: textOf(form, "note") || null,
              date: date && date !== screen.today ? date : undefined,
            });
            if (!result.ok) return result.error;
            done(`${money(amount.toFixed(2), currency)} was taken back on ${a.number}.`);
          }}
        >
          {(fieldError) => (
            <>
              <div className="grid items-start gap-5 sm:grid-cols-2">
                <Field
                  id="return-amount"
                  label={`Amount (${currency})`}
                  error={fieldError("amount")}
                >
                  <Input
                    id="return-amount"
                    name="amount"
                    inputMode="decimal"
                    autoComplete="off"
                    defaultValue={a.outstanding}
                    aria-invalid={Boolean(fieldError("amount"))}
                    aria-describedby={fieldError("amount") ? "return-amount-error" : undefined}
                  />
                </Field>
                <Field id="return-date" label="Returned on" error={fieldError("date")}>
                  <Input
                    id="return-date"
                    name="date"
                    type="date"
                    defaultValue={screen.today}
                    max={screen.today}
                  />
                </Field>
                <PaidFromFields
                  idPrefix="return"
                  label="Received into"
                  accounts={screen.moneyAccounts}
                  currency={currency}
                  fieldError={fieldError}
                />
              </div>
              <Field id="return-note" label="Note (optional)" error={fieldError("note")}>
                <Input id="return-note" name="note" maxLength={300} autoComplete="off" />
              </Field>
            </>
          )}
        </FormDialog>
      )}

      {open === "void" && (
        <FormDialog
          title={`Void ${a.number}?`}
          description={
            a.isOpening
              ? "The amount brought forward is removed from what the employee owes."
              : `The ${money(a.amount, currency)} goes back into ${a.paidFrom?.name ?? "the account it came from"}, and the employee no longer owes it.`
          }
          submitLabel="Void the advance"
          pendingLabel="Voiding"
          destructive
          errorTitle="We could not void the advance"
          onClose={close}
          onSubmit={async (form) => {
            const reason = readReason(form, 5);
            if (typeof reason !== "string") return reason;
            const result = await voidAdvanceAction(a.id, { reason });
            if (!result.ok) return result.error;
            done(`${a.number} was voided.`);
          }}
        >
          {(fieldError) => <ReasonField id="void-reason" min={5} error={fieldError("reason")} />}
        </FormDialog>
      )}
    </div>
  );
}

/** Undoing money returned in cash that was recorded by mistake (Accounts, both money keys). */
export function UndoReturn({
  advanceId,
  settlement,
  currency,
}: {
  advanceId: string;
  settlement: Settlement;
  currency: string;
}) {
  const [open, setOpen] = useState(false);
  const [notice, setNotice] = useNotice();
  return (
    <>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="text-destructive hover:text-destructive"
        onClick={() => setOpen(true)}
      >
        Undo
      </Button>
      {notice && (
        <span className="sr-only" role="status">
          {notice}
        </span>
      )}
      {open && (
        <FormDialog
          title="Undo this return?"
          description={`The ${money(settlement.amount, currency)} returned is taken out of the account again, and the employee owes it again.`}
          submitLabel="Undo the return"
          pendingLabel="Undoing"
          destructive
          errorTitle="We could not undo the return"
          onClose={() => setOpen(false)}
          onSubmit={async (form) => {
            const reason = readReason(form, 5);
            if (typeof reason !== "string") return reason;
            const result = await voidAdvanceReturnAction(advanceId, settlement.id, { reason });
            if (!result.ok) return result.error;
            setOpen(false);
            setNotice("The return was undone.");
          }}
        >
          {(fieldError) => <ReasonField id="undo-reason" min={5} error={fieldError("reason")} />}
        </FormDialog>
      )}
    </>
  );
}
