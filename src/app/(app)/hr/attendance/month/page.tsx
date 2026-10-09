import type { Metadata } from "next";
import Link from "next/link";

import { SectionError } from "@/components/dashboard/section-error";
import { FormAlert } from "@/components/forms/field";
import { hrHref, shiftMonth } from "@/components/hr/labels";
import { MonthNav } from "@/components/hr/month-days";
import { HrNoAccess } from "@/components/hr/no-access";
import { EmptyState } from "@/components/products/bits";
import { BackLink } from "@/components/settings/back-link";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatMonth } from "@/lib/display";
import { getAttendanceMonthScreenAction } from "@/server/actions/hr.actions";
import { requireCompanyPage } from "@/server/pages/guards";

export const metadata: Metadata = { title: "Attendance for the month" };

const one = (value: string | string[] | undefined) =>
  typeof value === "string" ? value : undefined;

const COLUMNS = [
  ["workingDays", "Working days"],
  ["presentDays", "Present"],
  ["lateDays", "Late"],
  ["halfDays", "Half days"],
  ["absentDays", "Absent"],
  ["paidLeaveDays", "Paid leave"],
  ["unpaidLeaveDays", "Unpaid leave"],
  ["unpaidDays", "Unpaid days"],
] as const;

/**
 * A month's day counts for each employee (hr.view, hr.manage or hr.payroll):
 * the figures payroll uses, with overtime hours. Each employee opens their
 * month day by day.
 */
export default async function AttendanceMonthPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireCompanyPage();
  const query = await searchParams;
  const month = one(query.month);
  const result = await getAttendanceMonthScreenAction({
    month: month && /^\d{4}-(0[1-9]|1[0-2])$/.test(month) ? month : undefined,
  });
  if (!result.ok) {
    if (result.error.code === "FORBIDDEN") return <HrNoAccess />;
    return (
      <SectionError title="Attendance" heading="The month could not load" error={result.error} />
    );
  }
  const m = result.data;
  const previous = shiftMonth(m.month, -1);
  const next = m.month < m.thisMonth ? shiftMonth(m.month, 1) : null;

  return (
    <section aria-labelledby="month-heading" className="grid gap-6">
      <BackLink href={hrHref.attendance()}>The day register</BackLink>
      <div>
        <h2 id="month-heading" className="font-serif text-2xl text-primary">
          Attendance for the month
        </h2>
        <p className="mt-1 max-w-xl text-sm leading-relaxed text-muted-foreground">
          The day counts payroll uses
          {m.month === m.thisMonth ? ", up to today" : ""}.
          {m.latesPerDeductionDay > 0
            ? ` Every ${m.latesPerDeductionDay} lates cost a day's salary.`
            : " Lates do not cost salary."}
        </p>
      </div>
      <MonthNav
        label={m.label}
        previous={{ href: hrHref.attendanceMonth(previous), label: formatMonth(previous) }}
        next={next ? { href: hrHref.attendanceMonth(next), label: formatMonth(next) } : null}
      />
      {m.closed && (
        <FormAlert tone="note">
          The payroll for {m.label} is approved, so these figures are final.
        </FormAlert>
      )}
      {m.rows.length === 0 ? (
        <EmptyState title="Nobody was employed that month" />
      ) : (
        <>
          <ul className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:hidden" aria-label="Employees">
            {m.rows.map((r) => (
              <li key={r.employee.id} className="rounded-lg border bg-card p-4">
                <Link
                  href={hrHref.employeeMonth(r.employee.id, m.month)}
                  className="font-medium text-primary underline-offset-4 hover:underline"
                >
                  {r.employee.name}
                </Link>
                <p className="text-[0.8125rem] text-muted-foreground">{r.employee.code}</p>
                <dl className="mt-3 grid grid-cols-3 gap-x-3 gap-y-2 border-t pt-3 text-sm tabular-nums">
                  {COLUMNS.map(([key, label]) => (
                    <div key={key}>
                      <dt className="text-[0.75rem] text-muted-foreground">{label}</dt>
                      <dd className={r[key] > 0 && key === "unpaidDays" ? "text-destructive" : ""}>
                        {r[key]}
                      </dd>
                    </div>
                  ))}
                  <div>
                    <dt className="text-[0.75rem] text-muted-foreground">Overtime</dt>
                    <dd>{r.overtimeHours} h</dd>
                  </div>
                </dl>
              </li>
            ))}
          </ul>
          <div className="hidden lg:block">
            <Table aria-label="Employees">
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead>Employee</TableHead>
                  {COLUMNS.map(([key, label]) => (
                    <TableHead key={key} className="text-right">
                      {label}
                    </TableHead>
                  ))}
                  <TableHead className="text-right">Overtime</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {m.rows.map((r) => (
                  <TableRow key={r.employee.id}>
                    <TableCell className="py-3">
                      <Link
                        href={hrHref.employeeMonth(r.employee.id, m.month)}
                        className="font-medium text-primary underline-offset-4 hover:underline"
                      >
                        {r.employee.name}
                      </Link>
                      <div className="text-[0.8125rem] text-muted-foreground">
                        {r.employee.code}
                      </div>
                    </TableCell>
                    {COLUMNS.map(([key]) => (
                      <TableCell
                        key={key}
                        className={`text-right tabular-nums ${
                          r[key] > 0 && key === "unpaidDays" ? "text-destructive" : ""
                        }`}
                      >
                        {r[key]}
                      </TableCell>
                    ))}
                    <TableCell className="text-right tabular-nums">{r.overtimeHours} h</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </>
      )}
    </section>
  );
}
