import type { ProductionStage, ProductionStatus } from "@prisma/client";

import { STAGE_ORDER } from "@/modules/production/timeline";

/*
 * The Production board on the Overview: open projects in columns, Planned
 * first and then one column per working stage. A project on hold stays in its
 * stage's column. Within a column, late projects come first, then by target day
 * (the order the overview hands them over in).
 */

export type BoardColumnKey = "PLANNED" | Exclude<ProductionStage, "COMPLETED">;

export const BOARD_COLUMNS: readonly BoardColumnKey[] = [
  "PLANNED",
  "FABRIC_SOURCING",
  "CUTTING",
  "SEWING",
  "WASH_QC",
  "FINISHING",
];

/** A stage move made by mistake can be taken back for this long. */
export const UNDO_STAGE_MINUTES = 10;

/** The column a project sits in; none for a completed one. */
export function boardColumnOf(project: {
  status: ProductionStatus;
  stage: ProductionStage;
}): BoardColumnKey | null {
  if (project.status === "PLANNED") return "PLANNED";
  return project.stage === "COMPLETED" ? null : project.stage;
}

/** The stage after this one; none after Finishing, which ends with Complete. */
export function nextStage(stage: ProductionStage): ProductionStage | null {
  const next = STAGE_ORDER[STAGE_ORDER.indexOf(stage) + 1];
  return next && next !== "COMPLETED" ? next : null;
}

/** The projects of each column, with how many there are and how many are late. */
export function boardColumns<T>(
  cards: readonly T[],
  read: (card: T) => { status: ProductionStatus; stage: ProductionStage; late: boolean },
) {
  return BOARD_COLUMNS.map((key) => {
    const projects = cards.filter((card) => boardColumnOf(read(card)) === key);
    return {
      key,
      projects,
      late: projects.filter((card) => read(card).late).length,
    };
  });
}
