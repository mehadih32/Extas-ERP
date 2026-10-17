import { CircleCheckIcon } from "lucide-react";
import Link from "next/link";

import { productionHref, remainingText, STAGE_LABELS } from "@/components/production/labels";
import { formatCount, formatDay } from "@/lib/display";
import { cn } from "@/lib/utils";
import type { ProductionPipeline } from "@/modules/dashboard/pipeline.service";

type Project = ProductionPipeline["items"][number];

/** "12 days left", "3 days late" (red), or "Due today" (amber in the last week). */
function DueText({ project }: { project: Project }) {
  const text = remainingText(project);
  if (!text) return null;
  return (
    <span
      title={`Target ${formatDay(project.targetOn)}`}
      className={cn(
        "shrink-0 text-[0.8125rem] whitespace-nowrap tabular-nums",
        project.isOverdue
          ? "font-medium text-destructive"
          : project.dueSoon
            ? "text-amber-800"
            : "text-muted-foreground",
      )}
    >
      {text}
    </span>
  );
}

function ProjectBar({
  project,
  open,
  currency,
}: {
  project: Project;
  open: boolean;
  currency: string;
}) {
  const stage = STAGE_LABELS[project.stage];
  const count = (n: number) => formatCount(n, currency);
  return (
    <li className="py-3.5 first:pt-0 last:pb-0">
      <div className="flex items-baseline justify-between gap-3">
        <p className="min-w-0 text-sm font-medium break-words">
          {open ? (
            <Link
              href={productionHref.project(project.id)}
              className="underline-offset-4 hover:underline"
            >
              {project.name}
            </Link>
          ) : (
            project.name
          )}
        </p>
        <DueText project={project} />
      </div>
      <p className="mt-0.5 text-[0.8125rem] break-words text-muted-foreground">
        {project.code} · {project.buyer ?? "In-House"}
      </p>
      <div
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={project.percent}
        aria-label={`${project.name}: ${project.percent}% complete, ${stage} stage`}
        className="mt-2.5 h-2.5 w-full overflow-hidden rounded-full bg-muted"
      >
        <div
          className={cn(
            "h-full rounded-full transition-[width]",
            project.isOverdue ? "bg-destructive" : "bg-primary",
          )}
          style={{ width: `${project.percent}%` }}
        />
      </div>
      <p className="mt-1.5 flex flex-wrap gap-x-1.5 text-[0.8125rem]">
        <span className="font-medium tabular-nums">{project.percent}% complete</span>
        <span className="text-muted-foreground">· {stage} stage</span>
        {project.received > 0 && (
          <span className="text-muted-foreground">
            · {count(project.received)} of {count(project.target)} pcs received
          </span>
        )}
      </p>
    </li>
  );
}

/**
 * The production pipeline: each active project as a progress bar, the most
 * pressing first, with its stage and the days left (red once late). Pieces and
 * days only, no money.
 */
export function Pipeline({ data, currency }: { data: ProductionPipeline; currency: string }) {
  const more = data.active - data.items.length;
  return (
    <section aria-labelledby="pipeline-heading" className="min-w-0">
      <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-1">
        <h2 id="pipeline-heading" className="font-serif text-2xl text-primary">
          Production pipeline
        </h2>
        <p className="text-[0.8125rem] text-muted-foreground">
          Active projects, the most pressing first
        </p>
      </div>
      <div className="mt-5 rounded-lg border bg-card p-5">
        {data.items.length === 0 ? (
          <p className="flex items-start gap-2 text-sm text-muted-foreground">
            <CircleCheckIcon className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
            No production project is running now.
          </p>
        ) : (
          <ul className="divide-y" aria-label="Active production projects">
            {data.items.map((project) => (
              <ProjectBar key={project.id} project={project} open={data.open} currency={currency} />
            ))}
          </ul>
        )}
        {(more > 0 || data.onHold > 0 || (data.open && data.active > 0)) && (
          <div className="mt-4 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-t pt-3 text-[0.8125rem]">
            {data.open ? (
              <Link href="/production" className="text-primary underline-offset-4 hover:underline">
                {more > 0
                  ? `See all ${formatCount(data.active, currency)} active projects`
                  : "Open Production"}
              </Link>
            ) : (
              <span className="text-muted-foreground">
                {more > 0 ? `${formatCount(more, currency)} more active` : ""}
              </span>
            )}
            {data.onHold > 0 && (
              <span className="text-muted-foreground">
                {formatCount(data.onHold, currency)} on hold
              </span>
            )}
          </div>
        )}
      </div>
    </section>
  );
}
