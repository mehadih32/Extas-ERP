"use client";

import type { ProductionStage } from "@prisma/client";
import { ArrowRightIcon } from "lucide-react";
import Link from "next/link";
import { useRef, useState } from "react";

import { toast } from "@/components/feedback/toaster";
import { money } from "@/components/sales/labels";
import { Button } from "@/components/ui/button";
import { formatCount } from "@/lib/display";
import { cn } from "@/lib/utils";
import type { BoardColumnKey } from "@/modules/production/board";
import type { BoardCardData, OverviewScreen } from "@/modules/production/screens.service";
import { setProjectStageAction, undoStageMoveAction } from "@/server/actions/production.actions";

import { ProjectBadge, TimelineBadge } from "./badges";
import { PROJECT_STATUS_LABELS, productionHref, STAGE_LABELS } from "./labels";
import { CostGuardLine } from "./cost-guard";
import { forWhom, PiecesBar, TimelineBar } from "./project-card";

const COLUMN_LABELS: Record<BoardColumnKey, string> = {
  PLANNED: PROJECT_STATUS_LABELS.PLANNED,
  FABRIC_SOURCING: STAGE_LABELS.FABRIC_SOURCING,
  CUTTING: STAGE_LABELS.CUTTING,
  SEWING: STAGE_LABELS.SEWING,
  WASH_QC: STAGE_LABELS.WASH_QC,
  FINISHING: STAGE_LABELS.FINISHING,
};

const OFFLINE = "The stage could not change. Check the connection and try again.";

/** One project on the board: who it is for, its stage, pieces, time, cost and next stage. */
function BoardCard({
  card,
  currency,
  busy,
  onMove,
}: {
  card: BoardCardData;
  currency: string;
  busy: boolean;
  onMove: (card: BoardCardData, to: ProductionStage) => void;
}) {
  const late = card.timeline.isOverdue;
  return (
    <li
      className={cn(
        "relative grid min-w-0 grid-cols-1 gap-3 rounded-lg border bg-card p-3.5 transition-colors focus-within:border-primary/40 hover:border-primary/40",
        late && "border-destructive/50 bg-destructive/5 hover:border-destructive",
      )}
    >
      <div>
        <div className="flex items-start justify-between gap-2">
          <p className="eyebrow min-w-0 truncate">
            {card.code} · {forWhom(card)}
          </p>
          <div className="-my-1 flex shrink-0 flex-wrap justify-end gap-1.5">
            {card.status === "ON_HOLD" ? (
              <ProjectBadge status={card.status} />
            ) : (
              <TimelineBadge timeline={card.timeline} />
            )}
          </div>
        </div>
        <Link
          href={productionHref.project(card.id)}
          className="mt-1.5 block font-serif text-base leading-snug break-words text-primary outline-none after:absolute after:inset-0 after:rounded-lg focus-visible:after:ring-[3px] focus-visible:after:ring-ring/25"
        >
          {card.name}
        </Link>
        <p className="mt-1 text-[0.8125rem] break-words text-muted-foreground">
          {STAGE_LABELS[card.stage.key]} · {card.stage.number} of {card.stage.of}
          {card.factoryLabel ? ` · ${card.factoryLabel}` : ""}
          {card.batch ? ` · ${card.batch.code}` : ""}
        </p>
      </div>
      <PiecesBar quantities={card.quantities} currency={currency} />
      <TimelineBar
        timeline={card.timeline}
        status={card.status}
        targetOn={card.targetOn}
        completedOn={card.completedOn}
      />
      {card.costGuard && <CostGuardLine guard={card.costGuard} currency={currency} />}
      {card.costs && (
        <p className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 border-t pt-2.5 text-[0.8125rem] tabular-nums">
          <span>
            <span className="text-muted-foreground">Cost </span>
            <span className="font-medium">{money(card.costs.totalCost, currency)}</span>
          </span>
          <span className="text-muted-foreground">
            {money(card.costs.estimatedCostPerPiece, currency)} a piece
          </span>
        </p>
      )}
      {card.next && (
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="relative z-10 w-full"
          disabled={busy}
          onClick={() => onMove(card, card.next!)}
        >
          {busy ? "Moving" : `Move to ${STAGE_LABELS[card.next]}`}
          <ArrowRightIcon aria-hidden />
        </Button>
      )}
    </li>
  );
}

