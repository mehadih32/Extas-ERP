"use client";

import Link from "next/link";

import { Amount, HeaderWithEye, PrivacyProvider } from "@/components/accounts/privacy";
import { Panel } from "@/components/sales/detail-bits";
import type { EcommercePage } from "@/modules/retail/dashboards.service";

import { BigCard, money, PeriodPicker } from "./dashboard-bits";
import { DownloadButton } from "./download-dialog";

/*
 * Business > Retail > E-commerce (plan v6 sec 10): every online store
 * together, then side by side. A store's name opens its own page with its
 * full dashboard.
 */

const change = (now: string, before: string | null) =>
  before === null ? null : (Number(now) - Number(before)).toFixed(2);

export function EcommerceScreen({ page }: { page: EcommercePage }) {
  const { currency, totals } = page;
  return (
    <PrivacyProvider>
      <div className="grid min-w-0 gap-6">
        <HeaderWithEye>
          <h2 className="font-serif text-2xl text-primary">E-commerce</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            What the online stores&apos; sites sent, less each month&apos;s fixed costs.
          </p>
        </HeaderWithEye>
        <div className="flex flex-wrap items-end justify-between gap-3">
          <PeriodPicker period={page.period} />
          <DownloadButton scope="ecommerce" period={page.period} />
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <BigCard
            label="Net sales"
            value={totals.sales}
            currency={currency}
            change={change(totals.sales, totals.previousSales)}
          />
          <BigCard
            label="Profit or loss"
            value={totals.profit}
            currency={currency}
            change={change(totals.profit, totals.previousProfit)}
          />
          <BigCard
            label="Profit rate"
            value={totals.margin === null ? "-" : `${totals.margin}%`}
            currency={currency}
            plain
          />
          <BigCard label="Orders" value={String(totals.orders)} currency={currency} plain />
        </div>
        {(page.fixedMissing.length > 0 || page.incomplete.length > 0) && (
          <p className="text-sm text-amber-700 dark:text-amber-400">
            {page.fixedMissing.length > 0 &&
              `Fixed costs not in yet for ${page.fixedMissing.join(", ")}. `}
            {page.incomplete.length > 0 && `Not complete yet: ${page.incomplete.join(", ")}.`}
          </p>
        )}

        <Panel title="Stores side by side" id="ecommerce-stores">
          {page.stores.length === 0 ? (
            <p className="mt-4 text-sm text-muted-foreground">
              No online store yet. Add one under Retail stores.
            </p>
          ) : (
            <ul className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-3" aria-label="Stores">
              {page.stores.map((s) => (
                <li key={s.id} className="min-w-0 rounded-md border p-4 text-sm">
                  <Link
                    href={`/business/stores/${s.id}`}
                    className="font-medium break-words text-primary hover:underline"
                  >
                    {s.name}
                  </Link>
                  {s.closed && <span className="ml-2 text-muted-foreground">(closed)</span>}
                  <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1">
                    <dt className="text-muted-foreground">Net sales</dt>
                    <dd className="text-right tabular-nums">
                      <Amount>{money(s.sales, currency)}</Amount>
                    </dd>
                    <dt className="text-muted-foreground">Profit or loss</dt>
                    <dd
                      className={`text-right tabular-nums ${Number(s.profit) < 0 ? "text-destructive" : ""}`}
                    >
                      <Amount>{money(s.profit, currency)}</Amount>
                    </dd>
                    <dt className="text-muted-foreground">Profit rate</dt>
                    <dd className="text-right tabular-nums">
                      {s.margin === null ? "-" : `${s.margin}%`}
                    </dd>
                    <dt className="text-muted-foreground">Owes the ERP</dt>
                    <dd className="text-right tabular-nums">
                      <Amount>{money(s.owes, currency)}</Amount>
                    </dd>
                  </dl>
                  {s.incomplete.length > 0 && (
                    <p className="mt-2 text-amber-700 dark:text-amber-400">
                      Not complete yet: {s.incomplete.join(", ")}
                    </p>
                  )}
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>
    </PrivacyProvider>
  );
}

/** Business > Retail > POS: showrooms come later (plan v6 sec 11). */
export function PosScreen() {
  return (
    <Panel title="POS" id="pos-empty" action={<DownloadButton scope="pos" />}>
      <p className="mt-4 text-sm text-muted-foreground">
        No showrooms yet. When a showroom opens, its sales and its own figures show here.
      </p>
    </Panel>
  );
}
