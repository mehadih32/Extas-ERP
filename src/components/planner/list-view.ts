/*
 * The Planner lists' filters as they appear in the address bar, so a filtered
 * list can be shared or reloaded, and the queries they make.
 */

type SearchParams = Record<string, string | string[] | undefined>;

export const PLANNER_PAGE_SIZE = 30;

const first = (value: string | string[] | undefined) =>
  (Array.isArray(value) ? value[0] : value)?.trim() || undefined;

function searchOf(entries: Record<string, string | undefined>): string {
  const query = new URLSearchParams(
    Object.entries(entries).filter((e): e is [string, string] => Boolean(e[1])),
  ).toString();
  return query ? `?${query}` : "";
}

// --- Tasks -------------------------------------------------------------------------------

export const TASK_SHOWS = ["open", "overdue", "done", "cancelled", "all"] as const;
export type TaskShow = (typeof TASK_SHOWS)[number];

export const TASK_SHOW_LABELS: Record<TaskShow, string> = {
  open: "Open tasks",
  overdue: "Overdue",
  done: "Done",
  cancelled: "Cancelled",
  all: "Every task",
};

export type TaskListView = {
  show: TaskShow;
  /** One employee's tasks. */
  assignee?: string;
  /** Only tasks I gave. */
  mine?: boolean;
  q?: string;
};

export function taskViewFrom(params: SearchParams): TaskListView {
  const show = TASK_SHOWS.find((s) => s === first(params.show)) ?? "open";
  const q = first(params.q)?.slice(0, 100);
  return {
    show,
    ...(first(params.assignee) ? { assignee: first(params.assignee) } : {}),
    ...(first(params.mine) === "1" ? { mine: true } : {}),
    ...(q ? { q } : {}),
  };
}

export function taskListSearch(view: TaskListView): string {
  return searchOf({
    show: view.show === "open" ? undefined : view.show,
    assignee: view.assignee,
    mine: view.mine ? "1" : undefined,
    q: view.q,
  });
}

export const isTaskFiltered = (view: TaskListView) =>
  view.show !== "open" || Boolean(view.assignee || view.mine || view.q);

export function taskListQuery(view: TaskListView, cursor?: string) {
  const status =
    view.show === "open"
      ? { open: true }
      : view.show === "overdue"
        ? { overdue: true }
        : view.show === "done"
          ? { status: "DONE" }
          : view.show === "cancelled"
            ? { status: "CANCELLED" }
            : {};
  return {
    ...status,
    ...(view.assignee ? { assigneeId: view.assignee } : {}),
    ...(view.mine ? { mine: true } : {}),
    ...(view.q ? { search: view.q } : {}),
    ...(cursor ? { cursor } : {}),
    take: PLANNER_PAGE_SIZE,
  };
}

// --- Reminders ---------------------------------------------------------------------------

export const REMINDER_SHOWS = ["all", "scheduled", "sent", "dealt", "cancelled"] as const;
export type ReminderShow = (typeof REMINDER_SHOWS)[number];

export const REMINDER_SHOW_LABELS: Record<ReminderShow, string> = {
  all: "Every reminder",
  scheduled: "Still to go out",
  sent: "Gone out",
  dealt: "Dealt with",
  cancelled: "Cancelled",
};

const SHOW_STATUS: Record<ReminderShow, string | undefined> = {
  all: undefined,
  scheduled: "SCHEDULED",
  sent: "SENT",
  dealt: "ACKNOWLEDGED",
  cancelled: "CANCELLED",
};

export const REMINDER_KINDS = ["manual", "automatic"] as const;
export type ReminderKind = (typeof REMINDER_KINDS)[number];

export const REMINDER_KIND_LABELS: Record<ReminderKind, string> = {
  manual: "Set by hand",
  automatic: "Automatic",
};

export type ReminderListView = {
  show: ReminderShow;
  kind?: ReminderKind;
  /** Everyone's reminders (reminders.manage). */
  everyone?: boolean;
};

export function reminderViewFrom(params: SearchParams): ReminderListView {
  const show = REMINDER_SHOWS.find((s) => s === first(params.show)) ?? "all";
  const kind = REMINDER_KINDS.find((k) => k === first(params.kind));
  return {
    show,
    ...(kind ? { kind } : {}),
    ...(first(params.everyone) === "1" ? { everyone: true } : {}),
  };
}

export function reminderListSearch(view: ReminderListView): string {
  return searchOf({
    show: view.show === "all" ? undefined : view.show,
    kind: view.kind,
    everyone: view.everyone ? "1" : undefined,
  });
}

export const isReminderFiltered = (view: ReminderListView) =>
  view.show !== "all" || Boolean(view.kind || view.everyone);

export function reminderListQuery(view: ReminderListView, cursor?: string) {
  const status = SHOW_STATUS[view.show];
  return {
    ...(status ? { status } : {}),
    ...(view.kind ? { automatic: view.kind === "automatic" } : {}),
    ...(view.everyone ? { all: true } : {}),
    ...(cursor ? { cursor } : {}),
    take: PLANNER_PAGE_SIZE,
  };
}
