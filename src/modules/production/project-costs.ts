import { Prisma, type ProductionStatus } from "@prisma/client";

import type { Db } from "@/lib/db-types";
import { AppError } from "@/lib/errors";
import { lockRows } from "@/lib/row-lock";
import { CONTROL_ACCOUNTS, ensureControlAccounts } from "@/modules/accounts/control-accounts";
import { postJournalEntry } from "@/modules/accounts/journal.service";
import type { CompanyContext } from "@/modules/auth/context";
import { money, ZERO } from "@/modules/production/costing";

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

/** Re-totals the cached `totalCost` on each project after a cost changes. */
export async function refreshProjectCosts(tx: Tx, companyId: string, projectIds: string[]) {
  const summaries = await projectCostSummaries(tx, companyId, projectIds);
  for (const [id, s] of summaries) {
    await tx.productionProject.update({ where: { id }, data: { totalCost: s.totalCost } });
  }
  return summaries;
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