/**
 * The Production board: a column for Planned and each working stage, every
 * open project as a card in its column, late ones first and in red. A
 * Production Manager moves a card to its next stage in one click, and can take
 * the move back from the note that confirms it.
 */
export function ProductionBoard({
  columns,
  currency,
}: {
  columns: OverviewScreen["columns"];
  currency: string;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const board = useRef<HTMLDivElement>(null);

  const show = (key: BoardColumnKey) =>
    board.current
      ?.querySelector(`[data-column="${key}"]`)
      ?.scrollIntoView({ behavior: "smooth", inline: "start", block: "nearest" });

  async function undo(card: BoardCardData, to: ProductionStage) {
    try {
      const result = await undoStageMoveAction(card.id, { stage: to });
      if (!result.ok) return toast.error(result.error.message);
      toast.success(`${card.code} is back at ${STAGE_LABELS[card.stage.key]}.`);
    } catch {
      toast.error(OFFLINE);
    }
  }

  async function move(card: BoardCardData, to: ProductionStage) {
    setBusy(card.id);
    try {
      const result = await setProjectStageAction(card.id, { stage: to });
      if (!result.ok) return toast.error(result.error.message);
      toast.success(`${card.code} moved to ${STAGE_LABELS[to]}.`, {
        label: "Undo",
        onClick: () => void undo(card, to),
      });
    } catch {
      toast.error(OFFLINE);
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="grid min-w-0 gap-4">
      <nav aria-label="Stages">
        <ol className="flex flex-wrap gap-2">
          {columns.map((column, index) => (
            <li key={column.key}>
              <button
                type="button"
                onClick={() => show(column.key)}
                className={cn(
                  "flex cursor-pointer items-center gap-2 rounded-full border bg-card px-3 py-1.5 text-sm transition-colors outline-none hover:border-primary/40 focus-visible:ring-[3px] focus-visible:ring-ring/25",
                  column.late > 0 && "border-destructive/40",
                )}
              >
                <span>
                  {column.key !== "PLANNED" && (
                    <span className="text-muted-foreground tabular-nums">{index}. </span>
                  )}
                  {COLUMN_LABELS[column.key]}
                </span>
                <span className="font-medium text-primary tabular-nums">
                  {formatCount(column.projects.length, currency)}
                </span>
                {column.late > 0 && (
                  <span className="text-xs font-medium text-destructive">
                    {formatCount(column.late, currency)} late
                  </span>
                )}
              </button>
            </li>
          ))}
        </ol>
      </nav>

      <div
        ref={board}
        className="-mx-4 snap-x snap-mandatory overflow-x-auto scroll-smooth px-4 pb-3 sm:mx-0 sm:snap-proximity sm:px-0"
      >
        <ol className="flex items-start gap-4" aria-label="Production board">
          {columns.map((column) => (
            <li
              key={column.key}
              data-column={column.key}
              aria-labelledby={`column-${column.key}`}
              className="grid w-[min(85vw,20rem)] shrink-0 snap-start grid-cols-1 gap-3 rounded-xl border border-dashed bg-muted/40 p-3 sm:w-72"
            >
              <h4
                id={`column-${column.key}`}
                className="flex items-baseline justify-between gap-2 px-0.5 text-sm font-medium"
              >
                <span>{COLUMN_LABELS[column.key]}</span>
                <span className="text-muted-foreground tabular-nums">
                  {formatCount(column.projects.length, currency)}
                  {column.late > 0 && (
                    <span className="text-destructive">
                      {" "}
                      · {formatCount(column.late, currency)} late
                    </span>
                  )}
                </span>
              </h4>
              {column.projects.length === 0 ? (
                <p className="rounded-lg border border-dashed px-3 py-6 text-center text-[0.8125rem] text-muted-foreground">
                  No projects here
                </p>
              ) : (
                <ul
                  className="grid min-w-0 grid-cols-1 gap-3"
                  aria-label={`${COLUMN_LABELS[column.key]} projects`}
                >
                  {column.projects.map((card) => (
                    <BoardCard
                      key={card.id}
                      card={card}
                      currency={currency}
                      busy={busy === card.id}
                      onMove={move}
                    />
                  ))}
                </ul>
              )}
            </li>
          ))}
        </ol>
      </div>
    </div>
  );
}
