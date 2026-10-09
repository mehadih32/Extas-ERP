"use client";

import { ArrowLeftRightIcon, BanknoteIcon, PlusIcon } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";

import { FormAlert } from "@/components/forms/field";
import { Button } from "@/components/ui/button";
import type { MoneyAccountOption } from "@/modules/accounts/screens.service";

import { accountsHref } from "./labels";
import { MoveMoneyDialog } from "./move-money-dialog";

/** Shows a success message for ten seconds after a change. */
export function useNotice(initial?: string) {
  const [notice, setNotice] = useState(initial);
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(undefined), 10_000);
    return () => clearTimeout(timer);
  }, [notice]);
  return [notice, setNotice] as const;
}

/**
 * The money buttons above the Overview and Cash & bank: move money between
 * accounts and pay a supplier (Accounts' payments permission), and add a bank
 * account (accounts.manage). Each is offered from the screen's flags.
 */
export function MoneyActions({
  accounts,
  currency,
  today,
  can,
  fromId,
}: {
  accounts: readonly MoneyAccountOption[];
  currency: string;
  today: string;
  can: { transfer: boolean; paySupplier?: boolean; addBank?: boolean };
  /** The account money leaves by default (a bank account's own page). */
  fromId?: string;
}) {
  const [open, setOpen] = useState(false);
  const [notice, setNotice] = useNotice();
  const transfer = can.transfer && accounts.length >= 2;
  if (!transfer && !can.paySupplier && !can.addBank && !notice) return null;

  return (
    <div className="grid gap-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
        {transfer && (
          <Button type="button" className="w-full sm:w-auto" onClick={() => setOpen(true)}>
            <ArrowLeftRightIcon aria-hidden />
            Move money
          </Button>
        )}
        {can.paySupplier && (
          <Button asChild variant="outline" className="w-full sm:w-auto">
            <Link href={accountsHref.pay()}>
              <BanknoteIcon aria-hidden />
              Pay a supplier
            </Link>
          </Button>
        )}
        {can.addBank && (
          <Button asChild variant="outline" className="w-full sm:w-auto">
            <Link href="/accounts/cash-bank/new">
              <PlusIcon aria-hidden />
              Add a bank account
            </Link>
          </Button>
        )}
      </div>
      {notice && <FormAlert tone="success">{notice}</FormAlert>}
      {open && (
        <MoveMoneyDialog
          accounts={accounts}
          currency={currency}
          today={today}
          fromId={fromId}
          onClose={() => setOpen(false)}
          onDone={(message) => {
            setNotice(message);
            setOpen(false);
          }}
        />
      )}
    </div>
  );
}
