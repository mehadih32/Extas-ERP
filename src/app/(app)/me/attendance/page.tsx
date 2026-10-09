import type { Metadata } from "next";

import { hrHref, shiftMonth } from "@/components/hr/labels";
import { MonthDays, MonthNav, MonthTotals } from "@/components/hr/month-days";
import { MyHrProblem } from "@/components/hr/no-access";
import { formatMonth } from "@/lib/display";
import { getMyMonthScreenAction } from "@/server/actions/portal.actions";
import { requireCompanyPage } from "@/server/pages/guards";

export const metadata: Metadata = { title: "My attendance" };

const one = (value: string | string[] | undefined) =>
  typeof value === "string" ? value : undefined;

/**
 * The employee's own month, day by day (portal.self): days off, holidays,
 * leave and each day's mark, with the figures payroll uses. Earlier months
 * open from the arrows.
 */
export default async function MyAttendancePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireCompanyPage();
  const month = one((await searchParams).month);
  const result = await getMyMonthScreenAction({
    month: /^\d{4}-(0[1-9]|1[0-2])$/.test(month ?? "") ? month : undefined,
  });
  if (!result.ok) {
    return (
      <MyHrProblem
        error={result.error}
        title="My attendance"
        heading="Your attendance could not load"
      />
    );
  }
  const m = result.data;
  const previous = shiftMonth(m.month, -1);
  const next = m.month < m.thisMonth ? shiftMonth(m.month, 1) : null;

  return (
    <section aria-labelledby="my-month-heading" className="grid grid-cols-1 gap-6">
      <h2 id="my-month-heading" className="sr-only">
        Attendance in {m.label}
      </h2>
      <MonthNav
        label={m.label}
        previous={{ href: hrHref.myMonth(previous), label: formatMonth(previous) }}
        next={next ? { href: hrHref.myMonth(next), label: formatMonth(next) } : null}
      />
      {m.totals ? (
        <>
          <MonthTotals totals={m.totals} />
          {m.month === m.thisMonth && (
            <p className="-mt-3 text-[0.8125rem] text-muted-foreground">
              Counted up to today; the days still to come are not in these figures yet.
            </p>
          )}
          <MonthDays days={m.days} today={m.today} />
        </>
      ) : (
        <p className="text-sm text-muted-foreground">
          You were not on the staff list in {m.label}.
        </p>
      )}
    </section>
  );
}
