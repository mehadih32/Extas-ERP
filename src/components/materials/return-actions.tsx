"use client";

import { BanIcon } from "lucide-react";
import { useEffect, useState } from "react";

import { FormAlert } from "@/components/forms/field";
import { FormDialog, readReason, ReasonField } from "@/components/sales/dialogs";
import { money } from "@/components/sales/labels";
import { Button } from "@/components/ui/button";
import type { ReturnScreen } from "@/modules/materials/screens.service";
import { voidSupplierReturnAction } from "@/server/actions/materials.actions";

/**
 * Voiding a return to a supplier entered by mistake (buyers and Accounts, when
 * screen.can.void): the goods come back into the store and the credit comes
 * off the supplier's account.
 */
export function ReturnActions({
  screen,
  currency,
  notice: initialNotice,
}: {
  screen: ReturnScreen;
  currency: string;
  notice?: string;
}) {
  const [open, setOpen] = useState(false);
  const [notice, setNotice] = useState(initialNotice);
  const { ret: r, can } = screen;

  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(undefined), 10_000);
    return () => clearTimeout(timer);
  }, [notice]);

  if (!can.void && !notice) return null;

  return (
    <div className="grid gap-4">
      {can.void && (
        <div className="flex flex-col gap-2 sm:flex-row">
          <Button
            type="button"
            variant="outline"
            className="w-full text-destructive hover:text-destructive sm:w-auto"
            onClick={() => setOpen(true)}
          >
            <BanIcon aria-hidden />
            Void the return
          </Button>
        </div>
      )}
      {notice && <FormAlert tone="success">{notice}</FormAlert>}
      {open && (
        <FormDialog
          title={`Void ${r.number}?`}
          description={`The goods count as back in ${r.store}, and the ${money(
            r.total,
            currency,
          )} credit comes off ${r.supplier.name}'s account. It stays on record as void.`}
          submitLabel="Void the return"
          pendingLabel="Voiding"
          destructive
          errorTitle="We could not void the return"
          onClose={() => setOpen(false)}
          onSubmit={async (form) => {
            const reason = readReason(form, 5);
            if (typeof reason !== "string") return reason;
            const result = await voidSupplierReturnAction(r.id, { reason });
            if (!result.ok) return result.error;
            setNotice(`${r.number} was voided.`);
            setOpen(false);
          }}
        >
          {(fieldError) => <ReasonField id="void-reason" min={5} error={fieldError("reason")} />}
        </FormDialog>
      )}
    </div>
  );
}
