"use client";

import { HistoryIcon } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";

import { Amount, ScopeEye } from "@/components/accounts/privacy";
import { addDays } from "@/lib/dates";
import { formatDay, groupAmount } from "@/lib/display";
import { cn } from "@/lib/utils";
import type { ActivityFeed as Feed, ActivityItem } from "@/modules/dashboard/activity.service";
import { getActivityFeedAction } from "@/server/actions/dashboard.actions";

const FEED_SCOPE = "feed";

/** The feed reads the latest activity again this often while the page is on screen. */
const EVERY_MS = 60_000;

/** "Today", "Yesterday" or "9 Oct 2026". */
function dayLabel(day: string, today: string) {
  if (day === today) return "Today";
  if (day === addDays(today, -1)) return "Yesterday";
  return formatDay(day);
}

/** The rows grouped by day, newest first. */
function byDay(items: ActivityItem[]) {
  const days: Array<{ day: string; items: ActivityItem[] }> = [];
  for (const item of items) {
    const last = days.at(-1);
    if (last && last.day === item.day) last.items.push(item);
    else days.push({ day: item.day, items: [item] });
  }
  return days;
}

function Summary({ item, currency }: { item: ActivityItem; currency: string }) {
  return (
    <>
      {item.parts.map((part, i) =>
        "amount" in part ? (
          <Amount key={i} scope={FEED_SCOPE}>
            {`${currency} ${groupAmount(part.amount, currency)}`}
          </Amount>
        ) : (
          <span key={i}>{part.text}</span>
        ),
      )}
    </>
  );
}

/**
 * The live activity feed: a timeline of the latest things done, newest first,
 * grouped by day. It reads the latest again every minute while the page is on
 * screen (and as soon as it comes back), and stops when the page is left.
 * Amounts in the text stay *** until the eye shows them.
 */
export function ActivityFeed({ initial }: { initial: Feed }) {
  const [feed, setFeed] = useState(initial);
  const busy = useRef(false);

  useEffect(() => {
    let alive = true;
    const refresh = async () => {
      if (document.visibilityState !== "visible" || busy.current) return;
      busy.current = true;
      try {
        const result = await getActivityFeedAction({});
        if (alive && result.ok) setFeed(result.data);
      } catch {
        // Offline for a moment: the next minute tries again.
      } finally {
        busy.current = false;
      }
    };
    const timer = setInterval(refresh, EVERY_MS);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      alive = false;
      clearInterval(timer);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, []);

  const hasAmounts = feed.items.some((item) => item.parts.some((part) => "amount" in part));
  const days = byDay(feed.items);

  return (
    <section aria-labelledby="activity-heading" className="min-w-0">
      <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-1">
        <h2 id="activity-heading" className="font-serif text-2xl text-primary">
          Live activity
        </h2>
        <p className="flex items-center gap-1.5 text-[0.8125rem] text-muted-foreground">
          <span className="relative flex size-2" aria-hidden>
            <span className="absolute inline-flex size-full animate-ping rounded-full bg-success/60 motion-reduce:animate-none" />
            <span className="relative inline-flex size-2 rounded-full bg-success" />
          </span>
          Updates every minute
        </p>
      </div>
      <div className="mt-5 rounded-lg border bg-card p-5">
        <header className="flex items-start justify-between gap-3">
          <p className="flex items-center gap-2 pt-1 text-[0.8125rem] text-muted-foreground">
            <HistoryIcon className="size-4 shrink-0 text-primary" aria-hidden />
            {feed.scope === "COMPANY"
              ? "Everything done in the company, newest first."
              : "What you did lately, newest first."}
          </p>
          {hasAmounts && (
            <ScopeEye scope={FEED_SCOPE} label="the activity feed" className="-mt-1.5 -mr-1.5" />
          )}
        </header>
        {days.length === 0 ? (
          <p className="mt-4 text-sm text-muted-foreground">
            {feed.scope === "COMPANY"
              ? "Nothing has been done in the company yet."
              : "Nothing yet. What you add or change in the app shows here."}
          </p>
        ) : (
          <ol className="mt-4 grid grid-cols-1 gap-4" aria-label="Recent activity">
            {days.map(({ day, items }) => (
              <li key={day} className="min-w-0">
                <h3 className="eyebrow">{dayLabel(day, feed.today)}</h3>
                <ol className="mt-2 ml-1 border-l border-border">
                  {items.map((item) => (
                    <li key={item.id} className="relative min-w-0 pb-3.5 pl-4 last:pb-0">
                      <span
                        aria-hidden
                        className={cn(
                          "absolute top-1.5 -left-[5px] size-2.5 rounded-full border-2 border-card",
                          item.mine ? "bg-primary" : "bg-muted-foreground/60",
                        )}
                      />
                      <p className="text-[0.75rem] text-muted-foreground tabular-nums">
                        <time dateTime={item.at}>{item.time}</time> ·{" "}
                        <span className={cn(item.mine ? "text-primary" : "text-foreground")}>
                          {item.who}
                        </span>
                      </p>
                      <p className="mt-0.5 text-sm leading-snug break-words">
                        {item.href ? (
                          <Link href={item.href} className="underline-offset-4 hover:underline">
                            <Summary item={item} currency={feed.currency} />
                          </Link>
                        ) : (
                          <Summary item={item} currency={feed.currency} />
                        )}
                      </p>
                    </li>
                  ))}
                </ol>
              </li>
            ))}
          </ol>
        )}
      </div>
    </section>
  );
}
