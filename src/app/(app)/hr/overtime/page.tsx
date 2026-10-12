import type { Metadata } from "next";
import Link from "next/link";

import { Stat } from "@/components/accounts/stat";
import { SectionError } from "@/components/dashboard/section-error";
import { FormAlert } from "@/components/forms/field";
import { FlagBadge } from "@/components/hr/badges";
import { hrHref, minutesText, shiftMonth } from "@/components/hr/labels";
import { MonthNav } from "@/components/hr/month-days";
import { HrNoAccess } from "@/components/hr/no-access";
import { ApproveAllOvertime, OvertimeDecisions } from "@/components/hr/overtime-actions";
import { EmptyState } from "@/components/products/bits";
import { money } from "@/components/sales/labels";
import { formatDay, formatMonth } from "@/lib/display";
import { cn } from "@/lib/utils";
import type { OvertimeFlag, OvertimeLedger } from "@/modules/hr/overtime.service";
import { getOvertimeLedgerAction } from "@/server/actions/hr.actions";
import { requireCompanyPage } from "@/server/pages/guards";

export const metadata: Metadata = { title: "Overtime" };

const linkClass = "text-primary underline-offset-4 hover:underline";
const smallText = "text-[0.8125rem] text-muted-foreground";
const one = (value: string | string[] | undefined) =>
  typeof value === "string" ? value : undefined;

type Row = OvertimeLedger["rows"][number];

const STATUSES = [
  [undefined, "All"],
  ["PENDING", "Waiting"],
  ["APPROVED", "Approved"],
  ["REJECTED", "Rejected"],
] as const;

const FLAG_LABELS: Record<OvertimeFlag, string> = {
  LEFT_EARLY: "Left before checking out",
  AWAY_AT_CHECK_OUT: "Checked out away",
  NO_LOCATION: "No location at check-out",
  LONG_DAY: "Long day",
};

/** "Waiting", "Approved 2 h", "Rejected". */
function StatusBadge({ row }: { row: Row }) {
  if (row.status === "APPROVED") {
    return <FlagBadge tone="done">Approved {minutesText(row.approvedMinutes ?? 0)}</FlagBadge>;
  }
  if (row.status === "REJECTED") return <FlagBadge tone="closed">Rejected</FlagBadge>;
  return <FlagBadge tone="warn">Waiting</FlagBadge>;
}

/** "In 09:02 at Head office · out 21:40", with "next day" after midnight. */
function shiftText(row: Row) {
  const parts = [
    row.checkIn && `In ${row.checkIn}${row.placeName ? ` at ${row.placeName}` : ""}`,
    `out ${row.checkOut}${row.checkOutNextDay ? " (next day)" : ""}`,
  ];
  return parts.filter(Boolean).join(" · ");
}

/**
 * Shadow overtime (HR, hr.manage): the overtime the app found when staff
 * checked themselves out after the working day ended, or worked on a day off.
 * Staff never see these hours. HR approves each entry as found, approves what
 * the location trail suggests, changes the hours with a reason, or rejects it;
 * only approved hours reach payroll, at each person's overtime rate.
 */
