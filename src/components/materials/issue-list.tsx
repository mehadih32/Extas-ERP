"use client";

import { RowCard, RowLink, ShowMore, useLoadMore } from "@/components/sales/load-more";
import { money } from "@/components/sales/labels";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatDay } from "@/lib/display";
import type { IssueRow } from "@/modules/materials/screens.service";
import { listIssueRowsAction } from "@/server/actions/materials.actions";

import { IssueKindBadge } from "./badges";
import { materialsHref } from "./labels";
import { issueListQuery, type IssueListView } from "./list-view";

const lines = (n: number) => `${n} ${n === 1 ? "material" : "materials"}`;

const where = (n: IssueRow) =>
  `${n.kind === "ISSUE" ? "From" : "Into"} ${n.store} · ${lines(n.lineCount)}${
    n.receivedBy ? ` · ${n.kind === "ISSUE" ? "taken by" : "brought by"} ${n.receivedBy}` : ""
  }`;

/**
 * Issue notes (materials handed to production) and return notes (unused
 * materials taken back), newest first, with "Show more".
 */
export function IssueList({
  initial,
  view,
  currency,
  seeCosts,
}: {
  initial: { items: IssueRow[]; nextCursor?: string };
  view: IssueListView;
  currency: string;
  seeCosts: boolean;
}) {
  const list = useLoadMore(initial, (cursor) => listIssueRowsAction(issueListQuery(view, cursor)));

  return (
    <div className="grid grid-cols-1 gap-5">
      <ul className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:hidden" aria-label="Issue notes">
        {list.items.map((n) => (
          <RowCard
            key={n.id}
            href={materialsHref.issue(n.id)}
            eyebrow={`${n.number} · ${formatDay(n.day)}`}
            badges={<IssueKindBadge kind={n.kind} />}
            title={`${n.project.code} · ${n.project.name}`}
            details={where(n)}
            footer={
              seeCosts && n.total ? (
                <span className="font-medium">{money(n.total, currency)}</span>
              ) : undefined
            }
          />
        ))}
      </ul>
      <div className="hidden lg:block">
        <Table aria-label="Issue notes">
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead>Note</TableHead>
              <TableHead>Project</TableHead>
              <TableHead>Store</TableHead>
              {seeCosts && <TableHead className="text-right">Cost</TableHead>}
            </TableRow>
          </TableHeader>
          <TableBody>
            {list.items.map((n) => (
              <TableRow key={n.id}>
                <TableCell className="py-3">
                  <RowLink href={materialsHref.issue(n.id)}>{n.number}</RowLink>
                  <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[0.8125rem] text-muted-foreground">
                    <span>{formatDay(n.day)}</span>
                    <IssueKindBadge kind={n.kind} />
                  </div>
                </TableCell>
                <TableCell>
                  <div className="font-medium">{n.project.code}</div>
                  <div className="max-w-64 truncate text-[0.8125rem] text-muted-foreground">
                    {n.project.name}
                  </div>
                </TableCell>
                <TableCell>
                  <div className="max-w-72 truncate text-muted-foreground">{where(n)}</div>
                </TableCell>
                {seeCosts && (
                  <TableCell className="text-right font-medium whitespace-nowrap tabular-nums">
                    {n.total ? money(n.total, currency) : "–"}
                  </TableCell>
                )}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      <ShowMore list={list} noun="notes" />
    </div>
  );
}
