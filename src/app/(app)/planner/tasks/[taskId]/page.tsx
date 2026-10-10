import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { SectionError } from "@/components/dashboard/section-error";
import { KindBadge, PriorityBadge, ReminderBadge, TaskBadge } from "@/components/planner/badges";
import {
  plannerHref,
  PRIORITY_LABELS,
  REMINDER_STATUS_LABELS,
  whenText,
} from "@/components/planner/labels";
import { TasksNoAccess } from "@/components/planner/no-access";
import { TaskActions } from "@/components/planner/task-actions";
import { Fact, Panel, RecordHeader } from "@/components/sales/detail-bits";
import { BackLink } from "@/components/settings/back-link";
import { localDay } from "@/lib/dates";
import { formatInstantDay } from "@/lib/format";
import { getTaskScreenAction } from "@/server/actions/reminders.actions";
import { requireCompanyPage } from "@/server/pages/guards";

export const metadata: Metadata = { title: "Task" };

const linkClass = "text-primary underline-offset-4 hover:underline";

/**
 * One task (reminders.manage): what, who, by when, how urgent, the project it
 * belongs to, the reminders sent about it, and what may be done with it.
 */
export default async function TaskPage({
  params,
  searchParams,
}: {
  params: Promise<{ taskId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const ctx = await requireCompanyPage();
  const { taskId } = await params;
  const { added } = await searchParams;
  const result = await getTaskScreenAction(taskId);
  if (!result.ok) {
    if (result.error.code === "NOT_FOUND") notFound();
    if (result.error.code === "FORBIDDEN") return <TasksNoAccess />;
    return <SectionError title="Task" heading="The task could not load" error={result.error} />;
  }
  const screen = result.data;
  const { task: t, reminders, links } = screen;
  const tz = ctx.company.timezone;
  const today = localDay(new Date(), tz);

  return (
    <div className="grid grid-cols-1 gap-6">
      <BackLink href={plannerHref.tasks}>All tasks</BackLink>
      <RecordHeader
        eyebrow="Task"
        title={t.title}
        badges={
          <>
            <TaskBadge status={t.status} />
            {t.overdue && <TaskBadge status={t.status} overdue />}
            <PriorityBadge priority={t.priority} />
          </>
        }
      />
      <TaskActions
        key={t.id}
        screen={screen}
        timeZone={tz}
        today={today}
        notice={
          added === "1"
            ? t.assignee
              ? t.assignee.hasLogin
                ? `${t.assignee.name} has been told in the app.`
                : `${t.assignee.name} has no login yet, so they hear about it once WhatsApp is set up.`
              : "The task is saved. Give it to someone with Change."
            : undefined
        }
      />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)]">
        <Panel title="Details" id="task-details-heading">
          <dl className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Fact label="For">
              {t.assignee ? (
                <>
                  {links.assignee ? (
                    <Link href={links.assignee} className={linkClass}>
                      {t.assignee.name}
                    </Link>
                  ) : (
                    t.assignee.name
                  )}
                  <span className="block text-[0.8125rem] text-muted-foreground">
                    {t.assignee.code}
                    {!t.assignee.hasLogin && " · no login yet, told once WhatsApp is set up"}
                  </span>
                </>
              ) : (
                "Nobody yet"
              )}
            </Fact>
            <Fact label="Due">{t.dueDay ? whenText(t.dueDay, t.dueTime) : "No due day"}</Fact>
            <Fact label="Priority">{PRIORITY_LABELS[t.priority]}</Fact>
            <Fact label="Production project">
              {t.project ? (
                links.project ? (
                  <Link href={links.project} className={linkClass}>
                    {t.project.code} {t.project.name}
                  </Link>
                ) : (
                  `${t.project.code} ${t.project.name}`
                )
              ) : (
                "None"
              )}
            </Fact>
            <Fact label="Given by">
              {t.createdBy?.name ?? "Someone who has left"} on {formatInstantDay(t.createdAt, tz)}
            </Fact>
            {t.completedAt && <Fact label="Done on">{formatInstantDay(t.completedAt, tz)}</Fact>}
          </dl>
          {t.description && (
            <p className="mt-5 border-t pt-4 text-sm leading-relaxed whitespace-pre-wrap">
              {t.description}
            </p>
          )}
        </Panel>

        <Panel title="Reminders about it" id="task-reminders-heading">
          {reminders.length === 0 ? (
            <p className="mt-3 text-sm text-muted-foreground">
              {t.dueDay
                ? "None yet. The app reminds the employee and whoever gave it as the due day comes near, as set in Automatic reminders."
                : "Give it a due day and the app reminds the employee before it."}
            </p>
          ) : (
            <ul className="mt-4 grid divide-y" aria-label="Reminders about this task">
              {reminders.map((r) => (
                <li
                  key={r.id}
                  className="flex items-start justify-between gap-3 py-2.5 first:pt-0 last:pb-0"
                >
                  <span className="min-w-0">
                    <Link href={plannerHref.reminder(r.id)} className={`text-sm ${linkClass}`}>
                      {r.title}
                    </Link>
                    <span className="block text-[0.8125rem] text-muted-foreground">
                      {whenText(r.day, r.time)}
                      {r.automatic ? " · automatic" : ""}
                    </span>
                  </span>
                  <span className="flex shrink-0 gap-1.5">
                    {r.status === "SENT" ? (
                      <KindBadge>{REMINDER_STATUS_LABELS.SENT}</KindBadge>
                    ) : (
                      <ReminderBadge status={r.status} />
                    )}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>
    </div>
  );
}
