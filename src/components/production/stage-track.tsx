import { CheckIcon, XIcon } from "lucide-react";

import { StatusBadge } from "@/components/sales/badges";
import { formatDay } from "@/lib/display";
import { cn } from "@/lib/utils";
import type { ProjectScreen } from "@/modules/production/screens.service";

import { days, STAGE_LABELS } from "./labels";

type Step = ProjectScreen["project"]["steps"][number];
type LogEntry = ProjectScreen["project"]["log"][number];

const span = (from: string | null, to: string | null) =>
  from ? (to && to !== from ? `${formatDay(from)} to ${formatDay(to)}` : formatDay(from)) : null;

function StepDot({ state, index }: { state: Step["state"]; index: number }) {
  return (
    <span
      aria-hidden
      className={cn(
        "relative z-10 flex size-8 shrink-0 items-center justify-center rounded-full border-2 bg-card text-[0.8125rem] font-medium tabular-nums",
        state === "done" && "border-primary bg-primary text-primary-foreground",
        state === "current" && "border-primary text-primary ring-4 ring-primary/15",
        state === "upcoming" && "border-border text-muted-foreground",
        state === "stopped" && "border-destructive/50 text-destructive",
      )}
    >
      {state === "done" ? (
        <CheckIcon className="size-4" />
      ) : state === "stopped" ? (
        <XIcon className="size-4" />
      ) : (
        index + 1
      )}
    </span>
  );
}

const STATE_WORDS: Record<Step["state"], string> = {
  done: "done",
  current: "under way",
  upcoming: "not started",
  stopped: "stopped here",
};

/**
 * The five working stages, Fabric sourcing to Finishing, and how far the
 * project got: done, under way or still to come, with the days each took. A
 * column on phones, a row from tablets up.
 */
export function StageTrack({ steps, status }: { steps: Step[]; status: string }) {
  return (
    <ol className="relative mt-5 grid gap-4 md:grid-cols-5 md:gap-2" aria-label="Stages">
      {steps.map((step, index) => {
        const when = span(step.startedOn, step.state === "done" ? step.endedOn : null);
        return (
          <li
            key={step.stage}
            aria-current={step.state === "current" ? "step" : undefined}
            className="relative flex min-w-0 gap-3 md:flex-col md:items-center md:gap-2 md:text-center"
          >
            {index < steps.length - 1 && (
              <span
                aria-hidden
                className={cn(
                  "absolute top-8 bottom-[-1rem] left-[15px] w-0.5 md:top-[15px] md:right-[calc(-50%+16px)] md:bottom-auto md:left-[calc(50%+16px)] md:h-0.5 md:w-auto",
                  step.state === "done" ? "bg-primary" : "bg-border",
                )}
              />
            )}
            <StepDot state={step.state} index={index} />
            <div className="min-w-0 pt-1 md:pt-0">
              <p
                className={cn(
                  "text-sm leading-tight font-medium",
                  step.state === "upcoming" && "text-muted-foreground",
                  step.state === "current" && "text-primary",
                )}
              >
                {STAGE_LABELS[step.stage]}
                <span className="sr-only">, {STATE_WORDS[step.state]}</span>
              </p>
              {(when || step.days > 0) && (
                <p className="mt-0.5 text-[0.75rem] leading-snug text-muted-foreground tabular-nums">
                  {[when, step.startedOn ? days(step.days) : null].filter(Boolean).join(" · ")}
                </p>
              )}
              {step.visits > 1 && (
                <p className="mt-0.5 text-[0.75rem] text-amber-700">Worked {step.visits} times</p>
              )}
              {step.state === "current" && status === "ON_HOLD" && (
                <p className="mt-0.5 text-[0.75rem] text-destructive">On hold</p>
              )}
            </div>
          </li>
        );
      })}
    </ol>
  );
}

/** Every move between stages, newest first; going back a stage is rework, with its reason. */
export function StageLog({ log }: { log: LogEntry[] }) {
  if (log.length === 0) {
    return (
      <p className="mt-4 text-sm text-muted-foreground">
        Nothing yet: the log starts when production starts.
      </p>
    );
  }
  return (
    <ol className="mt-4 grid gap-0 divide-y">
      {log.map((entry) => (
        <li key={entry.id} className="grid min-w-0 gap-1 py-3 first:pt-0 last:pb-0">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="text-sm font-medium">{STAGE_LABELS[entry.stage]}</span>
            {entry.isRework && <StatusBadge tone="warn">Sent back</StatusBadge>}
            {!entry.endedOn && <StatusBadge tone="open">Now</StatusBadge>}
          </div>
          <p className="text-[0.8125rem] text-muted-foreground tabular-nums">
            {entry.stage === "COMPLETED"
              ? formatDay(entry.startedOn)
              : entry.endedOn
                ? `${span(entry.startedOn, entry.endedOn)} · ${days(entry.days)}`
                : `Since ${formatDay(entry.startedOn)} · ${days(entry.days)} so far`}
          </p>
          {entry.note && (
            <p className="text-sm leading-relaxed break-words whitespace-pre-line">{entry.note}</p>
          )}
        </li>
      ))}
    </ol>
  );
}
