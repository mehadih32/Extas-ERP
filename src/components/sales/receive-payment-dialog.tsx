"use client";

import type { PaymentMethod } from "@prisma/client";
import { LoaderCircleIcon } from "lucide-react";
import { useEffect, useState } from "react";

import { Field, FormAlert } from "@/components/forms/field";
import { AMOUNT_HINT, readAmount, textOf } from "@/components/products/form-values";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { formatDay } from "@/lib/display";
import type { ActionError } from "@/lib/result";
import { cn } from "@/lib/utils";
import {
  advanceLeft,
  allocatedTotal,
  type AllocationLine,
  oldestFirst,
} from "@/modules/sales/allocation";
import { RECEIVE_METHODS } from "@/modules/sales/choices";
import type { BuyerOption } from "@/modules/sales/screens.service";
import {
  getBuyerOpenDuesAction,
  receivePaymentAction,
  recordChequeAction,
} from "@/server/actions/sales.actions";

import { FormDialog, problem } from "./dialogs";
import { METHOD_LABELS, money } from "./labels";
import { BuyerPicker } from "./pickers";
import { ProofDrop, type ReadyProof, uploadProof } from "./proof";

/*
 * Taking money from a buyer (Accounts): against an order, a proforma's advance
 * or the buyer's account. On account, the money pays their unpaid invoices
 * oldest first, or the amounts typed next to each invoice, and the rest is kept
 * as their advance balance. A cheque is recorded as pending and reaches the
 * bank only when marked cleared. A proof photo can go with either.
 */

type ReceiveTarget =
  { orderId: string; label: string } | { proformaId: string; label: string } | { onAccount: true };

type Due = {
  orderId: string;
  orderNumber: string;
  invoiceNumber: string;
  issuedOn: string;
  due: string;
};
type Dues =
  | {
      key: string;
      state: "ready";
      dues: Due[];
      credit: string;
      /** Owed but on no invoice (an opening balance): money left over pays it first. */
      earlier: number;
    }
  | { key: string; state: "failed" };

const fixed2 = (value: number) => value.toFixed(2);
const cents = (value: number) => Math.round(value * 100);

/** A day typed into a date box, left out when it is today (the server stamps the time). */
const dayOrNow = (form: FormData, name: string, today: string) => {
  const day = textOf(form, name);
  return day && day !== today ? day : undefined;
};

/** The cheque's own details, shown when it is paid by cheque. */
export function ChequeFields({
  idPrefix,
  today,
  fieldError,
}: {
  idPrefix: string;
  today: string;
  fieldError: (name: string) => string | undefined;
}) {
  return (
    <div className="grid items-start gap-5 sm:grid-cols-3">
      <Field id={`${idPrefix}-cheque-no`} label="Cheque number" error={fieldError("chequeNo")}>
        <Input
          id={`${idPrefix}-cheque-no`}
          name="chequeNo"
          maxLength={40}
          autoComplete="off"
          aria-invalid={Boolean(fieldError("chequeNo"))}
        />
      </Field>
      <Field id={`${idPrefix}-cheque-bank`} label="Bank (optional)">
        <Input id={`${idPrefix}-cheque-bank`} name="bankName" maxLength={120} autoComplete="off" />
      </Field>
      <Field
        id={`${idPrefix}-cheque-date`}
        label="Date on the cheque"
        error={fieldError("chequeDate")}
      >
        <Input id={`${idPrefix}-cheque-date`} name="chequeDate" type="date" defaultValue={today} />
      </Field>
    </div>
  );
}

/**
 * The buyer's unpaid invoices, oldest first, with what this money pays on each:
 * worked out oldest first, or typed in ("Choose amounts").
 */
