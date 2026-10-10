import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { SectionError } from "@/components/dashboard/section-error";
import { EmployeeBadge, FlagBadge, PayrollBadge } from "@/components/hr/badges";
import { EmployeeActions, LeaveAllowances, SalaryHistory } from "@/components/hr/employee-actions";
import { hrHref, payDetails } from "@/components/hr/labels";
import { HrNoAccess } from "@/components/hr/no-access";
import { Fact, Panel, RecordHeader } from "@/components/sales/detail-bits";
import { isZero, METHOD_LABELS, money } from "@/components/sales/labels";
import { BackLink } from "@/components/settings/back-link";
import { formatDay, formatMonth } from "@/lib/display";
import { getEmployeeScreenAction } from "@/server/actions/hr.actions";
import { requireCompanyPage } from "@/server/pages/guards";

export const metadata: Metadata = { title: "Employee" };

const linkClass = "text-primary underline-offset-4 hover:underline";
const one = (value: string | string[] | undefined) =>
  typeof value === "string" ? value : undefined;

/**
 * One employee (hr.view, hr.manage or hr.payroll, like GET /api/hr/employees/:id):
 * their details, this month's attendance and their leave for a year; for
 * people who see salaries, their pay, salary history, advances and payslips.
 * HR changes them as hr/rules.ts allows.
 */
