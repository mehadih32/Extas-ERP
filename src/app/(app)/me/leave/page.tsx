import type { Metadata } from "next";
import Link from "next/link";

import { LeaveBadge } from "@/components/hr/badges";
import { dayCount, hrHref, leaveDates } from "@/components/hr/labels";
import { AskForLeave, WithdrawLeave } from "@/components/hr/my-hr-actions";
import { MyHrProblem } from "@/components/hr/no-access";
import { EmptyState } from "@/components/products/bits";
import { Panel } from "@/components/sales/detail-bits";
import { getMyLeaveScreenAction } from "@/server/actions/portal.actions";
import { requireCompanyPage } from "@/server/pages/guards";

export const metadata: Metadata = { title: "My leave" };

const linkClass = "text-primary underline-offset-4 hover:underline";
const smallText = "block text-[0.8125rem] text-muted-foreground";
const one = (value: string | string[] | undefined) =>
  typeof value === "string" ? value : undefined;

/**
 * The employee's own leave for a year (portal.self): what is left of each
 * kind, their requests with HR's decision, asking for leave, and withdrawing
 * a request HR has not decided yet.
 */
export default async function MyLeavePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireCompanyPage();
  const result = await getMyLeaveScreenAction({ year: one((await searchParams).year) });
  if (!result.ok) {
    return (
      <MyHrProblem error={result.error} title="My leave" heading="Your leave could not load" />
    );
  }
  const { year, years, today, leaveTypes, balances, requests } = result.data;
  const thisYear = Number(today.slice(0, 4));

  return (
    <section aria-labelledby="my-leave-heading" className="grid gap-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 id="my-leave-heading" className="font-serif text-2xl text-primary">
            Leave in {year}
          </h2>
          <nav aria-label="Year" className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm">
            {years.map((y) =>
              y === year ? (
                <span key={y} aria-current="page" className="font-medium">
                  {y}
                </span>
              ) : (
                <Link
                  key={y}
                  href={hrHref.myLeave(y === thisYear ? undefined : y)}
                  className={linkClass}
                >
                  {y}
                </Link>
              ),
            )}
          </nav>
        </div>
        <AskForLeave leaveTypes={leaveTypes} today={today} />
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
        <Panel title="Left this year" id="balances-heading" className="self-start">
          {balances.length === 0 ? (
            <p className="mt-4 text-sm text-muted-foreground">No leave types are set up yet.</p>
          ) : (
            <ul className="mt-4 grid divide-y" aria-label="Leave left">
              {balances.map((b) => (
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

        <Panel title="Requests" id="requests-heading">
          {requests.length === 0 ? (
            <div className="mt-4">
              <EmptyState title={`No leave in ${year}`}>
                Leave you ask for, or HR records for you, shows here.
              </EmptyState>
            </div>
          ) : (
            <ul className="mt-4 grid divide-y" aria-label={`Leave in ${year}`}>
              {requests.map((r) => (
                <li key={r.id} className="grid gap-2 py-3 first:pt-0 last:pb-0">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <span className="min-w-0">
                      <span className="block text-sm font-medium">
                        {r.leaveType.name}
                        {r.leaveType.isPaid ? "" : " (unpaid)"}
                      </span>
                      <span className={smallText}>
                        {leaveDates(r)} · {dayCount(r.days)}
                      </span>
                    </span>
                    <LeaveBadge status={r.status} />
                  </div>
                  {r.reason && (
                    <p className="text-sm whitespace-pre-line text-muted-foreground">{r.reason}</p>
                  )}
                  {r.decisionNote && (
                    <p className="text-sm">
                      <span className="text-muted-foreground">
                        {r.decidedBy && (r.status === "APPROVED" || r.status === "REJECTED")
                          ? `${r.decidedBy.name}: `
                          : "Note: "}
                      </span>
                      <span className="whitespace-pre-line">{r.decisionNote}</span>
                    </p>
                  )}
                  {(r.attachment || r.canWithdraw) && (
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      {r.attachment ? (
                        <a
                          href={hrHref.file(r.attachment.id)}
                          target="_blank"
                          rel="noreferrer"
                          className={`text-sm ${linkClass}`}
                        >
                          {r.attachment.fileName}
                        </a>
                      ) : (
                        <span />
                      )}
                      {r.canWithdraw && (
                        <WithdrawLeave id={r.id} what={`${r.leaveType.name}, ${leaveDates(r)}`} />
                      )}
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>
    </section>
  );
}
