import type { AttendanceStatus } from "@prisma/client";
import Link from "next/link";

import { Fact } from "@/components/sales/detail-bits";
import { formatDay } from "@/lib/display";
import { cn } from "@/lib/utils";

import { FlagBadge, MarkBadge } from "./badges";
import { DAY_TYPE_LABELS, minutesText } from "./labels";

type Day = {
  date: string;
  weekday: string;
  dayType: keyof typeof DAY_TYPE_LABELS;
  holiday: string | null;
  mark: {
    status: AttendanceStatus;
    checkIn: string | null;
    checkOut: string | null;
    overtimeMinutes: number;
    note: string | null;
    source: string;
  } | null;
  leave: { fraction: number; isPaid: boolean } | null;
};

type Totals = {
  workingDays: number;
  presentDays: number;
  lateDays: number;
  absentDays: number;
  paidLeaveDays: number;
  unpaidLeaveDays: number;
  latePenaltyDays: number;
  unpaidDays: number;
  overtimeHours: number;
};

/** The month's figures that payroll uses. */
export function MonthTotals({ totals }: { totals: Totals }) {
  return (
    <dl className="grid grid-cols-2 gap-4 sm:grid-cols-4">
      <Fact label="Working days">{totals.workingDays}</Fact>
      <Fact label="Present">{totals.presentDays}</Fact>
      <Fact label="Late">
        {totals.lateDays}
        {totals.latePenaltyDays > 0 && (
          <span className="block text-[0.8125rem] text-destructive">
            {totals.latePenaltyDays} day{totals.latePenaltyDays === 1 ? "" : "s"} cut
          </span>
        )}
      </Fact>
      <Fact label="Absent">{totals.absentDays}</Fact>
      <Fact label="Paid leave">{totals.paidLeaveDays}</Fact>
      <Fact label="Unpaid leave">{totals.unpaidLeaveDays}</Fact>
      <Fact label="Unpaid days">{totals.unpaidDays}</Fact>
      <Fact label="Overtime">{totals.overtimeHours} h</Fact>
    </dl>
  );
}

/**
 * A month day by day: days off and holidays, leave, and each day's mark with
 * the check-in and check-out times. A working day nobody marked counts as
 * present. With `dayHref`, each working day opens that day's register.
 */
export function MonthDays({
  days,
  today,
  dayHref,
}: {
  days: Day[];
  today: string;
  dayHref?: (date: string) => string;
}) {
  return (
    <ul className="grid divide-y rounded-lg border bg-card" aria-label="Days of the month">
      {days.map((d) => {
        const off = d.dayType !== "WORKING";
        const future = d.date > today;
        const times = [
          d.mark?.checkIn && `In ${d.mark.checkIn}`,
          d.mark?.checkOut && `out ${d.mark.checkOut}`,
          d.mark && d.mark.overtimeMinutes > 0 && `overtime ${minutesText(d.mark.overtimeMinutes)}`,
        ]
          .filter(Boolean)
          .join(", ");
        const date = (
          <span className="w-24 shrink-0 text-sm tabular-nums">
            <span className="block font-medium">{d.weekday.slice(0, 3)}</span>
            <span className="block text-[0.8125rem] text-muted-foreground">
              {formatDay(d.date).replace(/ \d{4}$/, "")}
            </span>
          </span>
        );
        return (
          <li
            key={d.date}
            className={cn(
              "flex items-start gap-4 px-4 py-3",
              off && "bg-muted/40",
              d.date === today && "ring-1 ring-primary/30 ring-inset",
            )}
          >
            {dayHref && !off && !future ? (
              <Link
                href={dayHref(d.date)}
                className="rounded-sm text-primary outline-none hover:underline focus-visible:ring-[3px] focus-visible:ring-ring/25"
                aria-label={`Open the register for ${formatDay(d.date)}`}
              >
                {date}
              </Link>
            ) : (
              date
            )}
            <span className="grid min-w-0 flex-1 gap-1">
              <span className="flex flex-wrap items-center gap-1.5 text-sm">
                {off ? (
                  <span className="text-muted-foreground">
                    {d.holiday ?? DAY_TYPE_LABELS[d.dayType]}
                  </span>
                ) : future ? (
                  <span className="text-muted-foreground">To come</span>
                ) : (
                  <>
                    {d.leave && (
                      <FlagBadge tone={d.leave.isPaid ? "open" : "warn"}>
                        {d.leave.fraction < 1 ? "Half day leave" : "On leave"}
                        {d.leave.isPaid ? "" : " (unpaid)"}
                      </FlagBadge>
                    )}
                    {d.mark ? (
                      <MarkBadge status={d.mark.status} />
                    ) : (
                      (!d.leave || d.leave.fraction < 1) && (
                        <span className="text-muted-foreground">Present</span>
                      )
                    )}
                  </>
                )}
              </span>
              {(times || d.mark?.note) && (
                <span className="text-[0.8125rem] break-words text-muted-foreground">
                  {[times, d.mark?.note].filter(Boolean).join(" · ")}
                  {d.mark?.source === "SELF" ? " · checked in from their phone" : ""}
                </span>
              )}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

/** "‹ Sep 2026 · Nov 2026 ›" for a month page. */
export function MonthNav({
  label,
  previous,
  next,
}: {
  label: string;
  previous: { href: string; label: string };
  next: { href: string; label: string } | null;
}) {
  const link = "text-sm text-primary underline-offset-4 hover:underline";
  return (
    <nav aria-label="Month" className="flex flex-wrap items-center justify-between gap-3">
      <Link href={previous.href} className={link}>
        ‹ {previous.label}
      </Link>
      <span className="font-serif text-lg text-primary">{label}</span>
      {next ? (
        <Link href={next.href} className={link}>
          {next.label} ›
        </Link>
      ) : (
        <span aria-hidden className="w-16" />
      )}
    </nav>
  );
}
