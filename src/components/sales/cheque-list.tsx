"use client";

import { BanIcon, CircleCheckIcon } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import { Field, FormAlert } from "@/components/forms/field";
import { textOf } from "@/components/products/form-values";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { formatDay } from "@/lib/display";
import type { ChequeList as ChequePage, ChequeRow } from "@/modules/sales/screens.service";
import {
  bounceChequeAction,
  clearChequeAction,
  listChequeRowsAction,
} from "@/server/actions/sales.actions";

import { ChequeBadge } from "./badges";
import { FormDialog, problem, ReasonField } from "./dialogs";
import { money, salesHref } from "./labels";
import { paymentListQuery, type PaymentListView } from "./list-view";
import { ShowMore, useLoadMore } from "./load-more";
import { ProofAttach, ProofView } from "./proof";
import { paidSentence } from "./receive-payment-dialog";

/** What a cheque was for: "Order SO-0012", "Advance on PI-0003", "On account". */
function forText(c: ChequeRow): string {
  if (c.proforma) return `Advance on ${c.proforma.number}`;
  if (c.order) return `Order ${c.order.number}`;
  return "On account";
}

/**
 * Cheques received, newest first. Accounts marks a pending cheque cleared (the
 * receipt is recorded into the bank then) or bounced (nothing is recorded).
 */
