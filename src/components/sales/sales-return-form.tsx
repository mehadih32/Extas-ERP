"use client";

import { LoaderCircleIcon, PackageCheckIcon } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";

import { ErrorDialog } from "@/components/feedback/error-dialog";
import { Field, FormAlert } from "@/components/forms/field";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { formatCount, formatDay } from "@/lib/display";
import type { ActionError } from "@/lib/result";
import type { SalesReturnForm as SalesReturnFormData } from "@/modules/sales/return-screens.service";
import { createSalesReturnAction } from "@/server/actions/sales.actions";

import { Totals } from "./detail-bits";
import { money, salesHref } from "./labels";
import { wholeNumber } from "./order-style-card";
import { estimateReturn } from "./return-estimate";

/** The problems left once these fields are changed. */
const without = (all: Record<string, string>, ...keys: string[]) =>
  Object.fromEntries(Object.entries(all).filter(([key]) => !keys.includes(key)));

/** Reasons offered as the person types (any other reason can be written). */
const REASONS = [
  "Size problem",
  "Quality fault",
  "Damaged in transit",
  "Wrong item sent",
  "Colour not as ordered",
];

/**
 * A sales return on one invoice (accounts.receipts.record, as the action
 * checks): the pieces coming back per invoice line, at most what was delivered
 * and has not come back, the day and the reason. The credit is estimated as
 * the pieces are entered, at the prices billed with the invoice's discount and
 * VAT shares; the saved credit note shows the figure recorded.
 */