export default async function OvertimePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const ctx = await requireCompanyPage();
  const query = await searchParams;
  const month = one(query.month);
  const status = one(query.status);
  const result = await getOvertimeLedgerAction({
    month: month && /^\d{4}-(0[1-9]|1[0-2])$/.test(month) ? month : undefined,
    status: status && ["PENDING", "APPROVED", "REJECTED"].includes(status) ? status : undefined,
  });
  if (!result.ok) {
    if (result.error.code === "FORBIDDEN") return <HrNoAccess />;
    return <SectionError title="Overtime" heading="Overtime could not load" error={result.error} />;
  }
  const l = result.data;
  const currency = ctx.company.currency;
  const previous = shiftMonth(l.month, -1);
  const next = l.month < l.thisMonth ? shiftMonth(l.month, 1) : null;
  const t = l.totals;
  const hours = (minutes: number) => (minutes === 0 ? "0 h" : minutesText(minutes));

  return (
    <section aria-labelledby="overtime-heading" className="grid gap-6">
      <div>
        <h2 id="overtime-heading" className="font-serif text-2xl text-primary">
          Overtime
        </h2>
        <p className="mt-1 max-w-2xl text-sm leading-relaxed text-muted-foreground">
          Found when staff check out after {l.rules.officeEndTime} or work on a day off, once they
          stay {l.rules.overtimeMinMinutes} minutes, in {l.rules.stepMinutes}-minute steps. Staff
          never see these hours. Only what you approve goes to payroll, at each person&apos;s
          overtime rate.
        </p>
      </div>

      {!l.rules.shadowOvertime && (
        <FormAlert tone="note">
          Finding overtime from check-outs is turned off, so nothing new appears here.{" "}
          <Link href={hrHref.settings()} className="font-medium underline underline-offset-4">
            Turn it on in Holidays &amp; rules
          </Link>
        </FormAlert>
      )}

      <MonthNav
        label={l.label}
        previous={{ href: hrHref.overtime(previous), label: formatMonth(previous) }}
        next={next ? { href: hrHref.overtime(next), label: formatMonth(next) } : null}
      />
      {l.closed && (
        <FormAlert tone="note">
          The payroll for {l.label} is approved, so its overtime is final.
        </FormAlert>
      )}

      <dl className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat
          label="Waiting"
          value={String(t.waiting.count)}
          hint={t.waiting.count > 0 ? `${hours(t.waiting.minutes)} found` : "Nothing to approve"}
        />
        <Stat
          label="Need a look"
          value={String(t.needsLook)}
          hint="Flagged by the location or a long day"
          alert={t.needsLook > 0}
        />
        <Stat
          label="Approved"
          value={hours(t.approved.minutes)}
          hint={`${t.approved.count} ${t.approved.count === 1 ? "entry" : "entries"}`}
        />
        <Stat label="Approved pay" value={money(t.approved.pay, currency)} hint="Goes to payroll" />
      </dl>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <nav aria-label="Show" className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
          {STATUSES.map(([value, label]) =>
            (l.status ?? undefined) === value ? (
              <span key={label} aria-current="page" className="font-medium">
                {label}
              </span>
            ) : (
              <Link key={label} href={hrHref.overtime(l.month, value)} className={linkClass}>
                {label}
              </Link>
            ),
          )}
        </nav>
        {!l.closed && (
          <ApproveAllOvertime
            month={l.month}
            label={l.label}
            count={t.readyToApprove}
            needsLook={t.needsLook}
          />
        )}
      </div>

      {l.rows.length === 0 ? (
        <EmptyState title={l.status ? "Nothing here" : "No overtime found"}>
          {l.status
            ? "No overtime with this status in the month."
            : `Nobody checked out after ${l.rules.officeEndTime} or worked on a day off in ${l.label}.`}
        </EmptyState>
      ) : (
        <ul className="grid gap-3" aria-label="Overtime entries">
          {l.rows.map((r) => (
            <li
              key={r.id}
              className={cn(
                "grid gap-3 rounded-lg border bg-card p-4",
                r.status === "PENDING" && r.flags.length > 0 && "border-destructive/40",
              )}
            >
              <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0">
                  <Link
                    href={hrHref.employeeMonth(r.employee.id, l.month)}
                    className="font-medium text-primary underline-offset-4 hover:underline"
                  >
                    {r.employee.name}
                  </Link>
                  <span className={`${smallText} ml-2`}>{r.employee.code}</span>
                  <p className={`mt-0.5 ${smallText}`}>
                    {r.weekday}, {formatDay(r.date)}
                    {r.basis === "DAY_OFF" ? " · day off, all of it counts" : ""}
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-1.5">
                  <StatusBadge row={r} />
                  {r.flags.map((f) => (
                    <FlagBadge key={f} tone="warn">
                      {FLAG_LABELS[f]}
                    </FlagBadge>
                  ))}
                </div>
              </div>

              <dl className="grid grid-cols-1 gap-x-6 gap-y-2 text-sm sm:grid-cols-3">
                <div>
                  <dt className={smallText}>Shift</dt>
                  <dd className="break-words">{shiftText(r)}</dd>
                </div>
                <div>
                  <dt className={smallText}>Found</dt>
                  <dd>
                    {minutesText(r.detectedMinutes)}
                    <span className={`block ${smallText}`}>Counted from {r.startsAt}</span>
                  </dd>
                </div>
                <div>
                  <dt className={smallText}>Pay</dt>
                  <dd>
                    {r.pay === null ? (
                      "No overtime rate"
                    ) : (
                      <>
                        {money(r.pay, currency)}
                        <span className={`block ${smallText}`}>
                          {money(r.rate!, currency)} an hour
                          {r.status === "APPROVED" ? "" : ", if approved as found"}
                        </span>
                      </>
                    )}
                  </dd>
                </div>
              </dl>

              {r.suggestedMinutes !== null && (
                <p className="text-sm">
                  {r.lastAtPlace
                    ? `The location trail shows ${r.employee.name} left ${r.placeName ?? "the work place"} at ${r.lastAtPlace}`
                    : `The location trail shows ${r.employee.name} away from ${r.placeName ?? "the work place"} after ${r.startsAt}`}
                  {r.suggestedMinutes > 0
                    ? `: ${minutesText(r.suggestedMinutes)} suggested.`
                    : ", before overtime counts."}
                </p>
              )}
              {r.status !== "PENDING" && (
                <p className={smallText}>
                  {r.status === "APPROVED" ? "Approved" : "Rejected"}
                  {r.decidedBy ? ` by ${r.decidedBy}` : ""}
                  {r.decidedAt ? ` on ${formatDay(r.decidedAt)}` : ""}
                  {r.reason ? `: ${r.reason}` : ""}
                </p>
              )}
              {r.changedInRegister && (
                <FormAlert tone="note">
                  The attendance register now says {hours(r.inRegister)} for this day; payroll pays
                  that.
                </FormAlert>
              )}
              {r.own ? (
                <p className={smallText}>Someone else in HR decides your own overtime.</p>
              ) : (
                r.can.decide && <OvertimeDecisions row={r} />
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
