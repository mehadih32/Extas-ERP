"use client";

import { Undo2Icon } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import { PrintDocumentButton } from "@/components/documents/print-button";
import { FormAlert } from "@/components/forms/field";
import { textOf } from "@/components/products/form-values";
import { Button } from "@/components/ui/button";
import { formatDay } from "@/lib/display";
import type { ChequeStatus, PaymentMethod, RefundKind } from "@prisma/client";
import { voidRefundAction } from "@/server/actions/sales.actions";

import { ChequeBadge, RefundBadge } from "./badges";
import { Panel } from "./detail-bits";
import { FormDialog, problem, ReasonField } from "./dialogs";
import { METHOD_LABELS, money, salesHref } from "./labels";

type PaymentLine = {
  id: string;
  number: string;
  amount: string;
  method: PaymentMethod;
  paidOn: string;
  reference: string | null;
};

type RefundLine = {
  id: string;
  number: string;
  kind: RefundKind;
  amount: string;
  method: PaymentMethod | null;
  refundedOn: string;
  reason: string | null;
  voided: boolean;
  can: { void: boolean };
};

type CreditLine = {
  id: string;
  amount: string;
  usedOn: string;
  payment: { id: string; number: string } | null;
};

type ChequeLine = {
  id: string;
  chequeNo: string;
  bankName: string | null;
  amount: string;
  status: ChequeStatus;
  chequeDate: string;
  payment: { id: string; number: string } | null;
};

/**
 * The money receipts and refunds on an order or a proforma, the buyer's credit
 * used on it and the cheques taken for it. Every receipt opens its page; a
 * refund prints its voucher, and Accounts can void one recorded by mistake
 * while the money is still on the record (refund.can.void). A pending cheque
 * is listed but not counted until it clears.
 */
