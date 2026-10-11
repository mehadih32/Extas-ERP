"use client";

import {
  ArrowDownRightIcon,
  ArrowUpRightIcon,
  ChevronRightIcon,
  LoaderCircleIcon,
  MinusIcon,
} from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useOptimistic, useState, useTransition } from "react";

import { toast } from "@/components/feedback/toaster";
import { partyHref } from "@/components/parties/labels";
import {
  productionHref,
  PROJECT_STATUS_LABELS,
  STAGE_LABELS,
} from "@/components/production/labels";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { formatCount, formatDay } from "@/lib/display";
import type { ActionResult } from "@/lib/result";
import { cn } from "@/lib/utils";
import type { MoneyAccountKind } from "@/modules/accounts/choices";
import type { MarketRow, ProfitPeriod } from "@/modules/accounts/executive.service";
import type { AccountsOverviewScreen } from "@/modules/accounts/screens.service";
import {
  getHoldingsBreakdownAction,
  getMarketBalancesAction,
  getProfitLeadersAction,
} from "@/server/actions/accounts.actions";

import {
  growthText,
  isNegative,
  moneyAccountHref,
  PROFIT_PERIOD_LABELS,
  profitSpan,
  signedMoney,
} from "./labels";
import { Amount, ScopeEye, usePrivacy } from "./privacy";

/*
 * The five executive cards at the top of the Accounts Overview. Each card's
 * figures follow the eye (hidden until shown); a click opens what is behind
 * the figure in a side panel, loaded when it opens, where a second click on a
 * name goes to that buyer, supplier, category, project or account.
 */

type Cards = AccountsOverviewScreen["cards"];
type CashAccount = AccountsOverviewScreen["cash"]["accounts"][number];
type Drill = "cash" | "due" | "payable" | "holdings" | "profit";

const PERIODS = Object.keys(PROFIT_PERIOD_LABELS) as ProfitPeriod[];

const CASH_GROUPS: ReadonlyArray<{ kind: MoneyAccountKind; label: string }> = [
  { kind: "CASH", label: "Hand cash" },
  { kind: "BANK", label: "Bank" },
  { kind: "MOBILE_WALLET", label: "Mobile banking" },
];

/** Loads a panel's figures once it opens; a failure shows in the panel and as a toast. */
function useLoaded<T>(load: () => Promise<ActionResult<T>>, what: string) {
  const [state, setState] = useState<{ data?: T; failed?: string }>({});
  useEffect(() => {
    let live = true;
    const fail = (message: string) => {
      if (!live) return;
      setState({ failed: message });
      toast.error(message);
    };
    load()
      .then((result) => {
        if (!live) return;
        if (result.ok) setState({ data: result.data });
        else fail(result.error.message);
      })
      .catch(() => fail(`${what} could not load. Check the connection and try again.`));
    return () => {
      live = false;
    };
  }, [load, what]);
  return state;
}

function Loading({ state, what }: { state: { failed?: string }; what: string }) {
  return (
    <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground">
      {state.failed ?? (
        <>
          <LoaderCircleIcon className="size-4 animate-spin" aria-hidden />
          Loading {what}
        </>
      )}
    </p>
  );
}

function Figure({
  scope,
  value,
  alert = false,
}: {
  scope: string;
  value: string;
  alert?: boolean;
}) {
  return (
    <span
      className={cn(
        "block font-serif text-2xl leading-tight break-words lining-nums tabular-nums",
        alert ? "text-destructive" : "text-primary",
      )}
    >
      <Amount scope={scope}>{value}</Amount>
    </span>
  );
}

/** Small "label  amount" lines under a card's figure. */
function Lines({
  scope,
  lines,
}: {
  scope: string;
  lines: ReadonlyArray<{ label: string; value: string; alert?: boolean }>;
}) {
  return (
    <span className="mt-2 grid w-full gap-1 text-[0.8125rem]">
      {lines.map((line) => (
        <span key={line.label} className="flex items-baseline justify-between gap-3">
          <span className="text-muted-foreground">{line.label}</span>
          <span className={cn("text-right tabular-nums", line.alert && "text-destructive")}>
            <Amount scope={scope}>{line.value}</Amount>
          </span>
        </span>
      ))}
    </span>
  );
}

