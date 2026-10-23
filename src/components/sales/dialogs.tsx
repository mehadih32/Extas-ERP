"use client";

import type { PaymentMethod, RefundKind } from "@prisma/client";
import { LoaderCircleIcon } from "lucide-react";
import { useState, useTransition } from "react";

import { ErrorDialog } from "@/components/feedback/error-dialog";
import { Field, FormAlert } from "@/components/forms/field";
import { ChoiceList } from "@/components/parties/choice-list";
import { AMOUNT_HINT, readAmount, textOf } from "@/components/products/form-values";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import type { ActionError } from "@/lib/result";
import { cn } from "@/lib/utils";
import { RECEIVE_METHODS } from "@/modules/sales/choices";
import { refundBuyerAction } from "@/server/actions/sales.actions";

import { METHOD_LABELS, money, REFUND_KIND_HINTS, REFUND_KIND_LABELS } from "./labels";

/** A problem found before asking the server, shown like the server's own. */
export const problem = (fieldErrors: Record<string, string>): ActionError => ({
  code: "VALIDATION",
  message: "Please check the highlighted fields.",
  fieldErrors: Object.fromEntries(Object.entries(fieldErrors).map(([k, v]) => [k, [v]])),
});

/**
 * A window with a short form: what it does, the fields, and the button. The
 * submit handler returns the action's error (or a problem found first), which
 * shows on its field or above the buttons; on success the caller closes it.
 */
