"use client";

import { PinIcon } from "lucide-react";
import { useEffect, useRef } from "react";

import { formatDay } from "@/lib/display";
import type { MyNotices, NoticeView } from "@/modules/hr/notice.service";
import { markMyNoticesReadAction } from "@/server/actions/portal.actions";

import { FlagBadge } from "./badges";
import { postedText } from "./notice-labels";

const smallText = "text-[0.8125rem] text-muted-foreground";

/** A notice as staff read it: pinned or new, the title, who posted it and the text. */
export function NoticeText({
  notice: n,
  timeZone,
  isNew = false,
  badges,
}: {
  notice: NoticeView;
  timeZone: string;
  isNew?: boolean;
  badges?: React.ReactNode;
}) {
  return (
    <div className="grid min-w-0 gap-2">
      {(n.pinned || isNew || badges) && (
        <div className="flex flex-wrap items-center gap-1.5">
          {n.pinned && (
            <FlagBadge tone="open">
              <PinIcon className="size-3" aria-hidden />
              Pinned
            </FlagBadge>
          )}
          {isNew && <FlagBadge tone="warn">New</FlagBadge>}
          {badges}
        </div>
      )}
      <h3 className="font-medium break-words text-primary">{n.title}</h3>
      <p className={smallText}>
        {postedText(n, timeZone)}
        {n.showUntil && ` · Shown until ${formatDay(n.showUntil)}`}
      </p>
      <p className="text-sm leading-relaxed break-words whitespace-pre-wrap">{n.body}</p>
    </div>
  );
}

/**
 * The notice board in My HR: the notices up now, pinned first, the ones new
 * to this person marked "New". Opening the board counts as reading them (HR
 * sees when); they stay marked "New" until the page is opened again.
 */
export function MyNoticeBoard({
  items,
  timeZone,
}: {
  items: MyNotices["items"];
  timeZone: string;
}) {
  const sent = useRef(false);
  useEffect(() => {
    if (sent.current) return;
    sent.current = true;
    const unread = items.filter((n) => n.readAt === null).map((n) => n.id);
    if (unread.length > 0) void markMyNoticesReadAction(unread).catch(() => {});
  }, [items]);

  return (
    <ul className="grid grid-cols-1 gap-4" aria-label="Notices">
      {items.map((n) => (
        <li
          key={n.id}
          id={`notice-${n.id}`}
          className={
            n.readAt === null
              ? "scroll-mt-24 rounded-lg border border-primary/30 bg-card p-5"
              : "scroll-mt-24 rounded-lg border bg-card p-5"
          }
        >
          <NoticeText notice={n} timeZone={timeZone} isNew={n.readAt === null} />
        </li>
      ))}
    </ul>
  );
}