function Card({
  scope,
  label,
  className,
  children,
}: {
  scope: string;
  label: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <section
      aria-label={label}
      className={cn("flex min-w-0 flex-col rounded-lg border bg-card", className)}
    >
      <div className="flex min-h-11 items-center justify-between gap-2 pt-2 pr-2 pl-4">
        <h3 className="eyebrow">{label}</h3>
        <ScopeEye scope={scope} label={label} />
      </div>
      {children}
    </section>
  );
}

/** The body of a card: one button that opens its panel. */
function Opener({
  onOpen,
  cue,
  children,
}: {
  onOpen: () => void;
  cue: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-haspopup="dialog"
      className="flex flex-1 flex-col items-start rounded-b-lg px-4 pb-4 text-left transition-colors outline-none hover:bg-accent/40 focus-visible:ring-[3px] focus-visible:ring-ring/25"
    >
      {children}
      <span className="mt-auto inline-flex items-center gap-1 pt-3 text-xs font-medium text-primary">
        {cue}
        <ChevronRightIcon className="size-3.5" aria-hidden />
      </span>
    </button>
  );
}

function Panel({
  open,
  onClose,
  scope,
  title,
  description,
  wide = false,
  children,
}: {
  open: boolean;
  onClose: () => void;
  scope: string;
  title: string;
  description: string;
  wide?: boolean;
  children: React.ReactNode;
}) {
  return (
    <Sheet open={open} onOpenChange={(next) => !next && onClose()}>
      <SheetContent className={cn("gap-5 p-5 sm:p-6", wide && "sm:max-w-2xl")}>
        <div className="flex items-start gap-1 pr-8">
          <div className="min-w-0 flex-1">
            <SheetTitle className="font-serif text-xl text-primary">{title}</SheetTitle>
            <SheetDescription className="mt-1 text-sm leading-relaxed text-muted-foreground">
              {description}
            </SheetDescription>
          </div>
          <ScopeEye scope={scope} label={title} />
        </div>
        {children}
      </SheetContent>
    </Sheet>
  );
}

/** One line in a panel: a name (a link when this person may open it) and an amount. */
function Row({
  href,
  title,
  sub,
  amount,
  scope,
  alert = false,
}: {
  href?: string;
  title: string;
  sub?: string;
  amount: string;
  scope: string;
  alert?: boolean;
}) {
  const body = (
    <>
      <span className="min-w-0">
        <span className={cn("block font-medium break-words", href && "text-primary")}>{title}</span>
        {sub && <span className="block text-xs text-muted-foreground">{sub}</span>}
      </span>
      <span className={cn("shrink-0 text-right text-sm tabular-nums", alert && "text-destructive")}>
        <Amount scope={scope}>{amount}</Amount>
      </span>
    </>
  );
  const box = "flex min-h-11 items-center justify-between gap-3 rounded-md px-2 py-2";
  return (
    <li>
      {href ? (
        <Link
          href={href}
          className={cn(
            box,
            "transition-colors outline-none hover:bg-accent/50 focus-visible:ring-[3px] focus-visible:ring-ring/25",
          )}
        >
          {body}
        </Link>
      ) : (
        <div className={box}>{body}</div>
      )}
    </li>
  );
}

function Group({
  title,
  total,
  scope,
  children,
}: {
  title: string;
  total?: string;
  scope: string;
  children: React.ReactNode;
}) {
  return (
    <section className="grid gap-1">
      <h4 className="flex items-baseline justify-between gap-3 border-b pb-1.5">
        <span className="eyebrow">{title}</span>
        {total !== undefined && (
          <span className="text-sm font-medium tabular-nums">
            <Amount scope={scope}>{total}</Amount>
          </span>
        )}
      </h4>
      <ul className="-mx-2 grid">{children}</ul>
    </section>
  );
}

// --- Panels ----------------------------------------------------------------------------------

