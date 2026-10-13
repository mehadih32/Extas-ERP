import { HistoryIcon } from "lucide-react";
import Link from "next/link";

import { StatusBadge } from "@/components/sales/badges";
import { Panel } from "@/components/sales/detail-bits";
import { Button } from "@/components/ui/button";
import { NativeSelect } from "@/components/ui/native-select";
import { formatLongDay } from "@/lib/display";
import type { ActionLog } from "@/modules/production/action-log.service";

/*
 * The Employee Action Log: every input on a style or a master batch, newest
 * first, by day, with the time, the person and what they did. A plain form
 * filters it by person and by kind of record, with no script needed.
 */

/** The log with its filters; `href` is the page it is on. */
export function ActionLogView({ log, href }: { log: ActionLog; href: string }) {
  const days: Array<{ day: string; rows: ActionLog["rows"] }> = [];
  for (const row of log.rows) {
    const last = days[days.length - 1];
    if (last?.day === row.day) last.rows.push(row);
    else days.push({ day: row.day, rows: [row] });
  }
  const filtered = Boolean(log.filters.userId || log.filters.kind);
  const older = log.next
    ? `${href}?${new URLSearchParams({
        ...(log.filters.userId ? { userId: log.filters.userId } : {}),
        ...(log.filters.kind ? { kind: log.filters.kind } : {}),
        before: log.next,
      }).toString()}`
    : null;
  return (
    <div className="grid gap-6">
      <form
        method="get"
        action={href}
        className="flex flex-wrap items-end gap-3 rounded-lg border bg-card p-4 sm:p-5"
        aria-label="Filter the action log"
      >
        <label className="grid min-w-[11rem] flex-1 gap-1.5 text-sm font-medium sm:flex-none">
          Person
          <NativeSelect name="userId" defaultValue={log.filters.userId ?? ""}>
            <option value="">Everyone</option>
            {log.people.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </NativeSelect>
        </label>
        <label className="grid min-w-[11rem] flex-1 gap-1.5 text-sm font-medium sm:flex-none">
          What
          <NativeSelect name="kind" defaultValue={log.filters.kind ?? ""}>
            <option value="">Everything</option>
            {log.kinds.map((k) => (
              <option key={k.key} value={k.key}>
                {k.label}
              </option>
            ))}
          </NativeSelect>
        </label>
        <Button type="submit" size="sm" variant="outline">
          Show
        </Button>
        {filtered && (
          <Link
            href={href}
            className="pb-1.5 text-sm text-primary underline-offset-4 hover:underline"
          >
            Show all
          </Link>
        )}
      </form>

      {days.length === 0 ? (
        <Panel title="Nothing yet" id="log-empty-heading">
          <p className="mt-3 text-sm text-muted-foreground">
            {filtered ? "Nothing matches these filters." : "Nothing has been recorded here yet."}
          </p>
        </Panel>
      ) : (
        days.map(({ day, rows }) => (
          <section key={day} aria-labelledby={`day-${day}`} className="rounded-lg border bg-card">
            <h3 id={`day-${day}`} className="border-b px-4 py-3 text-sm font-medium sm:px-5">
              {formatLongDay(day)}
            </h3>
            <ol className="divide-y" aria-label={`Actions on ${formatLongDay(day)}`}>
              {rows.map((r) => (
                <li
                  key={r.id}
                  className="grid grid-cols-[3.25rem_minmax(0,1fr)] gap-x-3 gap-y-1 px-4 py-3 sm:grid-cols-[3.5rem_10rem_minmax(0,1fr)] sm:px-5"
                >
                  <time dateTime={r.at} className="text-sm text-muted-foreground tabular-nums">
                    {r.time}
                  </time>
                  <p className="min-w-0 text-sm font-medium break-words">
                    {r.who?.name ?? "Unknown person"}
                  </p>
                  <div className="col-start-2 min-w-0 sm:col-start-3 sm:row-start-1">
                    <p className="flex flex-wrap items-center gap-1.5 text-sm">
                      <StatusBadge tone="plain">{r.kind}</StatusBadge>
                      <span className="text-[0.8125rem] text-muted-foreground">{r.action}</span>
                    </p>
                    <p className="mt-1 text-sm leading-relaxed break-words">{r.summary}</p>
                  </div>
                </li>
              ))}
            </ol>
          </section>
        ))
      )}
      {older && (
        <div>
          <Button asChild size="sm" variant="outline">
            <Link href={older}>
              <HistoryIcon aria-hidden />
              Show older
            </Link>
          </Button>
        </div>
      )}
    </div>
  );
}

/** The way to a style's or batch's action log, on its page (for those who may read it). */
export function ActionLogLink({ href, of }: { href: string; of: "style" | "batch" }) {
  return (
    <Panel title="Action log" id="action-log-heading">
      <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
        Every input on this {of === "style" ? "style" : "batch and its styles"}, with when and who:
        receiving, cutting, finishing, issues, costs.
      </p>
      <Button asChild size="sm" variant="outline" className="mt-4">
        <Link href={href}>
          <HistoryIcon aria-hidden />
          Open the action log
        </Link>
      </Button>
    </Panel>
  );
}
