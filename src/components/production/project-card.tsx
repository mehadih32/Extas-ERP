import Link from "next/link";

import { money } from "@/components/sales/labels";
import { formatCount, formatDay } from "@/lib/display";
import { cn } from "@/lib/utils";
import type { ProjectCardData } from "@/modules/production/screens.service";

import { ProjectBadge, StageBadge, TimelineBadge } from "./badges";
import { days, pieces, productionHref } from "./labels";

type Timeline = ProjectCardData["timeline"];

/** Where the bar ends and what colour it is: red once late, amber in the last week. */
function barTone(timeline: Timeline, status: ProjectCardData["status"]) {
  if (timeline.isOverdue) return "bg-destructive";
  if (timeline.dueSoon) return "bg-amber-500";
  if (status === "CANCELLED") return "bg-muted-foreground/40";
  return "bg-primary";
}

/**
 * The time a project has had against the time it was given: "12 of 45 days used",
 * the target day, and a bar that fills up and turns red once it is late.
 */
export function TimelineBar({
  timeline,
  status,
  targetOn,
  completedOn,
}: {
  timeline: Timeline;
  status: ProjectCardData["status"];
  targetOn: string;
  completedOn: string | null;
}) {
  const closed = status === "COMPLETED" || status === "CANCELLED";
  const percent = timeline.isOverdue ? 100 : timeline.timeElapsedPercent;
  const left = closed
    ? `${days(timeline.elapsedDays)} in production`
    : `${timeline.elapsedDays} of ${days(timeline.totalDays)} used`;
  const right =
    status === "COMPLETED" && completedOn
      ? `Done ${formatDay(completedOn)}`
      : `Due ${formatDay(targetOn)}`;
  return (
    <div className="grid gap-1.5">
      <div className="flex items-baseline justify-between gap-3 text-[0.8125rem] tabular-nums">
        <span className="text-muted-foreground">{left}</span>
        <span
          className={cn(
            "whitespace-nowrap",
            timeline.isOverdue ? "font-medium text-destructive" : "text-muted-foreground",
          )}
        >
          {right}
        </span>
      </div>
      <div
        role="progressbar"
        aria-label="Time used"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent}
        aria-valuetext={
          timeline.isOverdue ? `${days(timeline.overdueDays)} late` : `${percent}% of the time used`
        }
        className="h-1.5 overflow-hidden rounded-full bg-muted"
      >
        <div
          className={cn("h-full rounded-full", barTone(timeline, status))}
          style={{ width: `${percent}%` }}
        />
      </div>
    </div>
  );
}

/** Pieces received against the target: "640 of 1,200 pcs", with a thin bar. */
export function PiecesBar({
  quantities,
  currency,
}: {
  quantities: ProjectCardData["quantities"];
  currency: string;
}) {
  const percent =
    quantities.target > 0
      ? Math.min(Math.round((quantities.produced / quantities.target) * 100), 100)
      : 0;
  return (
    <div className="grid gap-1.5">
      <div className="flex items-baseline justify-between gap-3 text-[0.8125rem] tabular-nums">
        <span className="text-muted-foreground">
          {quantities.produced > 0
            ? `${formatCount(quantities.produced, currency)} of ${pieces(quantities.target, currency)} in stock`
            : `${pieces(quantities.target, currency)} to make`}
        </span>
        {quantities.producedB > 0 && (
          <span className="whitespace-nowrap text-muted-foreground">
            {pieces(quantities.producedB, currency)} B-grade
          </span>
        )}
      </div>
      <div
        role="progressbar"
        aria-label="Pieces received"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent}
        className="h-1.5 overflow-hidden rounded-full bg-muted"
      >
        <div className="h-full rounded-full bg-primary/70" style={{ width: `${percent}%` }} />
      </div>
    </div>
  );
}

/** Who a project is for: the buyer, or In-House. */
export const forWhom = (project: Pick<ProjectCardData, "buyer">) =>
  project.buyer?.name ?? "In-House";

/**
 * A project on the Overview and on phones: who it is for, its stage and how
 * its time and pieces stand. Late projects get a red edge.
 */
export function ProjectCard({ project, currency }: { project: ProjectCardData; currency: string }) {
  const p = project;
  return (
    <li className="min-w-0">
      <Link
        href={productionHref.project(p.id)}
        className={cn(
          "group grid h-full grid-cols-1 gap-4 rounded-lg border bg-card p-4 transition-colors outline-none hover:border-primary/40 focus-visible:ring-[3px] focus-visible:ring-ring/25",
          p.timeline.isOverdue && "border-l-4 border-destructive/40 border-l-destructive",
        )}
      >
        <div>
          <div className="flex items-start justify-between gap-3">
            <p className="eyebrow min-w-0 truncate">
              {p.code} · {forWhom(p)}
            </p>
            <div className="-my-1 flex shrink-0 flex-wrap justify-end gap-1.5">
              {p.status === "ACTIVE" ? (
                <TimelineBadge timeline={p.timeline} />
              ) : (
                <ProjectBadge status={p.status} />
              )}
            </div>
          </div>
          <p className="mt-2 font-serif text-lg leading-snug break-words text-primary">{p.name}</p>
          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-sm text-muted-foreground">
            <StageBadge stage={p.stage} />
            {p.factoryLabel && <span className="min-w-0 truncate">{p.factoryLabel}</span>}
          </div>
        </div>
        <div className="grid gap-3">
          <TimelineBar
            timeline={p.timeline}
            status={p.status}
            targetOn={p.targetOn}
            completedOn={p.completedOn}
          />
          <PiecesBar quantities={p.quantities} currency={currency} />
        </div>
        {p.costs && (
          <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-t pt-3 text-sm tabular-nums">
            <span>
              <span className="text-muted-foreground">Cost so far </span>
              <span className="font-medium">{money(p.costs.totalCost, currency)}</span>
            </span>
            <span className="text-muted-foreground">
              {money(p.costs.estimatedCostPerPiece, currency)} a piece
            </span>
          </div>
        )}
      </Link>
    </li>
  );
}
