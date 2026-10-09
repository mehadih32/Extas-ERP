import {
  type BillStatus,
  type IntakeStatus,
  Prisma,
  type ProductionStage,
  type ProductionStatus,
} from "@prisma/client";

import { ALLOWED, refuse, type Verdict } from "@/lib/verdict";
import { isProjectClosed as isClosed } from "@/modules/production/project-costs";
import { isStageBackward, STAGE_LABELS, STAGE_ORDER } from "@/modules/production/timeline";

/*
 * What may be done with a production project, a factory delivery or a supplier
 * bill from where it stands. The production services refuse with these answers
 * and the Production screens read the same answers to decide what to offer. The
 * permission each action needs is checked before these (production.actions.ts).
 */

type Amount = Prisma.Decimal | string | number;
const dec = (v: Amount) => new Prisma.Decimal(v);
const lower = (status: string) => status.toLowerCase().replace(/_/g, " ");

// --- Projects ------------------------------------------------------------------------

type ProjectState = { code: string; status: ProductionStatus };

/** What a closed project still lets change. */
export const CLOSED_EDITABLE: readonly string[] = ["name", "notes"];

/** Every field of an open project changes; a closed one keeps all but its name and notes. */
export function canChangeProjectFields(project: ProjectState, fields: string[]): Verdict {
  if (!isClosed(project) || fields.every((f) => CLOSED_EDITABLE.includes(f))) return ALLOWED;
  return refuse(
    "CONFLICT",
    `${project.code} is ${lower(project.status)}; only its name and notes can change.`,
  );
}

/** A project started by a proforma advance keeps that proforma's buyer. */
export function canChangeProjectBuyer(
  project: { code: string; proformaId: string | null; buyerId: string | null },
  proformaNumber: string | undefined,
  buyerId: string | null,
): Verdict {
  if (!project.proformaId || buyerId === project.buyerId) return ALLOWED;
  return refuse(
    "CONFLICT",
    `${project.code} was started from ${proformaNumber}; its buyer cannot change.`,
  );
}

function notActiveMessage(project: ProjectState) {
  if (project.status === "PLANNED") return `${project.code} has not started yet; start it first.`;
  if (project.status === "ON_HOLD") return `${project.code} is on hold; resume it first.`;
  return `${project.code} is ${lower(project.status)}.`;
}

/** The stage badge moves while the project is active, to any other working stage. */
export function canSetStage(
  project: ProjectState & { stage: ProductionStage },
  to: ProductionStage,
): Verdict {
  if (project.status !== "ACTIVE") return refuse("CONFLICT", notActiveMessage(project));
  if (to === "COMPLETED") return refuse("VALIDATION", "Use Complete to finish the project");
  if (project.stage === to) {
    return refuse("CONFLICT", `${project.code} is already at ${STAGE_LABELS[to]}.`);
  }
  return ALLOWED;
}

/** Going back a stage is rework, and needs a note saying why. */
export const stageNeedsNote = (from: ProductionStage, to: ProductionStage) =>
  isStageBackward(from, to);

/** The stages a screen offers to move to, in order, saying which ones go back. */
export function stageMoves(project: ProjectState & { stage: ProductionStage }) {
  return STAGE_ORDER.filter((stage) => canSetStage(project, stage).ok).map((stage) => ({
    stage,
    label: STAGE_LABELS[stage],
    back: stageNeedsNote(project.stage, stage),
  }));
}

/** Planned projects start; active ones go on hold; held ones resume. */
export function canSetStatus(project: ProjectState, status: "ACTIVE" | "ON_HOLD"): Verdict {
  const from: readonly ProductionStatus[] =
    status === "ACTIVE" ? ["PLANNED", "ON_HOLD"] : ["ACTIVE"];
  if (from.includes(project.status)) return ALLOWED;
  return refuse(
    "CONFLICT",
    project.status === status
      ? `${project.code} is already ${status === "ACTIVE" ? "active" : "on hold"}.`
      : `${project.code} is ${lower(project.status)}.`,
  );
}

/**
 * Active and held projects are completed, once no delivery is left open. Cost
 * still in work in progress needs writing off as well (Accounts).
 */
export function canCompleteProject(
  project: ProjectState,
  openDelivery: { number: string } | null,
): Verdict {
  if (project.status !== "ACTIVE" && project.status !== "ON_HOLD") {
    return refuse(
      "CONFLICT",
      project.status === "PLANNED"
        ? `${project.code} has not started; start it or cancel it.`
        : `${project.code} is already ${lower(project.status)}.`,
    );
  }
  if (openDelivery) {
    return refuse(
      "CONFLICT",
      `Confirm or cancel the open delivery ${openDelivery.number} before completing ${project.code}.`,
    );
  }
  return ALLOWED;
}

/** Open projects are cancelled; cost still in work in progress is written off (Accounts). */
export function canCancelProject(project: ProjectState): Verdict {
  if (!isClosed(project)) return ALLOWED;
  return refuse("CONFLICT", `${project.code} is already ${lower(project.status)}.`);
}

/** Closing a project with cost still in work in progress writes it off: Accounts' call. */
export function canWriteOffOnClose(wip: Amount, canWriteOff: boolean): Verdict {
  if (!dec(wip).gt(0) || canWriteOff) return ALLOWED;
  return refuse(
    "FORBIDDEN",
    `${dec(wip).toFixed(2)} of cost would be written off as a loss; only Accounts can do that.`,
  );
}

