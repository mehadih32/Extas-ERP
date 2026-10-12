import type { AttendanceStatus } from "@prisma/client";

/*
 * The performance score on the employee dashboard: 0 to 10, worked out from
 * clear rules (no outside AI) over the last 30 days, so each person can see
 * exactly what moved it. Kept pure so it can be tested item by item.
 *
 *   Attendance (half the score)  each working day with a mark, leave days left
 *                                out: on time 1, late or half day 0.5, absent 0
 *   Tasks on time (30%)          each task due in the window: done by its due
 *                                day 1, done late 0.5, still open after it 0
 *   Clean claims (20%)           each decided claim: approved as sent 1,
 *                                approved for less 0.5, not approved 0
 *
 * Each part is the average of its items. A part with nothing to count is left
 * out and the others share its weight, so nobody loses points for having no
 * tasks or claims. Every item that lost points says how many.
 */

export const SCORE_DAYS = 30;

export const SCORE_PARTS = ["attendance", "tasks", "claims"] as const;
export type ScorePart = (typeof SCORE_PARTS)[number];

/** Out of 10, before a part with nothing to count gives its weight to the others. */
export const SCORE_WEIGHTS: Record<ScorePart, number> = { attendance: 5, tasks: 3, claims: 2 };

/** A working day with an attendance mark, not fully on leave. */
export type ScoreDay = {
  date: string;
  status: AttendanceStatus;
  /** Half a day of approved leave (the other half is worked). */
  halfLeave: boolean;
};

/** A task due in the window: done, or still open after its due day. */
export type ScoreTask = {
  id: string;
  title: string;
  dueDay: string;
  /** The day it was marked done, in company time; null while open. */
  doneDay: string | null;
};

/** A claim Accounts decided. */
export type ScoreClaim = {
  id: string;
  number: string;
  date: string;
  approved: boolean;
  /** Approved for less than was claimed. */
  cut: boolean;
};

export type ScoreLoss =
  | { part: "attendance"; kind: "LATE" | "HALF_DAY" | "ABSENT"; day: string; points: number }
  | {
      part: "tasks";
      kind: "TASK_LATE" | "TASK_OVERDUE";
      day: string;
      title: string;
      /** Days after the due day it was done (TASK_LATE). */
      daysLate: number;
      points: number;
    }
  | {
      part: "claims";
      kind: "CLAIM_CUT" | "CLAIM_REJECTED";
      day: string;
      number: string;
      points: number;
    };

export type ScoreTone = "good" | "fair" | "poor" | "none";

export type PerformanceScore = {
  /** 0 to 10 with one decimal; null when there is nothing to count yet. */
  score: number | null;
  tone: ScoreTone;
  from: string;
  to: string;
  parts: Array<{
    part: ScorePart;
    /** 0 to 100, or null when there was nothing to count. */
    percent: number | null;
    /** Its share of the 10 points this time (0 when left out). */
    weight: number;
    counts: { counted: number; full: number; half: number; none: number };
  }>;
  /** What lost points, newest first. */
  losses: ScoreLoss[];
};

const round = (value: number, places: number) => {
  const f = 10 ** places;
  return Math.round(value * f) / f;
};

const dayValue = (d: ScoreDay) =>
  d.status === "PRESENT"
    ? 1
    : d.status === "LATE"
      ? 0.5
      : d.status === "HALF_DAY"
        ? d.halfLeave
          ? 1
          : 0.5
        : 0;

const dayDiff = (from: string, to: string) =>
  Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);

/** green 8 and up, yellow 5 to 7.9, red below 5. */
export function scoreTone(score: number | null): ScoreTone {
  if (score === null) return "none";
  return score >= 8 ? "good" : score >= 5 ? "fair" : "poor";
}

/**
 * The score from the window's attendance, tasks and claims (the caller leaves
 * out open tasks that are not due yet, and claims still waiting).
 */
export function performanceScore(input: {
  from: string;
  to: string;
  days: ScoreDay[];
  tasks: ScoreTask[];
  claims: ScoreClaim[];
}): PerformanceScore {
  type Item = { value: number; loss: Omit<ScoreLoss, "points"> | null };
  const items: Record<ScorePart, Item[]> = {
    attendance: input.days.map((d) => {
      const value = dayValue(d);
      const kind = d.status === "ABSENT" ? "ABSENT" : d.status === "LATE" ? "LATE" : "HALF_DAY";
      return {
        value,
        loss: value < 1 ? { part: "attendance" as const, kind, day: d.date } : null,
      };
    }),
    tasks: input.tasks.map((t) => {
      if (t.doneDay === null) {
        return {
          value: 0,
          loss: {
            part: "tasks" as const,
            kind: "TASK_OVERDUE" as const,
            day: t.dueDay,
            title: t.title,
            daysLate: 0,
          },
        };
      }
      const late = dayDiff(t.dueDay, t.doneDay);
      return late <= 0
        ? { value: 1, loss: null }
        : {
            value: 0.5,
            loss: {
              part: "tasks" as const,
              kind: "TASK_LATE" as const,
              day: t.doneDay,
              title: t.title,
              daysLate: late,
            },
          };
    }),
    claims: input.claims.map((c) => {
      if (!c.approved) {
        return {
          value: 0,
          loss: {
            part: "claims" as const,
            kind: "CLAIM_REJECTED" as const,
            day: c.date,
            number: c.number,
          },
        };
      }
      return c.cut
        ? {
            value: 0.5,
            loss: {
              part: "claims" as const,
              kind: "CLAIM_CUT" as const,
              day: c.date,
              number: c.number,
            },
          }
        : { value: 1, loss: null };
    }),
  };

  const counted = SCORE_PARTS.filter((p) => items[p].length > 0);
  const totalWeight = counted.reduce((sum, p) => sum + SCORE_WEIGHTS[p], 0);
  const share = (p: ScorePart) =>
    totalWeight === 0 || items[p].length === 0 ? 0 : (10 * SCORE_WEIGHTS[p]) / totalWeight;
  const average = (p: ScorePart) =>
    items[p].length === 0 ? null : items[p].reduce((s, i) => s + i.value, 0) / items[p].length;

  const raw = counted.reduce((sum, p) => sum + share(p) * average(p)!, 0);
  const score = counted.length === 0 ? null : round(raw, 1);

  const losses: ScoreLoss[] = counted.flatMap((p) =>
    items[p].flatMap((i) =>
      i.loss
        ? [
            {
              ...i.loss,
              points: round((share(p) / items[p].length) * (1 - i.value), 2),
            } as ScoreLoss,
          ]
        : [],
    ),
  );
  losses.sort((a, b) => (a.day === b.day ? b.points - a.points : a.day < b.day ? 1 : -1));

  const count = (p: ScorePart, value: number) => items[p].filter((i) => i.value === value).length;
  return {
    score,
    tone: scoreTone(score),
    from: input.from,
    to: input.to,
    parts: SCORE_PARTS.map((p) => {
      const avg = average(p);
      return {
        part: p,
        percent: avg === null ? null : Math.round(avg * 100),
        weight: round(share(p), 2),
        /**
         * How many were counted, and scored 1 (on time, approved as sent),
         * 0.5 (late or a half day, done late, approved for less) and 0
         * (absent, overdue, not approved).
         */
        counts: {
          counted: items[p].length,
          full: count(p, 1),
          half: count(p, 0.5),
          none: count(p, 0),
        },
      };
    }),
    losses,
  };
}
