import type { Metadata } from "next";
import Link from "next/link";

import { FlagBadge, MarkBadge } from "@/components/hr/badges";
import { dayCount, hrHref, payDetails } from "@/components/hr/labels";
import { CheckInButtons } from "@/components/hr/my-hr-actions";
import { MyHrProblem } from "@/components/hr/no-access";
import { Fact, Panel } from "@/components/sales/detail-bits";
import { isZero, METHOD_LABELS, money } from "@/components/sales/labels";
import { formatDay, formatLongDay, formatMonth } from "@/lib/display";
import { getMyHrScreenAction } from "@/server/actions/portal.actions";
import { requireCompanyPage } from "@/server/pages/guards";

export const metadata: Metadata = { title: "My HR" };

const linkClass = "text-primary underline-offset-4 hover:underline";
const smallText = "block text-[0.8125rem] text-muted-foreground";

/**
 * The signed-in employee's own HR page (portal.self): checking in and out for
 * today when HR allows it, this month so far, leave left, their pay, advances
 * still owed, the latest payslips and their details. Only their own records.
 */
export default async function MyHrPage() {
  const ctx = await requireCompanyPage();
  const result = await getMyHrScreenAction();
  if (!result.ok) {
    return <MyHrProblem error={result.error} title="My HR" heading="Your HR page could not load" />;
  }
  const {
    profile: p,
    today,
    thisMonth,
    leaveBalances,
    advances,
    latestPayslips,
    can,
  } = result.data;
  const currency = ctx.company.currency;
  const mark = today.mark;
  const t = thisMonth.totals;
  const year = today.date.slice(0, 4);
  const pay = payDetails(p);

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)]">
      <div className="grid min-w-0 grid-cols-1 content-start gap-6">
        <Panel title="Today" id="today-heading">
          <p className="mt-1 text-sm text-muted-foreground">{formatLongDay(today.date)}</p>
          <div className="mt-4 grid gap-4">
            {mark ? (
              <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
                <MarkBadge status={mark.status} />
                {mark.checkIn && <span>In at {mark.checkIn}</span>}
                {mark.checkOut && <span>Out at {mark.checkOut}</span>}
              </div>
            ) : result.data.onLeaveToday ? (
              <p className="text-sm">You are on {result.data.onLeaveToday} today.</p>
            ) : !today.selfCheckIn ? (
              <p className="text-sm text-muted-foreground">
                HR marks your attendance. Nothing is marked for today yet.
              </p>
            ) : can.checkIn ? (
              <p className="text-sm text-muted-foreground">
                The office starts at {today.officeStartTime}.
              </p>
            ) : (
              <p className="text-sm text-muted-foreground">Nothing to check in for today.</p>
            )}
            <CheckInButtons canCheckIn={can.checkIn} canCheckOut={can.checkOut} />
          </div>
        </Panel>

        <Panel
          title={`${formatMonth(thisMonth.month)} so far`}
          id="month-heading"
          action={
            <Link href={hrHref.myMonth()} className={`text-sm ${linkClass}`}>
              Day by day
            </Link>
          }
        >
          {t ? (
            <dl className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-4">
              <Fact label="Working days">{t.workingDays}</Fact>
              <Fact label="Present">{t.presentDays}</Fact>
              <Fact label="Late">{t.lateDays}</Fact>
              <Fact label="Absent">{t.absentDays}</Fact>
              <Fact label="Paid leave">{t.paidLeaveDays}</Fact>
              <Fact label="Unpaid leave">{t.unpaidLeaveDays}</Fact>
              <Fact label="Unpaid days">{t.unpaidDays}</Fact>
              <Fact label="Overtime">{t.overtimeHours} h</Fact>
            </dl>
          ) : (
            <p className="mt-4 text-sm text-muted-foreground">Not on the staff list this month.</p>
          )}
        </Panel>

        <Panel
          title={`Leave in ${year}`}
          id="leave-heading"
          action={
            <Link href={hrHref.myLeave()} className={`text-sm ${linkClass}`}>
              Ask for leave
            </Link>
          }
        >
          {leaveBalances.length === 0 ? (
            <p className="mt-4 text-sm text-muted-foreground">No leave types are set up yet.</p>
          ) : (
            <ul className="mt-4 grid divide-y" aria-label="Leave left">
              {leaveBalances.map((b) => (
                <li
                  key={b.leaveType.id}
                  className="flex items-start justify-between gap-3 py-2.5 first:pt-0 last:pb-0"
                >
                  <span className="min-w-0">
                    <span className="block text-sm font-medium">{b.leaveType.name}</span>
                    <span className={smallText}>
                      {b.entitled === null
                        ? `Unpaid · ${dayCount(b.used)} taken`
                        : `${dayCount(b.used)} taken of ${dayCount(b.entitled)}`}
                      {b.pending > 0 ? ` · ${dayCount(b.pending)} waiting` : ""}
                    </span>
                  </span>
                  {b.remaining !== null && (
                    <span
                      className={`text-sm whitespace-nowrap tabular-nums ${b.remaining < 0 ? "text-destructive" : ""}`}
                    >
                      {dayCount(b.remaining)} left
                    </span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>

      <div className="grid min-w-0 grid-cols-1 content-start gap-6">
        <Panel
          title="Pay"
          id="pay-heading"
          action={
            <Link href={hrHref.myPayslips} className={`text-sm ${linkClass}`}>
              All payslips
            </Link>
          }
        >
          <dl className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">
            <Fact label="Monthly salary">
              <span className="font-serif text-lg text-primary">{money(p.salary, currency)}</span>
              {p.upcomingSalary && (
                <span className={smallText}>
                  {money(p.upcomingSalary.amount, currency)} from {formatDay(p.upcomingSalary.from)}
                </span>
              )}
            </Fact>
            <Fact label="Paid by">
              {METHOD_LABELS[p.salaryMethod]}
              {pay && <span className="block text-muted-foreground">{pay}</span>}
            </Fact>
          </dl>
          {latestPayslips.length > 0 && (
            <ul className="mt-5 grid divide-y border-t pt-3" aria-label="Latest payslips">
              {latestPayslips.map((s) => (
                <li key={s.itemId} className="py-2.5 first:pt-0 last:pb-0">
                  <Link
                    href={hrHref.myPayslip(s.itemId)}
                    className="flex items-start justify-between gap-3 rounded-sm outline-none focus-visible:ring-[3px] focus-visible:ring-ring/25"
                  >
                    <span className="min-w-0">
                      <span className="block text-sm font-medium text-primary">{s.label}</span>
                      <span className="mt-1 block">
                        {s.paid ? (
                          <FlagBadge tone="done">Paid</FlagBadge>
                        ) : (
                          <FlagBadge tone="warn">To be paid</FlagBadge>
                        )}
                      </span>
                    </span>
                    <span className="text-sm whitespace-nowrap tabular-nums">
                      {money(s.netPay, currency)}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel
          title="Advances"
          id="advances-heading"
          action={
            <Link href={hrHref.myAdvances} className={`text-sm ${linkClass}`}>
              Details
            </Link>
          }
        >
          <p className="mt-4 text-sm">
            {advances.open === 0 || isZero(advances.outstanding) ? (
              <span className="text-muted-foreground">You owe nothing on salary advances.</span>
            ) : (
              <>
                <span className="font-medium">{money(advances.outstanding, currency)}</span> still
                owed, taken back from your salary.
              </>
            )}
          </p>
        </Panel>

        <Panel title="My details" id="details-heading">
          <dl className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">
            <Fact label="Name">{p.name}</Fact>
            <Fact label="Employee code">{p.code}</Fact>
            <Fact label="Job">
              {[p.designation, p.department].filter(Boolean).join(", ") || "–"}
            </Fact>
            <Fact label="Joined">{formatDay(p.joinDate)}</Fact>
            {p.exitDate && <Fact label="Leaving">{formatDay(p.exitDate)}</Fact>}
            <Fact label="Phone">{p.phone ?? "–"}</Fact>
            {p.email && <Fact label="Email">{p.email}</Fact>}
            {p.bloodGroup && <Fact label="Blood group">{p.bloodGroup}</Fact>}
            {p.emergencyContact && <Fact label="Emergency contact">{p.emergencyContact}</Fact>}
            {p.address && (
              <Fact label="Address" className="sm:col-span-2 lg:col-span-1 xl:col-span-2">
                <span className="whitespace-pre-line">{p.address}</span>
              </Fact>
            )}
          </dl>
          <p className="mt-5 text-[0.8125rem] text-muted-foreground">
            Something wrong? Ask HR to change it.
          </p>
        </Panel>
      </div>
    </div>
  );
}
