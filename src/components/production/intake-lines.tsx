import { StatusBadge } from "@/components/sales/badges";
import { ColorName, Panel, SizeChips } from "@/components/sales/detail-bits";
import { formatCount } from "@/lib/display";
import type { IntakeScreen } from "@/modules/production/screens.service";

import { pieces } from "./labels";

/** What came in: each style, then each colour and grade with its sizes. */
export function IntakeLines({
  groups,
  currency,
}: {
  groups: IntakeScreen["intake"]["groups"];
  currency: string;
}) {
  return (
    <Panel title="Pieces" id="pieces-heading">
      {groups.length === 0 ? (
        <p className="mt-4 text-sm text-muted-foreground">
          No pieces entered yet. Correct the draft to count them in.
        </p>
      ) : (
        <div className="mt-4 grid grid-cols-1 gap-6">
          {groups.map((group) => (
            <section key={group.style.id} aria-label={group.style.code} className="min-w-0">
              <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-b pb-2">
                <p className="min-w-0 text-sm font-medium break-words">
                  {group.style.code} · {group.style.name}
                </p>
                <p className="text-[0.8125rem] text-muted-foreground tabular-nums">
                  {pieces(group.pieces, currency)}
                </p>
              </div>
              <ul className="mt-3 grid gap-3">
                {group.rows.map((row) => (
                  <li
                    key={`${row.color.name}-${row.grade}`}
                    className="grid min-w-0 gap-2 sm:grid-cols-[minmax(0,12rem)_minmax(0,1fr)_auto] sm:items-center sm:gap-4"
                  >
                    <div className="flex min-w-0 items-center gap-2 text-sm">
                      <ColorName name={row.color.name} hexCode={row.color.hexCode} />
                      <StatusBadge tone={row.grade === "B_GRADE" ? "warn" : "plain"}>
                        {row.grade === "B_GRADE" ? "B-grade" : "A-grade"}
                      </StatusBadge>
                    </div>
                    <SizeChips sizes={row.sizes} />
                    <p className="text-sm tabular-nums sm:text-right">
                      {formatCount(row.pieces, currency)}
                      <span className="text-muted-foreground"> pcs</span>
                    </p>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}
    </Panel>
  );
}
