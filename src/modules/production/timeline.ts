import type { ProductionStage, ProductionStatus } from "@prisma/client";

import { daysBetween, localDay } from "@/lib/dates";

/*
 * Project card timelines for the Production Overview: elapsed and remaining
 * days in company time, RED (overdue) once the target date has passed, and the
 * stage badge (Fabric Sourcing -> Cutting -> Sewing -> Wash/QC -> Finishing).
 */

export const STAGE_ORDER: readonly ProductionStage[] = [
  "FABRIC_SOURCING",
  "CUTTING",
  "SEWING",
  "WASH_QC",
  "FINISHING",
  "COMPLETED",
];

export const STAGE_LABELS: Record<ProductionStage, string> = {
  FABRIC_SOURCING: "Fabric Sourcing",
  CUTTING: "Cutting",
  SEWING: "Sewing",
  WASH_QC: "Wash/QC",
  FINISHING: "Finishing",
  COMPLETED: "Completed",
};

/** Working stages shown as "Stage n of 5". */
export const WORKING_STAGE_COUNT = STAGE_ORDER.length - 1;

/** Open projects within this many days of their target are flagged "due soon". */
export const DUE_SOON_DAYS = 7;

export const OPEN_STATUSES: readonly ProductionStatus[] = ["PLANNED", "ACTIVE", "ON_HOLD"];

export type ProjectHealth =
  "ON_TRACK" | "DUE_SOON" | "OVERDUE" | "COMPLETED" | "COMPLETED_LATE" | "CANCELLED";

export function stageBadge(stage: ProductionStage) {
  const index = STAGE_ORDER.indexOf(stage);
  return {
    key: stage,
    label: STAGE_LABELS[stage],
    number: Math.min(index + 1, WORKING_STAGE_COUNT),
    of: WORKING_STAGE_COUNT,
    /** Share of the working stages already behind the project. */
    progressPercent: Math.round((index / WORKING_STAGE_COUNT) * 100),
  };
}

export function isStageBackward(from: ProductionStage, to: ProductionStage) {
  return STAGE_ORDER.indexOf(to) < STAGE_ORDER.indexOf(from);
}

export function projectTimeline(
  project: {
    startDate: Date;
    targetDate: Date;
    completedAt: Date | null;
    status: ProductionStatus;
  },
  now: Date,
  timeZone: string,
) {
  const today = localDay(now, timeZone);
  const startDay = localDay(project.startDate, timeZone);
  const targetDay = localDay(project.targetDate, timeZone);
  const open = OPEN_STATUSES.includes(project.status);
  const endDay = project.completedAt ? localDay(project.completedAt, timeZone) : today;

  const totalDays = Math.max(daysBetween(startDay, targetDay), 0);
  const elapsedDays = Math.max(daysBetween(startDay, open ? today : endDay), 0);
  const remainingDays = open ? daysBetween(today, targetDay) : null;
  const isOverdue = remainingDays !== null && remainingDays < 0;
  const dueSoon = remainingDays !== null && !isOverdue && remainingDays <= DUE_SOON_DAYS;

  let health: ProjectHealth;
  if (project.status === "CANCELLED") health = "CANCELLED";
  else if (project.status === "COMPLETED") {
    health = daysBetween(targetDay, endDay) > 0 ? "COMPLETED_LATE" : "COMPLETED";
  } else health = isOverdue ? "OVERDUE" : dueSoon ? "DUE_SOON" : "ON_TRACK";

  return {
    startDay,
    targetDay,
    today,
    totalDays,
    elapsedDays,
    /** Negative once overdue; null for completed or cancelled projects. */
    remainingDays,
    /** The card turns RED. */
    isOverdue,
    overdueDays: isOverdue ? -remainingDays! : 0,
    dueSoon,
    health,
    timeElapsedPercent:
      totalDays > 0 ? Math.min(Math.round((elapsedDays / totalDays) * 100), 100) : 100,
  };
}
