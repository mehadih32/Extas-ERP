import { formatCount } from "@/lib/display";
import type { QuotationScreen } from "@/modules/sales/screens.service";

import { Panel, SizeChips, Totals, type TotalLine } from "./detail-bits";
import { money } from "./labels";

type Item = QuotationScreen["quotation"]["items"][number];

function ItemFacts({ item }: { item: Item }) {
  const facts = [
    item.style ? `${item.style.code} · ${item.style.name}` : null,
    item.category?.name,
    item.fabric ? `Fabric: ${item.fabric}` : null,
    item.colorNote ? `Colour: ${item.colorNote}` : null,
  ].filter(Boolean);
  return facts.length > 0 ? (
    <p className="mt-1 text-[0.8125rem] text-muted-foreground">{facts.join(" · ")}</p>
  ) : null;
}

/** A quotation's (or its proforma's) items with their sizes, and the totals under them. */
export function QuoteItems({
  items,
  totals,
  currency,
}: {
  items: Item[];
  totals: TotalLine[];
  currency: string;
}) {
  return (
    <Panel title="Items" id="items-heading">
      <ol className="mt-4 grid grid-cols-1 divide-y">
        {items.map((item, index) => (
          <li
            key={item.id}
            className="grid min-w-0 gap-2 py-4 first:pt-0 last:pb-0 sm:grid-cols-[minmax(0,1fr)_auto] sm:gap-6"
          >
            <div className="min-w-0">
              <p className="text-sm font-medium break-words">
                <span className="text-muted-foreground tabular-nums">{index + 1}. </span>
                {item.description}
              </p>
              <ItemFacts item={item} />
              {item.sizes && (
                <div className="mt-2">
                  <SizeChips sizes={item.sizes} />
                </div>
              )}
            </div>
            <div className="text-sm tabular-nums sm:text-right">
              <p className="text-muted-foreground">
                {formatCount(item.quantity, currency)} pcs × {money(item.unitPrice, currency)}
              </p>
              <p className="font-medium">{money(item.lineTotal, currency)}</p>
            </div>
          </li>
        ))}
      </ol>
      <Totals
        className="mt-5 border-t pt-4 sm:ml-auto sm:max-w-sm"
        currency={currency}
        lines={totals}
      />
    </Panel>
  );
}
