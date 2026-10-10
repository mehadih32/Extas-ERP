"use client";

import { SearchIcon, XIcon } from "lucide-react";
import { usePathname, useRouter } from "next/navigation";
import { useOptimistic, useTransition } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { cn } from "@/lib/utils";

import {
  isReminderFiltered,
  isTaskFiltered,
  REMINDER_KIND_LABELS,
  REMINDER_KINDS,
  REMINDER_SHOW_LABELS,
  REMINDER_SHOWS,
  type ReminderKind,
  reminderListSearch,
  type ReminderListView,
  type ReminderShow,
  TASK_SHOW_LABELS,
  TASK_SHOWS,
  taskListSearch,
  type TaskListView,
  type TaskShow,
} from "./list-view";

/** Changes the address bar's filters; the old list stays, dimmed, until the new one comes. */
function useFilters<V>(view: V, search: (view: V) => string) {
  const router = useRouter();
  const pathname = usePathname();
  const [pending, startTransition] = useTransition();
  const [shown, setShown] = useOptimistic(view);
  function show(next: V) {
    startTransition(() => {
      setShown(next);
      router.replace(`${pathname}${search(next)}`, { scroll: false });
    });
  }
  return { shown, show, pending };
}

function Results({ pending, children }: { pending: boolean; children: React.ReactNode }) {
  return (
    <div
      aria-busy={pending}
      className={cn(
        "grid grid-cols-1 gap-5 transition-opacity",
        pending && "pointer-events-none opacity-50",
      )}
    >
      {children}
    </div>
  );
}

function Check({
  checked,
  onChange,
  children,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  children: React.ReactNode;
}) {
  return (
    <label className="flex h-11 cursor-pointer items-center gap-2 text-sm md:h-9">
      <input
        type="checkbox"
        className="size-4 cursor-pointer accent-primary"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
      />
      {children}
    </label>
  );
}

/**
 * The task list's filters: which tasks (open, overdue, done...), a search,
 * and "Only tasks I gave". A list opened for one employee names them.
 */
export function TaskFilters({
  view,
  named,
  children,
}: {
  view: TaskListView;
  /** The employee the list is narrowed to: "Tasks of Sabbir Ahmed". */
  named?: string | null;
  children: React.ReactNode;
}) {
  const { shown, show, pending } = useFilters(view, taskListSearch);

  function search(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const value = new FormData(event.currentTarget).get("q");
    show({ ...shown, q: typeof value === "string" && value.trim() ? value.trim() : undefined });
  }

  return (
    <div className="grid min-w-0 grid-cols-1 content-start gap-5">
      <div className="grid gap-3 lg:flex lg:flex-wrap lg:items-center">
        <form role="search" onSubmit={search} className="relative w-full lg:max-w-xs">
          <SearchIcon
            aria-hidden
            className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
          />
          <Input
            key={shown.q}
            type="search"
            name="q"
            defaultValue={shown.q}
            enterKeyHint="search"
            autoComplete="off"
            placeholder="Search tasks"
            aria-label="Search tasks"
            className="pl-9"
          />
        </form>
        <div className="grid grid-cols-1 gap-2 sm:w-60">
          <label className="sr-only" htmlFor="task-show">
            Which tasks
          </label>
          <NativeSelect
            id="task-show"
            value={shown.show}
            onChange={(e) => show({ ...shown, show: e.target.value as TaskShow })}
          >
            {TASK_SHOWS.map((s) => (
              <option key={s} value={s}>
                {TASK_SHOW_LABELS[s]}
              </option>
            ))}
          </NativeSelect>
        </div>
        <Check
          checked={Boolean(shown.mine)}
          onChange={(checked) => show({ ...shown, mine: checked || undefined })}
        >
          Only tasks I gave
        </Check>
        {named && <p className="min-w-0 text-sm break-words text-muted-foreground">{named}</p>}
        {isTaskFiltered(shown) && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="justify-self-start lg:ml-auto"
            onClick={() => show({ show: "open" })}
          >
            <XIcon aria-hidden />
            Clear filters
          </Button>
        )}
      </div>
      <Results pending={pending}>{children}</Results>
    </div>
  );
}

/**
 * The reminder list's filters: which reminders (still to go out, gone out...),
 * set by hand or automatic, and, for reminders.manage, everyone's.
 */
export function ReminderFilters({
  view,
  everyone,
  children,
}: {
  view: ReminderListView;
  /** May see everyone's reminders (reminders.manage). */
  everyone: boolean;
  children: React.ReactNode;
}) {
  const { shown, show, pending } = useFilters(view, reminderListSearch);

  return (
    <div className="grid min-w-0 grid-cols-1 content-start gap-5">
      <div className="grid gap-3 lg:flex lg:flex-wrap lg:items-center">
        <div className="grid grid-cols-2 gap-2 md:flex md:items-center md:gap-3">
          <div className="min-w-0">
            <label className="sr-only" htmlFor="reminder-show">
              Which reminders
            </label>
            <NativeSelect
              id="reminder-show"
              value={shown.show}
              onChange={(e) => show({ ...shown, show: e.target.value as ReminderShow })}
            >
              {REMINDER_SHOWS.map((s) => (
                <option key={s} value={s}>
                  {REMINDER_SHOW_LABELS[s]}
                </option>
              ))}
            </NativeSelect>
          </div>
          <div className="min-w-0">
            <label className="sr-only" htmlFor="reminder-kind">
              Set by hand or automatic
            </label>
            <NativeSelect
              id="reminder-kind"
              value={shown.kind ?? ""}
              onChange={(e) =>
                show({ ...shown, kind: (e.target.value || undefined) as ReminderKind | undefined })
              }
            >
              <option value="">Any kind</option>
              {REMINDER_KINDS.map((k) => (
                <option key={k} value={k}>
                  {REMINDER_KIND_LABELS[k]}
                </option>
              ))}
            </NativeSelect>
          </div>
        </div>
        {everyone && (
          <Check
            checked={Boolean(shown.everyone)}
            onChange={(checked) => show({ ...shown, everyone: checked || undefined })}
          >
            Everyone&apos;s reminders
          </Check>
        )}
        {isReminderFiltered(shown) && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="justify-self-start lg:ml-auto"
            onClick={() => show({ show: "all" })}
          >
            <XIcon aria-hidden />
            Clear filters
          </Button>
        )}
      </div>
      <Results pending={pending}>{children}</Results>
    </div>
  );
}
