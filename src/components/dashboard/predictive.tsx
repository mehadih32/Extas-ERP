import { CircleCheckIcon, CrownIcon, HourglassIcon } from "lucide-react";
import Link from "next/link";

import { Amount, ScopeEye } from "@/components/accounts/privacy";
import { productionHref } from "@/components/production/labels";
import { salesHref } from "@/components/sales/labels";
import { formatCount, formatDay, groupAmount } from "@/lib/display";
import { cn } from "@/lib/utils";
import type { PredictiveInsights, RunwayStatus } from "@/modules/dashboard/predictive.service";

import { homeRangeLabel } from "./home-range";

const BUYER_SCOPE = "insights-buyer";

/** Beyond this the runway reads "over a year". */
const A_YEAR = 365;

function InsightCard({
  title,
  icon: Icon,
  eye,
  footer,
  children,
}: {
  title: string;
  icon: typeof HourglassIcon;
  eye?: React.ReactNode;
  footer?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <article aria-label={title} className="flex min-w-0 flex-col rounded-lg border bg-card p-5">
      <header className="flex items-start justify-between gap-3">
        <h3 className="eyebrow flex items-center gap-2 pt-1">
          <Icon className="size-4 text-primary" aria-hidden />
          {title}
        </h3>
        {eye}
      </header>
      <div className="mt-4 flex-1">{children}</div>
      {footer && <div className="mt-4 text-[0.8125rem] text-muted-foreground">{footer}</div>}
    </article>
  );
}

function Quiet({ children }: { children: React.ReactNode }) {
  return (
    <p className="flex items-start gap-2 text-sm text-muted-foreground">
      <CircleCheckIcon className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
      {children}
    </p>
  );
}

const RUNWAY_TONES: Record<RunwayStatus, string> = {
  OUT: "border-destructive/30 bg-destructive/[0.06] text-destructive",
  SHORT: "border-destructive/30 bg-destructive/[0.06] text-destructive",
  ORDER: "border-amber-300 bg-amber-50 text-amber-800",
  OK: "border-border bg-muted/40 text-foreground",
};

type Runway = NonNullable<PredictiveInsights["runway"]>;

function daysText(days: number, currency: string) {
  if (days >= A_YEAR) return "over a year";
  return `${formatCount(days, currency)} ${days === 1 ? "day" : "days"}`;
}