export function ChequeList({
  initial,
  view,
  currency,
  today,
}: {
  initial: ChequePage;
  view: PaymentListView;
  currency: string;
  today: string;
}) {
  const list = useLoadMore(initial, (cursor) =>
    listChequeRowsAction(paymentListQuery(view, cursor)),
  );
  const [changed, setChanged] = useState<Record<string, Partial<ChequeRow>>>({});
  const [clearing, setClearing] = useState<ChequeRow | null>(null);
  const [bouncing, setBouncing] = useState<ChequeRow | null>(null);
  const [notice, setNotice] = useState<string>();
  const rows = list.items.map((c) => ({ ...c, ...changed[c.id] }));

  return (
    <div className="grid grid-cols-1 gap-5">
      {notice && <FormAlert tone="success">{notice}</FormAlert>}
      <ul className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3" aria-label="Cheques">
        {rows.map((c) => (
          <li key={c.id} className="grid min-w-0 grid-cols-1 gap-3 rounded-lg border bg-card p-4">
            <div className="flex items-start justify-between gap-3">
              <p className="eyebrow min-w-0 truncate">
                Cheque {c.chequeNo} · dated {formatDay(c.chequeDate)}
              </p>
              <div className="-my-1 shrink-0">
                <ChequeBadge status={c.status} />
              </div>
            </div>
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="font-serif text-lg leading-snug break-words text-primary">
                  {c.buyer?.name ?? c.customerName ?? "Walk-in customer"}
                </p>
                <p className="mt-1 text-sm break-words text-muted-foreground">
                  {[c.bankName, forText(c), `received ${formatDay(c.receivedOn)}`]
                    .filter(Boolean)
                    .join(" · ")}
                </p>
              </div>
              {c.proofFileId && <ProofView fileId={c.proofFileId} label={`Cheque ${c.chequeNo}`} />}
            </div>
            <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-t pt-3 text-sm tabular-nums">
              <span className="font-medium">{money(c.amount, currency)}</span>
              {c.status === "CLEARED" && c.payment ? (
                <span className="text-muted-foreground">
                  Cleared {c.clearedOn ? formatDay(c.clearedOn) : ""} ·{" "}
                  <Link
                    href={salesHref.payment(c.payment.id)}
                    className="text-primary underline-offset-4 hover:underline"
                  >
                    {c.payment.number}
                  </Link>
                </span>
              ) : c.status === "BOUNCED" ? (
                <span className="text-muted-foreground">
                  Bounced {c.bouncedOn ? formatDay(c.bouncedOn) : ""}
                </span>
              ) : (
                <span className="text-muted-foreground">Not in the books yet</span>
              )}
            </div>
            {c.status === "BOUNCED" && c.bounceReason && (
              <p className="text-[0.8125rem] text-muted-foreground">{c.bounceReason}</p>
            )}
            {initial.canManage && (
              <div className="flex flex-wrap gap-2">
                {c.status === "PENDING" && (
                  <>
                    <Button type="button" size="sm" onClick={() => setClearing(c)}>
                      <CircleCheckIcon aria-hidden />
                      Mark cleared
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() => setBouncing(c)}
                    >
                      <BanIcon aria-hidden />
                      Mark bounced
                    </Button>
                  </>
                )}
                {!c.proofFileId && <ProofAttach target={{ chequeId: c.id }} hasProof={false} />}
              </div>
            )}
          </li>
        ))}
      </ul>
      <ShowMore list={list} noun="cheques" />

      {clearing && (
        <FormDialog
          title={`Mark cheque ${clearing.chequeNo} cleared?`}
          description={`The bank paid ${money(clearing.amount, currency)}. A money receipt is recorded into the bank account on the day it cleared${
            clearing.order ? `, against ${clearing.order.number}` : ""
          }.`}
          submitLabel="Mark cleared"
          pendingLabel="Recording"
          errorTitle="We could not clear the cheque"
          onClose={() => setClearing(null)}
          onSubmit={async (form) => {
            const clearedOn = textOf(form, "clearedOn");
            if (clearedOn && clearedOn < clearing.chequeDate) {
              return problem({ clearedOn: `On or after ${formatDay(clearing.chequeDate)}.` });
            }
            const accountId = textOf(form, "accountId");
            const result = await clearChequeAction(clearing.id, {
              ...(clearedOn && clearedOn !== today ? { clearedOn } : {}),
              ...(accountId ? { accountId } : {}),
            });
            if (!result.ok) return result.error;
            const { payment, onAccount, allocated, advanceKept } = result.data;
            setChanged((all) => ({
              ...all,
              [clearing.id]: { status: "CLEARED", payment, clearedOn: clearedOn || today },
            }));
            setNotice(
              [
                `Cheque ${clearing.chequeNo} cleared: payment ${payment.number} is recorded.`,
                onAccount ? paidSentence(clearing.amount, allocated, advanceKept, currency) : "",
              ]
                .filter(Boolean)
                .join(" "),
            );
            setClearing(null);
          }}
        >
          {(fieldError) => (
            <div className="grid items-start gap-5 sm:grid-cols-2">
              <Field id="clear-on" label="Cleared on" error={fieldError("clearedOn")}>
                <Input
                  id="clear-on"
                  name="clearedOn"
                  type="date"
                  defaultValue={today < clearing.chequeDate ? clearing.chequeDate : today}
                  min={clearing.chequeDate}
                  max={today}
                />
              </Field>
              {initial.banks.length > 1 && (
                <Field id="clear-bank" label="Deposited in" error={fieldError("accountId")}>
                  <NativeSelect id="clear-bank" name="accountId" containerClassName="sm:w-full">
                    {initial.banks.map((b) => (
                      <option key={b.id} value={b.id}>
                        {b.code} · {b.name}
                      </option>
                    ))}
                  </NativeSelect>
                </Field>
              )}
            </div>
          )}
        </FormDialog>
      )}
      {bouncing && (
        <FormDialog
          title={`Mark cheque ${bouncing.chequeNo} bounced?`}
          description={`Nothing is recorded in the books, and what it was for stays due. The cheque stays on the list as bounced.`}
          submitLabel="Mark bounced"
          pendingLabel="Saving"
          destructive
          errorTitle="We could not mark the cheque bounced"
          onClose={() => setBouncing(null)}
          onSubmit={async (form) => {
            const reason = textOf(form, "reason");
            if (reason.length < 3) return problem({ reason: "Write at least 3 letters." });
            const result = await bounceChequeAction(bouncing.id, { reason });
            if (!result.ok) return result.error;
            setChanged((all) => ({
              ...all,
              [bouncing.id]: { status: "BOUNCED", bounceReason: reason, bouncedOn: today },
            }));
            setNotice(`Cheque ${bouncing.chequeNo} is marked bounced.`);
            setBouncing(null);
          }}
        >
          {(fieldError) => (
            <ReasonField
              id="bounce-reason"
              label="Why it bounced"
              hint="For example: not enough money in the account."
              min={3}
              error={fieldError("reason")}
            />
          )}
        </FormDialog>
      )}
    </div>
  );
}
