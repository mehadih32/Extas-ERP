"use client";

import { BanIcon, BanknoteIcon } from "lucide-react";
import { useEffect, useState } from "react";

import { Field, FormAlert } from "@/components/forms/field";
import { textOf } from "@/components/products/form-values";
import { FormDialog, problem, readReason, ReasonField } from "@/components/sales/dialogs";
import { isZero, money } from "@/components/sales/labels";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import type { BillScreen } from "@/modules/production/screens.service";
import { payBillAction, voidBillAction } from "@/server/actions/production.actions";

import { dayOrNow, PayMethodSelect, readPositive } from "./cost-dialogs";

type Open = "pay" | "void" | null;

/**
 * What can be done with a supplier bill, each offered from the flags the
 * screen came with (screen.can, from production/rules.ts): Accounts pays what
 * is due; Production Managers and Accounts void a bill entered by mistake while
 * its projects still hold its cost.
 */
export function BillActions({
  screen,
  currency,
  today,
  notice: initialNotice,
}: {
  screen: BillScreen;
  currency: string;
  today: string;
  notice?: string;
}) {
  const [open, setOpen] = useState<Open>(null);
  const [notice, setNotice] = useState(initialNotice);
  const { bill: b, can, methods } = screen;
  const close = () => setOpen(null);
  const done = (message: string) => {
    setNotice(message);
    close();
  };

  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(undefined), 10_000);
    return () => clearTimeout(timer);
  }, [notice]);

  if (!can.pay && !can.void && !notice) return null;

  return (
    <div className="grid gap-4">
      {(can.pay || can.void) && (
        <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
          {can.pay && (
            <Button type="button" className="w-full sm:w-auto" onClick={() => setOpen("pay")}>
              <BanknoteIcon aria-hidden />
              Pay the supplier
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
              Void the bill
            </Button>
          )}
        </div>
      )}

      {notice && <FormAlert tone="success">{notice}</FormAlert>}

      {open === "pay" && (
        <FormDialog
          title={`Pay ${b.supplier.name}`}
          description={`${money(b.due, currency)} is due on ${b.number}. A payment voucher is made for it.`}
          submitLabel="Record the payment"
          pendingLabel="Recording"
          errorTitle="We could not record the payment"
          onClose={close}
          onSubmit={async (form) => {
            const amount = readPositive(form, "amount");
            if (typeof amount !== "number") return amount;
            if (amount > Number(b.due)) return problem({ amount: `At most ${b.due}.` });
            const result = await payBillAction(b.id, {
              amount,
              method: textOf(form, "method") || "CASH",
              paymentDate: dayOrNow(form, "paymentDate", today),
              reference: textOf(form, "reference") || undefined,
              notes: textOf(form, "notes") || undefined,
            });
            if (!result.ok) return result.error;
            done(`${money(amount.toFixed(2), currency)} was paid to ${b.supplier.name}.`);
          }}
        >
          {(fieldError) => (
            <>
              <div className="grid items-start gap-5 sm:grid-cols-2">
                <Field id="pay-amount" label={`Amount (${currency})`} error={fieldError("amount")}>
                  <Input
                    id="pay-amount"
                    name="amount"
                    inputMode="decimal"
                    defaultValue={b.due}
                    autoComplete="off"
                    aria-invalid={Boolean(fieldError("amount"))}
                    aria-describedby={fieldError("amount") ? "pay-amount-error" : undefined}
                    autoFocus
                  />
                </Field>
                <Field id="pay-method" label="Paid by" error={fieldError("method")}>
                  <PayMethodSelect id="pay-method" methods={methods} />
                </Field>
                <Field
                  id="pay-reference"
                  label="Reference (optional)"
                  hint="Cheque number, bKash transaction ID…"
                >
                  <Input
                    id="pay-reference"
                    name="reference"
                    maxLength={120}
                    autoComplete="off"
                    aria-describedby="pay-reference-hint"
                  />
                </Field>
                <Field id="pay-date" label="Paid on" error={fieldError("paymentDate")}>
                  <Input
                    id="pay-date"
                    name="paymentDate"
                    type="date"
                    defaultValue={today}
                    max={today}
                  />
                </Field>
              </div>
              <Field id="pay-notes" label="Notes (optional)">
                <Textarea id="pay-notes" name="notes" rows={2} maxLength={1000} />
              </Field>
            </>
          )}
        </FormDialog>
      )}

      {open === "void" && (
        <FormDialog
          title={`Void ${b.number}?`}
          description={`Its ${money(b.total, currency)} comes off ${
            b.shares.length > 1 ? "the projects it was shared across" : "its project"
          } and off ${b.supplier.name}'s account.${
            isZero(b.paid)
              ? ""
              : ` The ${money(b.paid, currency)} already paid stays with them as an advance.`
          } It stays on record as void.`}
          submitLabel="Void the bill"
          pendingLabel="Voiding"
          destructive
          errorTitle="We could not void the bill"
          onClose={close}
          onSubmit={async (form) => {
            const reason = readReason(form, 5);
            if (typeof reason !== "string") return reason;
            const result = await voidBillAction(b.id, { reason });
            if (!result.ok) return result.error;
            done(`${b.number} was voided.`);
          }}
        >
          {(fieldError) => <ReasonField id="void-reason" min={5} error={fieldError("reason")} />}
        </FormDialog>
      )}
    </div>
  );
}
