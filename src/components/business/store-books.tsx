"use client";

import { TriangleAlertIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { Field } from "@/components/forms/field";
import { Fact, Panel } from "@/components/sales/detail-bits";
import { FormDialog } from "@/components/sales/dialogs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { StoreBooks as Books } from "@/modules/retail/summaries.service";
import {
  copyLastMonthBudgetAction,
  setBudgetAction,
  setTargetAction,
} from "@/server/actions/retail.actions";

/*
 * A retail store's own books on its page (plan v6 sec 6, 6a and 7): the days
 * its site sent, the days missing, this month's fixed costs, the budget (80%
 * yellow, over 100% red) and the sales target.
 */

const LINE: Record<string, string> = {
  ads: "Ads",
  packaging: "Packaging",
  delivery: "Delivery",
  salary: "Salary",
  other: "Other",
};
const STATE: Record<string, string> = {
  GREEN: "text-emerald-700 dark:text-emerald-400",
  YELLOW: "text-amber-700 dark:text-amber-400",
  RED: "text-destructive",
  NONE: "text-muted-foreground",
};

const monthName = (month: string) =>
  new Date(`${month}-01T00:00:00Z`).toLocaleString("en-GB", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
const dayName = (day: string) =>
  new Date(`${day}T00:00:00Z`).toLocaleString("en-GB", {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  });

export function StoreBooks({
  books,
  storeId,
  currency,
  canManage,
}: {
  books: Books;
  storeId: string;
  currency: string;
  canManage: boolean;
}) {
  const router = useRouter();
  const [dialog, setDialog] = useState<"budget" | "target" | null>(null);
  const [copyError, setCopyError] = useState<string>();
  const close = () => setDialog(null);
  const month = monthName(books.month);
  const so = books.monthSoFar;
  const money = (v: string | null) => (v === null ? "-" : `${currency} ${v}`);

  return (
    <>
      <Panel title="Daily figures" id="store-days">
        <p className="mt-2 text-sm text-muted-foreground">
          What the store&apos;s site sends for each day. A figure it does not have yet shows
          &quot;not complete yet&quot;, never 0.
        </p>
        {books.missing.length > 0 && (
          <p className="mt-3 flex items-start gap-1.5 text-sm text-destructive">
            <TriangleAlertIcon aria-hidden className="mt-0.5 size-4 shrink-0" />
            Missing days: {books.missing.map(dayName).join(", ")}
          </p>
        )}
        <dl className="mt-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <Fact label={`Net sales, ${month}`}>{money(so.netSales)}</Fact>
          <Fact label="Profit before fixed costs">{money(so.netProfit)}</Fact>
          <Fact label="Fixed costs">
            {books.fixed ? (
              `${currency} ${books.fixed.total.toFixed(2)} (${currency} ${books.fixed.perDay} a day)`
            ) : (
              <span className="text-destructive">Fixed costs for {month} not in yet</span>
            )}
          </Fact>
          <Fact label="Profit after fixed costs">{money(so.afterFixed)}</Fact>
        </dl>
        {so.incomplete.length > 0 && (
          <p className="mt-3 text-sm text-amber-700 dark:text-amber-400">
            Not complete yet: {so.incomplete.join(", ")}
          </p>
        )}
        {books.days.length === 0 ? (
          <p className="mt-4 text-sm text-muted-foreground">No days sent yet.</p>
        ) : (
          <ul className="mt-4 grid gap-2" aria-label="Days sent">
            {books.days.map((d) => (
              <li key={d.date} className="rounded-md border p-3 text-sm">
                <p className="font-medium">
                  {dayName(d.date)} · Profit {currency} {d.netProfit}
                </p>
                {d.incomplete.length > 0 && (
                  <p className="text-amber-700 dark:text-amber-400">
                    Not complete yet: {d.incomplete.join(", ")}
                  </p>
                )}
                {!d.profitMatches && (
                  <p className="text-destructive">
                    The sum does not match: the ERP gets {currency} {d.checkedProfit}
                  </p>
                )}
                {d.previousProfit !== null && (
                  <p className="text-muted-foreground">
                    Sent {d.versions} times; profit was {currency} {d.previousProfit}
                  </p>
                )}
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <Panel
        title="Budget"
        id="store-budget"
        action={
          canManage && (
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={async () => {
                  const result = await copyLastMonthBudgetAction(storeId, books.month);
                  setCopyError(result.ok ? undefined : result.error.message);
                  if (result.ok) router.refresh();
                }}
              >
                Copy last month
              </Button>
              <Button type="button" size="sm" onClick={() => setDialog("budget")}>
                Set budget
              </Button>
            </div>
          )
        }
      >
        <p className="mt-2 text-sm text-muted-foreground">
          {month}: what the site spent against your budget. Yellow from 80%, red over 100% (you get
          an alarm).
        </p>
        {copyError && <p className="mt-2 text-sm text-destructive">{copyError}</p>}
        <dl className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-3 xl:grid-cols-5">
          {books.budget.map((b) => (
            <Fact key={b.line} label={LINE[b.line]!}>
              <span className={STATE[b.state]}>
                {currency} {b.spent}
                {b.budget !== null ? ` of ${b.budget}` : " (no budget)"}
              </span>
            </Fact>
          ))}
        </dl>
      </Panel>

      <Panel
        title="Sales target"
        id="store-target"
        action={
          canManage && (
            <Button type="button" size="sm" onClick={() => setDialog("target")}>
              Set target
            </Button>
          )
        }
      >
        <p className="mt-4 text-sm">
          {books.target
            ? `${month}: ${currency} ${books.target.done} of ${currency} ${books.target.sales} (${books.target.percent}%)`
            : `No target for ${month}.`}
        </p>
      </Panel>

      {dialog === "budget" && (
        <FormDialog
          title="Set budget"
          description={`The budget for ${month}, by line. Leave a line empty to not budget it.`}
          submitLabel="Save the budget"
          pendingLabel="Saving"
          errorTitle="The budget was not saved"
          onClose={close}
          onSubmit={async (form) => {
            const text = (name: string) => String(form.get(name) ?? "").trim();
            const result = await setBudgetAction(storeId, {
              month: books.month,
              ...Object.fromEntries(books.budget.map((b) => [b.line, text(b.line)])),
            });
            if (!result.ok) return result.error;
            router.refresh();
            close();
            return undefined;
          }}
        >
          {(fieldError) => (
            <>
              {books.budget.map((b) => (
                <Field
                  key={b.line}
                  id={`budget-${b.line}`}
                  label={`${LINE[b.line]} (${currency})`}
                  error={fieldError(b.line)}
                >
                  <Input
                    id={`budget-${b.line}`}
                    name={b.line}
                    inputMode="decimal"
                    defaultValue={b.budget ?? ""}
                  />
                </Field>
              ))}
            </>
          )}
        </FormDialog>
      )}
      {dialog === "target" && (
        <FormDialog
          title="Set target"
          description={`Net sales the store should reach in ${month}. 0 takes it off.`}
          submitLabel="Save the target"
          pendingLabel="Saving"
          errorTitle="The target was not saved"
          onClose={close}
          onSubmit={async (form) => {
            const result = await setTargetAction(storeId, {
              month: books.month,
              sales: String(form.get("sales") ?? "").trim(),
            });
            if (!result.ok) return result.error;
            router.refresh();
            close();
            return undefined;
          }}
        >
          {(fieldError) => (
            <Field id="target-sales" label={`Net sales (${currency})`} error={fieldError("sales")}>
              <Input
                id="target-sales"
                name="sales"
                inputMode="decimal"
                defaultValue={books.target?.sales ?? ""}
                placeholder="500000"
              />
            </Field>
          )}
        </FormDialog>
      )}
    </>
  );
}
