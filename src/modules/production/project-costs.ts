import { Prisma, type ProductionStatus } from "@prisma/client";

import type { Db } from "@/lib/db-types";
import { groupAmount } from "@/lib/display";
import { AppError } from "@/lib/errors";
import { lockRows } from "@/lib/row-lock";
import { CONTROL_ACCOUNTS, ensureControlAccounts } from "@/modules/accounts/control-accounts";
import { postJournalEntry } from "@/modules/accounts/journal.service";
import type { CompanyContext } from "@/modules/auth/context";
import { costGuard, guardHeadline, guardWorsened } from "@/modules/production/cost-guard";
import { money, ZERO } from "@/modules/production/costing";
import { activeMembers, membersWith } from "@/modules/reminders/audience";
import { sendInApp } from "@/modules/reminders/notification.service";

/*
 * How production reaches the books:
 *   Supplier bill (Due)        Dr Work in Progress          Cr Payable (supplier)
 *   Bill paid / Cash-Bank cost Dr Payable (supplier) or WIP Cr Cash / Bank / Wallet
 *   Move to Stock (delivery)   Dr Finished Goods Inventory  Cr Work in Progress
 *   Write-off (cancel / close) Dr Production Losses         Cr Work in Progress
 *   Materials issued (store)   Dr Work in Progress          Cr Raw Materials
 *   Materials returned (store) Dr Raw Materials             Cr Work in Progress
 * A project's work in progress = its costs - what moved to stock - write-offs.
 */

type Tx = Prisma.TransactionClient;

export type ProjectCostSummary = {
  /** Supplier bills allocated to the project (void bills excluded). */
  billCost: Prisma.Decimal;
  /** Costs paid straight from cash or bank (void ones excluded). */
  directCost: Prisma.Decimal;
  /** Raw materials issued from the store, less what came back unused. */
  materialCost: Prisma.Decimal;
  totalCost: Prisma.Decimal;
  /** Moved into stock by confirmed deliveries. */
  inStock: Prisma.Decimal;
  writtenOff: Prisma.Decimal;
  /** Still waiting in work in progress. */
  wip: Prisma.Decimal;
};

const emptySummary = (): ProjectCostSummary => ({
  billCost: ZERO,
  directCost: ZERO,
  materialCost: ZERO,
  totalCost: ZERO,
  inStock: ZERO,
  writtenOff: ZERO,
  wip: ZERO,
});

/** Cost figures per project (pass a transaction client to read inside it). */
export async function projectCostSummaries(
  db: Db,
  companyId: string,
  projectIds: string[],
): Promise<Map<string, ProjectCostSummary>> {
  const ids = [...new Set(projectIds)];
  const result = new Map(ids.map((id) => [id, emptySummary()]));
  if (ids.length === 0) return result;

  // Sequential on purpose: these may run on an interactive transaction client.
  const bills = await db.supplierBillAllocation.groupBy({
    by: ["projectId"],
    where: { projectId: { in: ids }, bill: { companyId, status: { not: "VOID" } } },
    _sum: { amount: true },
  });
  const direct = await db.expense.groupBy({
    by: ["projectId"],
    where: { companyId, projectId: { in: ids }, voidedAt: null },
    _sum: { amount: true },
  });
  const materials = await db.rawMaterialMovement.groupBy({
    by: ["productionProjectId"],
    where: {
      companyId,
      productionProjectId: { in: ids },
      type: { in: ["ISSUE_TO_PRODUCTION", "RETURN_FROM_PRODUCTION"] },
    },
    _sum: { value: true },
  });
  const intakes = await db.stockIntake.groupBy({
    by: ["projectId"],
    where: { companyId, projectId: { in: ids }, status: "CONFIRMED" },
    _sum: { totalCost: true },
  });
  const writeOffs = await db.$queryRaw<Array<{ projectId: string; amount: Prisma.Decimal }>>`
    SELECT je."sourceId" AS "projectId", SUM(jl.credit - jl.debit) AS amount
    FROM "JournalEntry" je
    JOIN "JournalLine" jl ON jl."entryId" = je.id
    JOIN "LedgerAccount" la ON la.id = jl."accountId"
    WHERE je."companyId" = ${companyId} AND je."sourceType" = 'PRODUCTION'::"JournalSource"
      AND la.code = ${CONTROL_ACCOUNTS.WORK_IN_PROGRESS.code}
      AND je."sourceId" IN (${Prisma.join(ids)})
    GROUP BY je."sourceId"`;

  for (const row of bills) {
    if (row.projectId) result.get(row.projectId)!.billCost = money(row._sum.amount ?? 0);
  }
  for (const row of direct) {
    if (row.projectId) result.get(row.projectId)!.directCost = money(row._sum.amount ?? 0);
  }
  for (const row of materials) {
    // Issues take value out of the store (negative), returns bring it back.
    if (row.productionProjectId) {
      result.get(row.productionProjectId)!.materialCost = ZERO.minus(money(row._sum.value ?? 0));
    }
  }
  for (const row of intakes) {
    if (row.projectId) result.get(row.projectId)!.inStock = money(row._sum.totalCost ?? 0);
  }
  for (const row of writeOffs) result.get(row.projectId)!.writtenOff = money(row.amount);
  for (const s of result.values()) {
    s.totalCost = s.billCost.plus(s.directCost).plus(s.materialCost);
    s.wip = s.totalCost.minus(s.inStock).minus(s.writtenOff);
  }
  return result;
}

