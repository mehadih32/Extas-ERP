"use client";

import {
  BanIcon,
  BanknoteIcon,
  EllipsisVerticalIcon,
  ShoppingCartIcon,
  Undo2Icon,
} from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";

import { PrintDocumentButton } from "@/components/documents/print-button";
import { FormAlert } from "@/components/forms/field";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { ProformaScreen } from "@/modules/sales/screens.service";
import { cancelProformaAction } from "@/server/actions/sales.actions";

import {
  FormDialog,
  readReason,
  ReasonField,
  ReceivePaymentDialog,
  RefundDialog,
  readSettle,
  SettleFields,
} from "./dialogs";
import { isZero, money } from "./labels";

type Open = "receive" | "refund" | "cancel" | null;

/**
 * What can be done with a proforma invoice, each offered from the flags the
 * screen came with (screen.can, from sales/rules.ts): Accounts receives the
 * advance and refunds it; sales.order.create makes the order once the advance is
 * paid; sales.quotation.manage cancels it (settling what was paid needs Accounts'
 * keys too). Everyone who sees it can print it.
 */
export function ProformaActions({
  screen,
  currency,
  today,
  notice: initialNotice,
}: {
  screen: ProformaScreen;
  currency: string;
  today: string;
  notice?: string;
}) {
  const [open, setOpen] = useState<Open>(null);
  const [notice, setNotice] = useState(initialNotice);
  const { proforma: p, can, held } = screen;
  const close = () => setOpen(null);
  const refund = can.refundKinds.length > 0;
  const hasMenu = refund || can.cancel;
  const done = (message: string) => {
    setNotice(message);
    close();
  };

  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(undefined), 10_000);
    return () => clearTimeout(timer);
  }, [notice]);

  return (
    <div className="grid gap-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
        {can.receive && (
          <Button type="button" className="w-full sm:w-auto" onClick={() => setOpen("receive")}>
            <BanknoteIcon aria-hidden />
            {isZero(p.advanceDue) ? "Receive a payment" : "Receive the advance"}
          </Button>
        )}
        {can.convert && (
          <Button
            asChild
            variant={can.receive ? "outline" : "default"}
            className="w-full sm:w-auto"
          >
            <Link href={`/sales/orders/new?proforma=${encodeURIComponent(p.id)}`}>
              <ShoppingCartIcon aria-hidden />
              Make the order
            </Link>
          </Button>
        )}
        <div className="flex gap-2">
          <PrintDocumentButton
            request={{ type: "PROFORMA_INVOICE", id: p.id }}
            label="PDF"
            className="flex-1 sm:flex-none"
            ready={{
              eyebrow: "Proforma invoice",
              description: `${p.number} for ${p.buyer.name}, asking for ${money(p.advanceAmount, currency)} in advance.`,
              errorTitle: "We could not make the proforma PDF",
            }}
          />
          {hasMenu && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="icon" aria-label={`More for ${p.number}`}>
                  <EllipsisVerticalIcon aria-hidden />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-60">
                {refund && (
                  <DropdownMenuItem onSelect={() => setOpen("refund")}>
                    <Undo2Icon aria-hidden />
                    Refund the advance
                  </DropdownMenuItem>
                )}
                {can.cancel && (
                  <>
                    {refund && <DropdownMenuSeparator />}
                    <DropdownMenuItem variant="destructive" onSelect={() => setOpen("cancel")}>
                      <BanIcon aria-hidden />
                      Cancel the proforma
                    </DropdownMenuItem>
                  </>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
      </div>

      {notice && <FormAlert tone="success">{notice}</FormAlert>}

      {open === "receive" && (
        <ReceivePaymentDialog
          target={{ proformaId: p.id, label: p.number }}
          due={isZero(p.advanceDue) ? p.balanceDue : p.advanceDue}
          currency={currency}
          today={today}
          onDone={done}
          onClose={close}
        />
      )}
      {open === "refund" && (
        <RefundDialog
          target={{ proformaId: p.id, label: p.number }}
          kinds={can.refundKinds}
          held={held}
          currency={currency}
          today={today}
          onDone={done}
          onClose={close}
        />
      )}
      {open === "cancel" && (
        <FormDialog
          title={`Cancel ${p.number}?`}
          description={
            isZero(held)
              ? "Nothing was paid on it. It stays on record as cancelled."
              : `${money(held, currency)} was paid on it. Say what happens to that money; a refund voucher is made for it.`
          }
          submitLabel="Cancel the proforma"
          pendingLabel="Cancelling"
          destructive
          errorTitle="We could not cancel the proforma"
          onClose={close}
          onSubmit={async (form) => {
            const reason = readReason(form, 3);
            if (typeof reason !== "string") return reason;
            const result = await cancelProformaAction(p.id, {
              reason,
              ...(isZero(held) ? {} : { settle: readSettle(form) }),
            });
            if (!result.ok) return result.error;
            done(`${p.number} was cancelled.`);
          }}
        >
          {(fieldError) => (
            <>
              {!isZero(held) && (
                <SettleFields
                  idPrefix="cancel"
                  kinds={can.settleKinds}
                  legend="What happens to the advance"
                  fieldError={fieldError}
                />
              )}
              <ReasonField id="cancel-reason" min={3} error={fieldError("reason")} />
            </>
          )}
        </FormDialog>
      )}
    </div>
  );
}
