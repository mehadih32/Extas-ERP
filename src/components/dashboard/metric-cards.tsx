"use client";

import { EyeIcon, EyeOffIcon, TrendingDownIcon, TrendingUpIcon } from "lucide-react";
import { useState, useTransition } from "react";

import { ActionErrorDialog } from "@/components/feedback/action-error-dialog";
import { Button } from "@/components/ui/button";
import { formatCount, formatDay, groupAmount } from "@/lib/display";
import type { ActionError } from "@/lib/result";
import { cn } from "@/lib/utils";
import type { getMetricCards } from "@/modules/dashboard/cards.service";
import { updateDashboardPreferencesAction } from "@/server/actions/dashboard.actions";

export type MetricCardsData = Awaited<ReturnType<typeof getMetricCards>>;
type MetricCard = MetricCardsData["cards"][number];
type Row = { label: string; value: string; strong?: boolean };

const MASK = "••••••";

/** Five cards over a six-column grid on wide screens: three across, then two. */
const SPAN: Record<MetricCard["key"], string> = {
  STOCK_VALUE: "lg:col-span-2",
  FIXED_ASSETS: "lg:col-span-2",
  LIABILITIES: "lg:col-span-2",
  TODAY_SALES: "lg:col-span-3",
  NET_PROFIT: "sm:col-span-2 lg:col-span-3",
};

/** The figures behind each card, written out for people. */
function detailRows(card: MetricCard, currency: string): Row[] {
  const money = (value: string) => groupAmount(value, currency);
  const count = (value: number) => formatCount(value, currency);
  switch (card.key) {
    case "STOCK_VALUE": {
      const d = card.details;
      return [
        { label: "A grade", value: `${count(d.aGrade.pieces)} pcs · ${money(d.aGrade.value)}` },
        { label: "B grade", value: `${count(d.bGrade.pieces)} pcs · ${money(d.bGrade.value)}` },
        { label: "Raw materials", value: money(d.rawMaterials) },
        { label: "Work in progress", value: money(d.workInProgress) },
        { label: "All stock held", value: money(d.allStock), strong: true },
      ];
    }
    case "FIXED_ASSETS": {
      const d = card.details;
      return [
        { label: "At cost", value: money(d.cost) },
        { label: "Depreciation so far", value: money(d.accumulatedDepreciation) },
        { label: "Assets in the register", value: count(d.assetCount) },
      ];
    }
    case "LIABILITIES": {
      const d = card.details;
      return [
        { label: "Loans", value: money(d.loans) },
        { label: "Investors", value: money(d.investors) },
      ];
    }
    case "TODAY_SALES": {
      const d = card.details;
      return [
        { label: "Invoices", value: count(d.invoices) },
        { label: "Pieces", value: count(d.pieces) },
        { label: "Yesterday", value: money(d.yesterday) },
      ];
    }
    case "NET_PROFIT": {
      const d = card.details;
      return [
        { label: "Last month", value: money(d.lastMonth) },
        {
          label: `Financial year from ${formatDay(d.financialYearFrom)}`,
          value: money(d.thisFinancialYear),
          strong: true,
        },
      ];
    }
  }
}

/** A line under the figure saying what it is, or how today compares with yesterday. */
function Caption({ card }: { card: MetricCard }) {
  const quiet = (text: string) => (
    <p className="mt-2 text-[0.8125rem] text-muted-foreground">{text}</p>
  );
  switch (card.key) {
    case "STOCK_VALUE":
      return quiet("Finished goods at average cost");
    case "FIXED_ASSETS":
      return quiet("Book value: cost less depreciation");
    case "LIABILITIES":
      return quiet("Owed to lenders and investors");
    case "NET_PROFIT":
      return quiet(`Since ${formatDay(card.details.monthFrom)}`);
    case "TODAY_SALES": {
      const { changePct } = card.details;
      if (changePct === null) return quiet("No sales yesterday to compare with");
      const down = changePct.startsWith("-");
      const Icon = down ? TrendingDownIcon : TrendingUpIcon;
      return (
        <p
          className={cn(
            "mt-2 inline-flex items-center gap-1.5 text-[0.8125rem]",
            down ? "text-destructive" : "text-success",
          )}
        >
          <Icon className="size-4" aria-hidden />
          {down ? "" : "+"}
          {changePct}% on yesterday
        </p>
      );
    }
  }
}

