import type { Metadata } from "next";
import Link from "next/link";

import { SectionError } from "@/components/dashboard/section-error";
import { PayrollBadge } from "@/components/hr/badges";
import { hrHref } from "@/components/hr/labels";
import { SalariesNoAccess } from "@/components/hr/no-access";
import { StartPayroll } from "@/components/hr/payroll-actions";
import { EmptyState } from "@/components/products/bits";
import { RowCard, RowLink } from "@/components/sales/load-more";
import { isZero, money } from "@/components/sales/labels";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatCount } from "@/lib/display";
import { getPayrollListAction } from "@/server/actions/hr.actions";
import { requireCompanyPage } from "@/server/pages/guards";

export const metadata: Metadata = { title: "Payroll" };

const linkClass = "text-primary underline-offset-4 hover:underline";
const one = (value: string | string[] | undefined) =>
  typeof value === "string" ? value : undefined;

/**
 * The payroll by month, newest first (hr.manage, hr.payroll or accounts.view):
 * a draft to check, approved and waiting to be paid, or paid. People who
 * prepare payroll (hr.payroll) start the next month's.
 */
export default async function PayrollPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const ctx = await requireCompanyPage();
  const result = await getPayrollListAction({ year: one((await searchParams).year) });
  if (!result.ok) {
    if (result.error.code === "FORBIDDEN") return <SalariesNoAccess />;
    return (
      <SectionError title="Payroll" heading="The payroll could not load" error={result.error} />
    );
  }
  const { runs, years, year, startable, can } = result.data;
  const currency = ctx.company.currency;
  const people = (n: number) => `${formatCount(n, currency)} ${n === 1 ? "employee" : "employees"}`;

  return (
    <section aria-labelledby="payroll-heading" className="grid gap-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 id="payroll-heading" className="font-serif text-2xl text-primary">
            Payroll
          </h2>
          <p className="mt-1 max-w-xl text-sm leading-relaxed text-muted-foreground">
            Each month&apos;s salaries from attendance, leave and advances: prepared and checked as
            a draft, approved by a second person, then paid by Accounts.
          </p>
        </div>
        {can.start && startable.length > 0 && <StartPayroll startable={startable} />}
      </div>

      {years.length > 1 && (
        <nav aria-label="Year" className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
          {year === null ? (
            <span aria-current="page" className="font-medium">
              All years
            </span>
          ) : (
            <Link href={hrHref.payroll} className={linkClass}>
              All years
            </Link>
          )}
          {years.map((y) =>
            y === year ? (
              <span key={y} aria-current="page" className="font-medium">
                {y}
              </span>
            ) : (
              <Link key={y} href={`${hrHref.payroll}?year=${y}`} className={linkClass}>
                {y}
              </Link>
            ),
          )}
        </nav>
      )}

      {runs.length === 0 ? (
        <EmptyState title="No payroll yet">
          {can.start
            ? "Prepare the first month's payroll once attendance and leave are in."
            : "Payroll shows here once it is prepared."}
        </EmptyState>
      ) : (
        <>
          <ul className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:hidden" aria-label="Payrolls">
            {runs.map((r) => (
              <RowCard
                key={r.id}
                href={hrHref.payrollRun(r.id)}
                eyebrow={people(r.employees)}
                badges={<PayrollBadge status={r.status} />}
                title={r.label}
                footer={
                  <>
                    <span className="text-muted-foreground">
                      {r.unpaid && !isZero(r.unpaid)
                        ? `${money(r.unpaid, currency)} to pay`
                        : r.status === "DRAFT"
                          ? "To approve"
                          : "All paid"}
                    </span>
                    <span className="font-medium">{money(r.totalNet, currency)}</span>
                  </>
                }
              />
            ))}
          </ul>
          <div className="hidden lg:block">
            <Table aria-label="Payrolls">
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead>Month</TableHead>
                  <TableHead>Employees</TableHead>
                  <TableHead className="text-right">Gross</TableHead>
                  <TableHead className="text-right">Take home</TableHead>
                  <TableHead className="text-right">Still to pay</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {runs.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="py-3">
                      <RowLink href={hrHref.payrollRun(r.id)}>{r.label}</RowLink>
                      <div className="mt-1">
                        <PayrollBadge status={r.status} />
                      </div>
                    </TableCell>
                    <TableCell className="text-muted-foreground">{people(r.employees)}</TableCell>
                    <TableCell className="text-right whitespace-nowrap tabular-nums">
                      {money(r.totalGross, currency)}
                    </TableCell>
                    <TableCell className="text-right font-medium whitespace-nowrap tabular-nums">
                      {money(r.totalNet, currency)}
                    </TableCell>
                    <TableCell className="text-right whitespace-nowrap tabular-nums">
                      {r.unpaid === null
                        ? "–"
                        : isZero(r.unpaid)
                          ? "Paid"
                          : money(r.unpaid, currency)}
                    </TableCell>
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