export function FormDialog({
  title,
  description,
  submitLabel,
  pendingLabel,
  destructive = false,
  errorTitle,
  onSubmit,
  onClose,
  children,
  className,
}: {
  title: string;
  description: React.ReactNode;
  submitLabel: string;
  pendingLabel: string;
  destructive?: boolean;
  /** The heading of the error window for an unexpected failure. */
  errorTitle: string;
  onSubmit: (form: FormData) => Promise<ActionError | undefined>;
  onClose: () => void;
  /** The fields, given the error of each field by its name. */
  children: (fieldError: (name: string) => string | undefined) => React.ReactNode;
  /** A wider window ("sm:max-w-2xl") for a long text. */
  className?: string;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<ActionError>();
  const fieldError = (name: string) => error?.fieldErrors?.[name]?.[0];
  const general =
    error && error.code !== "INTERNAL" && !(error.code === "VALIDATION" && error.fieldErrors)
      ? error.message
      : undefined;

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    startTransition(async () => setError(await onSubmit(form)));
  }

  return (
    <Dialog open onOpenChange={(open) => !open && !pending && onClose()}>
      <DialogContent className={cn("max-h-[calc(100dvh-2rem)] overflow-y-auto", className)}>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="grid gap-5" noValidate>
          {children(fieldError)}
          {general && <FormAlert>{general}</FormAlert>}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose} disabled={pending}>
              Cancel
            </Button>
            <Button
              type="submit"
              variant={destructive ? "destructive" : "default"}
              disabled={pending}
            >
              {pending && <LoaderCircleIcon className="animate-spin" aria-hidden />}
              {pending ? pendingLabel : submitLabel}
            </Button>
          </DialogFooter>
        </form>
        {error?.code === "INTERNAL" && (
          <ErrorDialog
            code={error.errorId ?? "ERR-UNKNOWN"}
            title={errorTitle}
            onClose={() => setError(undefined)}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

/** Why something is cancelled or voided: kept in the activity log and on the record. */
export function ReasonField({
  id,
  label = "Reason",
  hint = "Kept in the activity log.",
  min,
  error,
}: {
  id: string;
  label?: string;
  hint?: string;
  min: number;
  error?: string;
}) {
  return (
    <Field id={id} label={label} hint={hint} error={error}>
      <Textarea
        id={id}
        name="reason"
        rows={2}
        minLength={min}
        maxLength={500}
        required
        aria-invalid={Boolean(error)}
        aria-describedby={error ? `${id}-error` : `${id}-hint`}
      />
    </Field>
  );
}

/** The reason typed, or a problem when it is shorter than `min` letters. */
export function readReason(form: FormData, min: number): string | ActionError {
  const reason = textOf(form, "reason");
  if (reason.length < min) return problem({ reason: `Write at least ${min} letters.` });
  return reason;
}

function MethodSelect({ id, name = "method" }: { id: string; name?: string }) {
  return (
    <NativeSelect id={id} name={name} defaultValue="CASH" containerClassName="sm:w-full">
      {RECEIVE_METHODS.map((m) => (
        <option key={m} value={m}>
          {METHOD_LABELS[m]}
        </option>
      ))}
    </NativeSelect>
  );
}

/**
 * How money held for a buyer is settled: paid back (with how), kept as credit on
 * their account, or kept as a cancellation charge, limited to the ways this
 * person's Accounts keys allow.
 */
export function SettleFields({
  idPrefix,
  kinds,
  legend = "What happens to the money",
  fieldError,
}: {
  idPrefix: string;
  kinds: RefundKind[];
  legend?: string;
  fieldError: (name: string) => string | undefined;
}) {
  const [kind, setKind] = useState<RefundKind>(kinds[0]!);
  return (
    <div className="grid gap-5">
      <ChoiceList
        name="kind"
        legend={legend}
        defaultValue={kinds[0]}
        onChange={setKind}
        options={kinds.map((k) => ({
          value: k,
          label: REFUND_KIND_LABELS[k],
          hint: REFUND_KIND_HINTS[k],
        }))}
      />
      {kind === "CASH" && (
        <div className="grid items-start gap-5 sm:grid-cols-2">
          <Field id={`${idPrefix}-method`} label="Paid back by" error={fieldError("method")}>
            <MethodSelect id={`${idPrefix}-method`} />
          </Field>
          <Field
            id={`${idPrefix}-reference`}
            label="Reference (optional)"
            hint="Cheque number, bKash transaction ID…"
          >
            <Input
              id={`${idPrefix}-reference`}
              name="reference"
              maxLength={120}
              autoComplete="off"
              aria-describedby={`${idPrefix}-reference-hint`}
            />
          </Field>
        </div>
      )}
    </div>
  );
}

/** The settlement chosen in SettleFields, as the actions take it. */
export function readSettle(form: FormData) {
  const kind = textOf(form, "kind") as RefundKind;
  return kind === "CASH"
    ? {
        kind,
        method: (textOf(form, "method") || "CASH") as PaymentMethod,
        reference: textOf(form, "reference") || undefined,
      }
    : { kind };
}

/** An amount up to `max`, or a problem for the "amount" field. */
function readMoney(form: FormData, max?: string): number | ActionError {
  const amount = readAmount(textOf(form, "amount"));
  if (amount === "invalid") return problem({ amount: AMOUNT_HINT });
  if (amount === null || amount <= 0) return problem({ amount: "Enter the amount." });
  if (max !== undefined && amount > Number(max)) {
    return problem({ amount: `At most ${max}.` });
  }
  return amount;
}

/** A day typed into a date box, left out when it is today (the server stamps the time). */
const dayOrNow = (form: FormData, name: string, today: string) => {
  const day = textOf(form, name);
  return day && day !== today ? day : undefined;
};

/**
 * Takes money back off an order or a proforma (Accounts): paid back, kept as
 * the buyer's credit or kept as a cancellation charge, each needing its own key.
 * On a website return (`salesReturnId`) it pays back the credit its invoice
 * did not use.
 */
export function RefundDialog({
  target,
  kinds,
  held,
  currency,
  today,
  onDone,
  onClose,
}: {
  target:
    | { orderId: string; label: string }
    | { proformaId: string; label: string }
    | { salesReturnId: string; label: string };
  kinds: RefundKind[];
  /** Money held on it now (a return's credit left): the most that can be refunded. */
  held: string;
  currency: string;
  today: string;
  onDone: (message: string) => void;
  onClose: () => void;
}) {
  const fromReturn = "salesReturnId" in target;
  return (
    <FormDialog
      title={
        fromReturn
          ? `Pay back the credit from ${target.label}`
          : `Refund money paid on ${target.label}`
      }
      description={
        fromReturn
          ? `${money(held, currency)} of its credit was not needed on its invoice and can be paid back. A refund voucher is made for it.`
          : `${money(held, currency)} paid on it can be refunded. A refund voucher is made for it.`
      }
      submitLabel="Record the refund"
      pendingLabel="Recording"
      errorTitle="We could not record the refund"
      onClose={onClose}
      onSubmit={async (form) => {
        const amount = readMoney(form, held);
        if (typeof amount !== "number") return amount;
        const reason = readReason(form, 3);
        if (typeof reason !== "string") return reason;
        const result = await refundBuyerAction({
          ...("orderId" in target
            ? { orderId: target.orderId }
            : "proformaId" in target
              ? { proformaId: target.proformaId }
              : { salesReturnId: target.salesReturnId }),
          ...readSettle(form),
          amount,
          reason,
          refundDate: dayOrNow(form, "refundDate", today),
          notes: textOf(form, "notes") || undefined,
        });
        if (!result.ok) return result.error;
        onDone(
          `Refund ${result.data.number} of ${money(amount.toFixed(2), currency)} was recorded.`,
        );
      }}
    >
      {(fieldError) => (
        <>
          <SettleFields idPrefix="refund" kinds={kinds} fieldError={fieldError} />
          <div className="grid items-start gap-5 sm:grid-cols-2">
            <Field id="refund-amount" label={`Amount (${currency})`} error={fieldError("amount")}>
              <Input
                id="refund-amount"
                name="amount"
                inputMode="decimal"
                defaultValue={held}
                autoComplete="off"
                aria-invalid={Boolean(fieldError("amount"))}
                aria-describedby={fieldError("amount") ? "refund-amount-error" : undefined}
              />
            </Field>
            <Field id="refund-date" label="Refunded on">
              <Input
                id="refund-date"
                name="refundDate"
                type="date"
                defaultValue={today}
                max={today}
              />
            </Field>
          </div>
          <ReasonField id="refund-reason" min={3} error={fieldError("reason")} />
        </>
      )}
    </FormDialog>
  );
}
