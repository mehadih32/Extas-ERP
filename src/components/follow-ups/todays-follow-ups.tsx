import { BellRingIcon } from "lucide-react";
import Link from "next/link";

import { FollowUpActions } from "@/components/follow-ups/follow-up-actions";
import { formatDay } from "@/lib/display";
import type { TodaysFollowUps } from "@/modules/reminders/follow-up.service";

const KIND_LABELS = {
  QUOTATION_EXPIRY: "Quotation ends",
  PAYMENT_DUE: "Payment due",
  PROMISED_PAYMENT: "Promised payment",
  FOLLOW_UP: "Follow up",
} as const;

function when(daysLeft: number, dueOn: string) {
  if (daysLeft === 0) return "Today";
  const late = -daysLeft;
  return `${late} ${late === 1 ? "day" : "days"} late · ${formatDay(dueOn)}`;
}

/**
 * Home's "Today's follow-ups": quotations ending, invoices due, payments the
 * buyer promised and "Follow up on" dates, due today or overdue, each with a
 * link to its record, "Done" and "Snooze". For our own staff only; nothing here
 * goes to a buyer. Shown only when something is due.
 */
export function TodaysFollowUpsCard({ data }: { data: TodaysFollowUps }) {
  if (data.items.length === 0) return null;
  return (
    <section aria-labelledby="follow-ups-heading" className="min-w-0 rounded-lg border bg-card p-5">
      <h2 id="follow-ups-heading" className="eyebrow flex items-center gap-2">
        <BellRingIcon className="size-4 text-primary" aria-hidden />
        Today&apos;s follow-ups
        <span className="rounded-full bg-destructive px-1.5 py-px text-xs leading-4 font-medium tracking-normal text-destructive-foreground tabular-nums">
          {data.items.length + data.more}
        </span>
      </h2>
      <ul className="mt-4 grid grid-cols-1 divide-y">
        {data.items.map((item) => (
          <li
            key={item.key}
            className="flex min-w-0 flex-wrap items-center justify-between gap-x-4 gap-y-2 py-3 first:pt-0 last:pb-0"
          >
            <div className="min-w-0 flex-1 basis-60 text-sm">
              <p className="text-[0.8125rem] text-muted-foreground">
                {KIND_LABELS[item.kind]} ·{" "}
                <span className={item.daysLeft < 0 ? "text-destructive" : undefined}>
                  {when(item.daysLeft, item.dueOn)}
                </span>
              </p>
              <p className="font-medium break-words">
                {item.href ? (
                  <Link
                    href={item.href}
                    className="text-primary underline-offset-4 hover:underline"
                  >
                    {item.title}
                  </Link>
                ) : (
                  item.title
                )}
              </p>
              {item.detail && (
                <p className="text-[0.8125rem] break-words text-muted-foreground">{item.detail}</p>
              )}
            </div>
            <FollowUpActions mark={item.mark} today={data.today} what={item.title} />
          </li>
        ))}
      </ul>
      {data.more > 0 && (
        <p className="mt-3 text-[0.8125rem] text-muted-foreground">
          {data.more} more are in the Planner&apos;s agenda.
        </p>
      )}
    </section>
  );
}
