import { ChevronRightIcon } from "lucide-react";
import Link from "next/link";

import type { AgendaRow } from "@/modules/reminders/screens.service";

import { KindBadge } from "./badges";
import { AGENDA_KIND_LABELS, daysLeftText, dayWords } from "./labels";

/**
 * One thing coming up (a deadline, goods due, a shipment, a renewal, a task or
 * a reminder): what it is, when, and the page it opens where this person's
 * role opens it.
 */
function AgendaItem({ item, today }: { item: AgendaRow; today: string }) {
  const when = item.overdue
    ? `${daysLeftText(item.daysLeft)}${item.date ? ` · was due ${dayWords(item.date, today)}` : ""}`
    : item.time;
  const body = (
    <>
      <span className="min-w-0 flex-1">
        <span className="flex flex-wrap items-center gap-1.5">
          <KindBadge>{AGENDA_KIND_LABELS[item.kind] ?? "Reminder"}</KindBadge>
          {when && (
            <span
              className={
                item.overdue
                  ? "text-[0.8125rem] text-destructive"
                  : "text-[0.8125rem] text-muted-foreground"
              }
            >
              {when}
            </span>
          )}
        </span>
        <span className="mt-1 block text-sm font-medium break-words">{item.title}</span>
        {item.detail && (
          <span className="mt-0.5 line-clamp-2 block text-[0.8125rem] break-words text-muted-foreground">
            {item.detail}
          </span>
        )}
      </span>
      {item.href && (
        <ChevronRightIcon aria-hidden className="mt-1 size-4 shrink-0 text-muted-foreground" />
      )}
    </>
  );
  return (
    <li>
      {item.href ? (
        <Link
          href={item.href}
          className="flex items-start gap-3 rounded-md px-3 py-3 transition-colors outline-none hover:bg-muted/60 focus-visible:ring-[3px] focus-visible:ring-ring/25"
        >
          {body}
        </Link>
      ) : (
        <div className="flex items-start gap-3 px-3 py-3">{body}</div>
      )}
    </li>
  );
}

/** A list of agenda items under a heading. */
export function AgendaGroup({
  id,
  title,
  items,
  today,
  tone = "plain",
}: {
  id: string;
  title: string;
  items: AgendaRow[];
  today: string;
  tone?: "plain" | "warn";
}) {
  return (
    <section
      aria-labelledby={id}
      className={
        tone === "warn"
          ? "rounded-lg border border-destructive/30 bg-card p-2"
          : "rounded-lg border bg-card p-2"
      }
    >
      <h3
        id={id}
        className={
          tone === "warn"
            ? "px-3 pt-2 pb-1 text-sm font-medium text-destructive"
            : "px-3 pt-2 pb-1 text-sm font-medium text-primary"
        }
      >
        {title}
      </h3>
      <ul className="grid divide-y">
        {items.map((item) => (
          <AgendaItem
            key={`${item.kind}-${item.link.type}-${item.link.id}-${item.date}`}
            item={item}
            today={today}
          />
        ))}
      </ul>
    </section>
  );
}