export default async function EmployeePage({
  params,
  searchParams,
}: {
  params: Promise<{ employeeId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const ctx = await requireCompanyPage();
  const [{ employeeId }, query] = await Promise.all([params, searchParams]);
  const year = Number(one(query.year));
  const result = await getEmployeeScreenAction(employeeId, {
    year: Number.isInteger(year) && year >= 2000 && year <= 2100 ? year : undefined,
  });
  if (!result.ok) {
    if (result.error.code === "NOT_FOUND") notFound();
    if (result.error.code === "FORBIDDEN") return <HrNoAccess />;
    return (
      <SectionError title="Employee" heading="The employee could not load" error={result.error} />
    );
  }
  const screen = result.data;
  const { employee: e, pay, leave, thisMonth, can, notes } = screen;
  const currency = ctx.company.currency;
  const notice =
    one(query.created) === "1"
      ? `${e.name} was added as ${e.code}.`
      : one(query.saved) === "1"
        ? `${e.name}'s details were saved.`
        : undefined;
  const t = thisMonth.totals;
  const thisYear = Number(screen.today.slice(0, 4));

  return (
    <div className="grid grid-cols-1 gap-8 md:gap-10">
      <div className="grid gap-6">
        <BackLink href={hrHref.employees}>All employees</BackLink>
        <RecordHeader
          eyebrow={[e.code, e.designation, e.department].filter(Boolean).join(" · ")}
          title={e.name}
          badges={
            <>
              <EmployeeBadge status={e.status} />
              {e.exitDate && e.isCurrent && (
                <FlagBadge tone="warn">Leaving {formatDay(e.exitDate)}</FlagBadge>
              )}
              {e.exitDate && !e.isCurrent && <FlagBadge>Left {formatDay(e.exitDate)}</FlagBadge>}
              {e.login && (
                <FlagBadge>{e.login.active ? "Has a login" : "Login switched off"}</FlagBadge>
              )}
            </>
          }
        />
        <EmployeeActions key={e.id} screen={screen} currency={currency} notice={notice} />
        {notes.salary && <p className="text-[0.8125rem] text-muted-foreground">{notes.salary}</p>}
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)]">
        <div className="grid min-w-0 grid-cols-1 content-start gap-6">
          <Panel
            title={`${formatMonth(thisMonth.month)} so far`}
            id="month-heading"
            action={
              <Link href={hrHref.employeeMonth(e.id)} className={`text-sm ${linkClass}`}>
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
              <p className="mt-4 text-sm text-muted-foreground">Not employed this month.</p>
            )}
          </Panel>

          <Panel
            title={`Leave in ${leave.year}`}
            id="leave-heading"
            action={
              <Link href={hrHref.employeeLeave(e.id)} className={`text-sm ${linkClass}`}>
                Requests
              </Link>
            }
          >
            <nav aria-label="Year" className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-sm">
              {leave.years.map((y) =>
                y === leave.year ? (
                  <span key={y} aria-current="page" className="font-medium">
                    {y}
                  </span>
                ) : (
                  <Link
                    key={y}
                    href={hrHref.employee(e.id, y === thisYear ? undefined : y)}
                    className={linkClass}
                  >
                    {y}
                  </Link>
                ),
              )}
            </nav>
            <div className="mt-4">
              {leave.balances.length === 0 ? (
                <p className="text-sm text-muted-foreground">No leave types are set up.</p>
              ) : (
                <LeaveAllowances employeeId={e.id} balances={leave.balances} />
              )}
            </div>
          </Panel>

          {pay && (
            <Panel
              title="Payslips"
              id="payslips-heading"
              action={
                can.statement ? (
                  <Link href={hrHref.statement(e.id)} className={`text-sm ${linkClass}`}>
                    Statement
                  </Link>
                ) : undefined
              }
            >
              {pay.payslips.length === 0 ? (
                <p className="mt-4 text-sm text-muted-foreground">
                  No payroll has included them yet.
                </p>
              ) : (
                <ul className="mt-4 grid divide-y" aria-label="Payslips">
                  {pay.payslips.map((p) => (
                    <li key={p.itemId} className="py-3 first:pt-0 last:pb-0">
                      <Link
                        href={hrHref.payslip(p.runId, p.itemId)}
                        className="flex items-start justify-between gap-3 rounded-sm outline-none focus-visible:ring-[3px] focus-visible:ring-ring/25"
                      >
                        <span className="min-w-0">
                          <span className="block text-sm font-medium text-primary">{p.label}</span>
                          <span className="mt-1 block">
                            {p.paid ? (
                              <FlagBadge tone="done">Paid</FlagBadge>
                            ) : (
                              <PayrollBadge status={p.runStatus} />
                            )}
                          </span>
                        </span>
                        <span className="text-sm whitespace-nowrap tabular-nums">
                          {money(p.netPay, currency)}
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </Panel>
          )}
        </div>

        <div className="grid min-w-0 grid-cols-1 content-start gap-6">
          {pay && (
            <Panel title="Pay" id="pay-heading">
              <dl className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">
                <Fact label="Monthly salary">
                  <span className="font-serif text-lg text-primary">
                    {money(pay.salary, currency)}
                  </span>
                  {pay.upcomingSalary && (
                    <span className="block text-[0.8125rem] text-muted-foreground">
                      {money(pay.upcomingSalary.amount, currency)} from{" "}
                      {formatDay(pay.upcomingSalary.from)}
                    </span>
                  )}
                </Fact>
                <Fact label="Overtime per hour">
                  {pay.overtimeRate ? money(pay.overtimeRate, currency) : "Not paid"}
                </Fact>
                <Fact label="Paid by">
                  {METHOD_LABELS[pay.salaryMethod]}
                  {payDetails(pay) && (
                    <span className="block text-muted-foreground">{payDetails(pay)}</span>
                  )}
                </Fact>
                {pay.notes && (
                  <Fact label="Notes for HR">
                    <span className="whitespace-pre-line">{pay.notes}</span>
                  </Fact>
                )}
              </dl>
              <h4 className="eyebrow mt-6 mb-3">Salary over time</h4>
              <SalaryHistory employeeId={e.id} revisions={pay.salaryHistory} currency={currency} />
            </Panel>
          )}

          {pay && (
            <Panel
              title="Advances"
              id="advances-heading"
              action={
                can.openAdvances ? (
                  <Link href={hrHref.employeeAdvances(e.id)} className={`text-sm ${linkClass}`}>
                    All advances
                  </Link>
                ) : undefined
              }
            >
              {pay.advances.open.length === 0 ? (
                <p className="mt-4 text-sm text-muted-foreground">Nothing owed on advances.</p>
              ) : (
                <>
                  <p className="mt-4 text-sm">
                    <span className="font-medium text-destructive">
                      {money(pay.advances.outstanding, currency)}
                    </span>{" "}
                    still owed, taken back from their salary.
                  </p>
                  <ul className="mt-3 grid divide-y" aria-label="Open advances">
                    {pay.advances.open.map((a) => (
                      <li
                        key={a.id}
                        className="flex items-start justify-between gap-3 py-2.5 first:pt-0 last:pb-0"
                      >
                        <span className="min-w-0 text-sm">
                          {can.openAdvances ? (
                            <Link href={hrHref.advance(a.id)} className={linkClass}>
                              {a.number}
                            </Link>
                          ) : (
                            a.number
                          )}
                          <span className="block text-[0.8125rem] text-muted-foreground">
                            {money(a.amount, currency)} given
                          </span>
                        </span>
                        <span className="text-sm whitespace-nowrap tabular-nums">
                          {isZero(a.outstanding)
                            ? "Settled"
                            : `${money(a.outstanding, currency)} owed`}
                        </span>
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </Panel>
          )}

          <Panel title="Details" id="details-heading">
            <dl className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">
              <Fact label="Joined">{formatDay(e.joinDate)}</Fact>
              {e.exitDate && (
                <Fact label={e.isCurrent ? "Last working day" : "Left"}>
                  {formatDay(e.exitDate)}
                  {e.exitReason && (
                    <span className="block text-muted-foreground">{e.exitReason}</span>
                  )}
                </Fact>
              )}
              <Fact label="Phone">{e.phone ?? "–"}</Fact>
              {e.whatsapp && <Fact label="WhatsApp">{e.whatsapp}</Fact>}
              {e.email && <Fact label="Email">{e.email}</Fact>}
              {e.nid && <Fact label="National ID">{e.nid}</Fact>}
              {e.dateOfBirth && <Fact label="Date of birth">{formatDay(e.dateOfBirth)}</Fact>}
              {e.bloodGroup && <Fact label="Blood group">{e.bloodGroup}</Fact>}
              {e.address && (
                <Fact label="Address">
                  <span className="whitespace-pre-line">{e.address}</span>
                </Fact>
              )}
              {e.emergencyContact && <Fact label="Emergency contact">{e.emergencyContact}</Fact>}
              <Fact label="Login">
                {e.login ? `${e.login.email}${e.login.active ? "" : " (switched off)"}` : "None"}
              </Fact>
            </dl>
          </Panel>
        </div>
      </div>
    </div>
  );
}
