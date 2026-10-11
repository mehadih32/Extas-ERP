import { FactoryIcon, ShoppingBagIcon, TruckIcon } from "lucide-react";
import Link from "next/link";

import { Amount, ScopeEye } from "@/components/accounts/privacy";
import { formatCount, formatDayRange, groupAmount } from "@/lib/display";
import type { HomePulse } from "@/modules/dashboard/home.service";

import { homeRangeLabel } from "./home-range";

const SALES_SCOPE = "pulse-sales";

function PulseCard({
  title,
  icon: Icon,
  href,
  linkLabel,
  eye,
  children,
}: {
  title: string;
  icon: typeof TruckIcon;
  href: string;
  linkLabel: string;
  eye?: React.ReactNode;
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
      <Link
        href={href}
        className="mt-4 self-start text-[0.8125rem] text-primary underline-offset-4 hover:underline"
      >
        {linkLabel}
      </Link>
    </article>
  );
}

/** A big figure with what it counts under it. */
function Figure({ value, label }: { value: React.ReactNode; label: React.ReactNode }) {
  return (
    // The label comes first for screen readers; the figure shows on top.
    <div className="flex min-w-0 flex-col-reverse">
      <dt className="mt-0.5 text-[0.8125rem] text-muted-foreground">{label}</dt>
      <dd className="font-serif text-[1.625rem] leading-tight break-words text-primary lining-nums tabular-nums">
        {value}
      </dd>
    </div>
  );
}

/**
 * The Pulse: the pace of the business for the period chosen at the top. Sales
 * and money collected (amounts behind the eye), deliveries, and production.
 * Each card only comes for the people who may see it.
 */
export function Pulse({ data }: { data: HomePulse }) {
  const { currency, sales, deliveries, production } = data;
  const count = (n: number) => formatCount(n, currency);
  const amount = (fixed: string) => (
    <Amount scope={SALES_SCOPE}>{`${currency} ${groupAmount(fixed, currency)}`}</Amount>
  );
  const period = homeRangeLabel(data.range).toLowerCase();
  const plural = (n: number, one: string, many: string) => `${count(n)} ${n === 1 ? one : many}`;

  return (
    <section aria-labelledby="pulse-heading">
      <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-1">
        <h2 id="pulse-heading" className="font-serif text-2xl text-primary">
          The Pulse
        </h2>
        <p className="text-[0.8125rem] text-muted-foreground">
          {homeRangeLabel(data.range)} · {formatDayRange(data.from, data.to)}
        </p>
      </div>
      <div className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {sales && (
          <PulseCard
            title="Sales & collection"
            icon={ShoppingBagIcon}
            href="/sales/overview"
            linkLabel="Open the sales overview"
            eye={
              <ScopeEye
                scope={SALES_SCOPE}
                label="sales and collection"
                className="-mt-1.5 -mr-1.5"
              />
            }
          >
            <dl className="grid grid-cols-2 gap-4">
              <Figure
                value={amount(sales.net)}
                label={`Sales ${period} · ${plural(sales.invoices, "invoice", "invoices")}, ${count(sales.pieces)} pcs`}
              />
              <Figure
                value={amount(sales.collected)}
                label={`Collected ${period} · ${plural(sales.receipts, "receipt", "receipts")}`}
              />
            </dl>
            {/[1-9]/.test(sales.refunded) && (
              <p className="mt-3 text-[0.8125rem] text-muted-foreground">
                Collected is after {amount(sales.refunded)} refunded in cash.
              </p>
            )}
          </PulseCard>
        )}
        {deliveries && (
          <PulseCard
            title="Deliveries"
            icon={TruckIcon}
            href="/sales/orders"
            linkLabel="Open the orders"
          >
            <dl className="grid grid-cols-2 gap-4">
              <Figure
                value={count(deliveries.waiting)}
                label={
                  deliveries.waiting === 1 ? "Order waiting to go out" : "Orders waiting to go out"
                }
              />
              <Figure
                value={count(deliveries.challans)}
                label={`Delivered ${period} · ${count(deliveries.pieces)} pcs`}
              />
            </dl>
            {deliveries.late > 0 && (
              <p className="mt-3 text-[0.8125rem] font-medium text-destructive">
                {plural(deliveries.late, "order is", "orders are")} past the shipment day.
              </p>
            )}
          </PulseCard>
        )}
        {production && (
          <PulseCard
            title="Production"
            icon={FactoryIcon}
            href="/production/projects?status=ACTIVE"
            linkLabel="Open the active projects"
          >
            <dl className="grid grid-cols-2 gap-4">
              <Figure
                value={count(production.active)}
                label={production.active === 1 ? "Active project" : "Active projects"}
              />
              <Figure value={count(production.completed)} label={`Completed ${period}`} />
            </dl>
            <p className="mt-3 text-[0.8125rem] text-muted-foreground">
              {[
                production.late > 0 ? null : "None late",
                `${count(production.planned)} planned`,
                `${count(production.onHold)} on hold`,
              ]
                .filter(Boolean)
                .join(" · ")}
              {production.late > 0 && (
                <>
                  {" · "}
                  <Link
                    href="/production/projects?status=OVERDUE"
                    className="font-medium text-destructive underline-offset-4 hover:underline"
                  >
                    {count(production.late)} late
                  </Link>
                </>
              )}
            </p>
          </PulseCard>
        )}
      </div>
    </section>
  );
}
