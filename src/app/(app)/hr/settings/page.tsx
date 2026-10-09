import type { Metadata } from "next";
import Link from "next/link";

import { SectionError } from "@/components/dashboard/section-error";
import { hrHref, offDaysText } from "@/components/hr/labels";
import { HrNoAccess } from "@/components/hr/no-access";
import { Holidays, HrRules, LeaveTypes } from "@/components/hr/settings-actions";
import { Fact, Panel } from "@/components/sales/detail-bits";
import { getHrSettingsScreenAction } from "@/server/actions/hr.actions";
import { requireCompanyPage } from "@/server/pages/guards";

export const metadata: Metadata = { title: "Holidays & rules" };

const linkClass = "text-primary underline-offset-4 hover:underline";
const one = (value: string | string[] | undefined) =>
  typeof value === "string" ? value : undefined;

/** "09:00" plus 15 minutes: "09:15". */
function lateAfter(start: string, grace: number) {
  const [h, m] = start.split(":").map(Number) as [number, number];
  const total = (h * 60 + m + grace) % (24 * 60);
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}

/**
 * The working week, late rules, holidays and leave types that attendance,
 * leave and payroll follow. Everyone with HR access reads them; HR
 * (hr.manage) changes them.
 */
export default async function HrSettingsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireCompanyPage();
  const result = await getHrSettingsScreenAction({ year: one((await searchParams).year) });
  if (!result.ok) {
    if (result.error.code === "FORBIDDEN") return <HrNoAccess />;
    return (
      <SectionError
        title="Holidays & rules"
        heading="The HR rules could not load"
        error={result.error}
      />
    );
  }
  const { rules, year, years, holidays, leaveTypes, can } = result.data;
  const shownYears = years.includes(year) ? years : [...years, year].sort((a, b) => a - b);

  return (
    <section aria-labelledby="hr-settings-heading" className="grid gap-6">
      <div>
        <h2 id="hr-settings-heading" className="font-serif text-2xl text-primary">
          Holidays &amp; rules
        </h2>
        <p className="mt-1 max-w-xl text-sm leading-relaxed text-muted-foreground">
          The working week, when someone counts as late, the year&apos;s holidays and the kinds of
          leave. Attendance, leave and payroll all follow these.
          {!can.manage && " Only HR can change them."}
        </p>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Panel title="Working week" id="rules-heading" className="lg:col-span-2">
          <dl className="mt-4 mb-5 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Fact label="Weekly days off">{offDaysText(rules.weeklyOffDays)}</Fact>
            <Fact label="Office starts">
              {rules.officeStartTime}
              <span className="block text-[0.8125rem] text-muted-foreground">
                Late after {lateAfter(rules.officeStartTime, rules.lateGraceMinutes)}
              </span>
            </Fact>
            <Fact label="Lates">
              {rules.latesPerDeductionDay === 0
                ? "Cost nothing"
                : `Every ${rules.latesPerDeductionDay} in a month cost a day's salary`}
            </Fact>
            <Fact label="Check-in">
              {rules.selfCheckIn ? "Staff check in themselves in My HR" : "HR marks attendance"}
            </Fact>
          </dl>
          <HrRules rules={rules} canManage={can.manage} />
        </Panel>

        <Panel
          title={`Holidays in ${year}`}
          id="holidays-heading"
          action={
            <nav aria-label="Year" className="flex gap-3 text-sm">
              {shownYears.map((y) =>
                y === year ? (
                  <span key={y} aria-current="page" className="font-medium">
                    {y}
                  </span>
                ) : (
                  <Link key={y} href={hrHref.settings(y)} className={linkClass}>
                    {y}
                  </Link>
                ),
              )}
            </nav>
          }
        >
          <div className="mt-4">
            <Holidays key={year} year={year} holidays={holidays} canManage={can.manage} />
          </div>
        </Panel>

        <Panel title="Leave types" id="leave-types-heading">
          <div className="mt-4">
            <LeaveTypes types={leaveTypes} canManage={can.manage} />
          </div>
        </Panel>
      </div>
    </section>
  );
}
