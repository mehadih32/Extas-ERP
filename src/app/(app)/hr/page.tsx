import { CalendarCheckIcon, CalendarPlusIcon, HandCoinsIcon, UserPlusIcon } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { Stat } from "@/components/accounts/stat";
import { SectionError } from "@/components/dashboard/section-error";
import { PayrollBadge } from "@/components/hr/badges";
import { DAY_TYPE_LABELS, dayCount, hrHref, leaveDates } from "@/components/hr/labels";
import { HrNoAccess } from "@/components/hr/no-access";
import { visibleHrTabs } from "@/components/hr/tabs";
import { Panel } from "@/components/sales/detail-bits";
import { isZero, money } from "@/components/sales/labels";
import { Button } from "@/components/ui/button";
import { formatCount, formatDay } from "@/lib/display";
import { getHrOverviewScreenAction } from "@/server/actions/hr.actions";
import { requireCompanyPage } from "@/server/pages/guards";

export const metadata: Metadata = { title: "HR & payroll" };

const rowLink =
  "flex items-start justify-between gap-3 rounded-sm outline-none focus-visible:ring-[3px] focus-visible:ring-ring/25";
const linkClass = "text-sm text-primary underline-offset-4 hover:underline";

/**
 * The HR Overview (hr.view, hr.manage or hr.payroll): who works here, who is
 * in today, leave waiting for a decision and coming holidays; for people who
 * see salaries, where this month's and last month's payroll stand and what is
 * owed on advances. Accounts people without HR keys start on Payroll instead.
 */
