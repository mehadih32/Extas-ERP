import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { SectionError } from "@/components/dashboard/section-error";
import { FormAlert } from "@/components/forms/field";
import { FlagBadge, LeaveBadge } from "@/components/hr/badges";
import { dayCount, hrHref, leaveDates } from "@/components/hr/labels";
import { LeaveActions } from "@/components/hr/leave-actions";
import { HrNoAccess } from "@/components/hr/no-access";
import { Fact, Panel, RecordHeader } from "@/components/sales/detail-bits";
import { BackLink } from "@/components/settings/back-link";
import { formatDay } from "@/lib/display";
import { getLeaveScreenAction } from "@/server/actions/hr.actions";
import { requireCompanyPage } from "@/server/pages/guards";

export const metadata: Metadata = { title: "Leave request" };

const linkClass = "text-primary underline-offset-4 hover:underline";
const one = (value: string | string[] | undefined) =>
  typeof value === "string" ? value : undefined;

/**
 * One leave request (hr.view, hr.manage or hr.payroll): the dates and days,
 * why, any paper, who decided it, and the employee's allowance for its type,
 * with HR approving, rejecting or cancelling it as hr/rules.ts allows.
 */
export default async function LeaveRequestPage({
  params,
  searchParams,
}: {
  params: Promise<{ leaveId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireCompanyPage();
  const [{ leaveId }, query] = await Promise.all([params, searchParams]);
  const result = await getLeaveScreenAction(leaveId);
  if (!result.ok) {
    if (result.error.code === "NOT_FOUND") notFound();
    if (result.error.code === "FORBIDDEN") return <HrNoAccess />;
    return (
      <SectionError title="Leave" heading="The leave request could not load" error={result.error} />
    );
  }
  const screen = result.data;
  const { leave: l, balance, can, notes } = screen;
  const notice =
    one(query.created) === "1"
      ? l.status === "APPROVED"
        ? `${l.employee.name}'s leave was recorded and approved.`
        : `${l.employee.name}'s leave was recorded. It waits for a decision.`
      : undefined;

  return (
    <div className="grid grid-cols-1 gap-8 md:gap-10">
      <div className="grid gap-6">
        <BackLink href={hrHref.leave}>All leave</BackLink>
        <RecordHeader
          eyebrow={`${l.leaveType.name} · ${dayCount(l.days)}`}
          title={l.employee.name}
          badges={
            <>
              <LeaveBadge status={l.status} />
              {!l.leaveType.isPaid && <FlagBadge tone="warn">Unpaid</FlagBadge>}
              <span className="text-sm text-muted-foreground">{leaveDates(l)}</span>
            </>
          }
        />
        <LeaveActions key={l.id} screen={screen} notice={notice} />
        {notes.approve && <FormAlert tone="note">{notes.approve}</FormAlert>}
        {notes.cancel && <FormAlert tone="note">{notes.cancel}</FormAlert>}
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)]">
        <Panel title="The request" id="request-heading">
          <dl className="mt-4 grid gap-4 sm:grid-cols-2">
            <Fact label="Dates">{leaveDates(l)}</Fact>
            <Fact label="Working days">{dayCount(l.days)}</Fact>
            <Fact label="Leave type">
              {l.leaveType.name}
              {l.leaveType.isPaid ? "" : " (unpaid: taken off the salary)"}
            </Fact>
            <Fact label="Asked by">
              {l.requestedBy?.name ?? "–"}
              <span className="block text-muted-foreground">{formatDay(screen.askedOn)}</span>
            </Fact>
            {l.reason && (
              <Fact label="Reason" className="sm:col-span-2">
                <span className="whitespace-pre-line">{l.reason}</span>
              </Fact>
            )}
            {l.attachment && (
              <Fact label="Paper">
                <a
                  href={hrHref.file(l.attachment.id)}
                  target="_blank"
                  rel="noreferrer"
                  className={linkClass}
                >
                  {l.attachment.fileName}
                </a>
              </Fact>
            )}
            {(l.status === "APPROVED" || l.status === "REJECTED") && (
              <Fact label={l.status === "APPROVED" ? "Approved by" : "Rejected by"}>
                {l.decidedBy?.name ?? "–"}
                {l.decisionNote && (
                  <span className="block whitespace-pre-line text-muted-foreground">
                    {l.decisionNote}
                  </span>
                )}
              </Fact>
            )}
            {l.status === "CANCELLED" && (
              <Fact label="Cancelled">
                <span className="whitespace-pre-line">{l.decisionNote ?? "No reason given"}</span>
              </Fact>
            )}
          </dl>
        </Panel>

        <Panel
          title={`${l.leaveType.name} in ${l.startDate.slice(0, 4)}`}
          id="balance-heading"
          action={
            can.openEmployee ? (
              <Link href={hrHref.employee(l.employee.id)} className={`text-sm ${linkClass}`}>
                {l.employee.name}
              </Link>
            ) : undefined
          }
        >
          {!balance ? (
            <p className="mt-4 text-sm text-muted-foreground">No allowance for this type.</p>
          ) : balance.entitled === null ? (
            <p className="mt-4 text-sm text-muted-foreground">
              Unpaid leave has no limit. {dayCount(balance.used)} taken this year
              {balance.pending > 0 ? `, ${dayCount(balance.pending)} waiting` : ""}.
            </p>
          ) : (
            <dl className="mt-4 grid grid-cols-2 gap-4">
              <Fact label="Allowed">{dayCount(balance.entitled)}</Fact>
              <Fact label="Taken">{dayCount(balance.used)}</Fact>
              <Fact label="Waiting">{dayCount(balance.pending)}</Fact>
              <Fact label="Left">
                <span
                  className={
                    balance.remaining !== null && balance.remaining < 0 ? "text-destructive" : ""
                  }
                >
                  {dayCount(balance.remaining ?? 0)}
                </span>
              </Fact>
            </dl>
          )}
        </Panel>
      </div>
    </div>
  );
}
