"use client";

import { RowCard, RowLink, ShowMore, useLoadMore } from "@/components/sales/load-more";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { TaskRow } from "@/modules/reminders/screens.service";
import { listTaskRowsAction } from "@/server/actions/reminders.actions";

import { PriorityBadge, TaskBadge } from "./badges";
import { plannerHref, whenText } from "./labels";
import { taskListQuery, type TaskListView } from "./list-view";

const dueOf = (t: TaskRow) => (t.dueDay ? `Due ${whenText(t.dueDay, t.dueTime)}` : "No due day");

/**
 * Tasks, soonest due first: cards on phones, a table on computers, each
 * opening the task, with "Show more" for the next page.
 */
export function TaskList({
  initial,
  view,
}: {
  initial: { items: TaskRow[]; nextCursor?: string };
  view: TaskListView;
}) {
  const list = useLoadMore(initial, (cursor) => listTaskRowsAction(taskListQuery(view, cursor)));

  return (
    <div className="grid grid-cols-1 gap-5">
      <ul className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:hidden" aria-label="Tasks">
        {list.items.map((t) => (
          <RowCard
            key={t.id}
            href={plannerHref.task(t.id)}
            eyebrow={t.assignee ? `For ${t.assignee.name}` : "Nobody yet"}
            badges={
              <>
                <TaskBadge status={t.status} overdue={t.overdue} />
                <PriorityBadge priority={t.priority} />
              </>
            }
            title={t.title}
            details={t.project ? `${t.project.code} ${t.project.name}` : undefined}
            footer={
              <>
                <span className={t.overdue ? "text-destructive" : "text-muted-foreground"}>
                  {dueOf(t)}
                </span>
                {t.createdBy && (
                  <span className="text-muted-foreground">From {t.createdBy.name}</span>
                )}
              </>
            }
          />
        ))}
      </ul>
      <div className="hidden lg:block">
        <Table aria-label="Tasks">
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead>Task</TableHead>
              <TableHead>For</TableHead>
              <TableHead>Due</TableHead>
              <TableHead>Given by</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {list.items.map((t) => (
              <TableRow key={t.id}>
                <TableCell className="max-w-96 py-3">
                  <RowLink href={plannerHref.task(t.id)} className="whitespace-normal">
                    {t.title}
                  </RowLink>
                  <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[0.8125rem] text-muted-foreground">
                    <TaskBadge status={t.status} overdue={t.overdue} />
                    <PriorityBadge priority={t.priority} />
                    {t.project && <span>{t.project.code}</span>}
                  </div>
                </TableCell>
                <TableCell>
                  {t.assignee ? (
                    <>
                      <div>{t.assignee.name}</div>
                      <div className="text-[0.8125rem] text-muted-foreground">
                        {t.assignee.code}
                        {!t.assignee.hasLogin && " · no login yet"}
                      </div>
                    </>
                  ) : (
                    <span className="text-muted-foreground">Nobody yet</span>
                  )}
                </TableCell>
                <TableCell
                  className={
                    t.overdue
                      ? "whitespace-nowrap text-destructive"
                      : "whitespace-nowrap text-muted-foreground"
                  }
                >
                  {t.dueDay ? whenText(t.dueDay, t.dueTime) : "No due day"}
                </TableCell>
                <TableCell className="text-muted-foreground">{t.createdBy?.name ?? ""}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      <ShowMore list={list} noun="tasks" />
    </div>
  );
}
