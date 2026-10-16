"use client";

import { TrendingDownIcon, TrendingUpIcon } from "lucide-react";

import { Amount, ScopeEye, usePrivacy } from "@/components/accounts/privacy";
import { formatCount, formatDay, groupAmount } from "@/lib/display";
import { cn } from "@/lib/utils";
import type { getMetricCards } from "@/modules/dashboard/cards.service";

export type MetricCardsData = Awaited<ReturnType<typeof getMetricCards>>;
type MetricCard = MetricCardsData["cards"][number];
type Row = { label: string; value: string; strong?: boolean };

/** Six cards over a six-column grid on wide screens: three across, twice. */
const SPAN = "lg:col-span-2";

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
    case "BAD_STOCK_VALUE": {
      const d = card.details;
      return [
        { label: "Pieces written off", value: count(d.pieces) },
        {
          label: "This month",
          value: `${count(d.thisMonth.pieces)} pcs · ${money(d.thisMonth.value)}`,
        },
        { label: "Entries", value: count(d.entries) },
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
    case "BAD_STOCK_VALUE":
      return quiet("Damage & QC Rejects, at cost");
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

function MetricCardView({ card, currency }: { card: MetricCard; currency: string }) {
  const shown = usePrivacy().shown(card.key);
  const negative = card.value.startsWith("-") && /[1-9]/.test(card.value);
  const rows = detailRows(card, currency);
  return (
    <article
      className={cn("flex min-w-0 flex-col rounded-lg border bg-card p-5 sm:p-6", SPAN)}
      aria-label={card.label}
    >
      <header className="flex items-start justify-between gap-3">
        <h3 className="eyebrow pt-1">{card.label}</h3>
        <ScopeEye scope={card.key} label={card.label} className="-mt-1.5 -mr-1.5" />
      </header>
      <p className="mt-4 flex min-w-0 flex-wrap items-baseline gap-x-2">
        <span className="text-xs font-medium tracking-[0.14em] text-muted-foreground">
          {currency}
        </span>
        <span
          className={cn(
            "font-serif text-[1.75rem] leading-tight tracking-tight lining-nums tabular-nums sm:text-[2rem]",
            shown && negative && "text-destructive",
          )}
        >
          <Amount scope={card.key}>{groupAmount(card.value, currency)}</Amount>
        </span>
      </p>
      {shown ? (
        <Caption card={card} />
      ) : (
        <p className="mt-2 text-[0.8125rem] text-muted-foreground">Hidden: tap the eye to show</p>
      )}
      <dl className="mt-5 grid gap-2 border-t pt-4 text-[0.8125rem]">
        {rows.map((row) => (
          <div key={row.label} className="flex items-baseline justify-between gap-4">
            <dt className="text-muted-foreground">{row.label}</dt>
            <dd className={cn("text-right tabular-nums", row.strong && "font-medium")}>
              <Amount scope={card.key}>{row.value}</Amount>
            </dd>
          </div>
        ))}
      </dl>
    </article>
  );
}

/**
 * The owner's money cards (blueprint: stock value, fixed assets, liabilities,
 * today's sales, net profit; and the bad stock value). Every figure shows ***
 * when the screen opens: the eye at the top of the screen shows them all, a
 * card's own eye shows only that card, and nothing is remembered.
 */
export function MetricCards({ data }: { data: MetricCardsData }) {
  return (
    <section aria-labelledby="key-figures">
      <div>
        <h2 id="key-figures" className="font-serif text-2xl text-primary">
          Key figures
        </h2>
        <p className="mt-1 text-[0.8125rem] text-muted-foreground">
          From the books, as of {formatDay(data.asOf)}
        </p>
      </div>
      <div className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-6">
        {data.cards.map((card) => (
          <MetricCardView key={card.key} card={card} currency={data.currency} />
        ))}
      </div>
    </section>
  );
}
