"use client";

import { LockIcon, Undo2Icon } from "lucide-react";
import { useState } from "react";

import { PrintDocumentButton } from "@/components/documents/print-button";
import { FormAlert } from "@/components/forms/field";
import { textOf } from "@/components/products/form-values";
import { Button } from "@/components/ui/button";
import type { SalesReturnScreen } from "@/modules/sales/return-screens.service";
import { voidSalesReturnAction } from "@/server/actions/sales.actions";

import { FormDialog, problem, ReasonField } from "./dialogs";
import { money } from "./labels";

/**
 * What can be done with a credit note: everyone who sees it prints it; Accounts
 * voids one recorded by mistake while the buyer has not used its credit
 * (screen.can.void), which takes the credit back and the pieces out of Damage
 * & QC Rejects.
 */
export function SalesReturnActions({
  screen,
  currency,
}: {
  screen: SalesReturnScreen;
  currency: string;
}) {
  const [voiding, setVoiding] = useState(false);
  const [notice, setNotice] = useState<string>();
  const { salesReturn: r, can, notes } = screen;
  const buyer = r.buyer?.name ?? r.customerName ?? "the buyer";
  const restocked = r.wentTo.stock + r.wentTo.bGrade > 0;

  return (
    <div className="grid gap-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
        <PrintDocumentButton
          request={{ type: "SALES_RETURN", id: r.id }}
          label="PDF"
          ready={{
            eyebrow: "Credit note",
            description: `${r.number} for ${buyer}, on the company letterhead.`,
            errorTitle: "We could not make the credit note PDF",
          }}
        />
        {can.void && (
          <Button
            type="button"
            variant="outline"
            className="w-full sm:w-auto"
            onClick={() => setVoiding(true)}
          >
            <Undo2Icon aria-hidden />
            Void
          </Button>
        )}
      </div>
      {notes.void && (
        <p className="flex items-start gap-2 text-sm text-muted-foreground">
          <LockIcon className="mt-0.5 size-4 shrink-0" aria-hidden />
          {notes.void}
        </p>
      )}
      {notice && <FormAlert tone="success">{notice}</FormAlert>}
      {voiding && (
        <FormDialog
          title={`Void sales return ${r.number}?`}
          description={`Use this when it was recorded by mistake. The ${money(r.total, currency)} credit comes off ${buyer}'s account, ${restocked ? "the pieces put back into stock are taken out again (and any in Damage & QC Rejects leave it)" : `the ${r.pieces} pcs leave Damage & QC Rejects`}, and the credit note stays on record marked void.`}
          submitLabel="Void the return"
          pendingLabel="Voiding"
          destructive
          errorTitle="We could not void the return"
          onClose={() => setVoiding(false)}
          onSubmit={async (form) => {
            const reason = textOf(form, "reason");
            if (reason.length < 5) return problem({ reason: "Write at least 5 letters." });
            const result = await voidSalesReturnAction(r.id, { reason });
            if (!result.ok) return result.error;
            setNotice(`Sales return ${r.number} was voided.`);
            setVoiding(false);
          }}
        >
          {(fieldError) => (
            <ReasonField id="void-return-reason" min={5} error={fieldError("reason")} />
          )}
        </FormDialog>
      )}
    </div>
  );
}
