import {
  CircleCheckIcon,
  ClipboardCheckIcon,
  MessageCircleIcon,
  PackageIcon,
  ReceiptTextIcon,
} from "lucide-react";
import Link from "next/link";

import { Amount, ScopeEye } from "@/components/accounts/privacy";
import { hrHref } from "@/components/hr/labels";
import { productionHref } from "@/components/production/labels";
import { salesHref } from "@/components/sales/labels";
import { salesListSearch } from "@/components/sales/list-view";
import { formatCount, formatDayRange, formatMonth, groupAmount } from "@/lib/display";
import { cn } from "@/lib/utils";
import type { ActionZone as ActionZoneData } from "@/modules/dashboard/action-zone.service";

import { homeRangeLabel } from "./home-range";
import { OpenInsightsTab } from "./open-insights-tab";

const OVERDUE_SCOPE = "action-overdue";
const APPROVALS_SCOPE = "action-approvals";

const linkClass = "text-primary underline-offset-4 hover:underline";

function ZoneCard({
  title,
  icon: Icon,
  count,
  eye,
  footer,
  children,
}: {
  title: string;
  icon: typeof PackageIcon;
  /** Shown next to the title, in red, when something needs doing. */
  count: number;
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
          {count > 0 && (
            <span className="rounded-full bg-destructive px-1.5 py-px text-[0.6875rem] leading-4 font-medium tracking-normal text-destructive-foreground tabular-nums">
              {count}
            </span>
          )}
        </h3>
        {eye}
      </header>
      <div className="mt-4 flex-1">{children}</div>
      {footer && <div className="mt-4 text-[0.8125rem]">{footer}</div>}
    </article>
  );
}

/** "All clear" in a card with nothing to do. */
function Clear({ children }: { children: React.ReactNode }) {
  return (
    <p className="flex items-start gap-2 text-sm text-muted-foreground">
      <CircleCheckIcon className="mt-0.5 size-4 shrink-0 text-success" aria-hidden />
      {children}
    </p>
  );
}

const plural = (n: number, one: string, many: string, currency: string) =>
  `${formatCount(n, currency)} ${n === 1 ? one : many}`;

const lateText = (days: number, currency: string) =>
  days === 0 ? "due today" : `${plural(days, "day", "days", currency)} late`;

