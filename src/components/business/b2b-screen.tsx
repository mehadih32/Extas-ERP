"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { Field } from "@/components/forms/field";
import { Fact, Panel } from "@/components/sales/detail-bits";
import { FormDialog } from "@/components/sales/dialogs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { groupAmount } from "@/lib/display";
import type { B2bPage } from "@/modules/business/b2b.service";
import { setB2bBudgetAction } from "@/server/actions/business.actions";

/*
 * Business > B2B (2026-11-12): what finding new wholesale buyers cost in a
 * month, by sub-head of "Customer acquisition (B2B)", the new buyers, the cost
 * per new buyer, and the month's budget (80% yellow, over 100% red).
 */

const STATE: Record<string, string> = {
  GREEN: "text-emerald-700 dark:text-emerald-400",
  YELLOW: "text-amber-700 dark:text-amber-400",
  RED: "text-destructive",
  NONE: "",
};

const monthName = (month: string) =>
  new Date(`${month}-01T00:00:00Z`).toLocaleString("en-GB", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });

export function B2bScreen({ page }: { page: B2bPage }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const { currency } = page;
  const g = (v: string) => `${currency} ${groupAmount(Number(v).toFixed(2), currency)}`;
  const month = monthName(page.month);

  return (
    <div className="grid min-w-0 gap-6">
      <div>
        <h2 className="font-serif text-2xl text-primary">B2B</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          What finding new wholesale buyers cost: the &quot;Customer acquisition (B2B)&quot;
          expenses recorded in Accounts. An office cost, never part of order costing, and never
          mixed with the shops&apos; ad spend.
        </p>
      </div>

      <form method="get" className="flex flex-wrap items-end gap-3">
        <Field id="b2b-month" label="Month">
          <Input
            id="b2b-month"
            name="month"
            type="month"
            defaultValue={page.month}
            max={page.thisMonth}
            className="w-44"
          />
        </Field>
        <Button type="submit" variant="outline">
          Show
        </Button>
      </form>

      <dl className="grid gap-4 sm:grid-cols-3">
        <Fact label="Acquisition spend">
          <span className={STATE[page.totalState]}>
            {g(page.total)}
            {page.budgetTotal !== null ? ` of ${g(page.budgetTotal)}` : ""}
          </span>
        </Fact>
        <Fact label="New buyers">{page.newBuyers.length}</Fact>
        <Fact label="Cost per new buyer">
          {page.costPerNewBuyer === null ? "No new buyer yet" : g(page.costPerNewBuyer)}
        </Fact>
      </dl>

      <Panel
        title="Spend by sub-head"
        id="b2b-lines"
        action={
          <Button type="button" size="sm" onClick={() => setOpen(true)}>
            Set budget
          </Button>
        }
      >
        <p className="mt-2 text-sm text-muted-foreground">
          {month}: what was spent against the budget. Yellow from 80%, red over 100%.
        </p>
        <ul className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {page.lines.map((l) => (
            <li key={l.line} className="min-w-0 rounded-md border p-3">
              <p className="text-sm text-muted-foreground">{l.name}</p>
              <p className={`mt-1 font-medium break-words ${STATE[l.state]}`}>
                {g(l.spent)}
                {l.budget !== null ? ` of ${g(l.budget)} (${l.percent}%)` : " (no budget)"}
              </p>
            </li>
          ))}
        </ul>
      </Panel>

      <Panel title="New buyers this month" id="b2b-buyers">
        <p className="mt-2 text-sm text-muted-foreground">
          Buyers whose first wholesale order is in {month}. The retail stores do not count.
        </p>
        {page.newBuyers.length === 0 ? (
          <p className="mt-4 text-sm">No new buyer in {month}.</p>
        ) : (
          <ul className="mt-4 grid gap-2 sm:grid-cols-2">
            {page.newBuyers.map((b) => (
              <li key={b.id} className="min-w-0 break-words">
                <Link
                  href={`/parties/buyers/${b.id}`}
                  className="text-primary underline-offset-4 hover:underline"
                >
                  {b.name}
                </Link>{" "}
                <span className="text-sm text-muted-foreground">{b.code}</span>
              </li>
            ))}
          </ul>
        )}
      </Panel>

      {open && (
        <FormDialog
          title="Set budget"
          description={`The budget for ${month}, by sub-head. Leave one empty to not budget it.`}
          submitLabel="Save the budget"
          pendingLabel="Saving"
          errorTitle="The budget was not saved"
          onClose={() => setOpen(false)}
          onSubmit={async (form) => {
            const result = await setB2bBudgetAction({
              month: page.month,
              ...Object.fromEntries(
                page.lines.map((l) => [l.line, String(form.get(l.line) ?? "").trim()]),
              ),
            });
            if (!result.ok) return result.error;
            router.refresh();
            setOpen(false);
            return undefined;
          }}
        >
          {(fieldError) => (
            <>
              {page.lines.map((l) => (
                <Field
                  key={l.line}
                  id={`b2b-budget-${l.line}`}
                  label={`${l.name} (${currency})`}
                  error={fieldError(l.line)}
                >
                  <Input
                    id={`b2b-budget-${l.line}`}
                    name={l.line}
                    inputMode="decimal"
                    defaultValue={l.budget ?? ""}
                  />
                </Field>
              ))}
            </>
          )}
        </FormDialog>
      )}
    </div>
  );
}
