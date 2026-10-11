import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { employeePayHref } from "@/components/accounts/labels";
import { AccountsNoAccess } from "@/components/accounts/no-access";
import { Amount, PrivacyProvider, PrivacyToggle } from "@/components/accounts/privacy";
import { Stat } from "@/components/accounts/stat";
import { SectionError } from "@/components/dashboard/section-error";
import { hrHref } from "@/components/hr/labels";
import { EmptyState } from "@/components/products/bits";
import { RecordHeader } from "@/components/sales/detail-bits";
import { money } from "@/components/sales/labels";
import { BackLink } from "@/components/settings/back-link";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatDay, FULL_MONTHS } from "@/lib/display";
import { cn } from "@/lib/utils";
import { getEmployeePayAction } from "@/server/actions/accounts.actions";
import { requireCompanyPage } from "@/server/pages/guards";

export const metadata: Metadata = { title: "Employee pay" };

const linkClass = "text-primary underline-offset-4 hover:underline";
const SCOPE = "pay";
const isZero = (fixed: string) => !/[1-9]/.test(fixed);

/**
 * One employee's pay for a year (accounts.view, from the Salary & payroll panel
 * on the Overview), month by month: basic, allowances, overtime, bonus,
 * deductions and net pay from each approved payroll, when it was paid, and
 * what was paid in their name under each Salary-group expense head (a QC
 * bill). Amounts show *** until the eye shows them.
 */
