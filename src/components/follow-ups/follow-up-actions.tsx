"use client";

import { AlarmClockIcon, CheckIcon, LoaderCircleIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { addDays } from "@/lib/dates";
import type { ActionResult } from "@/lib/result";
import { markFollowUpDoneAction, snoozeFollowUpAction } from "@/server/actions/reminders.actions";

/** What Done and Snooze act on: a follow-up by its id, or a quotation's or invoice's date. */
export type FollowUpMark =
  | { target: "followUp"; id: string }
  | {
      target: "date";
      kind: "QUOTATION_EXPIRY" | "PAYMENT_DUE" | "PROMISED_PAYMENT";
      recordId: string;
      day: string;
    };

const SNOOZE_CHOICES = [
  { days: 1, label: "Tomorrow" },
  { days: 3, label: "In 3 days" },
  { days: 7, label: "In a week" },
] as const;

/**
 * "Done" (it leaves the list and its reminders stop) and "Snooze" (it comes
 * back tomorrow, in 3 days or in a week) for one follow-up.
 */
export function FollowUpActions({
  mark,
  today,
  what,
}: {
  mark: FollowUpMark;
  /** Today in company time ("2026-11-12"). */
  today: string;
  /** What it is, for the buttons' spoken names. */
  what: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string>();

  const run = (work: () => Promise<ActionResult<unknown>>) =>
    startTransition(async () => {
      setError(undefined);
      const result = await work();
      if (!result.ok) setError(result.error.message);
      else router.refresh();
    });

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={pending}
        aria-label={`Done: ${what}`}
        onClick={() => run(() => markFollowUpDoneAction(mark))}
      >
        {pending ? (
          <LoaderCircleIcon className="animate-spin" aria-hidden />
        ) : (
          <CheckIcon aria-hidden />
        )}
        Done
      </Button>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={pending}
            aria-label={`Snooze: ${what}`}
          >
            <AlarmClockIcon aria-hidden />
            Snooze
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {SNOOZE_CHOICES.map((choice) => (
            <DropdownMenuItem
              key={choice.days}
              onSelect={() =>
                run(() => snoozeFollowUpAction({ mark, until: addDays(today, choice.days) }))
              }
            >
              {choice.label}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
      {error && (
        <p role="alert" className="w-full text-[0.8125rem] text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}