function CashPanel({
  accounts,
  totals,
  currency,
  scope,
}: {
  accounts: CashAccount[];
  totals: Cards["cash"]["byKind"];
  currency: string;
  scope: string;
}) {
  return (
    <div className="grid gap-5">
      {CASH_GROUPS.map(({ kind, label }) => {
        const mine = accounts.filter((a) => a.kind === kind);
        if (mine.length === 0) return null;
        return (
          <Group key={kind} title={label} total={signedMoney(totals[kind], currency)} scope={scope}>
            {mine.map((a) => (
              <Row
                key={a.id}
                href={moneyAccountHref(a)}
                title={a.name}
                sub={a.isActive ? a.code : `${a.code} · archived`}
                amount={signedMoney(a.balance, currency)}
                alert={isNegative(a.balance)}
                scope={scope}
              />
            ))}
          </Group>
        );
      })}
    </div>
  );
}

function MarketPanel({
  side,
  currency,
  scope,
}: {
  side: "due" | "payable";
  currency: string;
  scope: string;
}) {
  const what = side === "due" ? "the buyers" : "the suppliers";
  const state = useLoaded(getMarketBalancesAction, side === "due" ? "Buyers" : "Suppliers");
  if (!state.data) return <Loading state={state} what={what} />;
  const { rows } = state.data[side];
  const open = state.data.can.openParty;
  const last = (r: MarketRow) =>
    `${r.code}${r.lastTransactionOn ? ` · last ${formatDay(r.lastTransactionOn)}` : ""}`;
  return (
    <div className="grid gap-4">
      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {side === "due" ? "No buyer owes anything." : "Nothing is owed to any supplier."}
        </p>
      ) : (
        <ul className="-mx-2 grid">
          {rows.map((r) => (
            <Row
              key={r.id}
              href={open ? partyHref(r) : undefined}
              title={r.name}
              sub={last(r)}
              amount={signedMoney(r.amount, currency)}
              scope={scope}
            />
          ))}
        </ul>
      )}
      {open && (
        <Link
          href="/parties/dues"
          className="text-sm text-primary underline-offset-4 hover:underline"
        >
          Open the Dues page
        </Link>
      )}
    </div>
  );
}

function HoldingsPanel({ currency, scope }: { currency: string; scope: string }) {
  const state = useLoaded(getHoldingsBreakdownAction, "Inventory and production");
  if (!state.data) return <Loading state={state} what="the stock and production" />;
  const h = state.data;
  const m = (fixed: string) => signedMoney(fixed, currency);
  return (
    <div className="grid gap-6 sm:grid-cols-2">
      <div className="grid content-start gap-5">
        <Group title="Ready stock by category" total={m(h.readyStock.total)} scope={scope}>
          {h.readyStock.categories.length === 0 && (
            <li className="px-2 py-2 text-sm text-muted-foreground">No pieces in stock.</li>
          )}
          {h.readyStock.categories.map((c) => (
            <Row
              key={c.id}
              href={
                h.can.openCategory ? `/products?category=${encodeURIComponent(c.id)}` : undefined
              }
              title={c.name}
              sub={`${formatCount(c.pieces, currency)} pcs`}
              amount={m(c.value)}
              scope={scope}
            />
          ))}
        </Group>
        <Group title="Raw materials" scope={scope}>
          <Row
            href={h.can.openMaterials ? "/materials" : undefined}
            title="Fabric and trims in the store"
            amount={m(h.rawMaterials.total)}
            scope={scope}
          />
        </Group>
      </div>
      <Group title="Money in production (WIP)" total={m(h.production.total)} scope={scope}>
        {h.production.projects.length === 0 && !h.production.other && (
          <li className="px-2 py-2 text-sm text-muted-foreground">
            No money is waiting in production.
          </li>
        )}
        {h.production.projects.map((p) => (
          <Row
            key={p.id}
            href={h.can.openProject ? productionHref.project(p.id) : undefined}
            title={`${p.code} · ${p.name}`}
            sub={p.status === "ACTIVE" ? STAGE_LABELS[p.stage] : PROJECT_STATUS_LABELS[p.status]}
            amount={m(p.wip)}
            scope={scope}
          />
        ))}
        {h.production.other && (
          <Row
            title="Not in an open project"
            sub="A closed project or a voucher"
            amount={m(h.production.other)}
            scope={scope}
          />
        )}
      </Group>
    </div>
  );
}

