import { formatDay } from "@/lib/display";
import type { PerformanceScore, ScoreLoss, ScorePart, ScoreTone } from "@/modules/hr/score";

/** The words for the performance score (hr/score.ts) on My HR and the employee's page. */

export const SCORE_PART_LABELS: Record<ScorePart, string> = {
  attendance: "Attendance",
  tasks: "Tasks on time",
  claims: "Clean claims",
};

export const SCORE_TONE_LABELS: Record<ScoreTone, string> = {
  good: "Doing well",
  fair: "Room to grow",
  poor: "Needs attention",
  none: "Not scored yet",
};

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

/** "20 on time, 2 late or half days and 1 absent, of 23 working days". */
export function partText(p: PerformanceScore["parts"][number]): string {
  const { counted, full, half, none } = p.counts;
  const list = (bits: Array<string | null>) => {
    const b = bits.filter((x): x is string => x !== null);
    return b.length <= 1 ? (b[0] ?? "") : `${b.slice(0, -1).join(", ")} and ${b.at(-1)}`;
  };
  if (p.part === "attendance") {
    if (counted === 0) return "No working days marked yet.";
    return `${list([
      full > 0 ? `${full} on time` : null,
      half > 0 ? `${half} late or half ${half === 1 ? "day" : "days"}` : null,
      none > 0 ? `${none} absent` : null,
    ])}, of ${plural(counted, "working day")}.`;
  }
  if (p.part === "tasks") {
    if (counted === 0) return "No tasks were due.";
    return `${list([
      full > 0 ? `${full} done on time` : null,
      half > 0 ? `${half} done late` : null,
      none > 0 ? `${none} overdue` : null,
    ])}, of ${plural(counted, "task")}.`;
  }
  if (counted === 0) return "No claims were decided.";
  return `${list([
    full > 0 ? `${full} approved as sent` : null,
    half > 0 ? `${half} approved for less` : null,
    none > 0 ? `${none} not approved` : null,
  ])}, of ${plural(counted, "claim")}.`;
}

/** "Late on 9 Oct 2026", "“Cut the samples” done 2 days late". */
export function lossText(loss: ScoreLoss): string {
  switch (loss.kind) {
    case "LATE":
      return `Late on ${formatDay(loss.day)}`;
    case "HALF_DAY":
      return `Half day on ${formatDay(loss.day)}`;
    case "ABSENT":
      return `Absent on ${formatDay(loss.day)}`;
    case "TASK_LATE":
      return `“${loss.title}” done ${plural(loss.daysLate, "day")} late`;
    case "TASK_OVERDUE":
      return `“${loss.title}” not done, due ${formatDay(loss.day)}`;
    case "CLAIM_CUT":
      return `Claim ${loss.number} approved for less`;
    case "CLAIM_REJECTED":
      return `Claim ${loss.number} not approved`;
  }
}

/** "−0.25" (points lost, with a real minus sign). */
export const pointsText = (points: number) => `−${points.toFixed(2)}`;

/** "8.4" or "10". */
export const scoreText = (score: number) =>
  Number.isInteger(score) ? String(score) : score.toFixed(1);
