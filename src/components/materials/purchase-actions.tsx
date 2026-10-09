"use client";

import { BanIcon, BanknoteIcon, Undo2Icon } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";

import { PaidFromFields } from "@/components/accounts/money-fields";
import { Field, FormAlert } from "@/components/forms/field";
import { dayOrNow, readPositive } from "@/components/production/cost-dialogs";
import { textOf } from "@/components/products/form-values";
import { FormDialog, problem, readReason, ReasonField } from "@/components/sales/dialogs";
import { isZero, money } from "@/components/sales/labels";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import type { PurchaseScreen } from "@/modules/materials/screens.service";
import { payPurchaseAction, voidPurchaseAction } from "@/server/actions/materials.actions";

import { materialsHref } from "./labels";

type Open = "pay" | "void" | null;

/**
 * What can be done with a material purchase, each offered from the flags its
 * screen came with (screen.can, from the materials and production rules):
 * Accounts pays what is due; buyers and Accounts send goods back to the
 * supplier, or void a purchase entered by mistake while nothing went back.
 */
export function PurchaseActions({
  screen,
  currency,
  notice: initialNotice,
}: {
  screen: PurchaseScreen;
  currency: string;
  notice?: string;
}) {
  const [open, setOpen] = useState<Open>(null);
  const [notice, setNotice] = useState(initialNotice);
  const { bill: b, can, today } = screen;
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

  const any = can.pay || can.return || can.void;
  if (!any && !notice) return null;

  return (
    <div className="grid gap-4">
      {any && (
        <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
          {can.pay && (
            <Button type="button" className="w-full sm:w-auto" onClick={() => setOpen("pay")}>
              <BanknoteIcon aria-hidden />
              Pay the supplier
            </Button>
          )}
          {can.return && (
            <Button asChild variant="outline" className="w-full sm:w-auto">
              <Link href={materialsHref.newReturn(b.id)}>
                <Undo2Icon aria-hidden />
                Send goods back
              </Link>
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
              Void the purchase
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
            const accountId = textOf(form, "accountId");
            if (!accountId) return problem({ accountId: "Choose where the money comes from." });
            const result = await payPurchaseAction(b.id, {
              amount,
              accountId,
              method: textOf(form, "method") || "CASH",
              paymentDate: dayOrNow(form, "paymentDate", today),
              reference: textOf(form, "reference") || undefined,
              notes: textOf(form, "notes") || undefined,
            });
            if (!result.ok) return result.error;
            done(`${money(amount.toFixed(2), currency)} was paid to ${b.supplier.name}.`);
          }}
        >
          {(fieldError) =>
            screen.moneyAccounts.length === 0 ? (
              <FormAlert tone="note">
                There is no cash, bank or wallet account to pay from. Add one under Accounts, Cash
                &amp; bank first.
              </FormAlert>
            ) : (
              <>
                <div className="grid items-start gap-5 sm:grid-cols-2">
                  <Field
                    id="pay-amount"
                    label={`Amount (${currency})`}
                    error={fieldError("amount")}
                  >
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
                  <Field id="pay-date" label="Paid on" error={fieldError("paymentDate")}>
                    <Input
                      id="pay-date"
                      name="paymentDate"
                      type="date"
                      defaultValue={today}
                      max={today}
                    />
                  </Field>
                  <PaidFromFields
                    idPrefix="pay"
                    accounts={screen.moneyAccounts}
                    currency={currency}
                    fieldError={fieldError}
                  />
                </div>
                <Field id="pay-notes" label="Notes (optional)">
                  <Textarea id="pay-notes" name="notes" rows={2} maxLength={1000} />
                </Field>
              </>
            )
          }
        </FormDialog>
      )}

      {open === "void" && (
        <FormDialog
          title={`Void ${b.number}?`}
          description={`The goods go back out of ${b.store ?? "the store"} at the bill price and its ${money(
            b.total,
            currency,
          )} comes off ${b.supplier.name}'s account.${
            isZero(b.paid)
              ? ""
              : ` The ${money(b.paid, currency)} already paid stays with them as an advance.`
          } It stays on record as void.`}
          submitLabel="Void the purchase"
          pendingLabel="Voiding"
          destructive
          errorTitle="We could not void the purchase"
          onClose={close}
          onSubmit={async (form) => {
            const reason = readReason(form, 5);
            if (typeof reason !== "string") return reason;
            const result = await voidPurchaseAction(b.id, { reason });
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
