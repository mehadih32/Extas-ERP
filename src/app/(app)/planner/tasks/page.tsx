import type { Metadata } from "next";

import { SectionError } from "@/components/dashboard/section-error";
import { TaskFilters } from "@/components/planner/filters";
import {
  isTaskFiltered,
  taskListQuery,
  taskListSearch,
  taskViewFrom,
} from "@/components/planner/list-view";
import { TasksNoAccess } from "@/components/planner/no-access";
import { GiveTaskButton } from "@/components/planner/task-form";
import { TaskList } from "@/components/planner/task-list";
import { EmptyState } from "@/components/products/bits";
import { localDay } from "@/lib/dates";
import { getTasksScreenAction } from "@/server/actions/reminders.actions";
import { requireCompanyPage } from "@/server/pages/guards";

export const metadata: Metadata = { title: "Tasks" };

/**
 * The tasks given to staff (reminders.manage), soonest due first: open ones,
 * overdue, done, cancelled or all; one employee's; the ones I gave. The
 * employee sees theirs in My HR and marks them started or done there.
 */
export default async function TasksPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const ctx = await requireCompanyPage();
  const view = taskViewFrom(await searchParams);
  const result = await getTasksScreenAction(taskListQuery(view));
  if (!result.ok) {
    if (result.error.code === "FORBIDDEN") return <TasksNoAccess />;
    return <SectionError title="Tasks" heading="The tasks could not load" error={result.error} />;
  }
  const { items, nextCursor, counts, assignee } = result.data;
  const today = localDay(new Date(), ctx.company.timezone);

  return (
    <section aria-labelledby="tasks-heading" className="grid gap-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 id="tasks-heading" className="font-serif text-2xl text-primary">
            Tasks
          </h2>
          <p className="mt-1 max-w-xl text-sm leading-relaxed text-muted-foreground">
            {counts.open === 0
              ? "No open tasks. Give staff a piece of work with a due day; they hear about it in the app."
              : `${counts.open} open ${counts.open === 1 ? "task" : "tasks"}${
                  counts.overdue > 0 ? `, ${counts.overdue} overdue` : ""
                }.`}
          </p>
        </div>
        <GiveTaskButton
          timeZone={ctx.company.timezone}
          today={today}
          className="w-full sm:w-auto"
        />
      </div>

      <TaskFilters view={view} named={assignee ? `Tasks of ${assignee.name}` : null}>
        {items.length === 0 ? (
          isTaskFiltered(view) ? (
            <EmptyState title="No tasks match">Clear the filters to see the open tasks.</EmptyState>
          ) : (
            <EmptyState title="No open tasks">
              Tasks given to staff show here until they are done.
            </EmptyState>
          )
        ) : (
          <TaskList key={taskListSearch(view)} initial={{ items, nextCursor }} view={view} />
        )}
      </TaskFilters>
    </section>
  );
}
