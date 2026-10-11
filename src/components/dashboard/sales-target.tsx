"use client";

import { TargetIcon, TrophyIcon } from "lucide-react";
import { useId, useState } from "react";

import { Amount, ScopeEye } from "@/components/accounts/privacy";
import { Field, FormAlert } from "@/components/forms/field";
import { AMOUNT_HINT, readAmount, textOf } from "@/components/products/form-values";
import { FormDialog, problem } from "@/components/sales/dialogs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatCount, formatMonth, groupAmount } from "@/lib/display";
import { cn } from "@/lib/utils";
import type { HomeTopBar } from "@/modules/dashboard/home.service";
import { setSalesTargetAction } from "@/server/actions/dashboard.actions";

type SalesTarget = NonNullable<HomeTopBar["salesTarget"]>;

const SCOPE = "target";

/** "October 2026" for "2026-10". */
const longMonth = (month: string) =>
  new Intl.DateTimeFormat("en-GB", { month: "long", year: "numeric", timeZone: "UTC" }).format(
    new Date(`${month}-01T00:00:00Z`),
  );

function SetTargetDialog({
  data,
  currency,
  onClose,
  onSaved,
}: {
  data: SalesTarget;
  currency: string;
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  const id = useId();
  return (
    <FormDialog
      title="Monthly sales target"
      description="The sales to aim for in a month, after discounts and without VAT or delivery charges. Later months keep it until it is changed."
      submitLabel="Save the target"
      pendingLabel="Saving"
      errorTitle="We could not save the target"
      onClose={onClose}
      onSubmit={async (form) => {
        const amount = readAmount(textOf(form, "amount"));
        if (amount === "invalid") return problem({ amount: AMOUNT_HINT });
        if (amount === null || amount <= 0) return problem({ amount: "Enter the target." });
        const month = textOf(form, "month") || data.month;
        const result = await setSalesTargetAction({ month, amount });
        if (!result.ok) return result.error;
        onSaved(`The target for ${longMonth(result.data.month)} is saved.`);
      }}
    >
      {(fieldError) => (
        <div className="grid items-start gap-5 sm:grid-cols-2">
          <Field id={`${id}-month`} label="Month" error={fieldError("month")}>
            <Input
              id={`${id}-month`}
              name="month"
              type="month"
              required
              min={data.month}
              defaultValue={data.month}
              aria-invalid={Boolean(fieldError("month"))}
            />
          </Field>
          <Field id={`${id}-amount`} label={`Target (${currency})`} error={fieldError("amount")}>
            <Input
              id={`${id}-amount`}
              name="amount"
              inputMode="decimal"
              placeholder="0.00"
              autoComplete="off"
              autoFocus
              defaultValue={
                data.target && data.target.setFor === data.month ? data.target.amount : ""
              }
              aria-invalid={Boolean(fieldError("amount"))}
            />
          </Field>
        </div>
      )}
    </FormDialog>
  );
}

/**
 * The month's sales against the target as a bar that fills up: the share
 * reached, whether the month is on pace (the mark on the bar is where a steady
 * month would be by today), and what each remaining day needs to sell. The
 * amounts stay *** until the eye shows them; the share always shows.
 */
export function SalesTargetBar({ data, currency }: { data: SalesTarget; currency: string }) {
  const [editing, setEditing] = useState(false);
  const [notice, setNotice] = useState<string>();
  const t = data.target;
  const amount = (fixed: string) => (
    <Amount scope={SCOPE}>{`${currency} ${groupAmount(fixed, currency)}`}</Amount>
  );
  const days = `${formatCount(data.daysLeft, currency)} ${data.daysLeft === 1 ? "day" : "days"} left`;

  return (
    <section
      aria-labelledby="sales-target-heading"
      className="rounded-lg border bg-card p-5 sm:p-6"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 id="sales-target-heading" className="eyebrow flex items-center gap-2">
            <TargetIcon className="size-4 text-primary" aria-hidden />
            Monthly sales target
          </h2>
          <p className="mt-1 text-[0.8125rem] text-muted-foreground">{longMonth(data.month)}</p>
        </div>
        <div className="-mt-1 flex shrink-0 items-center gap-1">
          {t && <ScopeEye scope={SCOPE} label="the sales target" />}
          {data.canSet && (
            <Button type="button" variant="outline" size="sm" onClick={() => setEditing(true)}>
              {t ? "Change target" : "Set target"}
            </Button>
          )}
        </div>
      </div>

      {t ? (
        <div className="mt-4 grid gap-3">
          <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
            <p className="font-serif text-[2rem] leading-none text-primary tabular-nums">
              {formatCount(t.percent, currency)}%
              <span className="ml-2 font-sans text-sm text-muted-foreground">achieved</span>
            </p>
            <p
              className={cn(
                "inline-flex items-center gap-1.5 text-[0.8125rem] font-medium",
                t.reached ? "text-success" : t.onPace ? "text-primary" : "text-destructive",
              )}
            >
              {t.reached && <TrophyIcon className="size-4" aria-hidden />}
              {t.reached ? "Target reached" : t.onPace ? "On pace" : "Behind pace"}
            </p>
          </div>
          <div
            role="progressbar"
            aria-label="Share of the monthly sales target reached"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.min(t.percent, 100)}
            aria-valuetext={`${t.percent}% of the target, with ${t.monthGonePct}% of the month gone`}
            className="relative h-3 overflow-hidden rounded-full bg-muted"
          >
            <div
              className={cn(
                "h-full rounded-full transition-[width] duration-700",
                t.reached ? "bg-success" : "bg-primary",
              )}
              style={{ width: `${Math.min(t.percent, 100)}%` }}
            />
            <div
              aria-hidden
              title="Where a steady month would be by today"
              className="absolute inset-y-0 w-0.5 bg-foreground/40"
              style={{ left: `${Math.min(t.monthGonePct, 100)}%` }}
            />
          </div>
          <p className="text-sm text-muted-foreground">
            {amount(data.achieved)} of {amount(t.amount)} · {days}
          </p>
          {!t.reached && (
            <p className="text-[0.8125rem] text-muted-foreground">
              To reach it, sell {amount(t.perDayLeft)} a day for the rest of the month.
            </p>
          )}
          {t.setFor !== data.month && (
            <p className="text-[0.8125rem] text-muted-foreground">
              Carried over from {formatMonth(t.setFor)}.
            </p>
          )}
        </div>
      ) : (
        <p className="mt-4 text-sm text-muted-foreground">
          {data.canSet
            ? "Set a target for the month to see how sales are going against it."
            : "No sales target is set for this month yet. The owner sets it here."}
        </p>
      )}
      {notice && (
        <div className="mt-4">
          <FormAlert tone="success">{notice}</FormAlert>
        </div>
      )}

      {editing && (
        <SetTargetDialog
          data={data}
          currency={currency}
          onClose={() => setEditing(false)}
          onSaved={(message) => {
            setNotice(message);
            setEditing(false);
          }}
        />
      )}
    </section>
  );
}
