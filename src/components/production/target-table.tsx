import { CheckIcon } from "lucide-react";

import { ColorName, Panel } from "@/components/sales/detail-bits";
import { formatCount } from "@/lib/display";
import { cn } from "@/lib/utils";
import type { ProjectScreen } from "@/modules/production/screens.service";

type Targets = NonNullable<ProjectScreen["project"]["targets"]>;

/**
 * One box: the pieces to make, and below it those received (a tick once all are
 * in) and, once the project is completed, those never received (wastage).
 */
function Cell({
  cell,
  currency,
}: {
  cell: { target: number; received: number; short: number } | null;
  currency: string;
}) {
  if (!cell) return <span className="text-muted-foreground/60">–</span>;
  const done = cell.target > 0 && cell.received >= cell.target;
  return (
    <span className="grid justify-items-end">
      <span className="font-medium">{formatCount(cell.target, currency)}</span>
      <span
        className={cn(
          "inline-flex items-center gap-0.5 text-xs",
          done ? "text-emerald-700 dark:text-emerald-400" : "text-muted-foreground",
        )}
      >
        {done && <CheckIcon className="size-3" aria-hidden />}
        {formatCount(cell.received, currency)} in
      </span>
      {cell.short > 0 && (
        <span className="text-xs text-amber-700 dark:text-amber-400">
          {formatCount(cell.short, currency)} short
        </span>
      )}
    </span>
  );
}

/**
 * The project's pieces to make per colour and size, a table per style, each box
 * with the pieces received into stock so far (confirmed deliveries, A- and
 * B-grade) and, once completed, those short: wastage, carried in the cost of
 * the pieces received. On a phone a wide table scrolls sideways inside the panel.
 */
export function TargetTable({ targets, currency }: { targets: Targets; currency: string }) {
  return (
    <Panel title="Pieces to make" id="targets-heading">
      <p className="mt-1 text-sm text-muted-foreground tabular-nums">
        {formatCount(targets.target, currency)} pcs by colour and size ·{" "}
        {formatCount(targets.received, currency)} received
        {targets.short > 0 && ` · ${formatCount(targets.short, currency)} short`}
      </p>
      {targets.short > 0 && (
        <p className="mt-2 text-[0.8125rem] leading-relaxed text-muted-foreground">
          Wastage: the factory never delivered the {formatCount(targets.short, currency)} pieces
          short. No loss is booked; their cost is carried by the pieces received.
        </p>
      )}
      <div className="mt-4 grid gap-6">
        {targets.styles.map((style) => (
          <section key={style.style.id} aria-label={style.style.code} className="min-w-0">
            <p className="text-sm font-medium break-words">
              {style.style.code} · {style.style.name}
            </p>
            <div className="mt-2 overflow-x-auto">
              <table className="w-full min-w-max border-collapse text-sm tabular-nums">
                <thead>
                  <tr className="border-b text-[0.8125rem] text-muted-foreground">
                    <th scope="col" className="py-2 pr-4 text-left font-normal">
                      Colour
                    </th>
                    {style.sizes.map((size) => (
                      <th key={size} scope="col" className="px-2 py-2 text-right font-normal">
                        {size}
                      </th>
                    ))}
                    <th scope="col" className="py-2 pl-3 text-right font-normal">
                      Total
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {style.rows.map((row) => (
                    <tr key={row.color.id} className="border-b last:border-b-0">
                      <th scope="row" className="py-2 pr-4 text-left font-normal">
                        <ColorName name={row.color.name} hexCode={row.color.hexCode} />
                      </th>
                      {row.cells.map((cell, i) => (
                        <td key={style.sizes[i]} className="px-2 py-2 text-right align-top">
                          <Cell cell={cell} currency={currency} />
                        </td>
                      ))}
                      <td className="py-2 pl-3 text-right align-top">
                        <Cell cell={row} currency={currency} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        ))}
      </div>
    </Panel>
  );
}
