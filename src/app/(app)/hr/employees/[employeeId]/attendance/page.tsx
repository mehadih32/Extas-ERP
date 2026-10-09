import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { SectionError } from "@/components/dashboard/section-error";
import { FormAlert } from "@/components/forms/field";
import { hrHref, shiftMonth } from "@/components/hr/labels";
import { MonthDays, MonthNav, MonthTotals } from "@/components/hr/month-days";
import { HrNoAccess } from "@/components/hr/no-access";
import { RecordHeader } from "@/components/sales/detail-bits";
import { BackLink } from "@/components/settings/back-link";
import { formatMonth } from "@/lib/display";
import { getEmployeeMonthScreenAction } from "@/server/actions/hr.actions";
import { requireCompanyPage } from "@/server/pages/guards";

export const metadata: Metadata = { title: "Attendance" };

const one = (value: string | string[] | undefined) =>
  typeof value === "string" ? value : undefined;

/**
 * One employee's month, day by day (hr.view, hr.manage or hr.payroll): days
 * off, holidays, leave and each day's mark, with the figures payroll uses. HR
 * opens a day's register to mark it while the month's payroll is open.
 */
export default async function EmployeeMonthPage({
  params,
  searchParams,
}: {
  params: Promise<{ employeeId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireCompanyPage();
  const [{ employeeId }, query] = await Promise.all([params, searchParams]);
  const result = await getEmployeeMonthScreenAction(employeeId, {
    month: /^\d{4}-(0[1-9]|1[0-2])$/.test(one(query.month) ?? "") ? one(query.month) : undefined,
  });
  if (!result.ok) {
    if (result.error.code === "NOT_FOUND") notFound();
    if (result.error.code === "FORBIDDEN") return <HrNoAccess />;
    return (
      <SectionError title="Attendance" heading="The month could not load" error={result.error} />
    );
  }
  const m = result.data;
  const previous = shiftMonth(m.month, -1);
  const next = m.month < m.thisMonth ? shiftMonth(m.month, 1) : null;

  return (
    <div className="grid grid-cols-1 gap-6">
      <BackLink href={hrHref.employee(m.employee.id)}>{m.employee.name}</BackLink>
      <RecordHeader eyebrow={`${m.employee.code} · Attendance`} title={m.employee.name} />
      <MonthNav
        label={m.label}
        previous={{
          href: hrHref.employeeMonth(m.employee.id, previous),
          label: formatMonth(previous),
        }}
        next={
          next
            ? { href: hrHref.employeeMonth(m.employee.id, next), label: formatMonth(next) }
            : null
        }
      />
      {m.closed && (
        <FormAlert tone="note">
          The payroll for {m.label} is approved, so its attendance is final. Reopening that payroll
          lets it change.
        </FormAlert>
      )}
      {m.totals ? (
        <>
          <MonthTotals totals={m.totals} />
          {m.month === m.thisMonth && (
            <p className="-mt-3 text-[0.8125rem] text-muted-foreground">
              Counted up to today; the days still to come are not in these figures yet.
            </p>
          )}
          <MonthDays
            days={m.days}
            today={m.today}
            dayHref={m.can.mark ? (date) => hrHref.attendance(date) : undefined}
          />
        </>
      ) : (
        <p className="text-sm text-muted-foreground">
          {m.employee.name} was not employed in {m.label}.
        </p>
      )}
    </div>
  );
}
