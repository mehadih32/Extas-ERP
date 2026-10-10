import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { SectionError } from "@/components/dashboard/section-error";
import { KindBadge, ReminderBadge } from "@/components/planner/badges";
import {
  offsetText,
  plannerHref,
  REMINDER_TYPE_LABELS,
  whenText,
} from "@/components/planner/labels";
import { ReminderActions } from "@/components/planner/reminder-actions";
import { Fact, Panel, RecordHeader } from "@/components/sales/detail-bits";
import { BackLink } from "@/components/settings/back-link";
import { formatDay } from "@/lib/display";
import { localDay } from "@/lib/dates";
import { formatInstantDay } from "@/lib/format";
import { getReminderScreenAction } from "@/server/actions/reminders.actions";
import { requireCompanyPage } from "@/server/pages/guards";

export const metadata: Metadata = { title: "Reminder" };

const linkClass = "text-primary underline-offset-4 hover:underline";

/**
 * One reminder a person set or is on (any reminder for reminders.manage): when
 * it goes out, whether it repeats, who hears about it, what it is about, and
 * what may be done with it.
 */
export default async function ReminderPage({
  params,
  searchParams,
}: {
  params: Promise<{ reminderId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const ctx = await requireCompanyPage();
  const { reminderId } = await params;
  const { added } = await searchParams;
  const result = await getReminderScreenAction(reminderId);
  if (!result.ok) {
    if (result.error.code === "NOT_FOUND") notFound();
    return (
      <SectionError title="Reminder" heading="The reminder could not load" error={result.error} />
    );
  }
  const screen = result.data;
  const { reminder: r, about } = screen;
  const tz = ctx.company.timezone;
  const today = localDay(new Date(), tz);
  const me = { id: ctx.user.id, name: ctx.user.name };
  const waiting = r.recipients.filter((p) => !p.inApp).map((p) => p.name ?? "Someone");
  const goesOut = r.status === "SCHEDULED";

  return (
    <div className="grid grid-cols-1 gap-6">
      <BackLink href={plannerHref.reminders}>All reminders</BackLink>
      <RecordHeader
        eyebrow={r.automatic ? `Automatic reminder · ${REMINDER_TYPE_LABELS[r.type]}` : "Reminder"}
        title={r.title}
        badges={
          <>
            <ReminderBadge status={r.status} awaits={screen.can.acknowledge} />
            {r.repeat && <KindBadge>Repeats</KindBadge>}
          </>
        }
      />
      <ReminderActions
        key={r.id}
        screen={screen}
        me={me}
        today={today}
        notice={
          added === "1"
            ? `Added. It goes out on ${whenText(r.day, r.time)}.${
                waiting.length > 0
                  ? ` ${waiting.join(" and ")} ${waiting.length === 1 ? "has" : "have"} no login yet, so they hear about it once WhatsApp is set up.`
                  : ""
              }`
            : undefined
        }
      />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)]">
        <Panel title="Details" id="reminder-details-heading">
          <dl className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Fact label={goesOut ? (r.sentAt ? "Goes out next" : "Goes out") : "Went out"}>
              {goesOut || !r.sentAt ? whenText(r.day, r.time) : formatInstantDay(r.sentAt, tz)}
            </Fact>
            <Fact label="Repeats">{r.repeat ? r.repeat.description : "No"}</Fact>
            {r.automatic && r.dueDate && (
              <Fact label="The date it is about">
                {formatDay(r.dueDate)}
                {r.offsetDays !== null && (
                  <span className="block text-[0.8125rem] text-muted-foreground">
                    Sent {offsetText(r.offsetDays).toLowerCase()}
                  </span>
                )}
              </Fact>
            )}
            <Fact label="Set by">
              {r.automatic
                ? "The app, from the automatic reminder settings"
                : (r.createdBy?.name ?? "Someone who has left")}
            </Fact>
            {r.acknowledgedAt && (
              <Fact label="Dealt with">
                {r.acknowledgedBy?.name ?? "Someone"} on {formatInstantDay(r.acknowledgedAt, tz)}
              </Fact>
            )}
          </dl>
          {r.message && (
            <p className="mt-5 border-t pt-4 text-sm leading-relaxed whitespace-pre-wrap">
              {r.message}
            </p>
          )}
        </Panel>

        <div className="grid content-start gap-6">
          <Panel title="Who hears about it" id="reminder-people-heading">
            <ul className="mt-4 grid gap-2.5 text-sm" aria-label="Who hears about it">
              {r.recipients.map((p, index) => (
                <li key={`${p.kind}-${p.id ?? index}`}>
                  {p.kind === "user" && p.id === me.id
                    ? `${p.name ?? me.name} (you)`
                    : (p.name ?? "Someone who has left")}
                  {!p.inApp && (
                    <span className="block text-[0.8125rem] text-muted-foreground">
                      No login yet, told once WhatsApp is set up
                    </span>
                  )}
                </li>
              ))}
            </ul>
            <p className="mt-4 text-[0.8125rem] text-muted-foreground">
              Reminders go out in the app. WhatsApp and email come later.
            </p>
          </Panel>

          {about.length > 0 && (
            <Panel title="About" id="reminder-about-heading">
              <ul className="mt-4 grid gap-2.5 text-sm" aria-label="What it is about">
                {about.map((a) => (
                  <li key={a.label}>
                    {a.href ? (
                      <Link href={a.href} className={linkClass}>
                        {a.label}
                      </Link>
                    ) : (
                      a.label
                    )}
                  </li>
                ))}
              </ul>
            </Panel>
          )}
        </div>
      </div>
    </div>
  );
}
