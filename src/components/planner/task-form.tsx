"use client";

import type { TaskPriority } from "@prisma/client";
import { ClipboardPlusIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { Field } from "@/components/forms/field";
import { textOf } from "@/components/products/form-values";
import { FormDialog, problem } from "@/components/sales/dialogs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { atLocalTime } from "@/lib/dates";
import type { ProjectOption } from "@/modules/reminders/screens.service";
import type { TaskView } from "@/modules/reminders/task.service";
import { createTaskAction, updateTaskAction } from "@/server/actions/reminders.actions";

import { plannerHref, PRIORITIES, PRIORITY_LABELS } from "./labels";
import { type EmployeeChoice, EmployeePicker, ProjectPicker } from "./pickers";

/** The due day as the server takes it: a day, or the moment at that time in company time. */
function dueOf(day: string, time: string, timeZone: string): string | null {
  if (!day) return null;
  return time ? atLocalTime(day, time, timeZone).toISOString() : day;
}

/**
 * Gives a task to a member of staff (reminders.manage) or changes an open one:
 * what, who, by when (a day, or a day and time), how urgent, and the production
 * project it belongs to. The employee hears about it in the app through their
 * login and marks it started or done in My HR.
 */
export function TaskDialog({
  task,
  timeZone,
  today,
  onDone,
  onClose,
}: {
  task?: TaskView;
  timeZone: string;
  today: string;
  onDone: (message: string, id: string) => void;
  onClose: () => void;
}) {
  const [assignee, setAssignee] = useState<EmployeeChoice | null>(task?.assignee ?? null);
  const [project, setProject] = useState<ProjectOption | null>(task?.project ?? null);
  const editing = Boolean(task);

  return (
    <FormDialog
      title={editing ? "Change the task" : "Give a task"}
      description={
        editing
          ? "A new employee on it hears about it in the app."
          : "The employee hears about it in the app and marks it done in My HR."
      }
      submitLabel={editing ? "Save the task" : "Give the task"}
      pendingLabel="Saving"
      errorTitle="We could not save the task"
      onClose={onClose}
      onSubmit={async (form) => {
        const title = textOf(form, "title");
        if (title.length < 2) return problem({ title: "Write what needs doing." });
        const day = textOf(form, "dueDay");
        const time = textOf(form, "dueTime");
        if (time && !day) return problem({ dueAt: "Pick the day too." });
        const input = {
          title,
          description: textOf(form, "description") || null,
          assigneeId: assignee?.id ?? null,
          projectId: project?.id ?? null,
          dueAt: dueOf(day, time, timeZone),
          priority: (textOf(form, "priority") || "MEDIUM") as TaskPriority,
        };
        const result = task
          ? await updateTaskAction(task.id, input)
          : await createTaskAction(input);
        if (!result.ok) return result.error;
        onDone(
          editing
            ? "The task is saved."
            : `"${result.data.title}" is given${assignee ? ` to ${assignee.name}` : ""}.`,
          result.data.id,
        );
      }}
    >
      {(fieldError) => (
        <>
          <Field id="task-title" label="What needs doing" error={fieldError("title")}>
            <Input
              id="task-title"
              name="title"
              defaultValue={task?.title}
              maxLength={200}
              placeholder="Factory visit at Gazipur"
              autoComplete="off"
              aria-invalid={Boolean(fieldError("title"))}
              aria-describedby={fieldError("title") ? "task-title-error" : undefined}
            />
          </Field>
          <Field id="task-assignee" label="Given to (optional)" error={fieldError("assigneeId")}>
            <EmployeePicker
              id="task-assignee"
              value={assignee}
              onChange={setAssignee}
              invalid={Boolean(fieldError("assigneeId"))}
            />
          </Field>
          <div className="grid items-start gap-5 sm:grid-cols-2">
            <Field id="task-due-day" label="Due day (optional)" error={fieldError("dueAt")}>
              <Input
                id="task-due-day"
                name="dueDay"
                type="date"
                min={editing ? undefined : today}
                defaultValue={task?.dueDay ?? ""}
                aria-invalid={Boolean(fieldError("dueAt"))}
              />
            </Field>
            <Field id="task-due-time" label="Time (optional)">
              <Input
                id="task-due-time"
                name="dueTime"
                type="time"
                defaultValue={task?.dueTime ?? ""}
              />
            </Field>
          </div>
          <Field id="task-priority" label="Priority">
            <NativeSelect
              id="task-priority"
              name="priority"
              defaultValue={task?.priority ?? "MEDIUM"}
              containerClassName="sm:w-full"
            >
              {PRIORITIES.map((p) => (
                <option key={p} value={p}>
                  {PRIORITY_LABELS[p]}
                </option>
              ))}
            </NativeSelect>
          </Field>
          <Field id="task-project" label="Production project (optional)">
            <ProjectPicker id="task-project" value={project} onChange={setProject} />
          </Field>
          <Field id="task-description" label="Details (optional)" error={fieldError("description")}>
            <Textarea
              id="task-description"
              name="description"
              rows={3}
              maxLength={5000}
              defaultValue={task?.description ?? ""}
            />
          </Field>
        </>
      )}
    </FormDialog>
  );
}

/** "Give a task", opening the form; the new task's page opens once it is given. */
export function GiveTaskButton({
  timeZone,
  today,
  variant = "default",
  className,
}: {
  timeZone: string;
  today: string;
  variant?: "default" | "outline";
  className?: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button type="button" variant={variant} className={className} onClick={() => setOpen(true)}>
        <ClipboardPlusIcon aria-hidden />
        Give a task
      </Button>
      {open && (
        <TaskDialog
          timeZone={timeZone}
          today={today}
          onClose={() => setOpen(false)}
          onDone={(_message, id) => {
            setOpen(false);
            router.push(`${plannerHref.task(id)}?added=1`);
          }}
        />
      )}
    </>
  );
}
