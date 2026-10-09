"use client";

import { BanIcon } from "lucide-react";
import { useState } from "react";

import { FormAlert } from "@/components/forms/field";
import { FormDialog, readReason, ReasonField } from "@/components/sales/dialogs";
import { money } from "@/components/sales/labels";
import { Button } from "@/components/ui/button";
import type { SupplierPaymentScreen } from "@/modules/accounts/screens.service";
import { voidSupplierPaymentAction } from "@/server/actions/accounts.actions";

import { useNotice } from "./money-actions";

/**
 * Voiding a payment made by mistake (Accounts, accounts/rules.ts): the money
 * goes back into the account it left and the supplier's bills are due again.
 */
export function PaymentActions({
  screen,
  currency,
  notice: initialNotice,
}: {
  screen: SupplierPaymentScreen;
  currency: string;
  notice?: string;
}) {
  const [open, setOpen] = useState(false);
  const [notice, setNotice] = useNotice(initialNotice);
  const { payment: p, can, notes } = screen;
  if (!can.void && !notice && !notes.void) return null;

  return (
    <div className="grid gap-4">
      {can.void && (
        <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
          <Button
            type="button"
            variant="outline"
            className="w-full text-destructive hover:text-destructive sm:w-auto"
            onClick={() => setOpen(true)}
          >
            <BanIcon aria-hidden />
            Void the payment
          </Button>
        </div>
      )}
      {notes.void && <FormAlert tone="note">{notes.void}</FormAlert>}
      {notice && <FormAlert tone="success">{notice}</FormAlert>}
      {open && (
        <FormDialog
          title={`Void ${p.number}?`}
          description={`${money(p.amount, currency)} goes back into ${p.account.name}, and what it paid on ${p.supplier.name}'s bills is owed again. It stays on record as void.`}
          submitLabel="Void the payment"
          pendingLabel="Voiding"
          destructive
          errorTitle="We could not void the payment"
          onClose={() => setOpen(false)}
          onSubmit={async (form) => {
            const reason = readReason(form, 5);
            if (typeof reason !== "string") return reason;
            const result = await voidSupplierPaymentAction(p.id, { reason });
            if (!result.ok) return result.error;
            setNotice(`${p.number} was voided.`);
            setOpen(false);
          }}
        >
          {(fieldError) => <ReasonField id="void-reason" min={5} error={fieldError("reason")} />}
        </FormDialog>
      )}
    </div>
  );
}