// --- Costs and supplier bills --------------------------------------------------------------

/** Costs and bills go on open projects (planned, active or on hold). */
export function canAddCost(project: ProjectState): Verdict {
  if (!isClosed(project)) return ALLOWED;
  return refuse(
    "CONFLICT",
    `${project.code} is ${lower(project.status)}; no more costs can be added.`,
  );
}

/**
 * A cost paid from cash or bank is voided while its project is open and its
 * amount is still in work in progress (not moved into stock).
 */
export function canVoidDirectCost(
  cost: { number: string; amount: Amount; isVoid: boolean },
  project: ProjectState & { wip: Amount },
): Verdict {
  if (cost.isVoid) return refuse("CONFLICT", `${cost.number} is already void.`);
  if (isClosed(project)) {
    return refuse(
      "CONFLICT",
      `${project.code} is ${lower(project.status)}; its costs can no longer change.`,
    );
  }
  if (dec(project.wip).lt(dec(cost.amount))) {
    return refuse(
      "CONFLICT",
      `${project.code} has already moved this cost into stock, so it can no longer be voided.`,
    );
  }
  return ALLOWED;
}

type BillState = { number: string; status: BillStatus; dueAmount: Amount };

export function canPayBill(bill: BillState): Verdict {
  if (bill.status === "VOID") return refuse("CONFLICT", `${bill.number} is void.`);
  if (!dec(bill.dueAmount).gt(0)) return refuse("CONFLICT", `${bill.number} is already paid.`);
  return ALLOWED;
}

/**
 * A bill entered by mistake is voided while every project it is shared across
 * is open and still holds its share in work in progress. Raw material purchases
 * are voided from Raw materials, since their goods have to leave the store.
 */
export function canVoidBill(
  bill: BillState & { itemCount: number },
  shares: Array<{ project: ProjectState & { wip: Amount }; amount: Amount }>,
): Verdict {
  if (bill.status === "VOID") return refuse("CONFLICT", `${bill.number} is already void.`);
  if (bill.itemCount > 0) {
    return refuse(
      "CONFLICT",
      `${bill.number} is a raw material purchase; void it from Raw materials.`,
    );
  }
  for (const { project } of shares) {
    if (isClosed(project)) {
      return refuse(
        "CONFLICT",
        `${project.code} is ${lower(project.status)}; its bills can no longer be voided.`,
      );
    }
  }
  for (const { project, amount } of shares) {
    if (dec(project.wip).lt(dec(amount))) {
      return refuse(
        "CONFLICT",
        `${project.code} has already moved this bill's cost into stock, so the bill can no longer be voided.`,
      );
    }
  }
  return ALLOWED;
}

// --- Factory deliveries (Move to Stock) -----------------------------------------------------

const DRAFT: readonly IntakeStatus[] = ["DRAFT", "PARSED"];

export const isDraftDelivery = (intake: { status: IntakeStatus }) => DRAFT.includes(intake.status);

/** Goods are received for active and held projects. */
export function canReceiveGoods(project: ProjectState): Verdict {
  if (project.status === "ACTIVE" || project.status === "ON_HOLD") return ALLOWED;
  return refuse(
    "CONFLICT",
    project.status === "PLANNED"
      ? `${project.code} has not started yet; start it first.`
      : `${project.code} is ${lower(project.status)}; it cannot receive goods.`,
  );
}

/** A delivery changes, is confirmed or is cancelled while it is a draft. */
export function canChangeDelivery(intake: { number: string; status: IntakeStatus }): Verdict {
  if (isDraftDelivery(intake)) return ALLOWED;
  return refuse("CONFLICT", `${intake.number} is already ${lower(intake.status)}.`);
}

/**
 * A confirmed delivery is undone (its pieces leave stock, its cost goes back to
 * the project) unless its project was cancelled (`project` is checked when
 * given; null when it no longer exists). Its pieces must all still be free in
 * the warehouse; `short` lists the ones that are not.
 */
export function canUndoDelivery(
  intake: { number: string; status: IntakeStatus },
  project?: ProjectState | null,
  short: Array<{ sku: string; grade: "A" | "B"; free: number; quantity: number }> = [],
): Verdict {
  if (intake.status !== "CONFIRMED") {
    return refuse(
      "CONFLICT",
      intake.status === "REVERSED"
        ? `${intake.number} is already undone.`
        : `${intake.number} is ${lower(intake.status)}; only a confirmed delivery can be undone.`,
    );
  }
  if (project === null) {
    return refuse(
      "CONFLICT",
      `${intake.number}'s production project no longer exists, so it cannot be undone.`,
    );
  }
  if (project?.status === "CANCELLED") {
    return refuse(
      "CONFLICT",
      `${project.code} is cancelled, so its deliveries can no longer be undone.`,
    );
  }
  if (short.length > 0) {
    const list = short
      .slice(0, 5)
      .map((l) => `${l.sku} ${l.grade}-grade (${l.free} of ${l.quantity} free)`)
      .join(", ");
    return refuse(
      "CONFLICT",
      `${intake.number} cannot be undone: some of its pieces were sold, are reserved for orders or went to bad stock — ${list}${
        short.length > 5 ? ` and ${short.length - 5} more` : ""
      }. Correct the difference with a stock count correction instead.`,
    );
  }
  return ALLOWED;
}
