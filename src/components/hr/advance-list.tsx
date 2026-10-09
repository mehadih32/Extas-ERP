"use client";

import { RowCard, RowLink, ShowMore, useLoadMore } from "@/components/sales/load-more";
import { isZero, money } from "@/components/sales/labels";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatDay } from "@/lib/display";
import type { AdvanceRow } from "@/modules/hr/screens.service";
import { listAdvanceRowsAction } from "@/server/actions/hr.actions";

import { AdvanceBadge, FlagBadge } from "./badges";
import { hrHref, recoveryText } from "./labels";
import { advanceListQuery, type AdvanceListView } from "./list-view";

/**
 * Salary advances, latest first: cards on phones, a table on computers, each
 * opening the advance, with "Show more" for the next page.
 */
export function AdvanceList({
  initial,
  view,
  currency,
}: {
  initial: { items: AdvanceRow[]; nextCursor?: string };
  view: AdvanceListView;
  currency: string;
}) {
  const list = useLoadMore(initial, (cursor) =>
    listAdvanceRowsAction(advanceListQuery(view, cursor)),
  );

  return (
    <div className="grid grid-cols-1 gap-5">
      <ul className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:hidden" aria-label="Advances">
        {list.items.map((a) => (
          <RowCard
            key={a.id}
            href={hrHref.advance(a.id)}
            eyebrow={`${a.number} · ${formatDay(a.givenOn)}`}
            badges={
              <>
                <AdvanceBadge status={a.status} />
                {a.isOpening && <FlagBadge>Brought forward</FlagBadge>}
              </>
            }
            title={a.employee.name}
            details={a.purpose ?? (a.status === "OPEN" ? recoveryText(a, currency) : undefined)}
            footer={
              <>
                <span className="text-muted-foreground">
                  {a.status === "OPEN" && !isZero(a.outstanding)
                    ? `${money(a.outstanding, currency)} still owed`
                    : "Nothing owed"}
                </span>
                <span className="font-medium">{money(a.amount, currency)}</span>
              </>
            }
          />
        ))}
      </ul>
      <div className="hidden lg:block">
        <Table aria-label="Advances">
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead>Advance</TableHead>
              <TableHead>Employee</TableHead>
              <TableHead>Taken back</TableHead>
              <TableHead className="text-right">Given</TableHead>
              <TableHead className="text-right">Still owed</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {list.items.map((a) => (
              <TableRow key={a.id}>
                <TableCell className="py-3">
                  <RowLink href={hrHref.advance(a.id)}>{a.number}</RowLink>
                  <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[0.8125rem] text-muted-foreground">
                    <span>{formatDay(a.givenOn)}</span>
                    <AdvanceBadge status={a.status} />
                    {a.isOpening && <FlagBadge>Brought forward</FlagBadge>}
                  </div>
                </TableCell>
                <TableCell>
                  <div className="max-w-56 truncate">{a.employee.name}</div>
                  <div className="text-[0.8125rem] text-muted-foreground">{a.employee.code}</div>
                </TableCell>
                <TableCell className="text-muted-foreground">
                  <div className="max-w-64 truncate">
                    {a.status === "OPEN" ? recoveryText(a, currency) : "–"}
                  </div>
                  {a.purpose && (
                    <div className="max-w-64 truncate text-[0.8125rem]">{a.purpose}</div>
                  )}
                </TableCell>
                <TableCell className="text-right whitespace-nowrap tabular-nums">
                  {money(a.amount, currency)}
                </TableCell>
                <TableCell className="text-right font-medium whitespace-nowrap tabular-nums">
                  {a.status === "OPEN" ? money(a.outstanding, currency) : "–"}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      <ShowMore list={list} noun="advances" />
    </div>
  );
}
