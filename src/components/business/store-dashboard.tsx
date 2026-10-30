"use client";

import { SparklesIcon } from "lucide-react";
import { useState } from "react";

import { Amount, PrivacyProvider, PrivacyToggle } from "@/components/accounts/privacy";
import { Fact, Panel } from "@/components/sales/detail-bits";
import { Button } from "@/components/ui/button";
import type { StoreDashboard as Dashboard } from "@/modules/retail/dashboards.service";
import { storeAnalysisAction } from "@/server/actions/retail.actions";

import { BigCard, money, More, PeriodPicker } from "./dashboard-bits";
import { DownloadButton } from "./download-dialog";

/*
 * A store's own dashboard on its page (plan v6 sec 10): the main numbers
 * against the period before, where the money went, ads, customers, delivery,
 * the store's side in the ERP's books, and the best sellers on a click.
 */

const COST: Record<string, string> = {
  goods: "Goods",
  returnLosses: "Return losses",
  packaging: "Packaging",
  delivery: "Delivery",
  paymentFees: "Payment fees",
  accessories: "Accessories",
  ads: "Ads",
  other: "Other",
  fixed: "Fixed costs",
};
const PLATFORM: Record<string, string> = {
  facebook: "Facebook",
  instagram: "Instagram",
  google: "Google",
  tiktok: "TikTok",
  other: "Other",
};

const rate = (v: number | null) => (v === null ? "-" : `${v}%`);
const diff = (now: string, before: string | undefined) =>
  before === undefined ? null : (Number(now) - Number(before)).toFixed(2);

export function StoreDashboard({
  d,
  currency,
  storeId,
}: {
  d: Dashboard;
  currency: string;
  storeId: string;
}) {
  const cash = (v: string | null) => (v === null ? "-" : `${currency} ${money(v, currency)}`);
  // How fast pieces go: per day of the period (of the days sent, for Lifetime).
  const days =
    d.period.key === "all"
      ? d.days || 1
      : (Date.parse(d.period.to) - Date.parse(d.period.from)) / 86_400_000 + 1;
  return (
    <PrivacyProvider>
      <Panel
        title="Store dashboard"
        id="store-dashboard"
        action={
          <div className="flex flex-wrap gap-2">
            <DownloadButton scope="store" storeId={storeId} period={d.period} />
            <PrivacyToggle compact />
          </div>
        }
      >
        <div className="mt-4 grid gap-4">
          <PeriodPicker period={d.period} />
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <BigCard
              label="Net sales"
              value={d.sales}
              currency={currency}
              change={diff(d.sales, d.previous?.sales)}
            />
            <BigCard
              label="Costs"
              value={d.costs}
              currency={currency}
              change={diff(d.costs, d.previous?.costs)}
            />
            <BigCard
              label="Profit or loss"
              value={d.profit}
              currency={currency}
              change={diff(d.profit, d.previous?.profit)}
            />
            <BigCard label="Profit rate" value={rate(d.margin)} currency={currency} plain />
          </div>
          {(d.fixedMissing.length > 0 || d.incomplete.length > 0) && (
            <p className="text-sm text-amber-700 dark:text-amber-400">
              {d.fixedMissing.length > 0 &&
                `Fixed costs not in yet for ${d.fixedMissing.join(", ")}. `}
              {d.incomplete.length > 0 && `Not complete yet: ${d.incomplete.join(", ")}.`}
            </p>
          )}

          <section aria-labelledby="dash-costs">
            <h4 id="dash-costs" className="eyebrow">
              Where the money went
            </h4>
            <ul className="mt-2 grid gap-1.5 text-sm">
              {d.costSplit.map((c) => (
                <li key={c.line} className="grid grid-cols-[minmax(0,1fr)_auto] gap-2">
                  <span className="min-w-0">
                    {COST[c.line] ?? c.line}
                    <span
                      aria-hidden
                      className="mt-1 block h-1.5 rounded-full bg-primary/70"
                      style={{ width: `${Math.min(100, c.share ?? 0)}%` }}
                    />
                  </span>
                  <span className="text-right tabular-nums">
                    <Amount>{cash(c.amount)}</Amount> ({rate(c.share)})
                  </span>
                </li>
              ))}
            </ul>
          </section>

          <dl className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            <Fact label="Ads spent">
              <Amount>{cash(d.ads.spend)}</Amount>
              {Object.keys(d.ads.byPlatform).length > 0 && (
                <span className="block text-muted-foreground">
                  <Amount>
                    {Object.entries(d.ads.byPlatform)
                      .map(([p, v]) => `${PLATFORM[p] ?? p} ${money(v, currency)}`)
                      .join(", ")}
                  </Amount>
                </span>
              )}
            </Fact>
            <Fact label="Sales for each taka of ads (ROAS)">
              {d.ads.roas === null ? "-" : d.ads.roas}
            </Fact>
            <Fact label="Ads cost of a new customer">
              <Amount>{cash(d.ads.perNewCustomer)}</Amount>
            </Fact>
            <Fact label="Customers">
              {d.customers.new} new, {d.customers.returning} came back
            </Fact>
            <Fact label="Bought again">{rate(d.customers.repeatRate)}</Fact>
            <Fact label="Money per order">
              <Amount>{cash(d.customers.perOrder)}</Amount>
            </Fact>
            <Fact label="Delivered">{rate(d.delivery.successRate)}</Fact>
            <Fact label="Came back">{rate(d.delivery.returnRate)}</Fact>
            <Fact label="Cash on delivery not in yet">
              <Amount>{cash(d.delivery.codPending)}</Amount>
            </Fact>
          </dl>

          {d.erp && (
            <section aria-labelledby="dash-erp">
              <h4 id="dash-erp" className="eyebrow">
                The store in the ERP&apos;s books
              </h4>
              <dl className="mt-2 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
                <Fact label="Taken from the ERP">
                  <Amount>{cash(d.erp.taken)}</Amount>
                </Fact>
                <Fact label="Given back to the ERP">
                  <Amount>{cash(d.erp.givenBack)}</Amount>
                </Fact>
                <Fact label="The store's loss on returns">
                  <Amount>{cash(d.erp.storeLoss)}</Amount>
                </Fact>
                <Fact label="The ERP's profit from the store">
                  <Amount>{cash(d.erp.erpProfit)}</Amount>
                </Fact>
              </dl>
            </section>
          )}

          <AiAnalysis storeId={storeId} period={d.period} />

          <More title="Best sellers and best customers">
            <div className="grid gap-6 md:grid-cols-2">
              <section aria-labelledby="dash-styles">
                <h4 id="dash-styles" className="eyebrow">
                  Best-selling styles
                </h4>
                {d.topStyles.length === 0 ? (
                  <p className="mt-2 text-sm text-muted-foreground">None in this period.</p>
                ) : (
                  <ol className="mt-2 grid gap-1 text-sm">
                    {d.topStyles.map((s) => (
                      <li key={s.style} className="flex justify-between gap-2">
                        <span className="min-w-0 break-words">{s.style}</span>
                        <span className="shrink-0 tabular-nums">
                          {s.pieces} pcs ({(s.pieces / days).toFixed(1)} a day)
                        </span>
                      </li>
                    ))}
                  </ol>
                )}
              </section>
              <section aria-labelledby="dash-customers">
                <h4 id="dash-customers" className="eyebrow">
                  Best customers
                </h4>
                {d.topCustomers.length === 0 ? (
                  <p className="mt-2 text-sm text-muted-foreground">None in this period.</p>
                ) : (
                  <ol className="mt-2 grid gap-1 text-sm">
                    {d.topCustomers.map((c) => (
                      <li key={`${c.name}-${c.phone}`} className="flex justify-between gap-2">
                        <span className="min-w-0 break-words">
                          {c.name || c.phone} {c.name && c.phone ? `(${c.phone})` : ""}
                        </span>
                        <span className="shrink-0 tabular-nums">
                          <Amount>{cash(c.spent)}</Amount>
                        </span>
                      </li>
                    ))}
                  </ol>
                )}
              </section>
            </div>
            <section aria-labelledby="dash-lying" className="mt-6">
              <h4 id="dash-lying" className="eyebrow">
                Styles lying unsold for 30 days
              </h4>
              <p className="mt-2 text-sm">
                {d.lyingStyles.length === 0 ? "None." : d.lyingStyles.join(", ")}
              </p>
            </section>
          </More>
        </div>
      </Panel>
    </PrivacyProvider>
  );
}

