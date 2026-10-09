"use client";

import { BanIcon, CircleStopIcon, PencilIcon, TruckIcon } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";

import { FormAlert } from "@/components/forms/field";
import { FormDialog, readReason, ReasonField } from "@/components/sales/dialogs";
import { Button } from "@/components/ui/button";
import type { OrderScreen } from "@/modules/materials/screens.service";
import {
  cancelPurchaseOrderAction,
  closePurchaseOrderAction,
} from "@/server/actions/materials.actions";

import { materialsHref } from "./labels";

type Open = "cancel" | "close" | null;

/**
 * What can be done with a purchase order, each offered from the flags its
 * screen came with (screen.can, from materials/rules.ts): buyers and Accounts
 * receive the goods; buyers change it while it is open, cancel it before
 * anything arrives, or close it when the rest will not come.
 */
export function OrderActions({
  screen,
  notice: initialNotice,
}: {
  screen: OrderScreen;
  notice?: string;
}) {
  const [open, setOpen] = useState<Open>(null);
  const [notice, setNotice] = useState(initialNotice);
  const { order: o, can } = screen;
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

  const any = can.receive || can.edit || can.cancel || can.close;
  if (!any && !notice) return null;

  return (
    <div className="grid gap-4">
      {any && (
        <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
          {can.receive && (
            <Button asChild className="w-full sm:w-auto">
              <Link href={materialsHref.newPurchase(o.id)}>
                <TruckIcon aria-hidden />
                Receive the goods
              </Link>
            </Button>
          )}
          {can.edit && (
            <Button asChild variant="outline" className="w-full sm:w-auto">
              <Link href={materialsHref.editOrder(o.id)}>
                <PencilIcon aria-hidden />
                Change
              </Link>
            </Button>
          )}
          {can.close && (
            <Button
              type="button"
              variant="outline"
              className="w-full sm:w-auto"
              onClick={() => setOpen("close")}
            >
              <CircleStopIcon aria-hidden />
              Close: the rest will not come
            </Button>
          )}
          {can.cancel && (
            <Button
              type="button"
              variant="outline"
              className="w-full text-destructive hover:text-destructive sm:w-auto"
              onClick={() => setOpen("cancel")}
            >
              <BanIcon aria-hidden />
              Cancel the order
            </Button>
          )}
        </div>
      )}

      {notice && <FormAlert tone="success">{notice}</FormAlert>}

      {open === "cancel" && (
        <FormDialog
          title={`Cancel ${o.number}?`}
          description={`Nothing has arrived on it. ${o.supplier.name} should be told it is off; it stays on record as cancelled.`}
          submitLabel="Cancel the order"
          pendingLabel="Cancelling"
          destructive
          errorTitle="We could not cancel the order"
          onClose={close}
          onSubmit={async (form) => {
            const reason = readReason(form, 5);
            if (typeof reason !== "string") return reason;
            const result = await cancelPurchaseOrderAction(o.id, { reason });
            if (!result.ok) return result.error;
            done(`${o.number} was cancelled.`);
          }}
        >
          {(fieldError) => <ReasonField id="cancel-reason" min={5} error={fieldError("reason")} />}
        </FormDialog>
      )}

      {open === "close" && (
        <FormDialog
          title={`Close ${o.number}?`}
          description="What has arrived stays received. The rest is no longer expected, and the order stops showing as open or late."
          submitLabel="Close the order"
          pendingLabel="Closing"
          errorTitle="We could not close the order"
          onClose={close}
          onSubmit={async (form) => {
            const reason = readReason(form, 5);
            if (typeof reason !== "string") return reason;
            const result = await closePurchaseOrderAction(o.id, { reason });
            if (!result.ok) return result.error;
            done(`${o.number} was closed.`);
          }}
        >
          {(fieldError) => <ReasonField id="close-reason" min={5} error={fieldError("reason")} />}
        </FormDialog>
      )}
    </div>
  );
}
