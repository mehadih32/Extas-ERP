"use client";

import {
  ArrowDownToLineIcon,
  ArrowUpFromLineIcon,
  BanIcon,
  PencilIcon,
  ReceiptIcon,
} from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import { FormAlert } from "@/components/forms/field";
import { FormDialog } from "@/components/sales/dialogs";
import { Button } from "@/components/ui/button";
import type { PettyCashScreen } from "@/modules/accounts/petty-cash.service";
import { closePettyCashBoxAction } from "@/server/actions/accounts.actions";

import { pettyCashHref } from "./labels";
import { useNotice } from "./money-actions";
import { MoveMoneyDialog } from "./move-money-dialog";

/**
 * A petty cash box's buttons: record a cost from it (its holder, or Accounts),
 * top it up and take money back (Accounts' payments permission), change its
 * details and close it once it is empty (accounts.manage).
 */
export function PettyCashActions({
  screen,
  currency,
  notice: initialNotice,
}: {
  screen: PettyCashScreen;
  currency: string;
  notice?: string;
}) {
  const [open, setOpen] = useState<"top-up" | "take-back" | "close" | null>(null);
  const [notice, setNotice] = useNotice(initialNotice);
  const { box, can, accounts } = screen;
  const close = () => setOpen(null);
  const done = (message: string) => {
    setNotice(message);
    setOpen(null);
  };
  const any = can.record || can.topUp || can.edit || can.close;
  if (!any && !notice) return null;

  return (
    <div className="grid gap-4">
      {any && (
        <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
          {can.record && (
            <Button asChild className="w-full sm:w-auto">
              <Link href={pettyCashHref.spend(box.id)}>
                <ReceiptIcon aria-hidden />
                Record a cost
              </Link>
            </Button>
          )}
          {can.topUp && (
            <Button
              type="button"
              variant="outline"
              className="w-full sm:w-auto"
              onClick={() => setOpen("top-up")}
            >
              <ArrowDownToLineIcon aria-hidden />
              Top up
            </Button>
          )}
          {can.topUp && can.takeBack && (
            <Button
              type="button"
              variant="outline"
              className="w-full sm:w-auto"
              onClick={() => setOpen("take-back")}
            >
              <ArrowUpFromLineIcon aria-hidden />
              Take money back
            </Button>
          )}
          {can.edit && (
            <Button asChild variant="outline" className="w-full sm:w-auto">
              <Link href={pettyCashHref.edit(box.id)}>
                <PencilIcon aria-hidden />
                Change details
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
              <BanIcon aria-hidden />
              Close the box
            </Button>
          )}
        </div>
      )}
      {notice && <FormAlert tone="success">{notice}</FormAlert>}
      {open === "top-up" && (
        <MoveMoneyDialog
          accounts={accounts}
          currency={currency}
          today={screen.today}
          toId={box.ledgerAccountId}
          locked="to"
          title={`Top up ${box.name}`}
          description="Money from cash, a bank or a wallet into the box. Both balances change; the profit does not."
          submitLabel="Top up"
          defaultAmount={box.shortOfFloat ?? undefined}
          onClose={close}
          onDone={done}
        />
      )}
      {open === "take-back" && (
        <MoveMoneyDialog
          accounts={accounts}
          currency={currency}
          today={screen.today}
          fromId={box.ledgerAccountId}
          locked="from"
          title={`Take money back from ${box.name}`}
          description="Cash the holder hands back, into cash, a bank or a wallet. Take it all back before closing the box."
          submitLabel="Take it back"
          defaultAmount={box.balance}
          onClose={close}
          onDone={done}
        />
      )}
      {open === "close" && (
        <FormDialog
          title={`Close ${box.name}?`}
          description="No more costs can be recorded from it. Its account is archived, and every top-up and cost stays in the books."
          submitLabel="Close the box"
          pendingLabel="Closing"
          destructive
          errorTitle="We could not close the box"
          onClose={close}
          onSubmit={async () => {
            const result = await closePettyCashBoxAction(box.id);
            if (!result.ok) return result.error;
            done(`${box.name} is closed.`);
          }}
        >
          {() => null}
        </FormDialog>
      )}
    </div>
  );
}
