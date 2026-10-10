"use client";

import type { TaskStatus } from "@prisma/client";
import {
  BanIcon,
  CheckIcon,
  EllipsisVerticalIcon,
  PencilIcon,
  PlayIcon,
  RotateCcwIcon,
  Trash2Icon,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { ActionErrorDialog } from "@/components/feedback/action-error-dialog";
import { ConfirmDialog } from "@/components/feedback/confirm-dialog";
import { FormAlert } from "@/components/forms/field";
import { useNotice } from "@/components/hr/use-notice";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { ActionError } from "@/lib/result";
import type { TaskScreen } from "@/modules/reminders/screens.service";
import { deleteTaskAction, setTaskStatusAction } from "@/server/actions/reminders.actions";

import { moveLabel, plannerHref, TASK_STATUS_LABELS } from "./labels";
import { TaskDialog } from "./task-form";

const MOVE_ICONS: Record<TaskStatus, typeof CheckIcon> = {
  IN_PROGRESS: PlayIcon,
  DONE: CheckIcon,
  TODO: RotateCcwIcon,
  CANCELLED: BanIcon,
};

/**
 * What management (reminders.manage) may do with a task, from the flags its
 * screen came with: start, finish, take back or reopen it, change an open one,
 * cancel or delete it. The employee and whoever gave it hear about it in the app.
 */
export function TaskActions({
  screen,
  timeZone,
  today,
  notice: initial,
}: {
  screen: TaskScreen;
  timeZone: string;
  today: string;
  notice?: string;
}) {
  const router = useRouter();
  const { task: t, moves, can } = screen;
  const [open, setOpen] = useState<"edit" | "cancel" | "delete" | null>(null);
  const [notice, setNotice] = useNotice(initial);
  const [error, setError] = useState<ActionError>();
  const [pending, startTransition] = useTransition();
  const close = () => setOpen(null);
  const quick = moves.filter((m) => m !== "CANCELLED");
  const canCancel = moves.includes("CANCELLED");

  function move(to: TaskStatus) {
    startTransition(async () => {
      const result = await setTaskStatusAction(t.id, { status: to });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setNotice(`The task is ${TASK_STATUS_LABELS[to].toLowerCase()}.`);
    });
  }

  return (
    <div className="grid gap-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
        {quick.map((to, index) => {
          const Icon = MOVE_ICONS[to];
          return (
            <Button
              key={to}
              type="button"
              variant={index === 0 ? "default" : "outline"}
              className="w-full sm:w-auto"
              disabled={pending}
              onClick={() => move(to)}
            >
              <Icon aria-hidden />
              {moveLabel(t.status, to)}
            </Button>
          );
        })}
        <div className="flex gap-2">
          {can.edit && (
            <Button
              type="button"
              variant="outline"
              className="flex-1 sm:flex-none"
              onClick={() => setOpen("edit")}
            >
              <PencilIcon aria-hidden />
              Change
            </Button>
          )}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="icon" aria-label={`More for ${t.title}`}>
                <EllipsisVerticalIcon aria-hidden />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              {canCancel && (
                <DropdownMenuItem onSelect={() => setOpen("cancel")}>
                  <BanIcon aria-hidden />
                  Cancel the task
                </DropdownMenuItem>
              )}
              {can.delete && (
                <DropdownMenuItem variant="destructive" onSelect={() => setOpen("delete")}>
                  <Trash2Icon aria-hidden />
                  Delete
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {notice && <FormAlert tone="success">{notice}</FormAlert>}

      {open === "edit" && (
        <TaskDialog
          task={t}
          timeZone={timeZone}
          today={today}
          onClose={close}
          onDone={(message) => {
            setNotice(message);
            close();
          }}
        />
      )}
      {open === "cancel" && (
        <ConfirmDialog
          title="Cancel this task?"
          description={
            t.assignee
              ? `${t.assignee.name} hears that it is cancelled. It can be reopened later.`
              : "It stays on the list as cancelled and can be reopened later."
          }
          confirmLabel="Cancel the task"
          pendingLabel="Cancelling"
          destructive
          errorTitle="We could not cancel the task"
          onClose={close}
          onConfirm={async () => {
            const result = await setTaskStatusAction(t.id, { status: "CANCELLED" });
            if (!result.ok) return result.error;
            setNotice("The task is cancelled.");
            close();
          }}
        />
      )}
      {open === "delete" && (
        <ConfirmDialog
          title="Delete this task?"
          description="It is removed for good, with its reminders. Cancel it instead to keep it on record."
          confirmLabel="Delete the task"
          pendingLabel="Deleting"
          destructive
          errorTitle="We could not delete the task"
          onClose={close}
          onConfirm={async () => {
            const result = await deleteTaskAction(t.id);
            if (!result.ok) return result.error;
            router.push(plannerHref.tasks);
          }}
        />
      )}
      <ActionErrorDialog
        error={error}
        title="We could not change the task"
        onClose={() => setError(undefined)}
      />
    </div>
  );
}
