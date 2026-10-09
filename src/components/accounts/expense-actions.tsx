"use client";

import { BanIcon, CheckIcon, PencilIcon, Undo2Icon, XIcon } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import { Field, FormAlert } from "@/components/forms/field";
import { dayOrNow } from "@/components/production/cost-dialogs";
import { textOf } from "@/components/products/form-values";
import { FormDialog, readReason, ReasonField } from "@/components/sales/dialogs";
import { money } from "@/components/sales/labels";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { ExpenseScreen } from "@/modules/expenses/screens.service";
import {
  approveExpenseAction,
  rejectExpenseAction,
  voidExpenseAction,
} from "@/server/actions/expenses.actions";

import { accountsHref } from "./labels";
import { useNotice } from "./money-actions";
import { PaidFromFields } from "./money-fields";

type Open = "approve" | "reject" | "void" | null;

/**
 * What can be done with an expense or claim, each offered from the screen's
 * flags (expenses/rules.ts): Accounts approves a waiting claim (paying a cash
 * claim back, or putting a Due one on the supplier's account) or turns it down;
 * its author can change it or withdraw it while it waits; Accounts voids an
 * expense in the books.
 */
export function ExpenseActions({
  screen,
  currency,
  notice: initialNotice,
}: {
  screen: ExpenseScreen;
  currency: string;
  notice?: string;
}) {
  const [open, setOpen] = useState<Open>(null);
  const [notice, setNotice] = useNotice(initialNotice);
  const { expense: e, can, accounts, today } = screen;
  const close = () => setOpen(null);
  const done = (message: string) => {
    setNotice(message);
    close();
  };
  // Withdrawing is the author's own claim; anyone else turns it down.
  const withdraw = e.own;
  const cashClaim = e.paymentType === "CASH_BANK";
  const amount = money(e.amount, currency);

  if (!can.approve && !can.reject && !can.void && !can.edit && !notice) return null;

  return (
    <div className="grid gap-4">
      {(can.approve || can.reject || can.void || can.edit) && (
        <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
          {can.approve && (
            <Button type="button" className="w-full sm:w-auto" onClick={() => setOpen("approve")}>
              <CheckIcon aria-hidden />
              {cashClaim ? "Approve and pay back" : "Approve"}
            </Button>
          )}
          {can.edit && (
            <Button asChild variant="outline" className="w-full sm:w-auto">
              <Link href={`${accountsHref.expense(e.id)}/edit`}>
                <PencilIcon aria-hidden />
                Change
              </Link>
            </Button>
          )}
          {can.reject && (
            <Button
              type="button"
              variant="outline"
              className="w-full sm:w-auto"
              onClick={() => setOpen("reject")}
            >
              {withdraw ? <Undo2Icon aria-hidden /> : <XIcon aria-hidden />}
              {withdraw ? "Withdraw the claim" : "Turn it down"}
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

      {open === "approve" && (
        <FormDialog
          title={`Approve ${e.number}?`}
          description={
            cashClaim
              ? `${amount} is paid back${e.createdBy ? ` to ${e.createdBy}` : ""} and the expense goes into the books.`
              : `${amount} goes on ${e.supplier?.name ?? "the supplier"}'s account, paid with their other dues.`
          }
          submitLabel={cashClaim ? "Approve and pay" : "Approve"}
          pendingLabel="Approving"
          errorTitle="We could not approve the claim"
          onClose={close}
          onSubmit={async (form) => {
            const result = await approveExpenseAction(
              e.id,
              cashClaim
                ? {
                    accountId: textOf(form, "accountId") || undefined,
                    method: textOf(form, "method") || "CASH",
                    reference: textOf(form, "reference") || undefined,
                    date: dayOrNow(form, "date", today),
                    useAdvance: e.head.requiresEmployee
                      ? form.get("useAdvance") === "on"
                      : undefined,
                  }
                : { reference: textOf(form, "reference") || undefined },
            );
            if (!result.ok) return result.error;
            done(
              cashClaim
                ? `${e.number} was approved and paid back.`
                : `${e.number} was approved and is owed to ${e.supplier?.name ?? "the supplier"}.`,
            );
          }}
        >
          {(fieldError) =>
            cashClaim ? (
              <>
                <div className="grid items-start gap-5 sm:grid-cols-2">
                  <PaidFromFields
                    idPrefix="approve"
                    accounts={accounts}
                    currency={currency}
                    fieldError={fieldError}
                  />
                  <Field id="approve-date" label="Paid on" error={fieldError("date")}>
                    <Input
                      id="approve-date"
                      name="date"
                      type="date"
                      defaultValue={today}
                      max={today}
                    />
                  </Field>
                </div>
                {e.head.requiresEmployee && e.employee && (
                  <label className="flex cursor-pointer items-start gap-2 text-sm">
                    <input
                      type="checkbox"
                      name="useAdvance"
                      defaultChecked
                      className="mt-0.5 size-4 shrink-0 cursor-pointer accent-primary"
                    />
                    Take it from {e.employee.name}&apos;s advance first, if they hold one
                  </label>
                )}
              </>
            ) : (
              <Field id="approve-reference" label="Their bill number (optional)">
                <Input id="approve-reference" name="reference" maxLength={120} autoComplete="off" />
              </Field>
            )
          }
        </FormDialog>
      )}

      {open === "reject" && (
        <FormDialog
          title={withdraw ? `Withdraw ${e.number}?` : `Turn down ${e.number}?`}
          description={
            withdraw
              ? "Accounts will no longer see it as waiting. It stays on record as withdrawn."
              : `${e.createdBy ?? "Its author"} sees why. Nothing is paid and it stays on record.`
          }
          submitLabel={withdraw ? "Withdraw it" : "Turn it down"}
          pendingLabel={withdraw ? "Withdrawing" : "Turning down"}
          destructive
          errorTitle="We could not change the claim"
          onClose={close}
          onSubmit={async (form) => {
            const reason = readReason(form, 5);
            if (typeof reason !== "string") return reason;
            const result = await rejectExpenseAction(e.id, { reason });
            if (!result.ok) return result.error;
            done(withdraw ? `${e.number} was withdrawn.` : `${e.number} was turned down.`);
          }}
        >
          {(fieldError) => <ReasonField id="reject-reason" min={5} error={fieldError("reason")} />}
        </FormDialog>
      )}

      {open === "void" && (
        <FormDialog
          title={`Void ${e.number}?`}
          description={
            e.paymentType === "DUE"
              ? `Its ${amount} comes off ${e.supplier?.name ?? "the supplier"}'s account and out of the expenses. It stays on record as void.`
              : `Its ${amount} goes back into ${e.paidFrom?.name ?? "the account it was paid from"}${
                  /[1-9]/.test(e.fromAdvance) ? " and the employee's advance" : ""
                }, and comes out of the expenses. It stays on record as void.`
          }
          submitLabel="Void it"
          pendingLabel="Voiding"
          destructive
          errorTitle="We could not void the expense"
          onClose={close}
          onSubmit={async (form) => {
            const reason = readReason(form, 5);
            if (typeof reason !== "string") return reason;
            const result = await voidExpenseAction(e.id, { reason });
            if (!result.ok) return result.error;
            done(`${e.number} was voided.`);
          }}
        >
          {(fieldError) => <ReasonField id="void-reason" min={5} error={fieldError("reason")} />}
        </FormDialog>
      )}
    </div>
  );
}
