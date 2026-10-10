"use client";

import { RowCard, RowLink, ShowMore, useLoadMore } from "@/components/sales/load-more";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { LeaveRow } from "@/modules/hr/screens.service";
import { listLeaveRowsAction } from "@/server/actions/hr.actions";

import { FlagBadge, LeaveBadge } from "./badges";
import { dayCount, hrHref, leaveDates } from "./labels";
import { leaveListQuery, type LeaveListView } from "./list-view";

/**
 * Leave requests, latest first: cards on phones, a table on computers, each
 * opening the request, with "Show more" for the next page.
 */
export function LeaveList({
  initial,
  view,
}: {
  initial: { items: LeaveRow[]; nextCursor?: string };
  view: LeaveListView;
}) {
  const list = useLoadMore(initial, (cursor) => listLeaveRowsAction(leaveListQuery(view, cursor)));

  return (
    <div className="grid grid-cols-1 gap-5">
      <ul className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:hidden" aria-label="Leave requests">
        {list.items.map((l) => (
          <RowCard
            key={l.id}
            href={hrHref.leaveRequest(l.id)}
            eyebrow={`${l.employee.code} · ${l.leaveType.name}`}
            badges={
              <>
                <LeaveBadge status={l.status} />
                {!l.leaveType.isPaid && <FlagBadge>Unpaid</FlagBadge>}
              </>
            }
            title={l.employee.name}
            details={l.reason ?? undefined}
            footer={
              <>
                <span className="text-muted-foreground">{leaveDates(l)}</span>
                <span className="font-medium">{dayCount(l.days)}</span>
              </>
            }
          />
        ))}
      </ul>
      <div className="hidden lg:block">
        <Table aria-label="Leave requests">
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead>Employee</TableHead>
              <TableHead>Leave</TableHead>
              <TableHead>Dates</TableHead>
              <TableHead className="text-right">Days</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {list.items.map((l) => (
              <TableRow key={l.id}>
                <TableCell className="py-3">
                  <RowLink href={hrHref.leaveRequest(l.id)}>{l.employee.name}</RowLink>
                  <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[0.8125rem] text-muted-foreground">
                    <span>{l.employee.code}</span>
                    <LeaveBadge status={l.status} />
                  </div>
                </TableCell>
                <TableCell>
                  <div>
                    {l.leaveType.name}
                    {!l.leaveType.isPaid && (
                      <span className="text-muted-foreground"> (unpaid)</span>
                    )}
                  </div>
                  {l.reason && (
                    <div className="max-w-64 truncate text-[0.8125rem] text-muted-foreground">
                      {l.reason}
                    </div>
                  )}
                </TableCell>
                <TableCell className="whitespace-nowrap text-muted-foreground">
                  {leaveDates(l)}
                </TableCell>
                <TableCell className="text-right whitespace-nowrap tabular-nums">
                  {dayCount(l.days)}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      <ShowMore list={list} noun="requests" />
    </div>
  );
}