export async function projectCostSummary(db: Db, companyId: string, projectId: string) {
  return (await projectCostSummaries(db, companyId, [projectId])).get(projectId)!;
}

type GuardedProject = {
  id: string;
  code: string;
  name: string;
  totalCost: Prisma.Decimal;
  targetQuantity: number;
  targetUnitCost: Prisma.Decimal | null;
};

/**
 * Re-totals the cached `totalCost` on each project after a cost changes, and
 * raises the cost guard's alert on any whose cost per piece just came near its
 * target price or went over it.
 */
export async function refreshProjectCosts(tx: Tx, companyId: string, projectIds: string[]) {
  const summaries = await projectCostSummaries(tx, companyId, projectIds);
  const before = await tx.productionProject.findMany({
    where: { id: { in: [...summaries.keys()] }, companyId },
    select: {
      id: true,
      code: true,
      name: true,
      totalCost: true,
      targetQuantity: true,
      targetUnitCost: true,
    },
  });
  for (const [id, s] of summaries) {
    await tx.productionProject.update({ where: { id }, data: { totalCost: s.totalCost } });
  }
  await alertCostGuard(
    tx,
    companyId,
    before.map((p) => ({ project: p, after: { totalCost: summaries.get(p.id)!.totalCost } })),
  );
  return summaries;
}

/**
 * The cost guard's instant alert: each project whose guard got worse (fine to
 * near its target price, or to over it) messages the people who run production
 * (production.manage) in the app. `after` is what changed: its cost, or its
 * target price and pieces when those were edited.
 */
export async function alertCostGuard(
  tx: Tx,
  companyId: string,
  changes: ReadonlyArray<{
    project: GuardedProject;
    after: Partial<Pick<GuardedProject, "totalCost" | "targetQuantity" | "targetUnitCost">>;
  }>,
) {
  const alerts = changes.flatMap(({ project: p, after }) => {
    const was = costGuard(p.totalCost, p.targetQuantity, p.targetUnitCost);
    const now = costGuard(
      after.totalCost ?? p.totalCost,
      after.targetQuantity ?? p.targetQuantity,
      after.targetUnitCost === undefined ? p.targetUnitCost : after.targetUnitCost,
    );
    return now && guardWorsened(was?.level ?? null, now.level) ? [{ p, guard: now }] : [];
  });
  if (alerts.length === 0) return 0;
  const company = await tx.company.findUniqueOrThrow({
    where: { id: companyId },
    select: { currency: true },
  });
  const members = await activeMembers(companyId, tx);
  const to = membersWith(members, ["production.manage"]).map((userId) => ({ userId }));
  const amount = (value: Prisma.Decimal) =>
    `${company.currency} ${groupAmount(value.toFixed(2), company.currency)}`;
  let sent = 0;
  for (const { p, guard } of alerts) {
    sent += await sendInApp(tx, companyId, to, {
      subject: `${guardHeadline(guard.level)}: ${p.code}`,
      body: `${p.name} now costs ${amount(guard.perPiece)} a piece against a target price of ${amount(guard.target)} (${guard.percent}%).${
        guard.level === "OVER"
          ? " Check its bills and costs before adding more."
          : ` ${amount(guard.leftPerPiece)} a piece is left before it goes over.`
      }`,
      entityType: "ProductionProject",
      entityId: p.id,
    });
  }
  return sent;
}

