import { type CostAllocationMethod, Prisma, type StockGrade } from "@prisma/client";

import type { Db } from "@/lib/db-types";
import { lockRows } from "@/lib/row-lock";
import { ensureControlAccounts } from "@/modules/accounts/control-accounts";
import { postJournalEntry } from "@/modules/accounts/journal.service";
import type { CompanyContext } from "@/modules/auth/context";
import { gradeCost, gradeCostData, gradeKey, onHandByGrade } from "@/modules/inventory/costs";
import { evenOutPieceCost, inStockShare, money, ZERO } from "@/modules/production/costing";

/*
 * One cost for every piece of a completed project ("into the received pieces",
 * the owner's choice for a factory that delivers short). Each delivery carries
 * its share of the project's cost into stock as it comes, the last one taking
 * whatever is left, so pieces from different deliveries can stand at different
 * costs. Completing the project spreads all that reached stock again over every
 * piece received: total ÷ received, B-grade at its share when the last delivery
 * valued it lower. Pieces short of the target are wastage, with no loss booked.
 *
 * The difference each delivery line gains or gives up is kept on the line
 * (costAdjustment). Pieces still in stock take it into their SKU grade's average
 * cost; for pieces already sold it goes to Cost of Goods Sold, the newest pieces
 * being taken as the ones left. Only that move between the two is posted:
 *   Dr Finished Goods Inventory  Cr Cost of Goods Sold  (or the other way round)
 * Undoing a delivery of a completed project reopens it and takes the evening
 * out back first, so the delivery leaves at the cost it came in at.
 */

type Tx = Prisma.TransactionClient;

type PieceLine = {
  id: string;
  variantId: string;
  grade: StockGrade;
  quantity: number;
  unitCost: Prisma.Decimal;
  costAdjustment: Prisma.Decimal;
  intake: {
    id: string;
    confirmedAt: Date | null;
    costAllocation: CostAllocationMethod;
    bGradeCostRatio: Prisma.Decimal | null;
  };
};

/** A project's confirmed delivery lines, the latest delivery's first. */
async function confirmedLines(db: Db, companyId: string, projectId: string) {
  const lines: PieceLine[] = await db.stockIntakeLine.findMany({
    where: { intake: { companyId, projectId, status: "CONFIRMED" } },
    select: {
      id: true,
      variantId: true,
      grade: true,
      quantity: true,
      unitCost: true,
      costAdjustment: true,
      intake: {
        select: { id: true, confirmedAt: true, costAllocation: true, bGradeCostRatio: true },
      },
    },
    orderBy: { id: "asc" },
  });
  return lines.sort(
    (a, b) =>
      (b.intake.confirmedAt?.getTime() ?? 0) - (a.intake.confirmedAt?.getTime() ?? 0) ||
      b.intake.id.localeCompare(a.intake.id),
  );
}

/**
 * What a project's pieces cost now, A- and B-grade apart: what their
 * deliveries carried into stock, evened out once the project was completed.
 * Also how the latest delivery split cost, which evening out follows.
 */
export async function projectPieceCosts(db: Db, companyId: string, projectId: string) {
  const lines = await confirmedLines(db, companyId, projectId);
  const of = (grade: StockGrade) => {
    const mine = lines.filter((l) => l.grade === grade);
    return {
      pieces: mine.reduce((s, l) => s + l.quantity, 0),
      value: money(
        mine.reduce((s, l) => s.plus(l.unitCost.times(l.quantity)).plus(l.costAdjustment), ZERO),
      ),
    };
  };
  const latest = lines[0]?.intake ?? null;
  return {
    a: of("A_GRADE"),
    b: of("B_GRADE"),
    method: latest?.costAllocation ?? null,
    bGradeRatio: latest?.bGradeCostRatio ?? null,
    evened: lines.some((l) => !l.costAdjustment.isZero()),
  };
}

