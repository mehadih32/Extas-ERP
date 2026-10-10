"use client";

import type { TaskStatus } from "@prisma/client";
import { CheckIcon, PlayIcon, RotateCcwIcon } from "lucide-react";
import { useState, useTransition } from "react";

import { ActionErrorDialog } from "@/components/feedback/action-error-dialog";
import { ShowMore, useLoadMore } from "@/components/sales/load-more";
import { Button } from "@/components/ui/button";
import type { ActionError } from "@/lib/result";
import { cn } from "@/lib/utils";
import { taskMoves } from "@/modules/reminders/checks";
import type { MyTaskRow, MyTaskShow } from "@/modules/reminders/screens.service";
import { getMyTasksScreenAction, setMyTaskStatusAction } from "@/server/actions/portal.actions";

import { PriorityBadge, TaskBadge } from "./badges";
import { moveLabel, TASK_STATUS_LABELS, whenText } from "./labels";

const MOVE_ICONS: Partial<Record<TaskStatus, typeof CheckIcon>> = {
  IN_PROGRESS: PlayIcon,
  DONE: CheckIcon,
  TODO: RotateCcwIcon,
};

/**
 * The tasks given to the signed-in employee, soonest due first, each with the
 * buttons to start, finish or reopen it. Whoever gave it hears about it in the
 * app. A task changed here keeps its place until the page is opened again.
 */
export function MyTaskList({
  initial,
  show,
}: {
  initial: { items: MyTaskRow[]; nextCursor?: string };
  show: MyTaskShow;
}) {
  const list = useLoadMore(initial, async (cursor) => {
    const result = await getMyTasksScreenAction({ show, cursor });
    return result.ok
      ? {
          ok: true as const,
          data: { items: result.data.items, nextCursor: result.data.nextCursor },
        }
      : result;
  });
  const [changed, setChanged] = useState<Map<string, TaskStatus>>(() => new Map());
  const [notice, setNotice] = useState<{ id: string; text: string }>();
  const [error, setError] = useState<ActionError>();
  const [pending, startTransition] = useTransition();

  function move(task: MyTaskRow, to: TaskStatus) {
    startTransition(async () => {
      const result = await setMyTaskStatusAction(task.id, { status: to });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setChanged((m) => new Map(m).set(task.id, to));
      setNotice({
        id: task.id,
        text:
          to === "DONE"
            ? `Marked as done.${task.createdBy ? ` ${task.createdBy.name} hears about it.` : ""}`
            : `The task is ${TASK_STATUS_LABELS[to].toLowerCase()}.`,
      });
    });
  }

  return (
    <div className="grid grid-cols-1 gap-5">
      <ul className="grid grid-cols-1 gap-4 lg:grid-cols-2" aria-label="My tasks">
        {list.items.map((t) => {
          const status = changed.get(t.id) ?? t.status;
          const overdue = t.overdue && (status === "TODO" || status === "IN_PROGRESS");
          const moves = changed.has(t.id) ? taskMoves(status, false) : t.moves;
          return (
            <li
              key={t.id}
              className={cn(
                "grid content-start gap-3 rounded-lg border bg-card p-5",
                overdue && "border-destructive/30",
              )}
            >
              <div className="flex flex-wrap items-center gap-1.5">
                <TaskBadge status={status} />
                {overdue && <TaskBadge status={status} overdue />}
                <PriorityBadge priority={t.priority} />
              </div>
              <div className="min-w-0">
                <h3 className="font-medium break-words text-primary">{t.title}</h3>
                <p
                  className={cn(
                    "mt-1 text-sm",
                    overdue ? "text-destructive" : "text-muted-foreground",
                  )}
                >
                  {t.dueDay ? `Due ${whenText(t.dueDay, t.dueTime)}` : "No due day"}
                </p>
                {t.description && (
                  <p className="mt-2 text-sm leading-relaxed break-words whitespace-pre-wrap">
                    {t.description}
                  </p>
                )}
                <p className="mt-2 text-[0.8125rem] text-muted-foreground">
                  {[
                    t.createdBy ? `From ${t.createdBy.name}` : null,
                    t.project ? `Project ${t.project.code} ${t.project.name}` : null,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </p>
              </div>
              {moves.length > 0 && (
                <div className="flex flex-col gap-2 border-t pt-3 sm:flex-row sm:flex-wrap">
                  {moves.map((to, index) => {
                    const Icon = MOVE_ICONS[to] ?? CheckIcon;
                    return (
                      <Button
                        key={to}
                        type="button"
                        variant={index === 0 ? "default" : "outline"}
                        className="w-full sm:w-auto"
                        disabled={pending}
                        onClick={() => move(t, to)}
                        aria-label={`${moveLabel(status, to)}: ${t.title}`}
                      >
                        <Icon aria-hidden />
                        {moveLabel(status, to)}
                      </Button>
                    );
                  })}
                </div>
              )}
              {notice?.id === t.id && (
                <p role="status" className="text-sm text-success">
                  {notice.text}
                </p>
              )}
            </li>
          );
        })}
      </ul>
      <ShowMore list={list} noun="tasks" />
      <ActionErrorDialog
        error={error}
        title="We could not change the task"
        onClose={() => setError(undefined)}
      />
    </div>
  );
}
