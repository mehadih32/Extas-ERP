import Link from "next/link";

import { StatusBadge, type Tone } from "@/components/sales/badges";
import { money } from "@/components/sales/labels";
import { cn } from "@/lib/utils";
import type { BatchCardData } from "@/modules/production/batch-screens.service";
import type { BatchState } from "@/modules/production/schemas";

import { TimelineBadge } from "./badges";
import { BatchGuardLine } from "./cost-guard";
import { BATCH_STATE_LABELS, pieces, productionHref } from "./labels";

/** The kind in a word or two, so it fits beside the code on a card. */
const KIND_SHORT: Record<BatchCardData["kind"], string> = {
  CM: "CM",
  READYMADE: "Ready-made",
  DROPSHIP: "Dropship",
};
import { PiecesBar, TimelineBar } from "./project-card";

const STATE_TONES: Record<BatchState, Tone> = {
  EMPTY: "plain",
  PLANNED: "plain",
  ACTIVE: "open",
  DONE: "done",
};

export function BatchBadge({ state }: { state: BatchState }) {
  return <StatusBadge tone={STATE_TONES[state]}>{BATCH_STATE_LABELS[state]}</StatusBadge>;
}

/** The project status the batch's days read as on the time bar. */
export const batchStatus = (state: BatchState) =>
  state === "DONE" ? "COMPLETED" : state === "ACTIVE" ? "ACTIVE" : "PLANNED";

/** "3 styles · 1 late". */
export function stylesText(batch: Pick<BatchCardData, "styleCount" | "lateStyles">) {
  const styles = `${batch.styleCount} ${batch.styleCount === 1 ? "style" : "styles"}`;
  return batch.lateStyles > 0 ? `${styles} · ${batch.lateStyles} late` : styles;
}

/**
 * A master batch on the Batches tab: its kind, styles, days and pieces, and for
 * people who see costs its cost so far and cost guard. A late style gives it a
 * red edge.
 */
export function BatchCard({ batch: b, currency }: { batch: BatchCardData; currency: string }) {
  const late = b.lateStyles > 0 || Boolean(b.timeline?.isOverdue);
  return (
    <li className="min-w-0">
      <Link
        href={productionHref.batch(b.id)}
        className={cn(
          "group grid h-full grid-cols-1 gap-4 rounded-lg border bg-card p-4 transition-colors outline-none hover:border-primary/40 focus-visible:ring-[3px] focus-visible:ring-ring/25",
          late && "border-l-4 border-destructive/40 border-l-destructive bg-destructive/5",
        )}
      >
        <div>
          <div className="flex items-start justify-between gap-3">
            <p className="eyebrow min-w-0 truncate">
              {b.code} · {KIND_SHORT[b.kind]}
            </p>
            <div className="-my-1 flex shrink-0 flex-wrap justify-end gap-1.5">
              {b.state === "ACTIVE" && b.timeline?.isOverdue ? (
                <TimelineBadge timeline={b.timeline} />
              ) : (
                <BatchBadge state={b.state} />
              )}
            </div>
          </div>
          <p className="mt-2 font-serif text-lg leading-snug break-words text-primary">{b.name}</p>
          <p className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-sm text-muted-foreground">
            <span className={cn(b.lateStyles > 0 && "font-medium text-destructive")}>
              {stylesText(b)}
            </span>
            {b.factory && <span className="min-w-0 truncate">{b.factory.name}</span>}
          </p>
        </div>
        {b.styleCount > 0 && (
          <div className="grid gap-3">
            {b.timeline && (
              <TimelineBar
                timeline={b.timeline}
                status={batchStatus(b.state)}
                targetOn={b.timeline.dueOn}
                completedOn={null}
              />
            )}
            <PiecesBar quantities={b.quantities} currency={currency} />
            {b.costs?.guard && <BatchGuardLine guard={b.costs.guard} currency={currency} />}
          </div>
        )}
        {b.costs && b.styleCount > 0 && (
          <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-t pt-3 text-sm tabular-nums">
            <span>
              <span className="text-muted-foreground">Cost so far </span>
              <span className="font-medium">{money(b.costs.totalCost, currency)}</span>
            </span>
            {b.costs.perPiece && (
              <span className="text-muted-foreground">
                {money(b.costs.perPiece, currency)} a piece
              </span>
            )}
          </div>
        )}
        {b.styleCount === 0 && (
          <p className="text-[0.8125rem] text-muted-foreground">
            No styles yet. Open it and add the first style.
          </p>
        )}
      </Link>
    </li>
  );
}

/** "1,200 pcs of 5 styles" for the batch page's header. */
export function batchPiecesText(b: BatchCardData, currency: string) {
  return `${pieces(b.quantities.target, currency)} in ${stylesText(b)}`;
}
