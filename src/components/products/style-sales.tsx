import { formatCount } from "@/lib/display";
import type { StyleScreen } from "@/modules/inventory/screens.service";

import { money } from "./labels";

type Sales = NonNullable<StyleScreen["sales"]>;

/**
 * The style's sales at a glance (sales.view): pieces sold and revenue, with the
 * wholesale and retail split as a bar. Invoiced orders only, after discounts.
 */
export function StyleSalesKpis({ sales, currency }: { sales: Sales; currency: string }) {
  const { wholesale, retail, total } = sales;
  const count = (n: number) => formatCount(n, currency);
  const share = (part: number, whole: number) => (whole > 0 ? (part / whole) * 100 : 0);
  const cards = [
    {
      label: "Units sold",
      value: `${count(total.pieces)} pcs`,
      wholesale: `${count(wholesale.pieces)} pcs`,
      retail: `${count(retail.pieces)} pcs`,
      split: share(wholesale.pieces, total.pieces),
      empty: total.pieces === 0,
    },
    {
      label: "Total revenue",
      value: money(total.net, currency),
      wholesale: money(wholesale.net, currency),
      retail: money(retail.net, currency),
      split: share(Number(wholesale.net), Number(total.net)),
      empty: Number(total.net) === 0,
    },
  ];
  return (
    <section aria-label="Sales of this style" className="grid gap-2">
      <div className="grid gap-3 sm:grid-cols-2">
        {cards.map((c) => (
          <div key={c.label} className="rounded-xl border bg-card p-4 shadow-sm sm:p-5">
            <p className="eyebrow">{c.label}</p>
            <p className="mt-1 font-serif text-2xl break-words text-primary lining-nums tabular-nums">
              {c.value}
            </p>
            <div aria-hidden className="mt-3 flex h-2 overflow-hidden rounded-full bg-muted">
              {!c.empty && (
                <>
                  <span className="bg-primary" style={{ width: `${c.split}%` }} />
                  <span className="flex-1 bg-primary/35" />
                </>
              )}
            </div>
            <dl className="mt-2 flex flex-wrap justify-between gap-x-4 gap-y-1 text-[0.8125rem] tabular-nums">
              <div className="flex items-center gap-1.5">
                <span aria-hidden className="size-2 rounded-full bg-primary" />
                <dt className="text-muted-foreground">Wholesale</dt>
                <dd>{c.wholesale}</dd>
              </div>
              <div className="flex items-center gap-1.5">
                <span aria-hidden className="size-2 rounded-full bg-primary/35" />
                <dt className="text-muted-foreground">Retail</dt>
                <dd>{c.retail}</dd>
              </div>
            </dl>
          </div>
        ))}
      </div>
      <p className="text-xs text-muted-foreground">
        Invoiced sales, all time, after discounts. Wholesale includes B2B pre-orders; retail is
        counter sales, social commerce and the website.
      </p>
    </section>
  );
}
