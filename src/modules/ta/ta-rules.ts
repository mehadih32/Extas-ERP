import type { TaFact } from "@prisma/client";

import { addDays, daysBetween } from "@/lib/dates";

/*
 * The T&A calendar's plain rules (no database, safe on the screen too): the
 * starting template, the day each step falls on, its colour and whether the
 * ship date is at risk. The AI order runs read the same template (order-run.ts
 * taDates), so both paths give the same days.
 */

export type TaTemplateLike = {
  key: string;
  name: string;
  daysBeforeShip: number;
  fact: TaFact | null;
  critical: boolean;
};

/**
 * The starting template: days before the ship date. The tech pack, fabric
 * booking, cutting, packing and ship days are the Order check card's rules
 * (fabric 30 days, making 25, shipping 7, tech pack 2 days before the booking).
 */
export const DEFAULT_TA_STEPS: readonly TaTemplateLike[] = [
  {
    key: "TECH_PACK",
    name: "Tech pack approval",
    daysBeforeShip: 64,
    fact: "TECH_PACK_APPROVED",
    critical: true,
  },
  {
    key: "FABRIC_BOOKING",
    name: "Lab dip and fabric booking",
    daysBeforeShip: 62,
    fact: "BOOKING_APPROVED",
    critical: true,
  },
  {
    key: "FABRIC_IN_HOUSE",
    name: "Fabric in-house",
    daysBeforeShip: 35,
    fact: "FABRIC_IN_HOUSE",
    critical: true,
  },
  { key: "PP_SAMPLE", name: "PP sample approval", daysBeforeShip: 34, fact: null, critical: true },
  {
    key: "CUTTING",
    name: "Cutting start",
    daysBeforeShip: 32,
    fact: "CUTTING_STARTED",
    critical: true,
  },
  { key: "SEWING", name: "Sewing finish", daysBeforeShip: 12, fact: "SEWING_DONE", critical: true },
  {
    key: "PACKING",
    name: "Packing and final inspection",
    daysBeforeShip: 7,
    fact: "PACKED",
    critical: true,
  },
  { key: "SHIP", name: "Ship", daysBeforeShip: 0, fact: "SHIPPED", critical: true },
];

/** The words the screens show for what finishes a step by itself. */
export const FACT_LABELS: Record<TaFact, string> = {
  TECH_PACK_APPROVED: "Tech pack approved",
  BOOKING_APPROVED: "Booking approved",
  FABRIC_IN_HOUSE: "Fabric received",
  CUTTING_STARTED: "Cutting report made",
  SEWING_DONE: "Sewing done",
  PACKED: "Packing list made",
  SHIPPED: "Order shipped",
};

export const TA_FACTS = Object.keys(FACT_LABELS) as TaFact[];

/** The day a step falls on: the ship date less its days. */
export const stepDay = (shipDate: string, daysBeforeShip: number) =>
  addDays(shipDate, -daysBeforeShip);

/** How soon a step is due, as a colour: done, green, yellow (due soon) or red (late). */
export type TaColour = "done" | "green" | "yellow" | "red";

export function taColour(
  step: { dueOn: string; done: boolean },
  today: string,
  dueSoonDays: number,
): TaColour {
  if (step.done) return "done";
  const left = daysBetween(today, step.dueOn);
  if (left < 0) return "red";
  if (left <= dueSoonDays) return "yellow";
  return "green";
}

/** The ship date is at risk when a step on the critical path is late. */
export function shipAtRisk(
  steps: ReadonlyArray<{ dueOn: string; done: boolean; critical: boolean }>,
  today: string,
): boolean {
  return steps.some((s) => s.critical && !s.done && daysBetween(today, s.dueOn) < 0);
}

export const COLOUR_WORDS: Record<TaColour, string> = {
  done: "Done",
  green: "On time",
  yellow: "Due soon",
  red: "Late",
};
