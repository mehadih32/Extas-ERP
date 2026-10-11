import { formatCount } from "@/lib/display";
import type { QuotationScreen } from "@/modules/sales/screens.service";

import { Panel, SizeChips, Totals, type TotalLine } from "./detail-bits";
import { money } from "./labels";
import { ProofView } from "./proof";

type Item = QuotationScreen["quotation"]["items"][number];

function ItemFacts({ item }: { item: Item }) {
  const lines = [
    [item.style ? `${item.style.code} · ${item.style.name}` : null, item.category?.name],
    [
      item.fabric ? `Fabric: ${item.fabric}` : null,
      item.gsm ? `${item.gsm} GSM` : null,
      item.colorNote ? `Colour: ${item.colorNote}` : null,
    ],
    [item.sizeRatio ? `Size ratio: ${item.sizeRatio}` : null],
    [item.accessories ? `Accessories: ${item.accessories}` : null],
  ]
    .map((parts) => parts.filter(Boolean).join(" · "))
    .filter(Boolean);
  return lines.length > 0 ? (
    <div className="mt-1 grid gap-0.5 text-[0.8125rem] break-words text-muted-foreground">
      {lines.map((line) => (
        <p key={line}>{line}</p>
      ))}
    </div>
  ) : null;
}

/**
 * A quotation's (or its proforma's) items with their specs, sizes and reference
 * pictures (tap to open full size), and the totals under them. A custom item (not
 * from the catalogue) carries a "Custom" mark.
 */
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
            <div className="flex min-w-0 gap-3">
              {item.imageId && (
                <ProofView
                  fileId={item.imageId}
                  label={`Reference picture of item ${index + 1}`}
                  description="The item's reference picture, full size."
                  className="size-16 bg-white"
                />
              )}
              <div className="min-w-0">
                <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm font-medium break-words">
                  <span>
                    <span className="text-muted-foreground tabular-nums">{index + 1}. </span>
                    {item.description}
                  </span>
                  {item.custom && (
                    <span className="rounded-full border border-dashed px-2 py-0.5 text-[0.75rem] font-normal text-muted-foreground">
                      Custom
                    </span>
                  )}
                </p>
                <ItemFacts item={item} />
                {item.sizes && (
                  <div className="mt-2">
                    <SizeChips sizes={item.sizes} />
                  </div>
                )}
              </div>
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
