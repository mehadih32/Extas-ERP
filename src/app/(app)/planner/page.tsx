import type { Metadata } from "next";

import { SectionError } from "@/components/dashboard/section-error";
import { AgendaGroup } from "@/components/planner/agenda";
import { dayHeading, plannerHref } from "@/components/planner/labels";
import { AddReminderButton } from "@/components/planner/reminder-form";
import { GiveTaskButton } from "@/components/planner/task-form";
import { ViewLinks } from "@/components/planner/view-links";
import { formatDay, formatDayRange } from "@/lib/display";
import { getAgendaScreenAction } from "@/server/actions/reminders.actions";
import { AGENDA_SPANS } from "@/modules/reminders/screens.service";
import { requireCompanyPage } from "@/server/pages/guards";

export const metadata: Metadata = { title: "Coming up" };

/**
 * What is coming up for this person over the next days and what is overdue:
 * production deadlines, goods due in-house, shipments and licence renewals as
 * far as their role sees them, their tasks (every task for reminders.manage)
 * and their own reminders.
 */
export default async function ComingUpPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const ctx = await requireCompanyPage();
  const { days } = await searchParams;
  const result = await getAgendaScreenAction({ days });
  if (!result.ok) {
    return (
      <SectionError
        title="Coming up"
        heading="What is coming up could not load"
        error={result.error}
      />
    );
  }
  const { today, until, span, overdue, days: byDay, can } = result.data;
  const busy = byDay.filter((d) => d.items.length > 0);
  const me = { id: ctx.user.id, name: ctx.user.name };

  return (
    <section aria-labelledby="agenda-heading" className="grid gap-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 id="agenda-heading" className="font-serif text-2xl text-primary">
            Coming up
          </h2>
          <p className="mt-1 max-w-xl text-sm leading-relaxed text-muted-foreground">
            {formatDayRange(today, until)}: deadlines, deliveries, renewals, tasks and reminders for
            you.
          </p>
        </div>
        {(can.remind || can.task) && (
          <div className="flex flex-col gap-2 sm:flex-row">
            {can.remind && (
              <AddReminderButton
                me={me}
                others={can.task}
                today={today}
                className="w-full sm:w-auto"
              />
            )}
            {can.task && (
              <GiveTaskButton
                timeZone={ctx.company.timezone}
                today={today}
                variant="outline"
                className="w-full sm:w-auto"
              />
            )}
          </div>
        )}
      </div>

      <ViewLinks
        label="How far ahead"
        links={AGENDA_SPANS.map((n) => ({
          href: plannerHref.agenda(n),
          label: `${n} days`,
          current: n === span,
        }))}
      />

      <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)]">
        <div className="order-2 grid gap-4 lg:order-1">
          {busy.length === 0 ? (
            <p className="rounded-lg border bg-card px-6 py-10 text-center text-sm text-muted-foreground">
              Nothing is due until {formatDay(until)}.
            </p>
          ) : (
            busy.map((d) => (
              <AgendaGroup
                key={d.date}
                id={`day-${d.date}`}
                title={dayHeading(d.date, today)}
                items={d.items}
                today={today}
              />
            ))
          )}
        </div>
        <div className="order-1 lg:order-2">
          {overdue.length > 0 ? (
            <AgendaGroup
              id="overdue-heading"
              title={`Overdue (${overdue.length})`}
              items={overdue}
              today={today}
              tone="warn"
            />
          ) : (
            <p className="rounded-lg border bg-card px-5 py-4 text-sm text-muted-foreground">
              Nothing is overdue.
            </p>
          )}
        </div>
      </div>
    </section>
  );
}
