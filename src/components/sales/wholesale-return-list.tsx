"use client";

import { PlusIcon } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { PinField } from "@/components/ai/pin-prompt";
import { Field } from "@/components/forms/field";
import { EmptyState } from "@/components/products/bits";
import { Fact, Panel } from "@/components/sales/detail-bits";
import { FormDialog } from "@/components/sales/dialogs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatDay } from "@/lib/display";
import type { WholesaleReturnList as Page } from "@/modules/sales/wholesale-return.service";
import { setWholesaleReturnSettingsAction } from "@/server/actions/wholesale-returns.actions";

import { money } from "./labels";

/*
 * Sales > Wholesale returns (2026-11-12): every return with its status and
 * pieces (received, refunded, exchanged, A / B / Reject), the filters, the
 * pieces in "Returns to check", and the month's totals with each buyer's
 * return rate.
 */

export const WR_STATUS: Record<string, string> = {
  RECEIVED: "Received",
  APPROVED: "Approved",
  CHECKED: "Checked",
  DONE: "Done",
};

const split = (f: Page["items"][number]["figures"]) =>
  f.a === null ? "Not checked yet" : `A ${f.a} · B ${f.b} · Reject ${f.reject}`;

export function WholesaleReturnList({ page }: { page: Page }) {
  const router = useRouter();
  const [settings, setSettings] = useState(false);
  const m = page.month;
  const f = page.filters;
  return (
    <section aria-labelledby="wr-heading" className="grid min-w-0 gap-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          <h2 id="wr-heading" className="font-serif text-2xl text-primary">
            Wholesale returns
          </h2>
          <p className="mt-1 max-w-xl text-sm leading-relaxed text-muted-foreground">
            Goods a wholesale buyer sends back, in three steps: receive (refund or exchange),
            approve the refund, and QC into A-grade, B-grade or Reject.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {page.access.settings && (
            <Button type="button" variant="outline" onClick={() => setSettings(true)}>
              PIN amount
            </Button>
          )}
          {page.access.receive && (
            <Button asChild>
              <Link href="/sales/wholesale-returns/new">
                <PlusIcon aria-hidden />
                Receive return
              </Link>
            </Button>
          )}
        </div>
      </div>

      <dl className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Fact label="Returns to check">{page.toCheck} pcs</Fact>
        <Fact label="Refund needs the PIN over">{money(page.pinAbove, page.currency)}</Fact>
      </dl>

      <form method="get" className="grid gap-3 sm:grid-cols-2 lg:grid-cols-6 lg:items-end">
        <Field id="wr-q" label="Search">
          <Input id="wr-q" name="q" defaultValue={f.search ?? ""} placeholder="Number or buyer" />
        </Field>
        <Field id="wr-status" label="Status">
          <select
            id="wr-status"
            name="status"
            defaultValue={f.status ?? ""}
            className="h-9 w-full rounded-md border bg-background px-3 text-sm"
          >
            <option value="">All</option>
            <option value="OPEN">Waiting for a step</option>
            <option value="RECEIVED">Received</option>
            <option value="APPROVED">Approved</option>
            <option value="CHECKED">Checked</option>
            <option value="DONE">Done</option>
          </select>
        </Field>
        <Field id="wr-from" label="From">
          <Input id="wr-from" name="from" type="date" defaultValue={f.from ?? ""} />
        </Field>
        <Field id="wr-to" label="To">
          <Input id="wr-to" name="to" type="date" defaultValue={f.to ?? ""} />
        </Field>
        <Field id="wr-month" label="Month">
          <Input id="wr-month" name="month" type="month" defaultValue={m.month} />
        </Field>
        <Button type="submit" variant="outline">
          Show
        </Button>
      </form>

      {page.items.length === 0 ? (
        <EmptyState title="No wholesale returns">
          A return shows here once goods are received back on a wholesale buyer&apos;s invoice.
        </EmptyState>
      ) : (
        <ul className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3" aria-label="Returns">
          {page.items.map((r) => (
            <li key={r.id} className="min-w-0">
              <Link
                href={`/sales/wholesale-returns/${r.id}`}
                className="block rounded-lg border bg-card p-4 transition-colors hover:border-primary/40"
              >
                <p className="eyebrow flex flex-wrap justify-between gap-2">
                  <span className="break-words">
                    {r.number} · {formatDay(r.receivedOn)}
                  </span>
                  <span>{WR_STATUS[r.status]}</span>
                </p>
                <p className="mt-2 font-serif text-lg leading-snug break-words text-primary">
                  {r.buyer.name}
                </p>
                <p className="mt-1 text-sm break-words text-muted-foreground">
                  {r.invoice?.number}
                  {r.daysSinceSale !== null ? ` · ${r.daysSinceSale} days after the sale` : ""}
                </p>
                <p className="mt-3 border-t pt-3 text-sm break-words tabular-nums">
                  {r.figures.received} received · {r.figures.refunded} refunded ·{" "}
                  {r.figures.exchanged} exchanged · {split(r.figures)}
                </p>
              </Link>
            </li>
          ))}
        </ul>
      )}

      <Panel title="This month" id="wr-month-report">
        <p className="mt-2 text-sm text-muted-foreground">
          {m.month}: {m.returns} returns, {m.received} pcs received, {m.refunded} refunded,{" "}
          {m.exchanged} exchanged; QC: A {m.a}, B {m.b}, Reject {m.reject}; {m.toCheck} still to
          check.
        </p>
        {m.buyers.length > 0 && (
          <ul className="mt-4 grid gap-2 sm:grid-cols-2" aria-label="Return rate by buyer">
            {m.buyers.map((b) => (
              <li key={b.id} className="min-w-0 rounded-md border p-3 text-sm break-words">
                <span className="font-medium">{b.name}</span>: {b.pieces} pcs back of {b.delivered}{" "}
                delivered
                {b.rate !== null ? ` (return rate ${b.rate}%)` : ""}
              </li>
            ))}
          </ul>
        )}
      </Panel>

      {settings && (
        <FormDialog
          title="PIN amount"
          description="Approving a refund over this amount asks for the owner's PIN."
          submitLabel="Save the amount"
          pendingLabel="Saving"
          errorTitle="The amount was not saved"
          onClose={() => setSettings(false)}
          onSubmit={async (form) => {
            const result = await setWholesaleReturnSettingsAction({
              pinAbove: String(form.get("pinAbove") ?? "").trim(),
              pin: String(form.get("pin") ?? "").trim(),
            });
            if (!result.ok) return result.error;
            router.refresh();
            setSettings(false);
            return undefined;
          }}
        >
          {(fieldError) => (
            <>
              <Field
                id="wr-pin-above"
                label={`Refund needs the PIN over (${page.currency})`}
                error={fieldError("pinAbove")}
              >
                <Input
                  id="wr-pin-above"
                  name="pinAbove"
                  inputMode="decimal"
                  defaultValue={page.pinAbove}
                />
              </Field>
              <PinField id="wr-settings-pin" error={fieldError("pin") ?? fieldError("pinNotSet")} />
            </>
          )}
        </FormDialog>
      )}
    </section>
  );
}
