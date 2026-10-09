"use client";

import { ArrowLeftRightIcon, ArchiveIcon, ArchiveRestoreIcon, PencilIcon } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import { FormAlert } from "@/components/forms/field";
import { FormDialog } from "@/components/sales/dialogs";
import { Button } from "@/components/ui/button";
import type { BankScreen } from "@/modules/accounts/screens.service";
import { updateBankAccountAction } from "@/server/actions/accounts.actions";

import { accountsHref } from "./labels";
import { useNotice } from "./money-actions";
import { MoveMoneyDialog } from "./move-money-dialog";

type Open = "move" | "close" | "reopen" | null;

/**
 * What can be done with a bank account, each offered from the screen's flags
 * (accounts/rules.ts): Accounts moves money in or out of it, and people who
 * keep the books change its details, close it once it is empty, or reopen it.
 */
export function BankActions({
  screen,
  currency,
  today,
}: {
  screen: BankScreen;
  currency: string;
  today: string;
}) {
  const [open, setOpen] = useState<Open>(null);
  const [notice, setNotice] = useNotice();
  const { bank: b, can, notes, moneyAccounts: accounts } = screen;
  const close = () => setOpen(null);
  const done = (message: string) => {
    setNotice(message);
    close();
  };
  const name = `${b.bankName} ${b.accountNumber}`;
  const move = can.transfer;

  if (!move && !can.edit && !can.close && !can.reopen && !notice && !notes.close) return null;

  return (
    <div className="grid gap-4">
      {(move || can.edit || can.close || can.reopen) && (
        <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
          {move && (
            <Button type="button" className="w-full sm:w-auto" onClick={() => setOpen("move")}>
              <ArrowLeftRightIcon aria-hidden />
              Move money
            </Button>
          )}
          {can.edit && (
            <Button asChild variant="outline" className="w-full sm:w-auto">
              <Link href={`${accountsHref.bank(b.id)}/edit`}>
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
              <ArchiveIcon aria-hidden />
              Close the account
            </Button>
          )}
          {can.reopen && (
            <Button
              type="button"
              variant="outline"
              className="w-full sm:w-auto"
              onClick={() => setOpen("reopen")}
            >
              <ArchiveRestoreIcon aria-hidden />
              Reopen
            </Button>
          )}
        </div>
      )}
      {notes.close && <FormAlert tone="note">{notes.close}</FormAlert>}
      {notice && <FormAlert tone="success">{notice}</FormAlert>}

      {open === "move" && (
        <MoveMoneyDialog
          accounts={accounts}
          currency={currency}
          today={today}
          fromId={b.ledgerAccount.id}
          onClose={close}
          onDone={done}
        />
      )}
      {(open === "close" || open === "reopen") && (
        <FormDialog
          title={open === "close" ? `Close ${name}?` : `Reopen ${name}?`}
          description={
            open === "close"
              ? "It stays on record with its statement, but is no longer offered for payments or transfers."
              : "It is offered again for payments, receipts and transfers."
          }
          submitLabel={open === "close" ? "Close the account" : "Reopen the account"}
          pendingLabel={open === "close" ? "Closing" : "Reopening"}
          errorTitle={
            open === "close" ? "We could not close the account" : "We could not reopen the account"
          }
          onClose={close}
          onSubmit={async () => {
            const result = await updateBankAccountAction(b.id, { isActive: open === "reopen" });
            if (!result.ok) return result.error;
            done(open === "close" ? `${name} was closed.` : `${name} was reopened.`);
          }}
        >
          {() => null}
        </FormDialog>
      )}
    </div>
  );
}
