"use client";

import { useState } from "react";

import { FormAlert } from "@/components/forms/field";
import { ChoiceList } from "@/components/parties/choice-list";
import { formatCount } from "@/lib/display";
import type { VoidChoice } from "@/modules/sales/screens.service";
import { voidInvoiceAction } from "@/server/actions/sales.actions";

import { FormDialog, readReason, readSettle, ReasonField, SettleFields } from "./dialogs";
import { isZero, money } from "./labels";

type After = "cancel" | "keep";

/**
 * Voids an invoice (Safe Void). By default its order is cancelled too: the
 * pieces held are freed, delivered pieces come back into stock at their cost,
 * the sale comes off the books and money held is settled. Or the order is kept
 * open to be corrected and invoiced again, as before.
 */
export function VoidInvoiceDialog({
  invoice,
  orderNumber,
  choice,
  currency,
  onDone,
  onClose,
}: {
  invoice: { id: string; number: string };
  orderNumber: string;
  choice: VoidChoice;
  currency: string;
  onDone: (message: string) => void;
  onClose: () => void;
}) {
  const [after, setAfter] = useState<After>(choice.cancel ? "cancel" : "keep");
  const held = !isZero(choice.held);
  const pieces = formatCount(choice.delivered, currency);
  const cancelHint =
    choice.delivered > 0
      ? `The ${pieces} pieces delivered come back into stock at their cost, and the sale and its cost of goods come off the books.`
      : "The pieces held for it go back to stock and the sale comes off the books.";

  return (
    <FormDialog
      title={`Void invoice ${invoice.number}?`}
      description="The buyer no longer owes it. Invoices are never deleted: the voided one stays on record, marked Void."
      submitLabel={after === "cancel" ? "Void and cancel" : "Void the invoice"}
      pendingLabel="Voiding"
      destructive
      errorTitle="We could not void the invoice"
      onClose={onClose}
      onSubmit={async (form) => {
        const reason = readReason(form, 5);
        if (typeof reason !== "string") return reason;
        const cancel = after === "cancel";
        const result = await voidInvoiceAction(invoice.id, {
          reason,
          ...(cancel ? { cancelOrder: true, ...(held ? { settle: readSettle(form) } : {}) } : {}),
        });
        if (!result.ok) return result.error;
        onDone(
          cancel
            ? `Invoice ${invoice.number} was voided and ${orderNumber} cancelled${
                choice.delivered > 0 ? `; ${pieces} pieces are back in stock` : ""
              }.`
            : `Invoice ${invoice.number} was voided. ${orderNumber} stays open to be corrected.`,
        );
      }}
    >
      {(fieldError) => (
        <>
          {choice.cancel ? (
            <ChoiceList<After>
              name="after"
              legend={`What happens to ${orderNumber}`}
              defaultValue={after}
              onChange={setAfter}
              options={[
                { value: "cancel", label: "Cancel the order", hint: cancelHint },
                {
                  value: "keep",
                  label: "Keep the order to correct it",
                  hint: "The order stays open, so it can be edited and invoiced again. Its stock stays with it.",
                },
              ]}
            />
          ) : (
            <FormAlert tone="note">
              {orderNumber} stays open, so it can be edited and invoiced again.
              {choice.note ? ` ${choice.note}` : ""}
            </FormAlert>
          )}
          {after === "cancel" && held && (
            <>
              <p className="text-sm text-muted-foreground">
                {money(choice.held, currency)} was paid on it: say what happens to that money.
              </p>
              <SettleFields idPrefix="void" kinds={choice.settleKinds} fieldError={fieldError} />
            </>
          )}
          <ReasonField id="void-reason" min={5} error={fieldError("reason")} />
        </>
      )}
    </FormDialog>
  );
}
