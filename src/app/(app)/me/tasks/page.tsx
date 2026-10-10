import type { Metadata } from "next";

import { MyHrProblem } from "@/components/hr/no-access";
import { plannerHref } from "@/components/planner/labels";
import { MyTaskList } from "@/components/planner/my-tasks";
import { ViewLinks } from "@/components/planner/view-links";
import { EmptyState } from "@/components/products/bits";
import { MY_TASK_SHOWS, type MyTaskShow } from "@/modules/reminders/screens.service";
import { getMyTasksScreenAction } from "@/server/actions/portal.actions";
import { requireCompanyPage } from "@/server/pages/guards";

export const metadata: Metadata = { title: "My tasks" };

const SHOW_LABELS: Record<MyTaskShow, string> = { open: "To do", done: "Done", all: "All" };

/**
 * The tasks given to the signed-in employee (portal.self), open ones first by
 * due day, with buttons to start, finish or reopen each. Whoever gave the task
 * hears about it in the app.
 */
export default async function MyTasksPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireCompanyPage();
  const { show } = await searchParams;
  const result = await getMyTasksScreenAction({ show });
  if (!result.ok) {
    return (
      <MyHrProblem error={result.error} title="My tasks" heading="Your tasks could not load" />
    );
  }
  const { items, nextCursor, show: shown } = result.data;

  return (
    <section aria-labelledby="my-tasks-heading" className="grid gap-6">
      <div>
        <h2 id="my-tasks-heading" className="font-serif text-2xl text-primary">
          Tasks
        </h2>
        <p className="mt-1 max-w-xl text-sm leading-relaxed text-muted-foreground">
          Work given to you, soonest due first. Mark it started or done; whoever gave it hears about
          it.
        </p>
      </div>
      <ViewLinks
        label="Which tasks"
        links={MY_TASK_SHOWS.map((s) => ({
          href: plannerHref.myTasks(s),
          label: SHOW_LABELS[s],
          current: s === shown,
        }))}
      />
      {items.length === 0 ? (
        <EmptyState title={shown === "open" ? "Nothing to do" : "No tasks"}>
          {shown === "open"
            ? "Tasks your manager gives you show here, with their due day."
            : "Tasks given to you show here."}
        </EmptyState>
      ) : (
        <MyTaskList key={shown} initial={{ items, nextCursor }} show={shown} />
      )}
    </section>
  );
}