export default async function HrOverviewPage() {
  const ctx = await requireCompanyPage();
  if (!ctx.can("hr.view") && !ctx.can("hr.manage") && !ctx.can("hr.payroll")) {
    const first = visibleHrTabs(ctx.permissions)[0];
    if (first && first.href !== hrHref.overview) redirect(first.href);
    return <HrNoAccess />;
  }
  const result = await getHrOverviewScreenAction();
  if (!result.ok) {
    if (result.error.code === "FORBIDDEN") return <HrNoAccess />;
    return (
      <SectionError
        title="HR & payroll"
        heading="The overview could not load"
        error={result.error}
      />
    );
  }
  const o = result.data;
  const currency = ctx.company.currency;
  const count = (n: number) => formatCount(n, currency);
  const { totals } = o.register;
  const working = o.register.dayType === "WORKING";
  const awayAllDay = o.onLeaveToday.filter((r) => !r.halfDay).length;
  const anyAction =
    o.can.addEmployee ||
    o.can.markAttendance ||
    o.can.recordLeave ||
    o.can.startPayroll ||
    o.can.giveAdvance;

  return (
    <div className="grid grid-cols-1 gap-8">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h2 className="font-serif text-2xl text-primary">Overview</h2>
          <p className="mt-1 max-w-xl text-sm leading-relaxed text-muted-foreground">
            Who works here, who is in today and what is waiting: leave to decide, payroll to approve
            and salaries to pay.
          </p>
        </div>
        {anyAction && (
          <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
            {o.can.markAttendance && (
              <Button asChild className="w-full sm:w-auto">
                <Link href={hrHref.attendance()}>
                  <CalendarCheckIcon aria-hidden />
                  Mark today
                </Link>
              </Button>
            )}
            {o.can.recordLeave && (
              <Button asChild variant="outline" className="w-full sm:w-auto">
                <Link href={hrHref.newLeave()}>
                  <CalendarPlusIcon aria-hidden />
                  Record leave
                </Link>
              </Button>
            )}
            {o.can.addEmployee && (
              <Button asChild variant="outline" className="w-full sm:w-auto">
                <Link href={hrHref.newEmployee}>
                  <UserPlusIcon aria-hidden />
                  Add an employee
                </Link>
              </Button>
            )}
            {o.can.giveAdvance && (
              <Button
                asChild
                variant={o.can.markAttendance ? "outline" : "default"}
                className="w-full sm:w-auto"
              >
                <Link href={hrHref.newAdvance()}>
                  <HandCoinsIcon aria-hidden />
                  Give an advance
                </Link>
              </Button>
            )}
          </div>
        )}
      </div>

      <section aria-label="HR at a glance">
        <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-5">
          <Stat
            label="Employees"
            value={count(o.headcount.current)}
            hint={
              o.headcount.joinedThisMonth > 0
                ? `${count(o.headcount.joinedThisMonth)} joined this month`
                : o.headcount.onLongLeave > 0
                  ? `${count(o.headcount.onLongLeave)} on long leave`
                  : "Working here now"
            }
            href={hrHref.employees}
          />
          <Stat
            label="In today"
            value={
              working
                ? count(Math.max(0, totals.employees - totals.absent - awayAllDay))
                : DAY_TYPE_LABELS[o.register.dayType]
            }
            hint={
              working
                ? `${count(totals.late)} late · ${count(totals.absent)} absent`
                : (o.register.holiday ?? o.register.weekday)
            }
            href={hrHref.attendance()}
          />
          <Stat
            label="On leave today"
            value={count(o.onLeaveToday.length)}
            hint={o.onLeaveToday.length === 1 ? o.onLeaveToday[0]!.employee.name : "Approved leave"}
            href={hrHref.attendance()}
          />
          <Stat
            label="Leave to decide"
            value={count(o.pendingLeave.count)}
            hint="Waiting for HR"
            href={`${hrHref.leave}?status=PENDING`}
            alert={o.pendingLeave.count > 0}
          />
          {o.advances && (
            <Stat
              label="Advances owed"
              value={money(o.advances.outstanding, currency)}
              hint={`${count(o.advances.open)} open ${o.advances.open === 1 ? "advance" : "advances"}`}
              href={`${hrHref.advances}?status=OPEN`}
              className="col-span-2 sm:col-span-1"
            />
          )}
        </dl>
      </section>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)]">
        <div className="grid min-w-0 grid-cols-1 content-start gap-6">
          <Panel
            title="Leave to decide"
            id="pending-heading"
            action={
              o.pendingLeave.count > 0 ? (
                <Link href={`${hrHref.leave}?status=PENDING`} className={linkClass}>
                  See all
                </Link>
              ) : undefined
            }
          >
            {o.pendingLeave.items.length === 0 ? (
              <p className="mt-4 text-sm text-muted-foreground">
                No leave is waiting for a decision.
              </p>
            ) : (
              <ul className="mt-4 grid divide-y" aria-label="Leave waiting for a decision">
                {o.pendingLeave.items.map((l) => (
                  <li key={l.id} className="py-3 first:pt-0 last:pb-0">
                    <Link href={hrHref.leaveRequest(l.id)} className={rowLink}>
                      <span className="min-w-0">
                        <span className="block text-sm font-medium text-primary">
                          {l.employee.name}
                        </span>
                        <span className="block truncate text-[0.8125rem] text-muted-foreground">
                          {l.leaveType.name} · {leaveDates(l)}
                        </span>
                      </span>
                      <span className="text-sm whitespace-nowrap">{dayCount(l.days)}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Panel>

          {o.payroll && (
            <Panel
              title="Payroll"
              id="payroll-heading"
              action={
                <Link href={hrHref.payroll} className={linkClass}>
                  All months
                </Link>
              }
            >
              <ul className="mt-4 grid divide-y" aria-label="This month and last month">
                {[o.payroll.lastMonth, o.payroll.thisMonth].map((m) => (
                  <li key={m.month} className="py-3 first:pt-0 last:pb-0">
                    {m.run ? (
                      <Link href={hrHref.payrollRun(m.run.id)} className={rowLink}>
                        <span className="min-w-0">
                          <span className="block text-sm font-medium text-primary">{m.label}</span>
                          <span className="block text-[0.8125rem] text-muted-foreground">
                            {count(m.run.employees)}{" "}
                            {m.run.employees === 1 ? "employee" : "employees"} ·{" "}
                            {money(m.run.totalNet, currency)} to take home
                          </span>
                        </span>
                        <span className="flex flex-col items-end gap-1">
                          <PayrollBadge status={m.run.status} />
                          {m.run.unpaid && !isZero(m.run.unpaid) && (
                            <span className="text-[0.8125rem] whitespace-nowrap text-destructive">
                              {money(m.run.unpaid, currency)} unpaid
                            </span>
                          )}
                        </span>
                      </Link>
                    ) : (
                      <div className="flex items-start justify-between gap-3">
                        <span className="min-w-0">
                          <span className="block text-sm font-medium">{m.label}</span>
                          <span className="block text-[0.8125rem] text-muted-foreground">
                            Not prepared yet
                          </span>
                        </span>
                        {o.can.startPayroll && (
                          <Link href={hrHref.payroll} className={linkClass}>
                            Prepare
                          </Link>
                        )}
                      </div>
                    )}
                  </li>
                ))}
              </ul>
              {(o.payroll.waitingApproval > 0 || o.payroll.unpaid.length > 0) && (
                <p className="mt-4 border-t pt-4 text-[0.8125rem] text-muted-foreground">
                  {o.payroll.waitingApproval > 0 &&
                    `${count(o.payroll.waitingApproval)} ${
                      o.payroll.waitingApproval === 1 ? "payroll is" : "payrolls are"
                    } waiting for approval. `}
                  {o.payroll.unpaid.length > 0 &&
                    `Salaries still to pay: ${o.payroll.unpaid
                      .map((r) => `${r.label} ${money(r.unpaid, currency)}`)
                      .join(", ")}.`}
                </p>
              )}
            </Panel>
          )}

          <Panel
            title="Today"
            id="today-heading"
            action={
              <Link href={hrHref.attendance()} className={linkClass}>
                Attendance
              </Link>
            }
          >
            {!working ? (
              <p className="mt-4 text-sm text-muted-foreground">
                {formatDay(o.today)} is a {DAY_TYPE_LABELS[o.register.dayType].toLowerCase()}
                {o.register.holiday ? ` (${o.register.holiday})` : ""}.
              </p>
            ) : o.onLeaveToday.length === 0 && o.absentToday.length === 0 ? (
              <p className="mt-4 text-sm text-muted-foreground">
                Nobody is on leave or marked absent today.
              </p>
            ) : (
              <ul className="mt-4 grid divide-y" aria-label="Away today">
                {o.onLeaveToday.map((r) => (
                  <li
                    key={r.employee.id}
                    className="flex items-start justify-between gap-3 py-3 first:pt-0 last:pb-0"
                  >
                    <span className="min-w-0 truncate text-sm">{r.employee.name}</span>
                    <span className="text-[0.8125rem] whitespace-nowrap text-muted-foreground">
                      {r.leaveType}
                      {r.halfDay ? ", half day" : ""}
                    </span>
                  </li>
                ))}
                {o.absentToday.map((e) => (
                  <li
                    key={e.id}
                    className="flex items-start justify-between gap-3 py-3 first:pt-0 last:pb-0"
                  >
                    <span className="min-w-0 truncate text-sm">{e.name}</span>
                    <span className="text-[0.8125rem] whitespace-nowrap text-destructive">
                      Absent
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        </div>

        <div className="grid min-w-0 grid-cols-1 content-start gap-6">
          <Panel title="By department" id="departments-heading">
            {o.byDepartment.length === 0 ? (
              <p className="mt-4 text-sm text-muted-foreground">
                No employees yet.{" "}
                {o.can.addEmployee && (
                  <Link href={hrHref.newEmployee} className={linkClass}>
                    Add the first one
                  </Link>
                )}
              </p>
            ) : (
              <ul className="mt-4 grid divide-y" aria-label="Employees by department">
                {o.byDepartment.map((d) => (
                  <li key={d.name} className="py-3 first:pt-0 last:pb-0">
                    <Link
                      href={
                        d.name === "No department"
                          ? hrHref.employees
                          : `${hrHref.employees}?department=${encodeURIComponent(d.name)}`
                      }
                      className={rowLink}
                    >
                      <span className="min-w-0 truncate text-sm font-medium">{d.name}</span>
                      <span className="text-sm whitespace-nowrap text-muted-foreground">
                        {count(d.count)}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Panel>

          <Panel
            title="Coming holidays"
            id="holidays-heading"
            action={
              <Link href={hrHref.settings()} className={linkClass}>
                All holidays
              </Link>
            }
          >
            {o.holidays.length === 0 ? (
              <p className="mt-4 text-sm text-muted-foreground">No holidays are set yet.</p>
            ) : (
              <ul className="mt-4 grid divide-y" aria-label="Coming holidays">
                {o.holidays.map((h) => (
                  <li
                    key={h.id}
                    className="flex items-start justify-between gap-3 py-3 first:pt-0 last:pb-0"
                  >
                    <span className="min-w-0 text-sm break-words">{h.name}</span>
                    <span className="text-[0.8125rem] whitespace-nowrap text-muted-foreground">
                      {formatDay(h.date)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        </div>
      </div>
    </div>
  );
}
