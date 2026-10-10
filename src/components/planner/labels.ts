import type {
  NoteTab,
  ReminderStatus,
  ReminderType,
  TaskPriority,
  TaskStatus,
} from "@prisma/client";

import { addDays } from "@/lib/dates";
import { formatDay, formatLongDay } from "@/lib/display";

/*
 * The words and addresses of the Planner, the inbox and the employee's tasks.
 */

export const TASK_STATUS_LABELS: Record<TaskStatus, string> = {
  TODO: "To do",
  IN_PROGRESS: "In progress",
  DONE: "Done",
  CANCELLED: "Cancelled",
};

export const PRIORITY_LABELS: Record<TaskPriority, string> = {
  LOW: "Low",
  MEDIUM: "Medium",
  HIGH: "High",
  URGENT: "Urgent",
};

export const PRIORITIES: readonly TaskPriority[] = ["LOW", "MEDIUM", "HIGH", "URGENT"];

/** The button that moves a task from `from` to `to`. */
export function moveLabel(from: TaskStatus, to: TaskStatus): string {
  switch (to) {
    case "IN_PROGRESS":
      return "Start";
    case "DONE":
      return "Mark as done";
    case "CANCELLED":
      return "Cancel the task";
    case "TODO":
      return from === "IN_PROGRESS" ? "Not started yet" : "Reopen";
  }
}

export const REMINDER_STATUS_LABELS: Record<ReminderStatus, string> = {
  SCHEDULED: "Scheduled",
  SENT: "Gone out",
  ACKNOWLEDGED: "Dealt with",
  CANCELLED: "Cancelled",
  FAILED: "Failed",
};

export const REMINDER_TYPE_LABELS: Record<ReminderType, string> = {
  PRODUCTION_DEADLINE: "Production deadline",
  GOODS_IN_HOUSE: "Goods in-house",
  SHIPMENT: "Shipment",
  COMPLIANCE_EXPIRY: "Licence renewal",
  TASK_DUE: "Task due",
  FACTORY_VISIT: "Factory visit",
  PAYMENT_DUE: "Payment due",
  INSTALLMENT_DUE: "Instalment due",
  CUSTOM: "Reminder",
};

/** What an agenda item is, as its small label. */
export const AGENDA_KIND_LABELS: Record<string, string> = {
  PRODUCTION_DEADLINE: "Deadline",
  GOODS_IN_HOUSE: "Goods due",
  SHIPMENT: "Shipment",
  COMPLIANCE_EXPIRY: "Renewal",
  TASK_DUE: "Task",
  REMINDER: "Reminder",
};

export const NOTE_TAB_LABELS: Record<NoteTab, string> = {
  DAILY_ROUTINE: "Daily routine",
  NEXT_3_DAYS: "Next 3 days",
  GENERAL: "General notes",
};

export const REPEAT_UNITS = ["DAY", "WEEK", "MONTH", "YEAR"] as const;
export type RepeatUnit = (typeof REPEAT_UNITS)[number];

export const REPEAT_LABELS: Record<RepeatUnit, string> = {
  DAY: "Every day",
  WEEK: "Every week",
  MONTH: "Every month",
  YEAR: "Every year",
};

/**
 * Who "the managers" are for each kind of automatic reminder: the holders of
 * the permissions in reminders/rules.ts RULE_INFO.
 */
export const RULE_MANAGER_WORDS: Record<string, string | null> = {
  PRODUCTION_DEADLINE: "People who manage production",
  GOODS_IN_HOUSE: "People who buy materials",
  SHIPMENT: "People who take sales orders",
  COMPLIANCE_EXPIRY: "People who see the licences",
  TASK_DUE: null,
};

/** "Today", "Tomorrow", "Yesterday" or "12 Oct 2026". */
export function dayWords(day: string, today: string): string {
  if (day === today) return "Today";
  if (day === addDays(today, 1)) return "Tomorrow";
  if (day === addDays(today, -1)) return "Yesterday";
  return formatDay(day);
}

/** A day's heading: "Today · Saturday, 10 October 2026" or "Monday, 12 October 2026". */
export function dayHeading(day: string, today: string): string {
  const words = dayWords(day, today);
  return words === formatDay(day) ? formatLongDay(day) : `${words} · ${formatLongDay(day)}`;
}

/** "12 Oct 2026 at 09:30", or the day alone. */
export function whenText(day: string | null, time: string | null): string {
  if (!day) return "";
  return time ? `${formatDay(day)} at ${time}` : formatDay(day);
}

/** "3 days late", "due today", "in 2 days". */
export function daysLeftText(daysLeft: number): string {
  if (daysLeft === 0) return "Today";
  if (daysLeft === 1) return "Tomorrow";
  if (daysLeft === -1) return "1 day late";
  if (daysLeft < 0) return `${-daysLeft} days late`;
  return `In ${daysLeft} days`;
}

/** When an automatic reminder went out against its date: "3 days before", "On the day", "2 days after". */
export function offsetText(offsetDays: number): string {
  if (offsetDays === 0) return "On the day";
  const n = Math.abs(offsetDays);
  return `${n} ${n === 1 ? "day" : "days"} ${offsetDays > 0 ? "before" : "after"}`;
}

/** "7, 3 and 1 days before and on the day". */
export function daysBeforeText(days: readonly number[]): string {
  if (days.length === 0) return "Only once the date has passed";
  const before = days.filter((d) => d > 0);
  const onTheDay = days.includes(0);
  const list =
    before.length === 0
      ? ""
      : before.length === 1
        ? `${before[0]} ${before[0] === 1 ? "day" : "days"} before`
        : `${before.slice(0, -1).join(", ")} and ${before.at(-1)} days before`;
  if (!list) return "On the day";
  return onTheDay ? `${list} and on the day` : list;
}

/** "Every 3 days while overdue". */
export function overdueText(everyDays: number): string {
  if (everyDays <= 0) return "Not again once overdue";
  if (everyDays === 1) return "Every day while overdue";
  return `Every ${everyDays} days while overdue`;
}

/** Reads "7, 3, 1, 0" into days; null when something is not a whole number 0–365. */
export function readDays(text: string): number[] | null {
  const parts = text
    .split(/[\s,]+/)
    .map((p) => p.trim())
    .filter(Boolean);
  const days = parts.map(Number);
  if (days.some((d) => !Number.isInteger(d) || d < 0 || d > 365)) return null;
  return [...new Set(days)].sort((a, b) => b - a);
}

const enc = encodeURIComponent;
const withQuery = (path: string, params: Record<string, string | undefined>) => {
  const query = new URLSearchParams(
    Object.entries(params).filter((e): e is [string, string] => Boolean(e[1])),
  ).toString();
  return query ? `${path}?${query}` : path;
};

export const plannerHref = {
  agenda: (days?: number) =>
    withQuery("/planner", { days: days && days !== 7 ? String(days) : undefined }),
  notepad: (tab?: NoteTab) =>
    withQuery("/planner/notepad", { tab: tab && tab !== "DAILY_ROUTINE" ? tab : undefined }),
  tasks: "/planner/tasks",
  task: (id: string) => `/planner/tasks/${enc(id)}`,
  employeeTasks: (employeeId: string) => withQuery("/planner/tasks", { assignee: employeeId }),
  reminders: "/planner/reminders",
  reminder: (id: string) => `/planner/reminders/${enc(id)}`,
  automatic: "/planner/automatic",
  inbox: "/inbox",
  myTasks: (show?: string) => withQuery("/me/tasks", { show: show !== "open" ? show : undefined }),
};
