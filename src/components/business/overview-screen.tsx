"use client";

import { TriangleAlertIcon } from "lucide-react";
import Link from "next/link";

import { Amount, HeaderWithEye, PrivacyProvider } from "@/components/accounts/privacy";
import { useWhen } from "@/components/ai/when";
import { Panel } from "@/components/sales/detail-bits";
import { Button } from "@/components/ui/button";
import type { OverviewPage } from "@/modules/retail/dashboards.service";

import { BigCard, money, More, PeriodPicker, ProfitChart } from "./dashboard-bits";
import { DownloadButton } from "./download-dialog";

/*
 * Business > Overview (plan v6 sec 10): the buying house and the retail stores
 * together. Six cards, the two businesses' profit in two colours, "Why profit
 * changed" and a warning for any day a store's figures did not come.
 */

const FIGURE: Record<string, string> = {
  "sales.net": "Net sales",
  "costs.goods": "Goods",
  "costs.returnLosses": "Return losses",
  "costs.packaging": "Packaging",
  "costs.delivery": "Delivery",
  "costs.paymentFees": "Payment fees",
  "costs.accessories": "Accessories",
  "costs.ads": "Ads",
  "costs.other": "Other costs",
  "fixed.salary": "Salary",
  "fixed.rent": "Rent",
  "fixed.utilities": "Utilities",
  "fixed.other": "Other fixed costs",
};

export function OverviewScreen({ page }: { page: OverviewPage }) {
  const { currency } = page;
  const when = useWhen({ year: true });
  return (
    <PrivacyProvider>
      <div className="grid min-w-0 gap-6">
        <HeaderWithEye>
          <h2 className="font-serif text-2xl text-primary">Overview</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            The buying house and the retail stores together. The ERP&apos;s sales to its own stores
            are counted once, as the stores&apos; sales to their customers.
          </p>
        </HeaderWithEye>
        <div className="flex flex-wrap items-end justify-between gap-3">
          <PeriodPicker period={page.period} />
          <div className="flex flex-wrap gap-2">
            <Button asChild variant="outline">
              <Link href="/business/returns">Returns</Link>
            </Button>
            <DownloadButton scope="overview" period={page.period} />
          </div>
        </div>

        {page.missingStores.length > 0 && (
          <div className="grid gap-1 rounded-lg border border-destructive/40 p-4 text-sm text-destructive">
            {page.missingStores.map((s) => (
              <p key={s.id} className="flex items-start gap-1.5">
                <TriangleAlertIcon aria-hidden className="mt-0.5 size-4 shrink-0" />
                <span>
                  <Link href={`/business/stores/${s.id}`} className="font-medium hover:underline">
                    {s.name}
                  </Link>
                  : figures missing for {s.days.join(", ")}
                </span>
              </p>
            ))}
          </div>
        )}

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {page.cards.map((c) => (
            <BigCard
              key={c.key}
              label={c.label}
              value={c.value}
              currency={currency}
              change={c.change}
              hint={
                c.key === "cash"
                  ? "Cash, bank and mobile wallets today"
                  : c.key === "owed"
                    ? "What the stores owe the ERP today"
                    : c.key === "afterInstallments"
                      ? "Total profit less the repayments on loans kept in capital"
                      : undefined
              }
            />
          ))}
        </div>
        {(page.fixedMissing.length > 0 || page.incomplete.length > 0) && (
          <p className="text-sm text-amber-700 dark:text-amber-400">
            {page.fixedMissing.length > 0 &&
              `Fixed costs not in yet for ${page.fixedMissing.join(", ")}. `}
            {page.incomplete.length > 0 && `Not complete yet: ${page.incomplete.join(", ")}.`}
          </p>
        )}

        <Panel title="Profit by business" id="overview-chart">
          <Amount>
            <ProfitChart
              rows={page.chart}
              currency={currency}
              labels={{ erp: "Buying house", retail: "Retail" }}
            />
          </Amount>
        </Panel>

        <More title="Why profit changed">
          {page.changes.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No store sent a day or a month again in this period.
            </p>
          ) : (
            <ul className="grid gap-3" aria-label="Changes">
              {page.changes.map((c) => (
                <li key={`${c.store}-${c.at}-${c.what}`} className="rounded-md border p-3 text-sm">
                  <p className="font-medium break-words">
                    {c.store}: {c.what}
                  </p>
                  <p className="text-muted-foreground">{when(c.at)}</p>
                  <p>
                    <Amount>
                      Was {currency} {money(c.was, currency)}, now {currency}{" "}
                      {money(c.now, currency)}
                    </Amount>
                  </p>
                  {c.lines.length > 0 && (
                    <ul className="mt-1 text-muted-foreground">
                      {c.lines.map((l) => (
                        <li key={l.figure}>
                          <Amount>
                            {FIGURE[l.figure] ?? l.figure}: {money(l.was, currency)} to{" "}
                            {money(l.now, currency)}
                          </Amount>
                        </li>
                      ))}
                    </ul>
                  )}
                </li>
              ))}
            </ul>
          )}
        </More>
      </div>
    </PrivacyProvider>
  );
}
