import { Stat } from "@/components/accounts/stat";
import { formatCount } from "@/lib/display";
import { NEW_JOINER_DAYS, type DirectoryStats } from "@/modules/hr/directory.service";

import { DAY_TYPE_LABELS, hrHref } from "./labels";

/**
 * The four counts over the employee directory: everyone working here, in
 * today (as the HR Overview counts it), on leave (approved leave today or long
 * leave) and new joiners (the last 30 days).
 */
export function DirectoryStatsRow({
  stats: s,
  currency,
}: {
  stats: DirectoryStats;
  currency: string;
}) {
  const count = (n: number) => formatCount(n, currency);
  const leaveHint = [
    s.onApprovedLeave > 0 ? `${count(s.onApprovedLeave)} on leave today` : null,
    s.onLongLeave > 0 ? `${count(s.onLongLeave)} on long leave` : null,
  ].filter(Boolean);
  return (
    <section aria-label="Employees at a glance">
      <dl className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Total employees" value={count(s.total)} hint="Working here now" />
        <Stat
          label="Present today"
          value={s.present === null ? DAY_TYPE_LABELS[s.dayType] : count(s.present)}
          hint={
            s.present === null ? s.holiday : `${count(s.late)} late · ${count(s.absent)} absent`
          }
          href={hrHref.attendance()}
        />
        <Stat
          label="On leave"
          value={count(s.onLeave)}
          hint={leaveHint.length > 0 ? leaveHint.join(" · ") : "Nobody today"}
        />
        <Stat
          label="New joiners"
          value={count(s.newJoiners)}
          hint={`Joined in the last ${NEW_JOINER_DAYS} days`}
        />
      </dl>
    </section>
  );
}
