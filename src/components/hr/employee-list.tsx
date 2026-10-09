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
import type { EmployeeListRow } from "@/modules/hr/screens.service";
import { listEmployeeRowsAction } from "@/server/actions/hr.actions";

import { EmployeeBadge, FlagBadge } from "./badges";
import { hrHref } from "./labels";
import { employeeListQuery, type EmployeeListView } from "./list-view";

const post = (e: EmployeeListRow) =>
  [e.designation, e.department].filter(Boolean).join(" · ") || "No post set";

const service = (e: EmployeeListRow) =>
  e.exitDate
    ? `${e.isCurrent ? "Leaving" : "Left"} ${formatDay(e.exitDate)}`
    : `Joined ${formatDay(e.joinDate)}`;

/**
 * Employees by code: cards on phones, a table on computers, each opening the
 * employee, with "Show more" for the next page. Salaries show only to people
 * who see salaries.
 */
export function EmployeeList({
  initial,
  view,
  currency,
  seeSalaries,
}: {
  initial: { items: EmployeeListRow[]; nextCursor?: string };
  view: EmployeeListView;
  currency: string;
  seeSalaries: boolean;
}) {
  const list = useLoadMore(initial, (cursor) =>
    listEmployeeRowsAction(employeeListQuery(view, cursor)),
  );

  return (
    <div className="grid grid-cols-1 gap-5">
      <ul className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:hidden" aria-label="Employees">
        {list.items.map((e) => (
          <RowCard
            key={e.id}
            href={hrHref.employee(e.id)}
            eyebrow={e.code}
            badges={
              <>
                {e.status !== "ACTIVE" && <EmployeeBadge status={e.status} />}
                {e.isCurrent && e.exitDate && <FlagBadge tone="warn">Leaving</FlagBadge>}
              </>
            }
            title={e.name}
            details={post(e)}
            footer={
              <>
                <span className="text-muted-foreground">{e.phone ?? service(e)}</span>
                {seeSalaries && e.salary && (
                  <span className="font-medium">{money(e.salary, currency)}</span>
                )}
              </>
            }
          />
        ))}
      </ul>
      <div className="hidden lg:block">
        <Table aria-label="Employees">
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead>Employee</TableHead>
              <TableHead>Post</TableHead>
              <TableHead>Phone</TableHead>
              <TableHead>Service</TableHead>
              {seeSalaries && <TableHead className="text-right">Monthly salary</TableHead>}
            </TableRow>
          </TableHeader>
          <TableBody>
            {list.items.map((e) => (
              <TableRow key={e.id}>
                <TableCell className="py-3">
                  <RowLink href={hrHref.employee(e.id)}>{e.name}</RowLink>
                  <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[0.8125rem] text-muted-foreground">
                    <span>{e.code}</span>
                    {e.status !== "ACTIVE" && <EmployeeBadge status={e.status} />}
                    {e.hasLogin && <span>· has a login</span>}
                  </div>
                </TableCell>
                <TableCell>
                  <div className="max-w-56 truncate">{e.designation ?? "–"}</div>
                  {e.department && (
                    <div className="max-w-56 truncate text-[0.8125rem] text-muted-foreground">
                      {e.department}
                    </div>
                  )}
                </TableCell>
                <TableCell className="whitespace-nowrap text-muted-foreground">
                  {e.phone ?? "–"}
                </TableCell>
                <TableCell className="whitespace-nowrap text-muted-foreground">
                  {service(e)}
                </TableCell>
                {seeSalaries && (
                  <TableCell className="text-right font-medium whitespace-nowrap tabular-nums">
                    {e.salary ? money(e.salary, currency) : "–"}
                  </TableCell>
                )}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      <ShowMore list={list} noun="employees" />
    </div>
  );
}