function OverdueCard({ data }: { data: ActionZoneData }) {
  const overdue = data.overdue!;
  const { currency } = data;
  const amount = (fixed: string) => (
    <Amount scope={OVERDUE_SCOPE}>{`${currency} ${groupAmount(fixed, currency)}`}</Amount>
  );
  return (
    <ZoneCard
      title="Overdue invoices"
      icon={ReceiptTextIcon}
      count={overdue.invoices}
      eye={
        overdue.invoices > 0 ? (
          <ScopeEye
            scope={OVERDUE_SCOPE}
            label="the overdue invoices"
            className="-mt-1.5 -mr-1.5"
          />
        ) : undefined
      }
      footer={
        overdue.invoices > 0 && data.open.sales ? (
          <Link
            href={`/sales/invoices${salesListSearch({ list: "invoices", q: "", status: "OVERDUE" })}`}
            className={linkClass}
          >
            See all overdue invoices
          </Link>
        ) : undefined
      }
    >
      {overdue.items.length === 0 ? (
        <Clear>No invoice is past its due day.</Clear>
      ) : (
        <>
          <p className="text-sm">
            <span className="font-medium text-destructive">{amount(overdue.total)}</span>{" "}
            <span className="text-muted-foreground">
              overdue on {plural(overdue.invoices, "invoice", "invoices", currency)} from{" "}
              {plural(overdue.buyers, "buyer", "buyers", currency)}
            </span>
          </p>
          <ul className="mt-3 divide-y">
            {overdue.items.map((row) => {
              const name = row.buyer ?? "Walk-in customer";
              const href =
                row.partyId && data.open.buyers
                  ? salesHref.buyer(row.partyId)
                  : data.open.sales
                    ? salesHref.invoice(row.invoiceId)
                    : null;
              return (
                <li
                  key={row.partyId ?? row.invoiceId}
                  className="flex items-center gap-3 py-2.5 first:pt-0 last:pb-0"
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">
                      {href ? (
                        <Link
                          href={href}
                          className="text-foreground underline-offset-4 hover:underline"
                        >
                          {name}
                        </Link>
                      ) : (
                        name
                      )}
                    </p>
                    <p className="truncate text-[0.8125rem] text-muted-foreground">
                      {row.invoices === 1
                        ? row.numbers[0]
                        : `${formatCount(row.invoices, currency)} invoices`}
                      {" · "}
                      <span className="text-destructive">
                        {row.invoices === 1 ? "" : "oldest "}
                        {lateText(row.daysLate, currency)}
                      </span>
                    </p>
                  </div>
                  <p className="shrink-0 text-sm font-medium tabular-nums">{amount(row.due)}</p>
                  {row.whatsapp ? (
                    <a
                      href={row.whatsapp}
                      target="_blank"
                      rel="noopener noreferrer"
                      aria-label={`Send ${name} a payment reminder on WhatsApp`}
                      title="Send a payment reminder on WhatsApp"
                      className="inline-flex size-10 shrink-0 items-center justify-center rounded-full border text-success transition-colors hover:bg-success/10 focus-visible:ring-[3px] focus-visible:ring-ring/25 focus-visible:outline-none"
                    >
                      <MessageCircleIcon className="size-[1.125rem]" aria-hidden />
                    </a>
                  ) : (
                    <span
                      title="No WhatsApp or phone number"
                      className="inline-flex size-10 shrink-0 items-center justify-center rounded-full border border-dashed text-muted-foreground/60"
                    >
                      <MessageCircleIcon className="size-[1.125rem]" aria-hidden />
                      <span className="sr-only">No WhatsApp or phone number for {name}</span>
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
          {overdue.buyers > overdue.items.length && (
            <p className="mt-3 text-[0.8125rem] text-muted-foreground">
              The {overdue.items.length} owing the most of{" "}
              {plural(overdue.buyers, "buyer", "buyers", currency)}.
            </p>
          )}
        </>
      )}
    </ZoneCard>
  );
}

function LowStockCard({ data }: { data: ActionZoneData }) {
  const low = data.lowStock!;
  const { currency } = data;
  return (
    <ZoneCard
      title="Low stock"
      icon={PackageIcon}
      count={low.total}
      footer={
        low.total > 0 ? (
          <OpenInsightsTab tab="low" className={cn(linkClass, "cursor-pointer")}>
            See the full list in Insights
          </OpenInsightsTab>
        ) : undefined
      }
    >
      {low.items.length === 0 ? (
        <Clear>Every SKU has at least {low.threshold} pieces available.</Clear>
      ) : (
        <>
          <p className="text-sm text-muted-foreground">
            {plural(low.total, "SKU is", "SKUs are", currency)} below {low.threshold} pieces
            {low.outOfStock > 0 && (
              <span className="text-destructive">
                , {formatCount(low.outOfStock, currency)} out of stock
              </span>
            )}
            .
          </p>
          <ul className="mt-3 divide-y">
            {low.items.map((row) => (
              <li
                key={row.variantId}
                className="flex items-center gap-3 py-2.5 first:pt-0 last:pb-0"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{row.styleName}</p>
                  <p className="truncate text-[0.8125rem] text-muted-foreground">
                    {row.colorName} · {row.sizeName} · {row.sku}
                  </p>
                </div>
                <p
                  className={cn(
                    "shrink-0 text-right text-[0.8125rem] tabular-nums",
                    row.available <= 0 ? "font-medium text-destructive" : "text-foreground",
                  )}
                >
                  {row.available <= 0
                    ? "Out of stock"
                    : `${formatCount(row.available, currency)} left`}
                </p>
                {low.orderNow && (
                  <Link
                    href={
                      low.orderNow === "PRODUCTION"
                        ? productionHref.restock(row.styleId)
                        : `/products/${encodeURIComponent(row.styleId)}`
                    }
                    aria-label={`${low.orderNow === "PRODUCTION" ? "Order now" : "See stock"}: ${row.styleName}, ${row.colorName} ${row.sizeName}`}
                    className="inline-flex h-9 shrink-0 items-center rounded-md border px-3 text-[0.8125rem] font-medium whitespace-nowrap text-primary transition-colors hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/25 focus-visible:outline-none"
                  >
                    {low.orderNow === "PRODUCTION" ? "Order now" : "See stock"}
                  </Link>
                )}
              </li>
            ))}
          </ul>
        </>
      )}
    </ZoneCard>
  );
}

/** One kind of approval: a red line with its count, and the first few under it. */
function ApprovalGroup({
  heading,
  href,
  children,
}: {
  heading: string;
  href: string | null;
  children?: React.ReactNode;
}) {
  return (
    <li className="rounded-md border border-destructive/25 bg-destructive/[0.04] px-3.5 py-3">
      <p className="text-sm font-medium text-destructive">
        {href ? (
          <Link href={href} className="underline-offset-4 hover:underline">
            {heading}
          </Link>
        ) : (
          heading
        )}
      </p>
      {children && (
        <ul className="mt-1.5 grid grid-cols-1 gap-1 text-[0.8125rem] text-muted-foreground">
          {children}
        </ul>
      )}
    </li>
  );
}

function ApprovalItem({ href, children }: { href: string | null; children: React.ReactNode }) {
  return (
    <li className="min-w-0 break-words">
      {href ? (
        <Link href={href} className="text-foreground underline-offset-4 hover:underline">
          {children}
        </Link>
      ) : (
        children
      )}
    </li>
  );
}

function ApprovalsCard({ data }: { data: ActionZoneData }) {
  const { returns, leave, payroll, discounts } = data.approvals!;
  const { currency } = data;
  const waiting =
    (leave?.count ?? 0) + (payroll?.count ?? 0) + (returns?.count ?? 0) + (discounts?.count ?? 0);
  const period = homeRangeLabel(data.range).toLowerCase();
  const money = (fixed: string) => (
    <Amount scope={APPROVALS_SCOPE}>{`${currency} ${groupAmount(fixed, currency)}`}</Amount>
  );

  return (
    <ZoneCard
      title="Pending approvals"
      icon={ClipboardCheckIcon}
      count={waiting}
      eye={
        (returns?.count ?? 0) + (discounts?.count ?? 0) > 0 ? (
          <ScopeEye
            scope={APPROVALS_SCOPE}
            label="the pending approvals"
            className="-mt-1.5 -mr-1.5"
          />
        ) : undefined
      }
    >
      {waiting === 0 ? (
        <Clear>
          Nothing is waiting for approval
          {discounts
            ? `, and there are no sales returns or discounts over ${discounts.threshold}% ${period}.`
            : "."}
        </Clear>
      ) : (
        <ul className="grid grid-cols-1 gap-2.5">
          {leave && leave.count > 0 && (
            <ApprovalGroup
              heading={`${plural(leave.count, "leave request", "leave requests", currency)} to decide`}
              href={`${hrHref.leave}?status=PENDING`}
            >
              {leave.items.map((r) => (
                <ApprovalItem key={r.id} href={hrHref.leaveRequest(r.id)}>
                  {r.employee} · {r.type} · {formatDayRange(r.from, r.to)} ({r.days}{" "}
                  {r.days === "1" ? "day" : "days"})
                </ApprovalItem>
              ))}
            </ApprovalGroup>
          )}
          {payroll?.items.map((run) => (
            <ApprovalGroup
              key={run.id}
              heading={`Payroll for ${formatMonth(run.month)} is waiting for approval`}
              href={hrHref.payrollRun(run.id)}
            />
          ))}
          {returns && returns.count > 0 && (
            <ApprovalGroup
              heading={`${plural(returns.count, "sales return", "sales returns", currency)} ${period}`}
              href={data.open.sales ? "/sales/returns" : null}
            >
              {returns.items.map((r) => (
                <ApprovalItem
                  key={r.id}
                  href={data.open.sales ? salesHref.salesReturn(r.id) : null}
                >
                  {r.number}
                  {r.buyer ? ` · ${r.buyer}` : ""} · {money(r.amount)}
                  {r.by ? ` · by ${r.by}` : ""}
                </ApprovalItem>
              ))}
            </ApprovalGroup>
          )}
          {discounts && discounts.count > 0 && (
            <ApprovalGroup
              heading={`${plural(discounts.count, "order", "orders", currency)} ${period} with a discount over ${discounts.threshold}%`}
              href={null}
            >
              {discounts.items.map((o) => (
                <ApprovalItem key={o.id} href={data.open.sales ? salesHref.order(o.id) : null}>
                  {o.number}
                  {o.buyer ? ` · ${o.buyer}` : ""} ·{" "}
                  <span className="font-medium text-destructive">{o.percent}% off</span> (
                  {money(o.discount)}){o.by ? ` · by ${o.by}` : ""}
                </ApprovalItem>
              ))}
            </ApprovalGroup>
          )}
        </ul>
      )}
    </ZoneCard>
  );
}

/**
 * The Action Zone: overdue invoices with a WhatsApp reminder a click away, low
 * stock with "Order now", and what is waiting for approval (or, for the owner,
 * the period's returns and big discounts to look over) in red. Each card
 * only comes for the people who handle it; amounts stay *** until the eye shows them.
 */
export function ActionZone({ data }: { data: ActionZoneData }) {
  const cards = [
    data.overdue && <OverdueCard key="overdue" data={data} />,
    data.lowStock && <LowStockCard key="low" data={data} />,
    data.approvals && <ApprovalsCard key="approvals" data={data} />,
  ].filter(Boolean);
  if (cards.length === 0) return null;
  return (
    <section aria-labelledby="action-zone-heading">
      <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-1">
        <h2 id="action-zone-heading" className="font-serif text-2xl text-primary">
          Action Zone
        </h2>
        <p className="text-[0.8125rem] text-muted-foreground">What needs doing now</p>
      </div>
      <div
        className={cn(
          "mt-5 grid grid-cols-1 items-start gap-4",
          cards.length > 1 && "lg:grid-cols-2",
          cards.length > 2 && "2xl:grid-cols-3",
        )}
      >
        {cards}
      </div>
    </section>
  );
}