/**
 * Evens a project's pieces out to one cost (`even`, as it is completed) or puts
 * them back at the cost each delivery carried (`reset`, before one is undone).
 * Inside the caller's transaction, with the project locked. Returns the cost a
 * piece of each grade now carries (null when nothing was evened out: no
 * deliveries, or typed costs kept) and the value moved between stock and the
 * cost of pieces sold.
 */
export async function evenOutPieceCostTx(
  tx: Tx,
  ctx: CompanyContext,
  project: { id: string; code: string },
  mode: "even" | "reset",
) {
  const companyId = ctx.company.id;
  const lines = await confirmedLines(tx, companyId, project.id);
  if (lines.length === 0) return { even: null, toStock: ZERO };
  const latest = lines[0]!.intake;
  const even =
    mode === "even"
      ? evenOutPieceCost({
          lines,
          method: latest.costAllocation,
          bGradeRatio: latest.bGradeCostRatio,
        })
      : null;
  const changes = lines.map((line, i) => {
    const target = even?.adjustments[i] ?? ZERO;
    return { line, target, change: target.minus(line.costAdjustment) };
  });
  if (changes.every((c) => c.change.isZero())) return { even, toStock: ZERO };

  // Each SKU grade's lines, newest first, for the pieces still in stock.
  const groups = new Map<string, typeof changes>();
  for (const c of changes) {
    const key = gradeKey(c.line.variantId, c.line.grade);
    groups.set(key, [...(groups.get(key) ?? []), c]);
  }
  const variantIds = [...new Set(changes.map((c) => c.line.variantId))];
  await lockRows(tx, "ProductVariant", variantIds);
  const onHand = await onHandByGrade(tx, variantIds);
  const variants = await tx.productVariant.findMany({
    where: { id: { in: variantIds } },
    select: { id: true, avgCost: true, bGradeAvgCost: true },
  });
  const costs = new Map(variants.map((v) => [v.id, v]));
  const updates = new Map<string, Prisma.ProductVariantUpdateInput>();
  let toStock = ZERO;
  for (const [key, group] of groups) {
    if (group.every((c) => c.change.isZero())) continue;
    const { variantId, grade } = group[0]!.line;
    const held = onHand.get(key) ?? 0;
    const share = inStockShare(
      group.map((c) => ({ quantity: c.line.quantity, change: c.change })),
      held,
    );
    if (held <= 0 || share.isZero()) continue;
    const before = gradeCost(costs.get(variantId)!, grade);
    const after = Prisma.Decimal.max(
      before.times(held).plus(share).dividedBy(held),
      ZERO,
    ).toDecimalPlaces(4, Prisma.Decimal.ROUND_HALF_UP);
    if (after.equals(before)) continue;
    updates.set(variantId, { ...updates.get(variantId), ...gradeCostData(grade, after) });
    toStock = toStock.plus(after.minus(before).times(held));
  }
  for (const [id, data] of updates) await tx.productVariant.update({ where: { id }, data });
  for (const c of changes) {
    if (c.change.isZero()) continue;
    await tx.stockIntakeLine.update({
      where: { id: c.line.id },
      data: { costAdjustment: c.target },
    });
  }

  const amount = money(toStock);
  if (!amount.isZero()) {
    const acc = await ensureControlAccounts(companyId, tx);
    const value = amount.abs();
    const memo = project.code;
    await postJournalEntry(tx, {
      companyId,
      description:
        mode === "even"
          ? `Cost per piece evened out — ${project.code} completed`
          : `Cost per piece put back — ${project.code} reopened`,
      sourceType: "PRODUCTION",
      sourceId: project.id,
      postedById: ctx.user.id,
      lines: amount.gt(0)
        ? [
            { accountId: acc.INVENTORY, debit: value, memo },
            { accountId: acc.COGS, credit: value, memo },
          ]
        : [
            { accountId: acc.COGS, debit: value, memo },
            { accountId: acc.INVENTORY, credit: value, memo },
          ],
    });
  }
  return { even, toStock: amount };
}
