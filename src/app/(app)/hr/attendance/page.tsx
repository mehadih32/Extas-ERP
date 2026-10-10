import type { Metadata } from "next";
import Link from "next/link";

import { Stat } from "@/components/accounts/stat";
import { SectionError } from "@/components/dashboard/section-error";
import { FormAlert } from "@/components/forms/field";
import { AttendanceRegister, DayPicker } from "@/components/hr/attendance-register";
import { DAY_TYPE_LABELS, hrHref, marksVersion } from "@/components/hr/labels";
import { HrNoAccess } from "@/components/hr/no-access";
import { dayParam } from "@/components/parties/route";
import { EmptyState } from "@/components/products/bits";
import { formatCount, formatLongDay } from "@/lib/display";
import { getAttendanceScreenAction } from "@/server/actions/hr.actions";
import { requireCompanyPage } from "@/server/pages/guards";

export const metadata: Metadata = { title: "Attendance" };

/**
 * The day register (hr.view, hr.manage or hr.payroll): everyone employed that
 * day with their mark and any leave. HR (hr.manage) marks lates, half days,
 * absences and overtime while the month's payroll is open; unmarked working
 * days count as present.
 */
export default async function AttendancePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const ctx = await requireCompanyPage();
  const query = await searchParams;
  const result = await getAttendanceScreenAction({ date: dayParam(query.date) });
  if (!result.ok) {
    if (result.error.code === "FORBIDDEN") return <HrNoAccess />;
    return (
      <SectionError title="Attendance" heading="The register could not load" error={result.error} />
    );
  }
  const screen = result.data;
  const { totals } = screen;
  const count = (n: number) => formatCount(n, ctx.company.currency);
  const working = screen.dayType === "WORKING";

  return (
    <section aria-labelledby="register-heading" className="grid gap-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 id="register-heading" className="font-serif text-2xl text-primary">
            {formatLongDay(screen.date)}
          </h2>
          <p className="mt-1 max-w-xl text-sm leading-relaxed text-muted-foreground">
            {working
              ? "Everyone counts as present unless marked. Mark lates, half days, absences and overtime."
              : `${screen.holiday ?? DAY_TYPE_LABELS[screen.dayType]}: nobody is expected in. Overtime can still be marked.`}
          </p>
        </div>
        <Link
          href={hrHref.attendanceMonth(screen.date.slice(0, 7))}
          className="text-sm text-primary underline-offset-4 hover:underline"
        >
          The month in figures
        </Link>
      </div>

      <DayPicker
        date={screen.date}
        today={screen.today}
        previous={screen.previous}
        next={screen.next}
      />

      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        <Stat label="Employees" value={count(totals.employees)} />
        <Stat label="Late" value={count(totals.late)} alert={totals.late > 0} />
        <Stat label="Half day" value={count(totals.halfDay)} />
        <Stat label="Absent" value={count(totals.absent)} alert={totals.absent > 0} />
        <Stat label="On leave" value={count(totals.onLeave)} className="col-span-2 sm:col-span-1" />
      </dl>

      {screen.notes.mark && <FormAlert tone="note">{screen.notes.mark}</FormAlert>}

      {screen.rows.length === 0 ? (
        <EmptyState title="Nobody was employed that day">
          The register lists the people working here on the day.
        </EmptyState>
      ) : (
        <AttendanceRegister screen={screen} version={marksVersion(screen.rows)} />
      )}
    </section>
  );
}
