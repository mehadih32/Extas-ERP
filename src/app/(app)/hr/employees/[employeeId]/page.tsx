import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { SectionError } from "@/components/dashboard/section-error";
import { GiveItemButton, ItemList } from "@/components/hr/asset-bits";
import { FlagBadge, PayrollBadge } from "@/components/hr/badges";
import { EmployeeActions, LeaveAllowances, SalaryHistory } from "@/components/hr/employee-actions";
import { hrHref, payDetails } from "@/components/hr/labels";
import { HrNoAccess } from "@/components/hr/no-access";
import { EmployeeProfileCard } from "@/components/hr/profile-card";
import { ProfileTab, ProfileTabs, type ProfileTab as Tab } from "@/components/hr/profile-tabs";
import { ScoreCard } from "@/components/hr/score-card";
import { SystemAccessCard } from "@/components/hr/system-access";
import { VaultPanel } from "@/components/hr/vault-panel";
import { Fact, Panel } from "@/components/sales/detail-bits";
import { isZero, METHOD_LABELS, money } from "@/components/sales/labels";
import { BackLink } from "@/components/settings/back-link";
import { formatDay, formatMonth } from "@/lib/display";
import { vaultScore } from "@/modules/hr/vault";
import { getEmployeeScreenAction } from "@/server/actions/hr.actions";
import { requireCompanyPage } from "@/server/pages/guards";

export const metadata: Metadata = { title: "Employee" };

const linkClass = "text-primary underline-offset-4 hover:underline";
const one = (value: string | string[] | undefined) =>
  typeof value === "string" ? value : undefined;

