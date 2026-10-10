"use client";

import { BellIcon, CheckCheckIcon, CheckIcon, ExternalLinkIcon } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { ActionErrorDialog } from "@/components/feedback/action-error-dialog";
import { ShowMore, useLoadMore } from "@/components/sales/load-more";
import { Button } from "@/components/ui/button";
import type { ActionError } from "@/lib/result";
import { cn } from "@/lib/utils";
import type { InboxRow } from "@/modules/reminders/screens.service";
import {
  acknowledgeReminderAction,
  listInboxRowsAction,
  markAllNotificationsReadAction,
  markNotificationReadAction,
} from "@/server/actions/reminders.actions";

import { dayWords, plannerHref } from "./labels";
import { PLANNER_PAGE_SIZE } from "./list-view";

/** The bell in the top bar: the inbox, with how many messages are unread. */
export function InboxBell({ unread }: { unread: number }) {
  const label = unread > 0 ? `Inbox, ${unread} unread` : "Inbox";
  return (
    <Link
      href={plannerHref.inbox}
      aria-label={label}
      title={label}
      className="relative inline-flex size-9 shrink-0 items-center justify-center rounded-md text-primary-foreground transition-colors outline-none hover:bg-primary-foreground/10 focus-visible:ring-[3px] focus-visible:ring-primary-foreground/30"
    >
      <BellIcon aria-hidden className="size-5" />
      {unread > 0 && (
        <span
          aria-hidden
          className="absolute -top-0.5 -right-0.5 inline-flex h-4.5 min-w-4.5 items-center justify-center rounded-full bg-destructive px-1 text-[0.6875rem] leading-none font-semibold text-destructive-foreground tabular-nums ring-2 ring-primary"
        >
          {unread > 99 ? "99+" : unread}
        </span>
      )}
    </Link>
  );
}

const OPEN_WORDS: Record<string, string> = {
  Task: "Open the task",
  Reminder: "Open the reminder",
  ProductionProject: "Open the project",
  SalesOrder: "Open the order",
  PurchaseOrder: "Open the purchase order",
  ComplianceDocument: "Open the licence",
};

/**
 * The person's messages, newest first: each can be opened (marking it read),
 * marked read, or, when it came from a reminder still waiting, marked as dealt
 * with. Unread ones stand out.
 */
export function InboxList({
  initial,
  unreadOnly,
  unread,
  today,
}: {
  initial: { items: InboxRow[]; nextCursor?: string };
  unreadOnly: boolean;
  unread: number;
  today: string;
}) {
  const router = useRouter();
  const list = useLoadMore(initial, (cursor) =>
    listInboxRowsAction({
      ...(unreadOnly ? { unread: true } : {}),
      cursor,
      take: PLANNER_PAGE_SIZE,
    }),
  );
  const [read, setRead] = useState<Set<string>>(() => new Set());
  const [dealt, setDealt] = useState<Set<string>>(() => new Set());
  const [allRead, setAllRead] = useState(false);
  const [error, setError] = useState<ActionError>();
  const [pending, startTransition] = useTransition();
  const isRead = (m: InboxRow) => allRead || m.read || read.has(m.id);
  const isDealt = (m: InboxRow) => m.dealtWith || (m.reminderId ? dealt.has(m.reminderId) : false);
  const anyUnread = !allRead && unread > read.size;

  function markRead(m: InboxRow, then?: () => void) {
    if (isRead(m)) {
      then?.();
      return;
    }
    startTransition(async () => {
      const result = await markNotificationReadAction(m.id);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setRead((s) => new Set(s).add(m.id));
      then?.();
    });
  }

  function dealWith(m: InboxRow) {
    if (!m.reminderId) return;
    const reminderId = m.reminderId;
    startTransition(async () => {
      const result = await acknowledgeReminderAction(reminderId);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setDealt((s) => new Set(s).add(reminderId));
      // Dealing with a reminder marks your messages about it read.
      setRead((s) => {
        const next = new Set(s);
        list.items.filter((x) => x.reminderId === reminderId).forEach((x) => next.add(x.id));
        return next;
      });
    });
  }

  function markAll() {
    startTransition(async () => {
      const result = await markAllNotificationsReadAction();
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setAllRead(true);
    });
  }

  return (
    <div className="grid grid-cols-1 gap-5">
      {anyUnread && (
        <div>
          <Button
            type="button"
            variant="outline"
            className="w-full sm:w-auto"
            disabled={pending}
            onClick={markAll}
          >
            <CheckCheckIcon aria-hidden />
            Mark all as read
          </Button>
        </div>
      )}
      <ul className="grid gap-3" aria-label="Messages">
        {list.items.map((m) => {
          const unreadNow = !isRead(m);
          const waiting = Boolean(m.reminderId) && !isDealt(m);
          return (
            <li
              key={m.id}
              className={cn(
                "grid gap-3 rounded-lg border bg-card p-4 sm:p-5",
                unreadNow && "border-primary/40 bg-secondary/40",
              )}
            >
              <div className="flex items-start gap-3">
                <span
                  aria-hidden
                  className={cn(
                    "mt-1.5 size-2 shrink-0 rounded-full",
                    unreadNow ? "bg-primary" : "bg-transparent",
                  )}
                />
                <div className="min-w-0 flex-1">
                  <p className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                    <span className={cn("text-sm break-words", unreadNow && "font-medium")}>
                      {unreadNow && <span className="sr-only">Unread: </span>}
                      {m.subject}
                    </span>
                    <span className="shrink-0 text-[0.8125rem] text-muted-foreground">
                      {dayWords(m.day, today)}, {m.time}
                    </span>
                  </p>
                  {m.body && m.body !== m.subject && (
                    <p className="mt-1 text-[0.8125rem] leading-relaxed break-words whitespace-pre-line text-muted-foreground">
                      {m.body}
                    </p>
                  )}
                </div>
              </div>
              {(m.href || waiting || unreadNow) && (
                <div className="flex flex-col gap-2 pl-5 sm:flex-row sm:flex-wrap">
                  {waiting && (
                    <Button
                      type="button"
                      size="sm"
                      className="h-10 sm:h-8"
                      disabled={pending}
                      onClick={() => dealWith(m)}
                    >
                      <CheckIcon aria-hidden />
                      Dealt with
                    </Button>
                  )}
                  {m.href && (
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className="h-10 sm:h-8"
                      disabled={pending}
                      onClick={() => markRead(m, () => router.push(m.href!))}
                    >
                      <ExternalLinkIcon aria-hidden />
                      {OPEN_WORDS[m.link?.type ?? ""] ?? "Open"}
                    </Button>
                  )}
                  {unreadNow && (
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      className="h-10 sm:h-8"
                      disabled={pending}
                      onClick={() => markRead(m)}
                    >
                      Mark as read
                    </Button>
                  )}
                </div>
              )}
            </li>
          );
        })}
      </ul>
      <ShowMore list={list} noun={unreadOnly ? "unread messages" : "messages"} />
      <ActionErrorDialog
        error={error}
        title="We could not update the message"
        onClose={() => setError(undefined)}
      />
    </div>
  );
}
