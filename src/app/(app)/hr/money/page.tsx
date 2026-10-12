import type { Metadata } from "next";

import { PrivacyProvider, PrivacyToggle } from "@/components/accounts/privacy";
import { SectionError } from "@/components/dashboard/section-error";
import { HrNoAccess } from "@/components/hr/no-access";
import { MoneyBoard } from "@/components/hr/money-board";
import { periodText } from "@/components/hr/money-labels";
import { MoneyRangePicker } from "@/components/hr/money-range";
import { formatMonth } from "@/lib/display";
import { getMoneySummaryAction } from "@/server/actions/hr.actions";
import { requireCompanyPage } from "@/server/pages/guards";

export const metadata: Metadata = { title: "Staff money" };

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

/** "Payroll months: Sep 2026", "Sep 2026 to Mar 2027", or none ended in the period. */
function monthsText(months: { first: string | null; last: string } | null) {
  if (!months) return "No payroll month ended in these days.";
  if (!months.first) return `Payrolls up to ${formatMonth(months.last)}.`;
  return months.first === months.last
    ? `Payroll month: ${formatMonth(months.last)}.`
    : `Payroll months: ${formatMonth(months.first)} to ${formatMonth(months.last)}.`;
}

/**
 * HR > Money (hr.money.view: Super Admin unless given): the salary,
 * conveyance, bonus and overtime that went to staff in a period, who got each,
 * and every month or trip behind a person's share with its purpose
 * (hr/money.service.ts says what counts when).
 */
export default async function MoneyPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const ctx = await requireCompanyPage();
  const params = await searchParams;
  const result = await getMoneySummaryAction({
    range: one(params.range),
    from: one(params.from),
    to: one(params.to),
  });
  if (!result.ok) {
    if (result.error.code === "FORBIDDEN") {
      return (
        <HrNoAccess title="Staff money is not part of your role">
          The totals of salary, conveyance, bonus and overtime show to the Super Admin and to roles
          given the permission to see staff money.
        </HrNoAccess>
      );
    }
    return (
      <SectionError title="Staff money" heading="Staff money could not load" error={result.error} />
    );
  }
  const summary = result.data;

  return (
    <PrivacyProvider>
      <section aria-labelledby="money-heading" className="grid gap-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h2 id="money-heading" className="font-serif text-2xl text-primary">
              Staff money
            </h2>
            <p className="mt-1 max-w-2xl text-sm leading-relaxed text-muted-foreground">
              What went to staff as salary, conveyance, bonus and overtime. Tap a total to see who
              got it, then a person to see each month or trip and what it was for.
            </p>
          </div>
          <PrivacyToggle className="w-full sm:w-auto" />
        </div>
        <MoneyRangePicker period={summary.period} today={summary.today}>
          <div className="grid gap-1">
            <p className="font-medium">{periodText(summary.period)}</p>
            <p className="text-[0.8125rem] text-muted-foreground">
              {monthsText(summary.months)} Salary, bonus and overtime come from approved payrolls
              and count in the month they are for; conveyance counts on the day of the trip.
            </p>
          </div>
          <MoneyBoard summary={summary} currency={ctx.company.currency} />
        </MoneyRangePicker>
      </section>
    </PrivacyProvider>
  );
}