/**
 * One employee's 360° profile (hr.view, hr.manage or hr.payroll, like
 * GET /api/hr/employees/:id). A card at the side stays in view whatever tab
 * is open: their photo, name, Employee ID, post, contact buttons, the day
 * they joined and their time here, and for HR and people who manage users the
 * System access card (their login, its role and switch). The tabs: Overview
 * (this month's attendance and, for HR, the performance score), Leave, Pay
 * (people who see salaries: pay, salary history, payslips, advances), Papers
 * (HR: the data vault), Items (company items they hold) and Details. HR
 * changes them as hr/rules.ts allows.
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
  const { employee: e, pay, leave, thisMonth, can, notes, vault, systemAccess } = screen;
  const currency = ctx.company.currency;
  const notice =
    one(query.created) === "1"
      ? `${e.name} was added as ${e.code}.`
      : one(query.saved) === "1"
        ? `${e.name}'s details were saved.`
        : undefined;
  const t = thisMonth.totals;
  const thisYear = Number(screen.today.slice(0, 4));
  const tabs: Tab[] = [
    { value: "overview", label: "Overview" },
    { value: "leave", label: "Leave" },
    ...(pay ? [{ value: "pay", label: "Pay" }] : []),
    ...(vault ? [{ value: "papers", label: "Papers" }] : []),
    ...(screen.assets ? [{ value: "items", label: "Items" }] : []),
    { value: "details", label: "Details" },
  ];
  const tab = one(query.tab) ?? "overview";

  return (
    <div className="grid grid-cols-1 gap-6">
      <BackLink href={hrHref.employees}>All employees</BackLink>
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[17rem_minmax(0,1fr)] lg:gap-8 xl:grid-cols-[19rem_minmax(0,1fr)]">
        <aside
          aria-label={`${e.name}'s profile`}
          className="grid min-w-0 content-start gap-6 lg:sticky lg:top-[calc(var(--app-top,0px)+1.5rem)] lg:max-h-[calc(100dvh-var(--app-top,0px)-3rem)] lg:overflow-y-auto lg:pb-2"
        >
          <section className="rounded-lg border bg-card p-5">
            <EmployeeProfileCard employee={e} pendingPayChange={Boolean(vault?.pendingRequest)} />
          </section>
          {systemAccess && (
            <Panel title="System access" id="access-heading">
              <div className="mt-4">
                <SystemAccessCard
                  employee={{ id: e.id, name: e.name, email: e.email, phone: e.phone }}
                  access={systemAccess}
                />
              </div>
            </Panel>
          )}
        </aside>

        <div className="grid min-w-0 grid-cols-1 content-start gap-6">
          <EmployeeActions
            key={e.id}
            screen={screen}
            currency={currency}
            notice={notice}
            openDeactivate={one(query.deactivate) === "1"}
          />
          {notes.salary && <p className="text-[0.8125rem] text-muted-foreground">{notes.salary}</p>}
          {vault?.pendingRequest && (
            <p className="text-sm">
              {e.name} asked to be paid by {vault.pendingRequest.changesText}.{" "}
              <Link href={hrHref.employeeTab(e.id, "papers")} className={linkClass}>
                See the change
              </Link>
            </p>
          )}

          <ProfileTabs key={tab} tabs={tabs} initial={tab}>
            <ProfileTab value="overview">
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
              {screen.score && (
                <Panel title="Performance score" id="score-heading">
                  <div className="mt-4">
                    <ScoreCard score={screen.score} mine={false} />
                  </div>
                </Panel>
              )}
            </ProfileTab>

            <ProfileTab value="leave">
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
                        href={hrHref.employeeTab(e.id, "leave", y === thisYear ? undefined : y)}
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
            </ProfileTab>

            {pay && (
              <ProfileTab value="pay">
                <Panel title="Pay" id="pay-heading">
                  <dl className="mt-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
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
                  <SalaryHistory
                    employeeId={e.id}
                    revisions={pay.salaryHistory}
                    currency={currency}
                  />
                </Panel>

                <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
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
                                <span className="block text-sm font-medium text-primary">
                                  {p.label}
                                </span>
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

                  <Panel
                    title="Advances"
                    id="advances-heading"
                    action={
                      can.openAdvances ? (
                        <Link
                          href={hrHref.employeeAdvances(e.id)}
                          className={`text-sm ${linkClass}`}
                        >
                          All advances
                        </Link>
                      ) : undefined
                    }
                  >
                    {pay.advances.open.length === 0 ? (
                      <p className="mt-4 text-sm text-muted-foreground">
                        Nothing owed on advances.
                      </p>
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
                </div>
              </ProfileTab>
            )}

            {vault && (
              <ProfileTab value="papers">
                <Panel
                  title="Data vault"
                  id="vault-heading"
                  action={
                    <span
                      className={`text-sm ${vault.gaps.length > 0 ? "text-destructive" : "text-muted-foreground"}`}
                    >
                      {vaultScore(vault.gaps)}
                    </span>
                  }
                >
                  <VaultPanel employeeId={e.id} name={e.name} vault={vault} />
                </Panel>
              </ProfileTab>
            )}

            {screen.assets && (
              <ProfileTab value="items">
                <Panel
                  title="Company items"
                  id="items-heading"
                  action={
                    can.giveItem ? (
                      <GiveItemButton
                        employee={{ id: e.id, code: e.code, name: e.name }}
                        today={screen.today}
                      />
                    ) : undefined
                  }
                >
                  <ItemList
                    items={screen.assets}
                    today={screen.today}
                    manage={can.changeItems}
                    currency={currency}
                    empty={`${e.name} holds no company items.`}
                  />
                </Panel>
              </ProfileTab>
            )}

            <ProfileTab value="details">
              <Panel title="Details" id="details-heading">
                <dl className="mt-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                  <Fact label="Joined">
                    {formatDay(e.joinDate)}
                    {e.tenure && (
                      <span className="block text-muted-foreground">
                        {e.tenure.text} with {ctx.company.name}
                      </span>
                    )}
                  </Fact>
                  {e.exitDate && (
                    <Fact label={e.isCurrent ? "Last working day" : "Left"}>
                      {formatDay(e.exitDate)}
                      {e.exitReason && (
                        <span className="block text-muted-foreground">{e.exitReason}</span>
                      )}
                    </Fact>
                  )}
                  <Fact label="Phone">{e.phone ?? "–"}</Fact>
                  {e.workPlace && <Fact label="Work place">{e.workPlace.name}</Fact>}
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
                  {e.emergencyContact && (
                    <Fact label="Emergency contact">{e.emergencyContact}</Fact>
                  )}
                  {e.referenceName && (
                    <Fact label="Reference person">
                      {e.referenceName}
                      {e.referenceRelation ? ` (${e.referenceRelation})` : ""}
                      {e.referencePhone && (
                        <span className="block text-muted-foreground">{e.referencePhone}</span>
                      )}
                    </Fact>
                  )}
                  <Fact label="Login">
                    {e.login
                      ? `${e.login.email}${e.login.active ? "" : " (switched off)"}`
                      : "None"}
                  </Fact>
                </dl>
              </Panel>
            </ProfileTab>
          </ProfileTabs>
        </div>
      </div>
    </div>
  );
}