function MetricCardView({
  card,
  currency,
  hidden,
  onToggle,
}: {
  card: MetricCard;
  currency: string;
  hidden: boolean;
  onToggle: () => void;
}) {
  const negative = card.value.startsWith("-") && /[1-9]/.test(card.value);
  const rows = detailRows(card, currency);
  return (
    <article
      className={cn("flex min-w-0 flex-col rounded-lg border bg-card p-5 sm:p-6", SPAN[card.key])}
      aria-label={card.label}
    >
      <header className="flex items-start justify-between gap-3">
        <h3 className="eyebrow pt-1">{card.label}</h3>
        <button
          type="button"
          onClick={onToggle}
          aria-pressed={hidden}
          aria-label={
            hidden ? `Show ${card.label.toLowerCase()}` : `Hide ${card.label.toLowerCase()}`
          }
          title={hidden ? "Show figure" : "Hide figure"}
          className="-mt-1.5 -mr-1.5 inline-flex size-8 shrink-0 cursor-pointer items-center justify-center rounded-full text-muted-foreground transition-colors outline-none hover:bg-accent hover:text-primary focus-visible:ring-[3px] focus-visible:ring-ring/25"
        >
          {hidden ? <EyeOffIcon className="size-4" /> : <EyeIcon className="size-4" />}
        </button>
      </header>
      <p className="mt-4 flex min-w-0 flex-wrap items-baseline gap-x-2">
        <span className="text-[0.6875rem] font-medium tracking-[0.14em] text-muted-foreground">
          {currency}
        </span>
        <span
          className={cn(
            "font-serif text-[1.75rem] leading-tight tracking-tight lining-nums tabular-nums sm:text-[2rem]",
            hidden ? "text-muted-foreground" : negative && "text-destructive",
          )}
        >
          {hidden ? MASK : groupAmount(card.value, currency)}
        </span>
      </p>
      {hidden ? (
        <p className="mt-2 text-[0.8125rem] text-muted-foreground">Hidden on your screens</p>
      ) : (
        <Caption card={card} />
      )}
      <dl className="mt-5 grid gap-2 border-t pt-4 text-[0.8125rem]">
        {rows.map((row) => (
          <div key={row.label} className="flex items-baseline justify-between gap-4">
            <dt className="text-muted-foreground">{row.label}</dt>
            <dd
              className={cn(
                "text-right tabular-nums",
                row.strong && "font-medium",
                hidden && "text-muted-foreground",
              )}
            >
              {hidden ? "•••" : row.value}
            </dd>
          </div>
        ))}
      </dl>
    </article>
  );
}

/**
 * The owner's money cards (blueprint: stock value, fixed assets, liabilities,
 * today's sales, net profit). The eye hides a figure on this person's screens
 * (saved with their preferences), e.g. while someone looks over their shoulder.
 */
export function MetricCards({ data }: { data: MetricCardsData }) {
  const [hidden, setHidden] = useState(() => new Set<string>(data.hiddenMetrics));
  const [error, setError] = useState<ActionError>();
  const [, startTransition] = useTransition();
  const keys = data.cards.map((card) => card.key);
  const allHidden = keys.every((key) => hidden.has(key));

  function save(next: Set<string>, input: unknown, undo: (current: Set<string>) => Set<string>) {
    setHidden(next);
    startTransition(async () => {
      const result = await updateDashboardPreferencesAction(input);
      if (!result.ok) {
        setHidden(undo);
        setError(result.error);
      }
    });
  }

  function toggle(key: string) {
    const hide = !hidden.has(key);
    const flip = (set: Set<string>, on: boolean) => {
      const copy = new Set(set);
      if (on) copy.add(key);
      else copy.delete(key);
      return copy;
    };
    save(flip(hidden, hide), { metric: key, hidden: hide }, (current) => flip(current, !hide));
  }

  function toggleAll() {
    const previous = hidden;
    const next = new Set<string>(allHidden ? [] : keys);
    save(next, { hiddenMetrics: [...next] }, () => previous);
  }

  return (
    <section aria-labelledby="key-figures">
      <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-2">
        <div>
          <h2 id="key-figures" className="font-serif text-2xl text-primary">
            Key figures
          </h2>
          <p className="mt-1 text-[0.8125rem] text-muted-foreground">
            From the books, as of {formatDay(data.asOf)}
          </p>
        </div>
        <Button type="button" variant="ghost" size="sm" onClick={toggleAll} className="-mr-2">
          {allHidden ? <EyeIcon aria-hidden /> : <EyeOffIcon aria-hidden />}
          {allHidden ? "Show all figures" : "Hide all figures"}
        </Button>
      </div>
      <div className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-6">
        {data.cards.map((card) => (
          <MetricCardView
            key={card.key}
            card={card}
            currency={data.currency}
            hidden={hidden.has(card.key)}
            onToggle={() => toggle(card.key)}
          />
        ))}
      </div>
      <ActionErrorDialog
        error={error}
        title="Your choice was not saved"
        onClose={() => setError(undefined)}
      />
    </section>
  );
}
