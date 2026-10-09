"use client";

import { BanknoteIcon } from "lucide-react";
import { useState } from "react";

import { FormAlert } from "@/components/forms/field";
import { Button } from "@/components/ui/button";

import { ReceivePaymentDialog } from "./dialogs";

/**
 * "Receive a payment" on the Payments tab: money a buyer paid towards their
 * balance, not for one order. Shown only to Accounts (accounts.receipts.record).
 */
export function ReceiveOnAccount({ currency, today }: { currency: string; today: string }) {
  const [open, setOpen] = useState(false);
  const [notice, setNotice] = useState<string>();
  return (
    <div className="grid gap-3">
      <Button type="button" className="w-full sm:w-auto" onClick={() => setOpen(true)}>
        <BanknoteIcon aria-hidden />
        Receive a payment
      </Button>
      {notice && <FormAlert tone="success">{notice}</FormAlert>}
      {open && (
        <ReceivePaymentDialog
          target={{ onAccount: true }}
          currency={currency}
          today={today}
          onDone={(message) => {
            setNotice(message);
            setOpen(false);
          }}
          onClose={() => setOpen(false)}
        />
      )}
    </div>
  );
}