function AllocationGrid({
  dues,
  amount,
  earlier,
  manual,
  onManual,
  currency,
  fieldError,
}: {
  dues: Due[];
  amount: number;
  earlier: number;
  manual: Record<string, string> | null;
  onManual: (next: Record<string, string> | null) => void;
  currency: string;
  fieldError: (name: string) => string | undefined;
}) {
  const plan = oldestFirst(dues, amount);
  const planned = new Map(plan.map((l) => [l.orderId, l.amount]));
  const lines = manual ? manualLines(dues, manual) : plan;
  const total = allocatedTotal(lines);
  const left = advanceLeft(amount, lines);
  const towardEarlier = Math.min(left, earlier);
  const kept = left - towardEarlier;
  const over = cents(total) > cents(amount);

  return (
    <fieldset className="grid gap-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <legend className="text-sm font-medium">What it pays</legend>
        <div className="flex gap-1 rounded-md bg-muted p-0.5 text-[0.8125rem]">
          <button
            type="button"
            aria-pressed={!manual}
            onClick={() => onManual(null)}
            className={cn("rounded px-2.5 py-1", !manual && "bg-card font-medium shadow-sm")}
          >
            Oldest first
          </button>
          <button
            type="button"
            aria-pressed={Boolean(manual)}
            onClick={() =>
              onManual(
                Object.fromEntries(
                  dues.map((d) => [
                    d.orderId,
                    planned.has(d.orderId) ? fixed2(planned.get(d.orderId)!) : "",
                  ]),
                ),
              )
            }
            className={cn("rounded px-2.5 py-1", manual && "bg-card font-medium shadow-sm")}
          >
            Choose amounts
          </button>
        </div>
      </div>
      <ul className="grid divide-y rounded-lg border">
        {dues.map((d) => {
          const error = fieldError(`allocations.${d.orderId}`);
          return (
            <li key={d.orderId} className="flex items-center justify-between gap-3 px-3 py-2.5">
              <div className="min-w-0 text-sm">
                <p className="font-medium">
                  {d.invoiceNumber} <span className="text-muted-foreground">· {d.orderNumber}</span>
                </p>
                <p className="text-[0.8125rem] text-muted-foreground">
                  Due {money(d.due, currency)} · issued {formatDay(d.issuedOn)}
                </p>
                {error && <p className="text-[0.8125rem] text-destructive">{error}</p>}
              </div>
              {manual ? (
                <Input
                  aria-label={`Pay on ${d.invoiceNumber}`}
                  inputMode="decimal"
                  value={manual[d.orderId] ?? ""}
                  onChange={(e) => onManual({ ...manual, [d.orderId]: e.target.value })}
                  placeholder="0.00"
                  autoComplete="off"
                  className="w-28 shrink-0 text-right tabular-nums"
                  aria-invalid={Boolean(error)}
                />
              ) : (
                <span className="shrink-0 text-sm font-medium tabular-nums">
                  {planned.has(d.orderId) ? money(fixed2(planned.get(d.orderId)!), currency) : "–"}
                </span>
              )}
            </li>
          );
        })}
      </ul>
      <p
        className={cn(
          "text-[0.8125rem] tabular-nums",
          over ? "text-destructive" : "text-muted-foreground",
        )}
      >
        {over
          ? `The amounts come to ${money(fixed2(total), currency)}, more than the ${money(fixed2(amount), currency)} received.`
          : [
              `Pays ${money(fixed2(total), currency)} of invoices.`,
              towardEarlier > 0
                ? `${money(fixed2(towardEarlier), currency)} pays the earlier balance.`
                : "",
              kept > 0.004 ? `${money(fixed2(kept), currency)} is kept as advance balance.` : "",
            ]
              .filter(Boolean)
              .join(" ")}
      </p>
    </fieldset>
  );
}

/** The amounts typed next to the invoices (empty boxes left out). */
function manualLines(dues: Due[], manual: Record<string, string>): AllocationLine[] {
  return dues.flatMap((d) => {
    const value = readAmount(manual[d.orderId]);
    return typeof value === "number" && value > 0 ? [{ orderId: d.orderId, amount: value }] : [];
  });
}

