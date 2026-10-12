import { formatDayRange } from "@/lib/display";
import { cn } from "@/lib/utils";
import type { PerformanceScore, ScoreTone } from "@/modules/hr/score";

import {
  lossText,
  partText,
  pointsText,
  SCORE_PART_LABELS,
  SCORE_TONE_LABELS,
  scoreText,
} from "./score-labels";

const smallText = "text-[0.8125rem] text-muted-foreground";

const STROKE: Record<ScoreTone, string> = {
  good: "stroke-success",
  fair: "stroke-amber-500",
  poor: "stroke-destructive",
  none: "stroke-transparent",
};

const TEXT: Record<ScoreTone, string> = {
  good: "text-success",
  fair: "text-amber-700",
  poor: "text-destructive",
  none: "text-muted-foreground",
};

const BAR: Record<ScoreTone, string> = {
  good: "bg-success",
  fair: "bg-amber-500",
  poor: "bg-destructive",
  none: "bg-muted-foreground/30",
};

/** The tone of one part, from its percentage (the same bands as the score). */
const partTone = (percent: number | null): ScoreTone =>
  percent === null ? "none" : percent >= 80 ? "good" : percent >= 50 ? "fair" : "poor";

const RADIUS = 52;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

/** The score as a ring: green from 8, yellow from 5, red below; grey with no score yet. */
export function ScoreRing({
  score,
  tone,
  className,
}: {
  score: number | null;
  tone: ScoreTone;
  className?: string;
}) {
  const filled = score === null ? 0 : Math.max(0, Math.min(1, score / 10));
  return (
    <div
      role="img"
      aria-label={
        score === null
          ? "Performance score: not scored yet"
          : `Performance score ${scoreText(score)} of 10: ${SCORE_TONE_LABELS[tone]}`
      }
      className={cn("relative size-32 shrink-0", className)}
    >
      <svg viewBox="0 0 120 120" className="size-full -rotate-90" aria-hidden>
        <circle cx="60" cy="60" r={RADIUS} fill="none" strokeWidth="10" className="stroke-muted" />
        <circle
          cx="60"
          cy="60"
          r={RADIUS}
          fill="none"
          strokeWidth="10"
          strokeLinecap="round"
          strokeDasharray={CIRCUMFERENCE}
          strokeDashoffset={CIRCUMFERENCE * (1 - filled)}
          className={cn("transition-[stroke-dashoffset] duration-700", STROKE[tone])}
        />
      </svg>
      <span className="absolute inset-0 flex flex-col items-center justify-center" aria-hidden>
        <span className={cn("font-serif text-4xl leading-none tabular-nums", TEXT[tone])}>
          {score === null ? "–" : scoreText(score)}
        </span>
        <span className="mt-1 text-[0.75rem] text-muted-foreground">of 10</span>
      </span>
    </div>
  );
}

/** How many of the newest losses to list before "and N more". */
const SHOWN_LOSSES = 10;

/**
 * The performance score with what makes it up and what lost points, for the
 * employee (My HR, `mine`) and for HR (the employee's page).
 */
export function ScoreCard({ score: s, mine }: { score: PerformanceScore; mine: boolean }) {
  const shown = s.losses.slice(0, SHOWN_LOSSES);
  const rest = s.losses.length - shown.length;
  return (
    <div className="grid gap-5">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
        <ScoreRing score={s.score} tone={s.tone} />
        <div className="min-w-0">
          <p className={cn("text-lg font-medium", TEXT[s.tone])}>{SCORE_TONE_LABELS[s.tone]}</p>
          <p className={cn("mt-1 leading-relaxed", smallText)}>
            {s.score === null
              ? `Nothing to count in the last 30 days yet (${formatDayRange(s.from, s.to)}).`
              : `The last 30 days (${formatDayRange(s.from, s.to)}), from ${
                  mine ? "your" : "their"
                } attendance, tasks done on time and claims. The app works it out from clear rules; nobody marks it by hand.`}
          </p>
        </div>
      </div>

      <ul className="grid gap-4" aria-label="What makes up the score">
        {s.parts.map((p) => {
          const tone = partTone(p.percent);
          return (
            <li key={p.part} className="grid gap-1.5">
              <div className="flex items-baseline justify-between gap-3 text-sm">
                <span className="font-medium">{SCORE_PART_LABELS[p.part]}</span>
                <span className={cn("tabular-nums", p.percent === null && "text-muted-foreground")}>
                  {p.percent === null ? "Not counted" : `${p.percent}%`}
                </span>
              </div>
              <div className="h-1.5 overflow-hidden rounded-full bg-muted" aria-hidden>
                <div
                  className={cn("h-full rounded-full", BAR[tone])}
                  style={{ width: `${p.percent ?? 0}%` }}
                />
              </div>
              <p className={smallText}>
                {partText(p)}
                {p.percent !== null &&
                  ` Worth ${p.weight % 1 === 0 ? p.weight : p.weight.toFixed(1)} of the 10 points.`}
              </p>
            </li>
          );
        })}
      </ul>

      {s.score !== null && (
        <details className="group rounded-md border bg-muted/30 px-3 py-2.5">
          <summary className="cursor-pointer text-sm font-medium text-primary">
            {s.losses.length === 0
              ? "Nothing lost points"
              : `What lost points (${s.losses.length})`}
          </summary>
          {s.losses.length === 0 ? (
            <p className={cn("mt-2", smallText)}>
              Every day, task and claim counted in full. Keep it up.
            </p>
          ) : (
            <>
              <ul className="mt-2 grid divide-y" aria-label="What lost points">
                {shown.map((loss, index) => (
                  <li
                    key={`${loss.kind}-${loss.day}-${index}`}
                    className="flex items-start justify-between gap-3 py-1.5 text-sm"
                  >
                    <span className="min-w-0 break-words">{lossText(loss)}</span>
                    <span className="shrink-0 text-destructive tabular-nums">
                      {pointsText(loss.points)}
                    </span>
                  </li>
                ))}
              </ul>
              {rest > 0 && <p className={cn("mt-1", smallText)}>And {rest} more before these.</p>}
              <p className={cn("mt-2", smallText)}>
                {mine
                  ? "Days on approved leave, holidays and days off never count. If a day is marked wrong, ask HR to fix it and the score follows."
                  : "Days on approved leave, holidays and days off never count. Fixing a day's attendance changes the score."}
              </p>
            </>
          )}
        </details>
      )}
    </div>
  );
}