export function MoneyRecords({
  payments,
  refunds,
  credits = [],
  cheques = [],
  currency,
  empty,
}: {
  payments: PaymentLine[];
  refunds: RefundLine[];
  credits?: CreditLine[];
  cheques?: ChequeLine[];
  currency: string;
  /** What shows when nothing was paid yet. */
  empty: string;
}) {
  const [voiding, setVoiding] = useState<RefundLine | null>(null);
  const [notice, setNotice] = useState<string>();

  return (
    <Panel title="Payments" id="payments-heading">
      {notice && (
        <div className="mt-4">
          <FormAlert tone="success">{notice}</FormAlert>
        </div>
      )}
      {payments.length === 0 &&
      refunds.length === 0 &&
      credits.length === 0 &&
      cheques.length === 0 ? (
        <p className="mt-4 text-sm text-muted-foreground">{empty}</p>
      ) : (
        <ul className="mt-4 grid grid-cols-1 divide-y">
          {payments.map((p) => (
            <li
              key={p.id}
              className="flex min-w-0 items-start justify-between gap-4 py-3 first:pt-0"
            >
              <div className="min-w-0">
                <Link
                  href={salesHref.payment(p.id)}
                  className="text-sm font-medium text-primary underline-offset-4 hover:underline"
                >
                  {p.number}
                </Link>
                <p className="text-[0.8125rem] text-muted-foreground">
                  {[formatDay(p.paidOn), METHOD_LABELS[p.method], p.reference]
                    .filter(Boolean)
                    .join(" · ")}
                </p>
              </div>
              <p className="text-sm font-medium whitespace-nowrap tabular-nums">
                {money(p.amount, currency)}
              </p>
            </li>
          ))}
          {credits.map((c) => (
            <li
              key={c.id}
              className="flex min-w-0 items-start justify-between gap-4 py-3 first:pt-0"
            >
              <div className="min-w-0">
                <p className="text-sm font-medium">Credit used</p>
                <p className="text-[0.8125rem] text-muted-foreground">
                  {formatDay(c.usedOn)} ·{" "}
                  {c.payment ? (
                    <Link
                      href={salesHref.payment(c.payment.id)}
                      className="text-primary underline-offset-4 hover:underline"
                    >
                      from {c.payment.number}
                    </Link>
                  ) : (
                    "from the advance balance"
                  )}
                </p>
              </div>
              <p className="text-sm font-medium whitespace-nowrap tabular-nums">
                {money(c.amount, currency)}
              </p>
            </li>
          ))}
          {cheques.map((c) => (
            <li
              key={c.id}
              className="flex min-w-0 items-start justify-between gap-4 py-3 first:pt-0"
            >
              <div className="min-w-0">
                <p className="flex flex-wrap items-center gap-2 text-sm font-medium">
                  Cheque {c.chequeNo}
                  <ChequeBadge status={c.status} />
                </p>
                <p className="text-[0.8125rem] text-muted-foreground">
                  {[c.bankName, `dated ${formatDay(c.chequeDate)}`].filter(Boolean).join(" · ")}
                  {c.payment && (
                    <>
                      {" · "}
                      <Link
                        href={salesHref.payment(c.payment.id)}
                        className="text-primary underline-offset-4 hover:underline"
                      >
                        {c.payment.number}
                      </Link>
                    </>
                  )}
                </p>
              </div>
              <p
                className={
                  c.status === "BOUNCED"
                    ? "text-sm whitespace-nowrap text-muted-foreground tabular-nums line-through"
                    : c.status === "PENDING"
                      ? "text-sm whitespace-nowrap text-muted-foreground tabular-nums"
                      : "text-sm font-medium whitespace-nowrap tabular-nums"
                }
              >
                {money(c.amount, currency)}
              </p>
            </li>
          ))}
          {refunds.map((r) => (
            <li key={r.id} className="grid min-w-0 gap-3 py-3 first:pt-0">
              <div className="flex min-w-0 items-start justify-between gap-4">
                <div className="min-w-0">
                  <p className="flex flex-wrap items-center gap-2 text-sm font-medium">
                    {r.number}
                    <RefundBadge kind={r.kind} voided={r.voided} />
                  </p>
                  <p className="text-[0.8125rem] text-muted-foreground">
                    {[formatDay(r.refundedOn), r.method ? METHOD_LABELS[r.method] : null, r.reason]
                      .filter(Boolean)
                      .join(" · ")}
                  </p>
                </div>
                <p
                  className={
                    r.voided
                      ? "text-sm whitespace-nowrap text-muted-foreground tabular-nums line-through"
                      : "text-sm font-medium whitespace-nowrap tabular-nums"
                  }
                >
                  − {money(r.amount, currency)}
                </p>
              </div>
              {!r.voided && (
                <div className="flex flex-wrap gap-2">
                  <PrintDocumentButton
                    request={{ type: "REFUND_VOUCHER", id: r.id }}
                    label="Voucher PDF"
                    className="w-auto"
                    ready={{
                      eyebrow: "Refund voucher",
                      description: `${r.number} for ${money(r.amount, currency)}.`,
                      errorTitle: "We could not make the refund voucher",
                    }}
                  />
                  {r.can.void && (
                    <Button type="button" variant="ghost" onClick={() => setVoiding(r)}>
                      <Undo2Icon aria-hidden />
                      Void
                    </Button>
                  )}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
      {voiding && (
        <FormDialog
          title={`Void refund ${voiding.number}?`}
          description={`Use this when it was recorded by mistake. The ${money(voiding.amount, currency)} counts as held again, and the voucher stays on record marked void.`}
          submitLabel="Void the refund"
          pendingLabel="Voiding"
          destructive
          errorTitle="We could not void the refund"
          onClose={() => setVoiding(null)}
          onSubmit={async (form) => {
            const reason = textOf(form, "reason");
            if (reason.length < 5) return problem({ reason: "Write at least 5 letters." });
            const result = await voidRefundAction(voiding.id, { reason });
            if (!result.ok) return result.error;
            setNotice(`Refund ${voiding.number} was voided.`);
            setVoiding(null);
          }}
        >
          {(fieldError) => (
            <ReasonField id="void-refund-reason" min={5} error={fieldError("reason")} />
          )}
        </FormDialog>
      )}
    </Panel>
  );
}