function RunwayCard({ runway, currency }: { runway: Runway; currency: string }) {
  const [top] = runway.items;
  const count = (n: number) => formatCount(n, currency);
  return (
    <InsightCard
      title="Stock runway"
      icon={HourglassIcon}
      footer={
        runway.items.length > 0 ? (
          <>
            At the speed of the last {runway.speedDays} days. Red: runs out within{" "}
            {runway.shortDays} days. Amber: runs out before a new batch could be made (about{" "}
            {runway.orderDays} days).
          </>
        ) : undefined
      }
    >
      {!top ? (
        <Quiet>
          Nothing sold in the last {runway.speedDays} days, so there is no speed to go by.
        </Quiet>
      ) : (
        <>
          <p className="text-[0.9375rem] leading-relaxed">
            Top selling: <span className="font-medium text-primary">{top.styleName}</span>.{" "}
            {top.status === "OUT" ? (
              <span className="font-medium text-destructive">It is out of stock now.</span>
            ) : (
              <>
                At the current speed, stock runs out in{" "}
                <span
                  className={cn(
                    "font-medium",
                    top.status === "SHORT" && "text-destructive",
                    top.status === "ORDER" && "text-amber-800",
                  )}
                >
                  {daysText(top.days, currency)}
                </span>
                {top.days < A_YEAR && <> (around {formatDay(top.runsOutOn)})</>}.
              </>
            )}
          </p>
          <ul className="mt-4 divide-y" aria-label="Runway of the top selling styles">
            {runway.items.map((row) => {
              const act = row.status !== "OK" && runway.orderNow;
              return (
                <li
                  key={row.styleId}
                  className="flex items-center gap-3 py-2.5 first:pt-0 last:pb-0"
                >
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium break-words">
                      {row.styleName}{" "}
                      <span className="font-normal text-muted-foreground">{row.styleCode}</span>
                    </p>
                    <p className="text-[0.8125rem] break-words text-muted-foreground">
                      {row.perDay} a day · {count(row.available)} pcs left
                    </p>
                  </div>
                  {/* The days and the button side by side, the button under the days on phones. */}
                  <div className="flex shrink-0 flex-col items-end gap-1.5 sm:flex-row sm:items-center sm:gap-3">
                    <span
                      className={cn(
                        "rounded-full border px-2 py-0.5 text-[0.75rem] font-medium whitespace-nowrap tabular-nums",
                        RUNWAY_TONES[row.status],
                      )}
                    >
                      {row.status === "OUT" ? "Out of stock" : daysText(row.days, currency)}
                    </span>
                    {act && (
                      <Link
                        href={
                          runway.orderNow === "PRODUCTION"
                            ? productionHref.restock(row.styleId)
                            : `/products/${encodeURIComponent(row.styleId)}`
                        }
                        aria-label={`${runway.orderNow === "PRODUCTION" ? "Order now" : "See stock"}: ${row.styleName}`}
                        className="inline-flex h-9 items-center rounded-md border px-3 text-[0.8125rem] font-medium whitespace-nowrap text-primary transition-colors hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/25 focus-visible:outline-none"
                      >
                        {runway.orderNow === "PRODUCTION" ? "Order now" : "See stock"}
                      </Link>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        </>
      )}
    </InsightCard>
  );
}

type TopBuyer = NonNullable<PredictiveInsights["topBuyer"]>;

function TopBuyerCard({ data, topBuyer }: { data: PredictiveInsights; topBuyer: TopBuyer }) {
  const { currency } = data;
  const period = homeRangeLabel(data.range).toLowerCase();
  const { buyer, runnersUp } = topBuyer;
  const count = (n: number) => formatCount(n, currency);
  const amount = (fixed: string) => (
    <Amount scope={BUYER_SCOPE}>{`${currency} ${groupAmount(fixed, currency)}`}</Amount>
  );
  const name = (row: { partyId: string; name: string }, className?: string) =>
    data.open.buyers ? (
      <Link
        href={salesHref.buyer(row.partyId)}
        className={cn("underline-offset-4 hover:underline", className)}
      >
        {row.name}
      </Link>
    ) : (
      <span className={className}>{row.name}</span>
    );

  return (
    <InsightCard
      title={`Top buyer ${period}`}
      icon={CrownIcon}
      eye={
        buyer ? (
          <ScopeEye scope={BUYER_SCOPE} label="the top buyer" className="-mt-1.5 -mr-1.5" />
        ) : undefined
      }
    >
      {!buyer ? (
        <Quiet>
          {/[1-9]/.test(topBuyer.total)
            ? `Only walk-in sales ${period} so far; no buyer account has bought yet.`
            : `No sales ${period} yet.`}
        </Quiet>
      ) : (
        <>
          <p className="font-serif text-[1.625rem] leading-tight break-words text-primary">
            {name(buyer)}
          </p>
          <p className="mt-0.5 text-[0.8125rem] text-muted-foreground">{buyer.code}</p>
          <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
            <div className="col-span-2 flex flex-col-reverse sm:col-span-1">
              <dt className="text-[0.8125rem] text-muted-foreground">
                Bought {period}
                {buyer.sharePct && <> · {buyer.sharePct}% of sales</>}
              </dt>
              <dd className="font-medium tabular-nums">{amount(buyer.net)}</dd>
            </div>
            <div className="col-span-2 flex flex-col-reverse sm:col-span-1">
              <dt className="text-[0.8125rem] text-muted-foreground">Invoices and pieces</dt>
              <dd className="font-medium tabular-nums">
                {count(buyer.invoices)} {buyer.invoices === 1 ? "invoice" : "invoices"} ·{" "}
                {count(buyer.pieces)} pcs
              </dd>
            </div>
          </dl>
          {buyer.styles.length > 0 && (
            <p className="mt-3 text-[0.8125rem] text-muted-foreground">
              Bought most:{" "}
              <span className="text-foreground">
                {buyer.styles.map((s) => `${s.name} (${count(s.pieces)} pcs)`).join(", ")}
              </span>
            </p>
          )}
          {runnersUp.length > 0 && (
            <ol className="mt-4 divide-y border-t pt-1" aria-label="After the top buyer">
              {runnersUp.map((row, i) => (
                <li key={row.partyId} className="flex items-baseline gap-3 py-2 last:pb-0">
                  <span className="w-4 shrink-0 text-[0.8125rem] text-muted-foreground tabular-nums">
                    {i + 2}
                  </span>
                  <span className="min-w-0 flex-1 text-sm break-words">{name(row)}</span>
                  <span className="shrink-0 text-sm tabular-nums">{amount(row.net)}</span>
                </li>
              ))}
            </ol>
          )}
        </>
      )}
    </InsightCard>
  );
}

/**
 * Predictive insights: how long the top sellers' stock lasts at the current
 * speed, and the period's top buyer. Each card only comes for the people who
 * may see it; the buyer's amounts stay *** until the eye shows them.
 */
export function Predictive({ data }: { data: PredictiveInsights }) {
  const cards = [
    data.runway && <RunwayCard key="runway" runway={data.runway} currency={data.currency} />,
    data.topBuyer && <TopBuyerCard key="buyer" data={data} topBuyer={data.topBuyer} />,
  ].filter(Boolean);
  if (cards.length === 0) return null;
  return (
    <section aria-labelledby="predictive-heading">
      <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-1">
        <h2 id="predictive-heading" className="font-serif text-2xl text-primary">
          Predictive insights
        </h2>
        <p className="text-[0.8125rem] text-muted-foreground">Where things are heading</p>
      </div>
      <div
        className={cn(
          "mt-5 grid grid-cols-1 items-start gap-4",
          cards.length > 1 && "lg:grid-cols-2",
        )}
      >
        {cards}
      </div>
    </section>
  );
}