export default async function EmployeePayPage({
  params,
  searchParams,
}: {
  params: Promise<{ employeeId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const ctx = await requireCompanyPage();
  const [{ employeeId }, query] = await Promise.all([params, searchParams]);
  const result = await getEmployeePayAction(
    employeeId,
    typeof query.year === "string" ? query.year : undefined,
  );
  if (!result.ok) {
    if (result.error.code === "NOT_FOUND") notFound();
    if (result.error.code === "FORBIDDEN") return <AccountsNoAccess />;
    return <SectionError title="Pay" heading="The pay could not load" error={result.error} />;
  }
  const p = result.data;
  const currency = ctx.company.currency;
  const m = (fixed: string) => money(fixed, currency);
  const cell = (fixed: string) => (isZero(fixed) ? "" : <Amount scope={SCOPE}>{m(fixed)}</Amount>);
  const hasOther = p.heads.length > 0;
  const lines = (row: (typeof p.months)[number]) => [
    ...(row.payroll
      ? [
          { label: "Basic", value: row.payroll.basic },
          { label: "Allowances", value: row.payroll.allowances },
          { label: "Overtime", value: row.payroll.overtime },
          { label: "Bonus", value: row.payroll.bonus },
          { label: "Deductions", value: row.payroll.deductions, minus: true },
          { label: "Net pay", value: row.payroll.netPay, strong: true },
        ]
      : []),
    ...p.heads.map((h, i) => ({ label: h.name, value: row.other[i]! })),
  ];

  return (
    <PrivacyProvider>
      <div className="grid grid-cols-1 gap-6">
        <BackLink href={`/accounts?costs=${p.year}`}>Overview</BackLink>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <RecordHeader eyebrow={`${p.employee.code} · Pay in ${p.year}`} title={p.employee.name}>
            <p className="mt-1 text-sm text-muted-foreground">
              {[p.employee.designation, p.employee.department].filter(Boolean).join(" · ") ||
                "Employee"}
              {p.can.openProfile && (
                <>
                  {" · "}
                  <Link href={hrHref.employee(p.employee.id)} className={linkClass}>
                    HR profile
                  </Link>
                </>
              )}
            </p>
          </RecordHeader>
          <PrivacyToggle className="w-full shrink-0 sm:w-auto" />
        </div>

        <nav aria-label="Year" className="flex flex-wrap gap-2">
          {p.years.map((y) => (
            <Link
              key={y}
              href={employeePayHref(p.employee.id, y)}
              aria-current={y === p.year ? "page" : undefined}
              className={cn(
                "inline-flex h-11 items-center rounded-md border px-4 text-sm font-medium md:h-9",
                y === p.year
                  ? "border-primary bg-primary text-primary-foreground"
                  : "bg-card hover:bg-accent",
              )}
            >
              {y}
            </Link>
          ))}
        </nav>

        <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Stat
            label="Total paid to them"
            value={m(p.totals.total)}
            scope={SCOPE}
            hint={`In ${p.year}`}
          />
          <Stat
            label="Net pay"
            value={m(p.totals.netPay)}
            scope={SCOPE}
            hint="From the approved payrolls"
          />
          {hasOther && (
            <Stat
              label="Other pay"
              value={m(p.totals.otherPay)}
              scope={SCOPE}
              hint={p.heads.map((h) => h.name).join(", ")}
            />
          )}
          {!isZero(p.totals.unpaid) && (
            <Stat
              label="Not paid yet"
              value={m(p.totals.unpaid)}
              scope={SCOPE}
              hint="Approved, waiting for payment"
              alert
            />
          )}
        </dl>

        {p.months.length === 0 ? (
          <EmptyState title={`Nothing paid in ${p.year}`}>
            Approved payrolls and payments in {p.employee.name}&apos;s name show here, month by
            month.
          </EmptyState>
        ) : (
          <>
            <ul className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:hidden" aria-label="Months">
              {p.months.map((row) => (
                <li key={row.month} className="rounded-lg border bg-card p-4">
                  <div className="flex items-baseline justify-between gap-3">
                    <h3 className="font-medium">
                      {FULL_MONTHS[row.month - 1]} {p.year}
                    </h3>
                    {row.payroll && (
                      <Link
                        href={hrHref.payslip(row.payroll.runId, row.payroll.itemId)}
                        className={`text-sm ${linkClass}`}
                      >
                        Payslip
                      </Link>
                    )}
                  </div>
                  <dl className="mt-3 grid gap-1 text-sm">
                    {lines(row).map((l) => (
                      <div key={l.label} className="flex items-baseline justify-between gap-3">
                        <dt className="text-muted-foreground">{l.label}</dt>
                        <dd
                          className={cn("text-right tabular-nums", "strong" in l && "font-medium")}
                        >
                          {isZero(l.value) ? (
                            "–"
                          ) : (
                            <Amount scope={SCOPE}>
                              {"minus" in l ? "− " : ""}
                              {m(l.value)}
                            </Amount>
                          )}
                        </dd>
                      </div>
                    ))}
                  </dl>
                  <p className="mt-3 flex items-baseline justify-between gap-3 border-t pt-3 text-sm">
                    <span className="text-muted-foreground">
                      {row.payroll
                        ? row.payroll.paidOn
                          ? `Paid on ${formatDay(row.payroll.paidOn)}`
                          : "Not paid yet"
                        : "Total"}
                    </span>
                    <span className="font-medium tabular-nums">
                      <Amount scope={SCOPE}>{m(row.total)}</Amount>
                    </span>
                  </p>
                </li>
              ))}
            </ul>
            <div className="hidden lg:block">
              <Table aria-label="Months">
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead>Month</TableHead>
                    <TableHead className="text-right">Basic</TableHead>
                    <TableHead className="text-right">Allowances</TableHead>
                    <TableHead className="text-right">Overtime</TableHead>
                    <TableHead className="text-right">Bonus</TableHead>
                    <TableHead className="text-right">Deductions</TableHead>
                    <TableHead className="text-right">Net pay</TableHead>
                    {p.heads.map((h) => (
                      <TableHead key={h.id} className="text-right">
                        {h.name}
                      </TableHead>
                    ))}
                    <TableHead className="text-right">Total</TableHead>
                    <TableHead>Paid</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {p.months.map((row) => (
                    <TableRow key={row.month}>
                      <TableCell className="py-3 font-medium whitespace-nowrap">
                        {row.payroll ? (
                          <Link
                            href={hrHref.payslip(row.payroll.runId, row.payroll.itemId)}
                            className={linkClass}
                          >
                            {FULL_MONTHS[row.month - 1]}
                          </Link>
                        ) : (
                          FULL_MONTHS[row.month - 1]
                        )}
                      </TableCell>
                      <TableCell className="text-right whitespace-nowrap">
                        {row.payroll && cell(row.payroll.basic)}
                      </TableCell>
                      <TableCell className="text-right whitespace-nowrap">
                        {row.payroll && cell(row.payroll.allowances)}
                      </TableCell>
                      <TableCell className="text-right whitespace-nowrap">
                        {row.payroll && cell(row.payroll.overtime)}
                      </TableCell>
                      <TableCell className="text-right whitespace-nowrap">
                        {row.payroll && cell(row.payroll.bonus)}
                      </TableCell>
                      <TableCell className="text-right whitespace-nowrap">
                        {row.payroll && cell(row.payroll.deductions)}
                      </TableCell>
                      <TableCell className="text-right font-medium whitespace-nowrap">
                        {row.payroll && cell(row.payroll.netPay)}
                      </TableCell>
                      {p.heads.map((h, i) => (
                        <TableCell key={h.id} className="text-right whitespace-nowrap">
                          {cell(row.other[i]!)}
                        </TableCell>
                      ))}
                      <TableCell className="text-right font-medium whitespace-nowrap">
                        <Amount scope={SCOPE}>{m(row.total)}</Amount>
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-muted-foreground">
                        {row.payroll
                          ? row.payroll.paidOn
                            ? formatDay(row.payroll.paidOn)
                            : "Not yet"
                          : ""}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
                <tfoot className="border-t bg-muted/30">
                  <TableRow className="hover:bg-transparent">
                    <TableCell className="font-medium">Year</TableCell>
                    <TableCell className="text-right whitespace-nowrap">
                      {cell(p.totals.basic)}
                    </TableCell>
                    <TableCell className="text-right whitespace-nowrap">
                      {cell(p.totals.allowances)}
                    </TableCell>
                    <TableCell className="text-right whitespace-nowrap">
                      {cell(p.totals.overtime)}
                    </TableCell>
                    <TableCell className="text-right whitespace-nowrap">
                      {cell(p.totals.bonus)}
                    </TableCell>
                    <TableCell className="text-right whitespace-nowrap">
                      {cell(p.totals.deductions)}
                    </TableCell>
                    <TableCell className="text-right font-medium whitespace-nowrap">
                      {cell(p.totals.netPay)}
                    </TableCell>
                    {p.heads.map((h, i) => (
                      <TableCell key={h.id} className="text-right whitespace-nowrap">
                        {cell(p.totals.other[i]!)}
                      </TableCell>
                    ))}
                    <TableCell className="text-right font-medium whitespace-nowrap">
                      <Amount scope={SCOPE}>{m(p.totals.total)}</Amount>
                    </TableCell>
                    <TableCell />
                  </TableRow>
                </tfoot>
              </Table>
            </div>
          </>
        )}
        <p className="text-[0.8125rem] leading-relaxed text-muted-foreground">
          Deductions are unpaid leave, advance repayments, tax and other deductions on the payslip.
          Other pay is money recorded as an expense in their name under a Salary-group head, such as
          a QC bill.
        </p>
      </div>
    </PrivacyProvider>
  );
}