export function SalesReturnForm({
  form,
  currency,
}: {
  form: SalesReturnFormData;
  currency: string;
}) {
  const router = useRouter();
  const [counts, setCounts] = useState<Record<string, string>>({});
  const [returnDate, setReturnDate] = useState(form.today);
  const [reason, setReason] = useState("");
  const [notes, setNotes] = useState("");
  const [problems, setProblems] = useState<Record<string, string>>({});
  const [error, setError] = useState<ActionError>();
  const [pending, startTransition] = useTransition();
  // The lines sent, in order, so the server's "items.0.quantity" finds its line.
  const [sent, setSent] = useState<string[]>([]);

  const takes = useMemo(
    () =>
      Object.fromEntries(
        form.lines.map((l) => [l.id, Math.min(wholeNumber(counts[l.id]) ?? 0, l.returnable)]),
      ),
    [counts, form.lines],
  );
  const estimate = estimateReturn(form, takes);
  const serverError = (name: string) => error?.fieldErrors?.[name]?.[0];
  const lineError = (id: string) => {
    if (problems[`line.${id}`]) return problems[`line.${id}`];
    const index = sent.indexOf(id);
    return index >= 0 ? serverError(`items.${index}.quantity`) : undefined;
  };
  const fieldError = (name: string) => problems[name] ?? serverError(name);
  const hasFieldErrors =
    Object.keys(problems).length > 0 || Object.keys(error?.fieldErrors ?? {}).length > 0;
  const returnable = form.lines.filter((l) => l.returnable > 0);

  function fillAll() {
    setCounts(Object.fromEntries(returnable.map((l) => [l.id, String(l.returnable)])));
    setProblems({});
  }

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(undefined);
    const found: Record<string, string> = {};
    for (const line of returnable) {
      const text = counts[line.id]?.trim() ?? "";
      if (!text) continue;
      const n = wholeNumber(text);
      if (n === null) found[`line.${line.id}`] = "Whole pieces";
      else if (n > line.returnable) found[`line.${line.id}`] = `At most ${line.returnable}`;
    }
    if (estimate.pieces === 0 && Object.keys(found).length === 0) {
      found.items = "Enter the pieces coming back on at least one line.";
    }
    if (reason.trim().length < 3) found.reason = "Say why the goods came back";
    if (!returnDate) found.returnDate = "Choose the day the goods came back";
    else if (returnDate > form.today) found.returnDate = "Choose today or an earlier day";
    else if (returnDate < form.invoice.issuedOn) {
      found.returnDate = `Choose ${formatDay(form.invoice.issuedOn)} or later`;
    }
    setProblems(found);
    if (Object.keys(found).length > 0) return;

    const lines = form.lines.filter((l) => (takes[l.id] ?? 0) > 0);
    setSent(lines.map((l) => l.id));
    startTransition(async () => {
      const result = await createSalesReturnAction({
        invoiceId: form.invoice.id,
        items: lines.map((l) => ({ orderItemId: l.id, quantity: takes[l.id] })),
        reason: reason.trim(),
        returnDate,
        notes: notes.trim() || null,
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      router.push(`${salesHref.salesReturn(result.data.id)}?created=1`);
    });
  }

  return (
    <form onSubmit={submit} className="grid min-w-0 gap-8" noValidate>
      <section aria-labelledby="pieces-heading" className="grid min-w-0 gap-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <h3 id="pieces-heading" className="font-serif text-lg text-primary">
            Pieces coming back
          </h3>
          {returnable.length > 0 && (
            <Button type="button" variant="ghost" size="sm" onClick={fillAll}>
              <PackageCheckIcon aria-hidden />
              Everything delivered
            </Button>
          )}
        </div>
        <p className="-mt-2 text-sm text-muted-foreground">
          Up to the pieces delivered that have not come back yet. Each is credited at the price
          billed on {form.invoice.number}.
        </p>
        <ul className="grid grid-cols-1 divide-y rounded-lg border bg-card">
          {form.lines.map((line) => {
            const id = `return-${line.id}`;
            const err = lineError(line.id);
            const take = takes[line.id] ?? 0;
            return (
              <li
                key={line.id}
                className="grid min-w-0 gap-3 p-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center"
              >
                <div className="min-w-0 text-sm">
                  <label htmlFor={id} className="font-medium break-words">
                    {line.style} · {line.color} · {line.size}
                  </label>
                  <p className="text-[0.8125rem] text-muted-foreground">
                    {line.sku} · {money(line.priceBilled, currency)} a piece
                  </p>
                  <p className="mt-1 text-[0.8125rem] text-muted-foreground tabular-nums">
                    Billed {formatCount(line.billed, currency)} · delivered{" "}
                    {formatCount(line.delivered, currency)}
                    {line.returned > 0 && ` · ${formatCount(line.returned, currency)} back already`}
                  </p>
                </div>
                {line.returnable > 0 ? (
                  <div className="grid gap-1 sm:justify-items-end">
                    <div className="flex items-center gap-3">
                      <Input
                        id={id}
                        inputMode="numeric"
                        autoComplete="off"
                        placeholder="0"
                        value={counts[line.id] ?? ""}
                        onChange={(e) => {
                          setCounts((all) => ({ ...all, [line.id]: e.target.value }));
                          setProblems((all) => without(all, `line.${line.id}`, "items"));
                        }}
                        aria-invalid={Boolean(err)}
                        aria-describedby={err ? `${id}-error` : `${id}-hint`}
                        className="w-24 text-right tabular-nums"
                      />
                      <span className="w-28 text-right text-sm font-medium tabular-nums">
                        {take > 0 ? money(estimate.amounts[line.id]!, currency) : "—"}
                      </span>
                    </div>
                    {err ? (
                      <p id={`${id}-error`} className="text-[0.8125rem] text-destructive">
                        {err}
                      </p>
                    ) : (
                      <p id={`${id}-hint`} className="text-[0.8125rem] text-muted-foreground">
                        Up to {formatCount(line.returnable, currency)}
                      </p>
                    )}
                  </div>
                ) : (
                  <p className="text-[0.8125rem] text-muted-foreground sm:text-right">
                    {line.delivered === 0 ? "Not delivered yet" : "All delivered pieces are back"}
                  </p>
                )}
              </li>
            );
          })}
        </ul>
        {problems.items && <FormAlert>{problems.items}</FormAlert>}
      </section>

      <div className="grid items-start gap-5 sm:grid-cols-2">
        <Field
          id="returnDate"
          label="Came back on"
          hint={`Between ${formatDay(form.invoice.issuedOn)} and today`}
          error={fieldError("returnDate")}
        >
          <Input
            id="returnDate"
            type="date"
            value={returnDate}
            min={form.invoice.issuedOn}
            max={form.today}
            onChange={(e) => setReturnDate(e.target.value)}
            aria-invalid={Boolean(fieldError("returnDate"))}
          />
        </Field>
        <Field
          id="reason"
          label="Reason"
          hint="Printed on the credit note and kept with the pieces in Damage & QC Rejects"
          error={fieldError("reason")}
        >
          <Input
            id="reason"
            list="return-reasons"
            value={reason}
            maxLength={500}
            onChange={(e) => {
              setReason(e.target.value);
              setProblems((all) => without(all, "reason"));
            }}
            aria-invalid={Boolean(fieldError("reason"))}
          />
          <datalist id="return-reasons">
            {REASONS.map((r) => (
              <option key={r} value={r} />
            ))}
          </datalist>
        </Field>
        <Field id="notes" label="Notes (optional)" className="sm:col-span-2">
          <Textarea
            id="notes"
            rows={2}
            maxLength={1000}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />
        </Field>
      </div>

      <section
        aria-labelledby="credit-heading"
        className="grid gap-4 rounded-lg border bg-card p-5"
      >
        <h3 id="credit-heading" className="font-serif text-lg text-primary">
          Credit to the buyer
        </h3>
        <Totals
          currency={currency}
          className="sm:max-w-sm"
          lines={[
            {
              label: `Goods back (${formatCount(estimate.pieces, currency)} pcs)`,
              amount: estimate.goods,
            },
            {
              label: "Their share of the discount",
              amount: estimate.discount,
              minus: true,
              optional: true,
            },
            { label: "Their share of the VAT", amount: estimate.tax, optional: true },
            { label: "Credit", amount: estimate.total, strong: true },
          ]}
        />
        <p className="text-[0.8125rem] leading-relaxed text-muted-foreground">
          The credit goes on {form.buyer?.name ?? "the buyer"}&apos;s account. It first pays
          anything they owed from before outside their invoices, such as an opening balance; the
          rest can be used on any invoice (&quot;Use credit&quot; on an order). The pieces go to
          Damage &amp; QC Rejects{form.warehouse ? ` in ${form.warehouse}` : ""}, not back into
          sellable stock. A delivery charge is not credited.
        </p>
      </section>

      {hasFieldErrors && !problems.items && (
        <FormAlert>Please check the highlighted fields.</FormAlert>
      )}
      {error && error.code !== "INTERNAL" && !error.fieldErrors && (
        <FormAlert>{error.message}</FormAlert>
      )}

      <div className="flex flex-col-reverse gap-2 border-t pt-6 sm:flex-row sm:justify-end">
        <Button asChild variant="outline">
          <Link href={salesHref.invoice(form.invoice.id)}>Cancel</Link>
        </Button>
        <Button type="submit" disabled={pending}>
          {pending && <LoaderCircleIcon className="animate-spin" aria-hidden />}
          {pending ? "Recording" : "Record the return"}
        </Button>
      </div>
      {error?.code === "INTERNAL" && (
        <ErrorDialog
          code={error.errorId ?? "ERR-UNKNOWN"}
          title="We could not record the return"
          onClose={() => setError(undefined)}
        />
      )}
    </form>
  );
}