function ProfitPanel({
  period,
  currency,
  scope,
}: {
  period: ProfitPeriod;
  currency: string;
  scope: string;
}) {
  const load = useCallback(() => getProfitLeadersAction(period), [period]);
  const state = useLoaded(load, "The most profitable");
  if (!state.data) return <Loading state={state} what="the most profitable" />;
  const l = state.data;
  const m = (fixed: string) => signedMoney(fixed, currency);
  const sub = (x: { sales: string; margin: string | null }) =>
    `Sales ${m(x.sales)}${x.margin ? ` · ${x.margin}% margin` : ""}`;
  return (
    <div className="grid gap-6">
      <p className="text-sm text-muted-foreground">{profitSpan(l)}</p>
      <Group title="Top profitable category" scope={scope}>
        {l.categories.length === 0 && (
          <li className="px-2 py-2 text-sm text-muted-foreground">No sales in these days.</li>
        )}
        {l.categories.map((c) => (
          <Row
            key={c.id}
            href={l.can.openCategory ? `/products?category=${encodeURIComponent(c.id)}` : undefined}
            title={c.name}
            sub={sub(c)}
            amount={m(c.profit)}
            alert={isNegative(c.profit)}
            scope={scope}
          />
        ))}
      </Group>
      <Group title="Top profitable buyer" scope={scope}>
        {l.buyers.length === 0 && (
          <li className="px-2 py-2 text-sm text-muted-foreground">
            No sales to a buyer account in these days.
          </li>
        )}
        {l.buyers.map((b) => (
          <Row
            key={b.id}
            href={l.can.openParty ? partyHref(b) : undefined}
            title={b.name}
            sub={sub(b)}
            amount={m(b.profit)}
            alert={isNegative(b.profit)}
            scope={scope}
          />
        ))}
      </Group>
      <p className="text-xs leading-relaxed text-muted-foreground">
        Gross profit: invoiced sales after discounts, less what the pieces cost. Walk-in sales count
        for the categories only.
      </p>
    </div>
  );
}

// --- The cards -------------------------------------------------------------------------------