/**
 * What money on a buyer's account paid, in a sentence: "It paid INV-1 (2,000.00).
 * 300.00 paid the earlier balance. 500.00 is kept as advance balance."
 */
export function paidSentence(
  amount: string | number,
  allocated: Array<{ number: string; amount: string }>,
  advanceKept: string,
  currency: string,
) {
  const parts: string[] = [];
  if (allocated.length > 0) {
    parts.push(
      `It paid ${allocated.map((a) => `${a.number} (${money(a.amount, currency)})`).join(", ")}.`,
    );
  }
  const toInvoices = allocated.reduce((sum, a) => sum + cents(Number(a.amount)), 0);
  const earlier = cents(Number(amount)) - toInvoices - cents(Number(advanceKept));
  if (earlier > 0)
    parts.push(`${money(fixed2(earlier / 100), currency)} paid the earlier balance.`);
  if (Number(advanceKept) > 0) {
    parts.push(`${money(advanceKept, currency)} is kept as advance balance.`);
  }
  return parts.join(" ");
}

/**
 * Records money received (accounts.receipts.record): against an order (an
 * advance before it is invoiced), a proforma's advance (production starts once
 * it is paid in full) or a buyer's account.
 */
export function ReceivePaymentDialog({
  target,
  due,
  most,
  extraAllowed = false,
  currency,
  today,
  onDone,
  onClose,
}: {
  target: ReceiveTarget;
  /** What is still to pay: the suggested amount (and the most, unless extra is allowed). */
  due?: string;
  /**
   * The most that can be received when it is more than the due: a website order whose
   * return credit pays part of it (the credit then goes back to the customer).
   */
  most?: string;
  /** An invoiced order of a named buyer: more than the due is kept as advance balance. */
  extraAllowed?: boolean;
  currency: string;
  today: string;
  onDone: (message: string) => void;
  onClose: () => void;
}) {
  const onAccount = "onAccount" in target;
  const [buyer, setBuyer] = useState<BuyerOption | null>(null);
  const [amountText, setAmountText] = useState(due && Number(due) > 0 ? due : "");
  const [method, setMethod] = useState<PaymentMethod>("CASH");
  const [proof, setProof] = useState<ReadyProof | null>(null);
  const [answer, setAnswer] = useState<Dues>();
  const [manual, setManual] = useState<Record<string, string> | null>(null);

  const buyerKey = onAccount && buyer ? buyer.id : "";
  const dues: Dues | { state: "idle" | "loading" } = !buyerKey
    ? { state: "idle" }
    : answer?.key === buyerKey
      ? answer
      : { state: "loading" };
  useEffect(() => {
    if (!buyerKey) return;
    let live = true;
    void getBuyerOpenDuesAction(buyerKey)
      .then((result) => {
        if (!live) return;
        setManual(null);
        setAnswer(
          result.ok
            ? {
                key: buyerKey,
                state: "ready",
                dues: result.data.dues,
                credit: result.data.credit,
                earlier: Math.max(
                  Number(result.data.previousDue) - Number(result.data.openDues),
                  0,
                ),
              }
            : { key: buyerKey, state: "failed" },
        );
      })
      .catch(() => live && setAnswer({ key: buyerKey, state: "failed" }));
    return () => {
      live = false;
    };
  }, [buyerKey]);

  const typed = readAmount(amountText);
  const amount = typeof typed === "number" ? typed : 0;
  const cheque = method === "CHEQUE";
  const limit = most ?? due;
  const extra = !onAccount && limit !== undefined && cents(amount) > cents(Number(limit));
  const ready = dues.state === "ready" ? dues : null;

  return (
    <FormDialog
      title={onAccount ? "Receive a payment on account" : `Receive a payment for ${target.label}`}
      description={
        onAccount
          ? "Money a buyer paid towards what they owe, not for one order. It pays their oldest invoices first, or the amounts you choose; the rest is kept as their advance balance."
          : due
            ? `${money(due, currency)} is still to pay. A money receipt is made for it.`
            : "A money receipt is made for it."
      }
      submitLabel={cheque ? "Record the cheque" : "Record the payment"}
      pendingLabel="Recording"
      errorTitle="We could not record the payment"
      className={onAccount ? "sm:max-w-xl" : undefined}
      onClose={onClose}
      onSubmit={async (form) => {
        if (onAccount && !buyer) return problem({ partyId: "Choose the buyer who paid." });
        if (typed === "invalid") return problem({ amount: AMOUNT_HINT });
        if (typed === null || typed <= 0) return problem({ amount: "Enter the amount." });
        if (extra && (!extraAllowed || cheque)) return problem({ amount: `At most ${limit}.` });
        const chequeNo = textOf(form, "chequeNo");
        if (cheque && !chequeNo) return problem({ chequeNo: "Enter the cheque number." });
        let allocation: { allocations?: AllocationLine[]; oldestFirst?: boolean } = {};
        if (onAccount && ready && ready.dues.length > 0) {
          if (manual) {
            const lines = manualLines(ready.dues, manual);
            const found: Record<string, string> = {};
            for (const d of ready.dues) {
              const value = readAmount(manual[d.orderId]);
              if (value === "invalid") found[`allocations.${d.orderId}`] = AMOUNT_HINT;
              else if (typeof value === "number" && cents(value) > cents(Number(d.due))) {
                found[`allocations.${d.orderId}`] = `At most ${d.due}`;
              }
            }
            if (Object.keys(found).length > 0) return problem(found);
            if (cents(allocatedTotal(lines)) > cents(amount)) {
              return problem({ amount: "The invoice amounts come to more than this." });
            }
            allocation = { allocations: lines };
          } else {
            allocation = { oldestFirst: true };
          }
        }
        let proofFileId: string | undefined;
        if (proof) {
          const stored = await uploadProof(proof);
          if (!("id" in stored)) return stored as ActionError;
          proofFileId = stored.id;
        }
        const where = {
          ...("orderId" in target ? { orderId: target.orderId } : {}),
          ...("proformaId" in target ? { proformaId: target.proformaId } : {}),
          ...(onAccount ? { partyId: buyer!.id } : {}),
        };
        const notes = textOf(form, "notes") || undefined;
        if (cheque) {
          const result = await recordChequeAction({
            ...where,
            amount,
            chequeNo,
            bankName: textOf(form, "bankName") || undefined,
            chequeDate: textOf(form, "chequeDate") || undefined,
            receivedAt: dayOrNow(form, "paymentDate", today),
            notes,
            proofFileId,
            ...allocation,
          });
          if (!result.ok) return result.error;
          onDone(
            `Cheque ${result.data.chequeNo} of ${money(fixed2(amount), currency)} is recorded as pending. Nothing is in the books until it is marked cleared in Payments › Cheques.`,
          );
          return;
        }
        const result = await receivePaymentAction({
          ...where,
          amount,
          method,
          paymentDate: dayOrNow(form, "paymentDate", today),
          reference: textOf(form, "reference") || undefined,
          notes,
          proofFileId,
          ...allocation,
          ...(extra ? { extra: "ADVANCE" } : {}),
        });
        if (!result.ok) return result.error;
        const { payment, productionProject, allocated, advanceKept } = result.data;
        onDone(
          [
            `Payment ${payment.number} of ${money(fixed2(amount), currency)} was recorded.`,
            onAccount || extra ? paidSentence(amount, allocated, advanceKept, currency) : "",
            productionProject
              ? `The advance is paid in full, so production ${productionProject.code} has started.`
              : "",
          ]
            .filter(Boolean)
            .join(" "),
        );
      }}
    >
      {(fieldError) => (
        <>
          {onAccount && (
            <Field id="receive-buyer" label="Buyer" error={fieldError("partyId")}>
              <BuyerPicker
                id="receive-buyer"
                value={buyer}
                onChange={setBuyer}
                purpose="PAYMENT"
                currency={currency}
                invalid={Boolean(fieldError("partyId"))}
              />
            </Field>
          )}
          <div className="grid items-start gap-5 sm:grid-cols-2">
            <Field id="receive-amount" label={`Amount (${currency})`} error={fieldError("amount")}>
              <Input
                id="receive-amount"
                name="amount"
                inputMode="decimal"
                value={amountText}
                onChange={(e) => setAmountText(e.target.value)}
                placeholder="0.00"
                autoComplete="off"
                aria-invalid={Boolean(fieldError("amount"))}
                aria-describedby={fieldError("amount") ? "receive-amount-error" : undefined}
                autoFocus={!onAccount}
              />
            </Field>
            <Field id="receive-method" label="Paid by" error={fieldError("method")}>
              <NativeSelect
                id="receive-method"
                name="method"
                value={method}
                onChange={(e) => setMethod(e.target.value as PaymentMethod)}
                containerClassName="sm:w-full"
              >
                {RECEIVE_METHODS.map((m) => (
                  <option key={m} value={m}>
                    {METHOD_LABELS[m]}
                  </option>
                ))}
              </NativeSelect>
            </Field>
            {!cheque && (
              <Field
                id="receive-reference"
                label="Reference (optional)"
                hint="bKash transaction ID, bank reference…"
              >
                <Input
                  id="receive-reference"
                  name="reference"
                  maxLength={120}
                  autoComplete="off"
                  aria-describedby="receive-reference-hint"
                />
              </Field>
            )}
            <Field id="receive-date" label="Received on" error={fieldError("paymentDate")}>
              <Input
                id="receive-date"
                name="paymentDate"
                type="date"
                defaultValue={today}
                max={today}
              />
            </Field>
          </div>
          {cheque && (
            <>
              <ChequeFields idPrefix="receive" today={today} fieldError={fieldError} />
              <FormAlert tone="note">
                The cheque is kept as pending: the due stays and nothing reaches the bank account
                until you mark it cleared.
              </FormAlert>
            </>
          )}
          {extra && extraAllowed && !cheque && (
            <FormAlert tone="note">
              {money(fixed2(amount - Number(due)), currency)} more than the due goes on the
              buyer&apos;s account, for their earlier balance or their next bills.
            </FormAlert>
          )}
          {onAccount &&
            buyer &&
            (dues.state === "loading" ? (
              <p className="flex items-center gap-2 text-sm text-muted-foreground">
                <LoaderCircleIcon className="size-4 animate-spin" aria-hidden />
                Finding {buyer.name}&apos;s unpaid invoices
              </p>
            ) : dues.state === "failed" ? (
              <FormAlert tone="note">
                The unpaid invoices could not load. The money will be kept as advance balance; use
                it on an order with &ldquo;Use credit&rdquo;.
              </FormAlert>
            ) : ready && ready.dues.length === 0 ? (
              <FormAlert tone="note">
                {ready.earlier > 0
                  ? `${buyer.name} has no unpaid invoices. It pays their earlier balance of ${money(fixed2(ready.earlier), currency)} first; anything over is kept as advance balance.`
                  : `${buyer.name} has no unpaid invoices: all of it is kept as advance balance.`}
              </FormAlert>
            ) : ready ? (
              <AllocationGrid
                dues={ready.dues}
                amount={amount}
                earlier={ready.earlier}
                manual={manual}
                onManual={setManual}
                currency={currency}
                fieldError={fieldError}
              />
            ) : null)}
          <ProofDrop value={proof} onChange={setProof} error={fieldError("proofFileId")} />
          <Field id="receive-notes" label="Notes (optional)">
            <Textarea id="receive-notes" name="notes" rows={2} maxLength={1000} />
          </Field>
        </>
      )}
    </FormDialog>
  );
}