const CLOSED: ProductionStatus[] = ["COMPLETED", "CANCELLED"];

export function isProjectClosed(project: { status: ProductionStatus }) {
  return CLOSED.includes(project.status);
}

/**
 * Locks the projects for the rest of the transaction and checks they belong to
 * the company and are still open (planned, active or on hold).
 */
export async function lockOpenProjects(
  tx: Tx,
  companyId: string,
  projectIds: string[],
  closedMessage: string,
) {
  const ids = [...new Set(projectIds)];
  await lockRows(tx, "ProductionProject", ids);
  const projects = await tx.productionProject.findMany({ where: { id: { in: ids }, companyId } });
  if (projects.length !== ids.length) {
    throw new AppError("NOT_FOUND", "Production project not found.");
  }
  for (const p of projects) {
    if (isProjectClosed(p)) {
      throw new AppError("CONFLICT", `${p.code} is ${p.status.toLowerCase()}; ${closedMessage}.`);
    }
  }
  return new Map(projects.map((p) => [p.id, p]));
}

/** Production costs are money figures: shown to Production Managers and Accounts. */
export function canSeeProductionCosts(ctx: CompanyContext) {
  return ctx.can("production.manage") || ctx.can("accounts.view");
}

export function assertCanSeeProductionCosts(ctx: CompanyContext) {
  if (!canSeeProductionCosts(ctx)) {
    throw new AppError("FORBIDDEN", "You do not have permission to see production costs.");
  }
}

/**
 * Money paid out is kept apart from producing: by default only Accounts and
 * Super Admin may pay suppliers or record a cost as paid from cash or bank.
 */
export function assertCanPayOut(ctx: CompanyContext) {
  if (!ctx.can("accounts.payments.record")) {
    throw new AppError(
      "FORBIDDEN",
      "Only Accounts can record money paid out. Save it as Due to the supplier and Accounts will pay it.",
    );
  }
}

/** Writing work in progress off as a loss is an accounting decision. */
export function assertCanWriteOff(ctx: CompanyContext, amount: Prisma.Decimal) {
  if (!ctx.can("accounts.manage")) {
    throw new AppError(
      "FORBIDDEN",
      `${amount.toFixed(2)} of cost would be written off as a loss; only Accounts can do that.`,
    );
  }
}

/** Dr Production Losses / Cr Work in Progress for cost that will never reach stock. */
export async function writeOffProjectWip(
  tx: Tx,
  ctx: CompanyContext,
  project: { id: string; code: string },
  amount: Prisma.Decimal,
  reason: string,
) {
  if (amount.lte(0)) return null;
  const acc = await ensureControlAccounts(ctx.company.id, tx);
  return postJournalEntry(tx, {
    companyId: ctx.company.id,
    description: `Production cost written off — ${project.code}: ${reason}`,
    sourceType: "PRODUCTION",
    sourceId: project.id,
    postedById: ctx.user.id,
    lines: [
      { accountId: acc.PRODUCTION_LOSS, debit: amount, memo: project.code },
      { accountId: acc.WORK_IN_PROGRESS, credit: amount, memo: project.code },
    ],
  });
}
