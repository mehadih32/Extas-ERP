import type { Metadata } from "next";

import { SectionError } from "@/components/dashboard/section-error";
import { ReminderFilters } from "@/components/planner/filters";
import {
  isReminderFiltered,
  reminderListQuery,
  reminderListSearch,
  reminderViewFrom,
} from "@/components/planner/list-view";
import { AddReminderButton } from "@/components/planner/reminder-form";
import { ReminderList } from "@/components/planner/reminder-list";
import { EmptyState } from "@/components/products/bits";
import { localDay } from "@/lib/dates";
import { getRemindersScreenAction } from "@/server/actions/reminders.actions";
import { requireCompanyPage } from "@/server/pages/guards";

export const metadata: Metadata = { title: "Reminders" };

/**
 * The reminders a person set or is on, latest first (everyone's for
 * reminders.manage): still to go out, gone out, dealt with or cancelled; set
 * by hand or automatic. They go out in the app; WhatsApp and email come later.
 */
export default async function RemindersPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const ctx = await requireCompanyPage();
  const asked = reminderViewFrom(await searchParams);
  // Everyone's reminders are for reminders.manage only; others keep their own.
  const view = ctx.can("reminders.manage") ? asked : { ...asked, everyone: undefined };
  const result = await getRemindersScreenAction(reminderListQuery(view));
  if (!result.ok) {
    return (
      <SectionError title="Reminders" heading="The reminders could not load" error={result.error} />
    );
  }
  const { items, nextCursor, can } = result.data;
  const today = localDay(new Date(), ctx.company.timezone);
  const me = { id: ctx.user.id, name: ctx.user.name };

  return (
    <section aria-labelledby="reminders-heading" className="grid gap-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 id="reminders-heading" className="font-serif text-2xl text-primary">
            Reminders
          </h2>
          <p className="mt-1 max-w-xl text-sm leading-relaxed text-muted-foreground">
            {can.others
              ? "Reminders for you and your team. They go out in the app at the time set."
              : "Reminders you set and the ones sent to you. They go out in the app at the time set."}
          </p>
        </div>
        {can.add && (
          <AddReminderButton
            me={me}
            others={can.others}
            today={today}
            className="w-full sm:w-auto"
          />
        )}
      </div>

      <ReminderFilters view={view} everyone={can.everyone}>
        {items.length === 0 ? (
          isReminderFiltered(view) ? (
            <EmptyState title="No reminders match">
              Clear the filters to see every reminder.
            </EmptyState>
          ) : (
            <EmptyState title="No reminders yet">
              {can.add
                ? "Add one for a call, a payment or a visit, and the app reminds you on the day."
                : "Reminders sent to you show here."}
            </EmptyState>
          )
        ) : (
          <ReminderList
            key={reminderListSearch(view)}
            initial={{ items, nextCursor }}
            view={view}
            meId={ctx.user.id}
          />
        )}
      </ReminderFilters>
    </section>
  );
}