export function ExecutiveCards({
  cards,
  accounts,
  currency,
}: {
  cards: Cards;
  accounts: CashAccount[];
  currency: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [pending, startTransition] = useTransition();
  const [period, setPeriod] = useOptimistic(cards.profit.period);
  const [open, setOpen] = useState<Drill | null>(null);
  const close = () => setOpen(null);
  const m = (fixed: string) => signedMoney(fixed, currency);
  const { cash, due, payable, holdings, profit } = cards;
  const growth = profit.growth;
  const profitShown = usePrivacy().shown("profit");
  const GrowthIcon =
    growth?.direction === "UP"
      ? ArrowUpRightIcon
      : growth?.direction === "DOWN"
        ? ArrowDownRightIcon
        : MinusIcon;

  function choose(next: ProfitPeriod) {
    startTransition(() => {
      setPeriod(next);
      const query = next === "MONTH" ? "" : `?period=${next.toLowerCase()}`;
      router.replace(`${pathname}${query}`, { scroll: false });
    });
  }

  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-6">
      <Card scope="cash" label="Cash & bank" className="lg:col-span-2">
        <Opener onOpen={() => setOpen("cash")} cue="See each account">
          <Figure scope="cash" value={m(cash.total)} alert={isNegative(cash.total)} />
          <Lines
            scope="cash"
            lines={CASH_GROUPS.map(({ kind, label }) => ({
              label,
              value: m(cash.byKind[kind]),
              alert: isNegative(cash.byKind[kind]),
            }))}
          />
        </Opener>
      </Card>

      <Card scope="due" label="Market due" className="lg:col-span-2">
        <Opener onOpen={() => setOpen("due")} cue="See who owes">
          <Figure scope="due" value={m(due.total)} />
          <span className="mt-1 block text-[0.8125rem] text-muted-foreground">
            {due.count === 0
              ? "No buyer owes anything"
              : `${formatCount(due.count, currency)} ${due.count === 1 ? "buyer owes" : "buyers owe"} us`}
          </span>
        </Opener>
      </Card>

      <Card scope="payable" label="Market payable" className="lg:col-span-2">
        <Opener onOpen={() => setOpen("payable")} cue="See who we owe">
          <Figure scope="payable" value={m(payable.total)} />
          <span className="mt-1 block text-[0.8125rem] text-muted-foreground">
            {payable.count === 0
              ? "Nothing owed to suppliers"
              : `We owe ${formatCount(payable.count, currency)} ${
                  payable.count === 1 ? "supplier or factory" : "suppliers and factories"
                }`}
          </span>
        </Opener>
      </Card>

      <Card scope="holdings" label="Inventory & WIP" className="lg:col-span-3">
        <Opener onOpen={() => setOpen("holdings")} cue="See stock and production">
          <Figure scope="holdings" value={m(holdings.total)} />
          <Lines
            scope="holdings"
            lines={[
              { label: "Ready stock", value: m(holdings.readyStock) },
              { label: "Raw materials", value: m(holdings.rawMaterials) },
              { label: "In production (WIP)", value: m(holdings.workInProgress) },
            ]}
          />
        </Opener>
      </Card>

      <Card scope="profit" label="Net profit" className="sm:col-span-2 lg:col-span-3">
        <div role="group" aria-label="Profit for" className="grid grid-cols-4 gap-1 px-4 pb-2">
          {PERIODS.map((p) => (
            <Button
              key={p}
              type="button"
              size="sm"
              variant={period === p ? "default" : "outline"}
              aria-pressed={period === p}
              onClick={() => choose(p)}
              className="h-9 px-1 text-xs sm:h-8"
            >
              {PROFIT_PERIOD_LABELS[p]}
            </Button>
          ))}
        </div>
        <div
          aria-busy={pending}
          className={cn("flex flex-1 flex-col transition-opacity", pending && "opacity-60")}
        >
          <Opener onOpen={() => setOpen("profit")} cue="See the most profitable">
            <Figure scope="profit" value={m(profit.net)} alert={isNegative(profit.net)} />
            {growth && profit.period !== "LIFETIME" && (
              <span
                className={cn(
                  "mt-1 inline-flex items-center gap-1 text-[0.8125rem] font-medium",
                  !profitShown
                    ? "text-muted-foreground"
                    : growth.direction === "UP"
                      ? "text-success"
                      : growth.direction === "DOWN"
                        ? "text-destructive"
                        : "text-muted-foreground",
                )}
              >
                {/* The arrow would give the trend away while the card is hidden. */}
                {profitShown && <GrowthIcon className="size-4 shrink-0" aria-hidden />}
                <Amount scope="profit">{growthText(growth, profit.period)}</Amount>
              </span>
            )}
            <Lines
              scope="profit"
              lines={[
                {
                  label: "Gross profit",
                  value: m(profit.gross),
                  alert: isNegative(profit.gross),
                },
                { label: "Sales", value: m(profit.sales) },
              ]}
            />
            <span className="mt-2 block text-xs text-muted-foreground">{profitSpan(profit)}</span>
          </Opener>
        </div>
      </Card>

      <Panel
        open={open === "cash"}
        onClose={close}
        scope="cash"
        title="Cash & bank"
        description="All the money the business can use now: cash in hand, bank accounts and mobile banking. Open an account for its statement."
      >
        <CashPanel accounts={accounts} totals={cash.byKind} currency={currency} scope="cash" />
      </Panel>
      <Panel
        open={open === "due"}
        onClose={close}
        scope="due"
        title="Market due"
        description="What each buyer owes, after any advance they paid. Open a buyer for their profile and ledger."
      >
        <MarketPanel side="due" currency={currency} scope="due" />
      </Panel>
      <Panel
        open={open === "payable"}
        onClose={close}
        scope="payable"
        title="Market payable"
        description="What we owe each supplier, factory and CMT, after any advance we paid them. Open one for their profile and ledger."
      >
        <MarketPanel side="payable" currency={currency} scope="payable" />
      </Panel>
      <Panel
        open={open === "holdings"}
        onClose={close}
        scope="holdings"
        title="Inventory & WIP"
        description="Ready stock at cost, category by category, and the money spent on production projects that has not reached stock yet."
        wide
      >
        <HoldingsPanel currency={currency} scope="holdings" />
      </Panel>
      <Panel
        open={open === "profit"}
        onClose={close}
        scope="profit"
        title="Most profitable"
        description="The categories and buyers that made the most gross profit in the days chosen on the card. Open one for its products or the buyer's profile."
      >
        <ProfitPanel period={profit.period} currency={currency} scope="profit" />
      </Panel>
    </div>
  );
}