/**
 * The store's health at the top of its page (plan v6 sec 14, point 3): green,
 * yellow or red from its profit, its debt, its returns and whether its figures
 * come on time, with the reason in one line.
 */
export function StoreHealth({
  d,
  onHold,
  missingDays,
}: {
  d: Dashboard;
  onHold: boolean;
  missingDays: number;
}) {
  const red = [
    onHold && "on hold for its debt",
    Number(d.profit) < 0 && "losing money this period",
  ].filter(Boolean);
  const yellow = [
    missingDays > 0 && `figures missing for ${missingDays} day${missingDays === 1 ? "" : "s"}`,
    (d.delivery.returnRate ?? 0) >= 15 && `${d.delivery.returnRate}% of parcels came back`,
  ].filter(Boolean);
  const [tone, label, reasons] =
    red.length > 0
      ? (["text-destructive", "Health: red", [...red, ...yellow]] as const)
      : yellow.length > 0
        ? (["text-amber-700 dark:text-amber-400", "Health: yellow", yellow] as const)
        : ([
            "text-emerald-700 dark:text-emerald-400",
            "Health: green",
            ["making money, figures on time, no hold"],
          ] as const);
  return (
    <p className={`text-sm break-words ${tone}`}>
      <span aria-hidden className="mr-1.5 inline-block size-2.5 rounded-full bg-current" />
      <span className="font-medium">{label}</span>: {reasons.join("; ")}
    </p>
  );
}

/** "AI analysis": the AI's advice on the period shown (plan v6 sec 13). Advice only. */
function AiAnalysis({
  storeId,
  period,
}: {
  storeId: string;
  period: { key: string; from: string; to: string };
}) {
  const [pending, setPending] = useState(false);
  const [text, setText] = useState<string>();
  const [error, setError] = useState<string>();
  return (
    <section aria-labelledby="dash-ai" className="grid gap-2">
      <div className="flex flex-wrap items-center gap-3">
        <h4 id="dash-ai" className="eyebrow">
          Advice
        </h4>
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={pending}
          onClick={async () => {
            setPending(true);
            const result = await storeAnalysisAction(
              storeId,
              period.key === "custom"
                ? { from: period.from, to: period.to }
                : { period: period.key },
            );
            setPending(false);
            setText(result.ok ? result.data.text : undefined);
            setError(result.ok ? undefined : result.error.message);
          }}
        >
          <SparklesIcon aria-hidden />
          {pending ? "Thinking" : "AI analysis"}
        </Button>
      </div>
      {error && <p className="text-sm text-destructive">{error}</p>}
      {text && (
        <p className="rounded-md border p-3 text-sm whitespace-pre-line">
          {text}
          <span className="mt-2 block text-muted-foreground">
            Advice only: nothing was changed.
          </span>
        </p>
      )}
    </section>
  );
}
