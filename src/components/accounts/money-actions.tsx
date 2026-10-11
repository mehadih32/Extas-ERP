"use client";

import { ArrowDownUpIcon, ArrowLeftRightIcon, BanknoteIcon, PlusIcon } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";

import { FormAlert } from "@/components/forms/field";
import { Button } from "@/components/ui/button";
import type { MoneyInOutOptions } from "@/modules/accounts/money-in-out.service";

import { accountsHref } from "./labels";
import { MoneyInOutDialog } from "./money-in-out-dialog";
import { type MoveMoneyAccount, MoveMoneyDialog } from "./move-money-dialog";

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
 * accounts and pay a supplier (Accounts' payments permission), money in/out
 * (owner's funds and bank charges), and add a bank account (accounts.manage).
 * Each is offered from the screen's flags.
 */
export function MoneyActions({
  accounts,
  currency,
  today,
  can,
  fromId,
  moneyInOut,
}: {
  accounts: readonly MoveMoneyAccount[];
  currency: string;
  today: string;
  can: { transfer: boolean; paySupplier?: boolean; addBank?: boolean };
  /** The account money leaves by default (a bank account's own page). */
  fromId?: string;
  /** Add fund, withdraw and bank charge, when this person may record any of them. */
  moneyInOut?: MoneyInOutOptions | null;
}) {
  const [open, setOpen] = useState<"move" | "in-out" | null>(null);
  const [notice, setNotice] = useNotice();
  const transfer = can.transfer && accounts.length >= 2;
  const inOut = Boolean(moneyInOut) && accounts.length > 0;
  if (!transfer && !inOut && !can.paySupplier && !can.addBank && !notice) return null;
  const done = (message: string) => {
    setNotice(message);
    setOpen(null);
  };

  return (
    <div className="grid gap-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
        {transfer && (
          <Button type="button" className="w-full sm:w-auto" onClick={() => setOpen("move")}>
            <ArrowLeftRightIcon aria-hidden />
            Move money
          </Button>
        )}
        {inOut && (
          <Button
            type="button"
            variant="outline"
            className="w-full sm:w-auto"
            onClick={() => setOpen("in-out")}
          >
            <ArrowDownUpIcon aria-hidden />
            Money in/out
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
      {open === "move" && (
        <MoveMoneyDialog
          accounts={accounts}
          currency={currency}
          today={today}
          fromId={fromId}
          onClose={() => setOpen(null)}
          onDone={done}
        />
      )}
      {open === "in-out" && moneyInOut && (
        <MoneyInOutDialog
          options={moneyInOut}
          accounts={accounts}
          currency={currency}
          today={today}
          onClose={() => setOpen(null)}
          onDone={done}
        />
      )}
    </div>
  );
}
