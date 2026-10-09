"use client";

import { RowLink, ShowMore, useLoadMore } from "@/components/sales/load-more";
import { money } from "@/components/sales/labels";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatCount, formatDay } from "@/lib/display";
import { cn } from "@/lib/utils";
import type { ProjectCardData } from "@/modules/production/screens.service";
import { listProjectRowsAction } from "@/server/actions/production.actions";

import { ProjectBadge, StageBadge, TimelineBadge } from "./badges";
import { productionHref } from "./labels";
import { projectListQuery, type ProjectListView } from "./list-view";
import { forWhom, ProjectCard } from "./project-card";

/**
 * The projects found: cards on phones and tablets, a table on computers, each
 * opening the project, with "Show more" for the next page.
 */
export function ProjectList({
  initial,
  view,
  currency,
}: {
  initial: { items: ProjectCardData[]; nextCursor?: string };
  view: ProjectListView;
  currency: string;
}) {
  const list = useLoadMore(initial, (cursor) =>
    listProjectRowsAction(projectListQuery(view, cursor)),
  );
  const showCosts = list.items.some((p) => p.costs);

  return (
    <div className="grid grid-cols-1 gap-5">
      <ul className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:hidden" aria-label="Projects">
        {list.items.map((project) => (
          <ProjectCard key={project.id} project={project} currency={currency} />
        ))}
      </ul>
      <div className="hidden lg:block">
        <Table aria-label="Projects">
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead>Project</TableHead>
              <TableHead>For</TableHead>
              <TableHead>Stage</TableHead>
              <TableHead>Target day</TableHead>
              <TableHead className="text-right">Pieces in stock</TableHead>
              {showCosts && <TableHead className="text-right">Cost a piece</TableHead>}
            </TableRow>
          </TableHeader>
          <TableBody>
            {list.items.map((p) => (
              <TableRow key={p.id}>
                <TableCell className="py-3">
                  <RowLink href={productionHref.project(p.id)}>{p.code}</RowLink>
                  <div className="mt-1 max-w-72 truncate text-[0.8125rem]">{p.name}</div>
                </TableCell>
                <TableCell>
                  <div className="max-w-56 truncate">{forWhom(p)}</div>
                  {p.factoryLabel && (
                    <div className="max-w-56 truncate text-[0.8125rem] text-muted-foreground">
                      {p.factoryLabel}
                    </div>
                  )}
                </TableCell>
                <TableCell>
                  <div className="flex flex-wrap items-center gap-1.5">
                    {p.status === "ACTIVE" ? (
                      <StageBadge stage={p.stage} />
                    ) : (
                      <ProjectBadge status={p.status} />
                    )}
                  </div>
                </TableCell>
                <TableCell>
                  <div
                    className={cn(
                      "whitespace-nowrap",
                      p.timeline.isOverdue && "font-medium text-destructive",
                    )}
                  >
                    {formatDay(
                      p.status === "COMPLETED" && p.completedOn ? p.completedOn : p.targetOn,
                    )}
                  </div>
                  <div className="mt-1">
                    <TimelineBadge timeline={p.timeline} />
                  </div>
                </TableCell>
                <TableCell className="text-right whitespace-nowrap tabular-nums">
                  {formatCount(p.quantities.produced, currency)}
                  <span className="text-muted-foreground">
                    {" "}
                    of {formatCount(p.quantities.target, currency)}
                  </span>
                </TableCell>
                {showCosts && (
                  <TableCell className="text-right whitespace-nowrap tabular-nums">
                    {p.costs ? money(p.costs.estimatedCostPerPiece, currency) : null}
                  </TableCell>
                )}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      <ShowMore list={list} noun="projects" />
    </div>
  );
}
