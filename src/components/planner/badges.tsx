import type { ReminderStatus, TaskPriority, TaskStatus } from "@prisma/client";

import { StatusBadge, type Tone } from "@/components/sales/badges";

import { PRIORITY_LABELS, REMINDER_STATUS_LABELS, TASK_STATUS_LABELS } from "./labels";

const TASK_TONES: Record<TaskStatus, Tone> = {
  TODO: "open",
  IN_PROGRESS: "open",
  DONE: "done",
  CANCELLED: "closed",
};

export function TaskBadge({ status, overdue = false }: { status: TaskStatus; overdue?: boolean }) {
  if (overdue) return <StatusBadge tone="warn">Overdue</StatusBadge>;
  return <StatusBadge tone={TASK_TONES[status]}>{TASK_STATUS_LABELS[status]}</StatusBadge>;
}

/** Only high and urgent work is flagged; low and medium go without a label. */
export function PriorityBadge({ priority }: { priority: TaskPriority }) {
  if (priority !== "HIGH" && priority !== "URGENT") return null;
  return (
    <StatusBadge tone={priority === "URGENT" ? "warn" : "plain"}>
      {PRIORITY_LABELS[priority]}
    </StatusBadge>
  );
}

const REMINDER_TONES: Record<ReminderStatus, Tone> = {
  SCHEDULED: "open",
  SENT: "warn",
  ACKNOWLEDGED: "done",
  CANCELLED: "closed",
  FAILED: "warn",
};

/** Gone out and waiting to be dealt with shows as needing attention. */
export function ReminderBadge({ status, awaits }: { status: ReminderStatus; awaits?: boolean }) {
  if (awaits && status === "SCHEDULED") return <StatusBadge tone="warn">To deal with</StatusBadge>;
  return (
    <StatusBadge tone={status === "SENT" && awaits === false ? "plain" : REMINDER_TONES[status]}>
      {REMINDER_STATUS_LABELS[status]}
    </StatusBadge>
  );
}

export function KindBadge({ children }: { children: React.ReactNode }) {
  return <StatusBadge tone="plain">{children}</StatusBadge>;
}
