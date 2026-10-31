import type {
  BillStatus,
  CostAllocationMethod,
  ExpenseCategory,
  PaymentType,
  Prisma,
  ProductionStatus,
  StockGrade,
} from "@prisma/client";

import { addDays, dateOnly, localDay } from "@/lib/dates";
import { AppError } from "@/lib/errors";
import { prisma } from "@/lib/prisma";
import { assertAllowed } from "@/lib/verdict";
import { ensureControlAccounts } from "@/modules/accounts/control-accounts";
import { listMoneyAccounts } from "@/modules/accounts/screens.service";
import type { CompanyContext } from "@/modules/auth/context";
import { listSizes } from "@/modules/inventory/catalog.service";
import { getStyleMatrix, listRatioPresets, matrixAxes } from "@/modules/inventory/matrix.service";
import { listCategoryOptions } from "@/modules/inventory/screens.service";
import { getDefaultWarehouse, listWarehouses } from "@/modules/inventory/stock.service";
import { listStyles } from "@/modules/inventory/style.service";
import { canSeeMaterialCosts } from "@/modules/materials/access";
import { findOpenBatches } from "@/modules/production/batch.service";
import { boardColumns, nextStage } from "@/modules/production/board";
import { projectChallans } from "@/modules/production/challan.service";
import { isWalkIn } from "@/modules/parties/walk-in";
import {
  billShares,
  getBill,
  getProjectCostSheet,
  listBills,
  listCostHeads,
} from "@/modules/production/cost.service";
import type { CostGuard } from "@/modules/production/cost-guard";
import { DEFAULT_B_GRADE_RATIO, evenCostPerPiece, money, ZERO } from "@/modules/production/costing";
import { getIntake, listIntakes } from "@/modules/production/intake.service";
import { projectPieceCosts } from "@/modules/production/piece-cost.service";
import {
  canSeeProductionCosts,
  projectCostSummaries,
  projectCostSummary,
} from "@/modules/production/project-costs";
import {
  DEFAULT_PRODUCTION_LEAD_DAYS,
  getProductionOverview,
  getProject,
  listProjects,
  proformaTargets,
} from "@/modules/production/project.service";
import {
  canAddCost,
  canCancelProject,
  canChangeDelivery,
  canCompleteProject,
  canPayBill,
  canReceiveGoods,
  canSendMaterial,
  canSetStage,
  canSetStatus,
  canStartFromOrder,
  canStartFromProforma,
  canUndoDelivery,
  canVoidBill,
  canVoidDirectCost,
  canWriteOffOnClose,
  isDraftDelivery,
  ORDER_OPEN_FOR_PRODUCTION,
  stageMoves,
} from "@/modules/production/rules";
import { projectSupplierRows } from "@/modules/production/settlement.service";
import {
  lessTargets,
  sumTargets,
  targetTotal,
  type UnplacedReason,
} from "@/modules/production/targets";
import { deliveredByVariant } from "@/modules/sales/documents.service";
import { STAGE_LABELS, STAGE_ORDER } from "@/modules/production/timeline";

/*
 * What the Production screens show, as plain values (amounts as "12500.00"
 * strings, days as "2026-10-08" in company time), with what the person looking
 * may do decided by the same permissions and rules the production actions use:
 *   production.view           projects, their stages and deliveries
 *   production.manage         projects, stages, cost heads, Due bills, voiding
 *                             bills, undoing a confirmed delivery
 *   production.stock_intake   factory deliveries (Move to Stock)
 *   accounts.payments.record  money paid out: Cash/Bank costs, paying bills
 *   accounts.manage           writing off cost that never reached stock
 * and the rules in production/rules.ts. Costs (bills, cost per piece, the A- and
 * B-grade costs) show only to production.manage and accounts.view holders.
 */

type Amount = Prisma.Decimal;
const fixed = (value: Amount) => value.toFixed(2);

/** What this person may do anywhere in Production (each screen narrows it to the record). */
export function productionAccess(ctx: CompanyContext) {
  const manage = ctx.can("production.manage");
  const payOut = ctx.can("accounts.payments.record");
  const writeOff = ctx.can("accounts.manage");
  return {
    manage,
    /** Factory deliveries: Move to Stock. */
    receive: ctx.can("production.stock_intake"),
    seeCosts: canSeeProductionCosts(ctx),
    payOut,
    writeOff,
    /** Bills and costs go on projects (Due); paying them needs payOut. */
    recordCosts: manage || payOut,
    /** Completing and cancelling: Production, or Accounts when cost is written off. */
    close: manage || writeOff,
    voidBills: manage || writeOff,
    /** Open a buyer's or supplier's profile (Buyers & suppliers). */
    openParty: ctx.can("parties.view"),
  };
}

type PartyLike = { id: string; code: string; name: string };
const partyOf = (party: PartyLike | null) =>
  party ? { id: party.id, code: party.code, name: party.name } : null;

// =============================================================================
// Projects: the Overview cards and the list
// =============================================================================

type ProjectCard = Awaited<ReturnType<typeof listProjects>>["items"][number];

/** The cost guard as plain values: the level, the cost per piece and the target price. */
export function presentGuard(guard: CostGuard | null) {
  return guard
    ? {
        level: guard.level,
        perPiece: fixed(guard.perPiece),
        target: fixed(guard.target),
        percent: guard.percent,
        leftPerPiece: fixed(guard.leftPerPiece),
      }
    : null;
}

export type CostGuardData = NonNullable<ReturnType<typeof presentGuard>>;

export function presentCard(card: ProjectCard, tz: string) {
  const t = card.timeline;
  return {
    id: card.id,
    code: card.code,
    name: card.name,
    batch: card.batch ? { id: card.batch.id, code: card.batch.code, name: card.batch.name } : null,
    status: card.status,
    stage: card.stage,
    buyer: partyOf(card.buyer),
    isInHouse: card.isInHouse,
    factory: card.factory ? { id: card.factory.id, name: card.factory.name } : null,
    factoryLabel: card.factoryLabel,
    category: card.category ? { id: card.category.id, name: card.category.name } : null,
    style: card.style ? { id: card.style.id, code: card.style.code, name: card.style.name } : null,
    proforma: card.proforma ? { id: card.proforma.id, number: card.proforma.number } : null,
    salesOrder: card.salesOrder ? { id: card.salesOrder.id, number: card.salesOrder.number } : null,
    startOn: localDay(card.startDate, tz),
    targetOn: localDay(card.targetDate, tz),
    completedOn: card.completedAt ? localDay(card.completedAt, tz) : null,
    timeline: {
      totalDays: t.totalDays,
      elapsedDays: t.elapsedDays,
      remainingDays: t.remainingDays,
      isOverdue: t.isOverdue,
      overdueDays: t.overdueDays,
      dueSoon: t.dueSoon,
      health: t.health,
      timeElapsedPercent: t.timeElapsedPercent,
    },
    quantities: card.quantities,
    /** Production Managers and Accounts only: the target price and the cost guard. */
    targetUnitCost: card.targetUnitCost ? fixed(card.targetUnitCost) : null,
    costGuard: presentGuard(card.costGuard),
    /** Production Managers and Accounts only. */
    costs: card.costs
      ? {
          totalCost: fixed(card.costs.totalCost),
          inStock: fixed(card.costs.inStock),
          wip: fixed(card.costs.wip),
          estimatedCostPerPiece: fixed(card.costs.estimatedCostPerPiece),
        }
      : null,
  };
}

export type ProjectCardData = ReturnType<typeof presentCard>;

/**
 * The Production Overview: the board (a column per stage, Planned first, with a
 * card per open project, late ones first), the counts, and for people who see
 * costs what sits in production. A Production Manager moves an active project
 * to its next stage from its card (`next`).
 */
export async function getOverviewScreen(ctx: CompanyContext) {
  const overview = await getProductionOverview(ctx);
  const access = productionAccess(ctx);
  const tz = ctx.company.timezone;
  const cards = overview.projects.map((card) => {
    const to = nextStage(card.stage.key);
    return {
      ...presentCard(card, tz),
      /** The stage the card moves to in one click; null when not offered. */
      next:
        access.manage && to && canSetStage({ ...card, stage: card.stage.key }, to).ok ? to : null,
    };
  });
  return {
    today: overview.today,
    counts: overview.counts,
    totals: overview.totals
      ? {
          totalCost: fixed(overview.totals.totalCost),
          inStock: fixed(overview.totals.inStock),
          wip: fixed(overview.totals.wip),
        }
      : null,
    columns: boardColumns(cards, (c) => ({
      status: c.status,
      stage: c.stage.key,
      late: c.timeline.isOverdue,
    })),
    canCreate: access.manage,
  };
}

export type BoardCardData = OverviewScreen["columns"][number]["projects"][number];

export type OverviewScreen = Awaited<ReturnType<typeof getOverviewScreen>>;

export async function listProjectRows(ctx: CompanyContext, raw: unknown = {}) {
  const page = await listProjects(ctx, raw);
  const tz = ctx.company.timezone;
  return { items: page.items.map((card) => presentCard(card, tz)), nextCursor: page.nextCursor };
}

/** The Projects tab: the first page, and whether this person may start a project. */
export async function getProjectList(ctx: CompanyContext, raw: unknown = {}) {
  return { ...(await listProjectRows(ctx, raw)), canCreate: productionAccess(ctx).manage };
}

export type ProjectList = Awaited<ReturnType<typeof getProjectList>>;

// =============================================================================
// One project
// =============================================================================

type ProjectData = Awaited<ReturnType<typeof getProject>>;
type StepState = "done" | "current" | "upcoming" | "stopped";

/**
 * The five working stages (Fabric sourcing to Finishing) with how far the
 * project got: when each stage started and ended, the days spent in it (added
 * up when it was worked on more than once) and whether it is done, current or
 * still to come.
 */
function stageSteps(project: ProjectData, tz: string) {
  const current = STAGE_ORDER.indexOf(project.stage.key);
  const working = project.status === "ACTIVE" || project.status === "ON_HOLD";
  return STAGE_ORDER.filter((s) => s !== "COMPLETED").map((stage, index) => {
    const visits = project.stageHistory.filter((log) => log.stage === stage);
    let state: StepState = "upcoming";
    if (project.status === "COMPLETED" || (index < current && project.status !== "PLANNED")) {
      state = "done";
    } else if (index === current) {
      state = working ? "current" : project.status === "CANCELLED" ? "stopped" : "upcoming";
    }
    const last = visits[visits.length - 1];
    return {
      stage,
      label: STAGE_LABELS[stage],
      state,
      startedOn: visits[0] ? localDay(visits[0].startedAt, tz) : null,
      endedOn: last?.completedAt ? localDay(last.completedAt, tz) : null,
      days: visits.reduce((s, v) => s + v.days, 0),
      /** Worked on more than once (a later stage sent it back). */
      visits: visits.length,
    };
  });
}

/** The stage log, newest first; a move to an earlier stage is rework. */
function stageLog(project: ProjectData, tz: string) {
  return project.stageHistory
    .map((log, i, all) => ({
      id: log.id,
      stage: log.stage,
      label: log.label,
      startedOn: localDay(log.startedAt, tz),
      endedOn: log.completedAt ? localDay(log.completedAt, tz) : null,
      days: log.days,
      note: log.note,
      isRework: i > 0 && STAGE_ORDER.indexOf(log.stage) < STAGE_ORDER.indexOf(all[i - 1]!.stage),
    }))
    .reverse();
}

type GradeCost = { pieces: number; value: string; perPiece: string | null };

const perPieceText = (cost: { a: Amount | null; b: Amount | null } | null) =>
  cost
    ? { a: cost.a ? fixed(money(cost.a)) : null, b: cost.b ? fixed(money(cost.b)) : null }
    : null;

/**
 * What the pieces received so far cost, A- and B-grade apart: the cost each
 * confirmed delivery moved into stock with them, per piece of each grade, and
 * once the project is completed the one cost they were all evened out to. Also
 * what completing it now would even them out to (`whenCompleted`).
 */
async function gradeCosts(
  ctx: CompanyContext,
  projectId: string,
  inStock: Amount,
): Promise<{
  a: GradeCost;
  b: GradeCost;
  evened: boolean;
  whenCompleted: { a: string | null; b: string | null } | null;
}> {
  const costs = await projectPieceCosts(prisma, ctx.company.id, projectId);
  const of = (grade: { pieces: number; value: Amount }): GradeCost => ({
    pieces: grade.pieces,
    value: fixed(grade.value),
    perPiece: grade.pieces > 0 ? fixed(money(grade.value.dividedBy(grade.pieces))) : null,
  });
  return {
    a: of(costs.a),
    b: of(costs.b),
    evened: costs.evened,
    whenCompleted: costs.method
      ? perPieceText(
          evenCostPerPiece({
            aPieces: costs.a.pieces,
            bPieces: costs.b.pieces,
            total: inStock,
            method: costs.method,
            bGradeRatio: costs.bGradeRatio,
          }),
        )
      : null,
  };
}

type CostSheet = Awaited<ReturnType<typeof getProjectCostSheet>>;

const MATERIAL_LABEL = { MATERIAL_ISSUE: "Raw materials issued", MATERIAL_RETURN: "Returned" };

/** Each cost on the project: bill shares, costs paid from cash or bank, materials. */
function costEntries(
  sheet: CostSheet,
  project: { code: string; status: ProductionStatus; wip: Amount },
  canVoid: boolean,
  tz: string,
) {
  return sheet.entries.map((e) => {
    const base = {
      id: e.id,
      kind: e.kind,
      on: localDay(e.date, tz),
      number: e.number,
      amount: fixed(e.amount),
      description: e.description,
      isVoid: e.isVoid,
    };
    if (e.kind === "BILL") {
      return {
        ...base,
        label: e.head.name,
        from: e.supplier.name,
        billId: e.billId,
        paymentType: e.paymentType as PaymentType,
        billStatus: e.billStatus as BillStatus | null,
        voidReason: null,
        canVoid: false,
      };
    }
    if (e.kind === "DIRECT") {
      return {
        ...base,
        label: e.head.name,
        from: e.boughtBy
          ? `Bought by ${e.boughtBy.name}, owed to them`
          : e.paidFrom
            ? `Paid from ${e.paidFrom.name}`
            : "Paid",
        billId: null,
        paymentType: e.paymentType as PaymentType,
        billStatus: null,
        voidReason: e.voidReason ?? null,
        canVoid:
          canVoid &&
          canVoidDirectCost({ number: e.number, amount: e.amount, isVoid: e.isVoid }, project).ok,
      };
    }
    return {
      ...base,
      label: MATERIAL_LABEL[e.kind],
      from: e.warehouse.name,
      billId: null,
      paymentType: null,
      billStatus: null,
      voidReason: null,
      canVoid: false,
    };
  });
}

/**
 * One project: its timeline and stages (how far cutting, sewing and the rest
 * got), the pieces received by grade, its deliveries, and for people who see
 * costs the cost sheet and what an A- and a B-grade piece cost. What may be
 * done comes from the same rules the production actions use.
 */
export async function getProjectScreen(ctx: CompanyContext, projectId: string) {
  const project = await getProject(ctx, projectId);
  const access = productionAccess(ctx);
  const tz = ctx.company.timezone;
  const state = { code: project.code, status: project.status, stage: project.stage.key };
  const [summary, targets, challans] = await Promise.all([
    projectCostSummary(prisma, ctx.company.id, project.id),
    targetTable(ctx, project.id, project.targets, project.status === "COMPLETED"),
    projectChallans(ctx, project.id),
  ]);
  const wip = summary.wip;
  const [sheet, grades, suppliers] = access.seeCosts
    ? await Promise.all([
        getProjectCostSheet(ctx, project.id),
        gradeCosts(ctx, project.id, summary.inStock),
        projectSupplierRows(prisma, ctx, {
          id: project.id,
          status: project.status,
          completedAt: project.completedAt,
        }),
      ])
    : [null, null, null];
  const openDelivery = project.deliveries.find((d) => isDraftDelivery(d)) ?? null;
  const writeOff = canWriteOffOnClose(wip, access.writeOff).ok;
  const completable = access.close && canCompleteProject(state, openDelivery).ok;
  const cancellable = access.close && canCancelProject(state).ok;
  const open = canAddCost(state).ok;
  const wipText = access.seeCosts ? fixed(wip) : null;

  return {
    project: {
      ...presentCard({ ...project, costs: null }, tz),
      notes: project.notes,
      steps: stageSteps(project, tz),
      log: stageLog(project, tz),
      deliveries: project.deliveries.map((d) => ({
        id: d.id,
        number: d.number,
        status: d.status,
        pieces: d.pieces,
        bGradePieces: d.bGradePieces,
        totalCost: d.totalCost ? fixed(d.totalCost) : null,
        madeOn: localDay(d.createdAt, tz),
        confirmedOn: d.confirmedAt ? localDay(d.confirmedAt, tz) : null,
      })),
      /** The pieces to make per colour and size, with those received; null without a grid. */
      targets,
    },
    /** The cost sheet: Production Managers and Accounts only. */
    costs:
      sheet && grades
        ? {
            billCost: fixed(sheet.summary.billCost),
            directCost: fixed(sheet.summary.directCost),
            materialCost: fixed(sheet.summary.materialCost),
            totalCost: fixed(sheet.summary.totalCost),
            inStock: fixed(sheet.summary.inStock),
            writtenOff: fixed(sheet.summary.writtenOff),
            wip: fixed(sheet.summary.wip),
            estimatedCostPerPiece: fixed(sheet.summary.estimatedCostPerPiece),
            actualCostPerPiece: sheet.summary.actualCostPerPiece
              ? fixed(sheet.summary.actualCostPerPiece)
              : null,
            grades: { a: grades.a, b: grades.b },
            /** Completed: every piece received was evened out to one cost (total ÷ received). */
            evened: project.status === "COMPLETED" && grades.evened,
            byHead: sheet.byHead.map((h) => ({
              headId: h.headId,
              name: h.name,
              category: h.category as ExpenseCategory,
              amount: fixed(h.amount),
            })),
            materials: sheet.byMaterial.map((m) => ({
              id: m.material.id,
              code: m.material.code,
              name: m.material.name,
              unit: m.material.unit,
              quantity: m.netQuantity.toFixed(3).replace(/\.?0+$/, ""),
              amount: fixed(m.netValue),
            })),
            entries: costEntries(sheet, { ...state, wip }, access.payOut, tz),
          }
        : null,
    /**
     * Each supplier's bills for the project, what is paid and what it still owes
     * them; once completed, the settlement statements (balance zero, the rest
     * left on their ledger). Production Managers and Accounts only.
     */
    suppliers,
    /** "Materials sent": the project's material challans (MC-), with no prices. */
    materialsSent: {
      challans,
      /** Where a new challan goes unless changed: the project's factory. */
      sentTo: project.factoryLabel,
      today: localDay(new Date(), tz),
    },
    can: {
      edit: access.manage,
      /** Where the stage badge may move (empty unless active). */
      stages: access.manage ? stageMoves(state) : [],
      start: access.manage && project.status === "PLANNED" && canSetStatus(state, "ACTIVE").ok,
      hold: access.manage && canSetStatus(state, "ON_HOLD").ok,
      resume: access.manage && project.status === "ON_HOLD" && canSetStatus(state, "ACTIVE").ok,
      complete: completable && writeOff,
      cancel: cancellable && writeOff,
      /** Completing or cancelling writes the cost left in production off (the amount for people who see costs). */
      writeOff: wip.gt(0) ? { amount: wipText } : null,
      addDueCost: access.recordCosts && open,
      addPaidCost: access.payOut && open,
      newBill: access.recordCosts && open,
      receive: access.receive && canReceiveGoods(state).ok,
      sendMaterial: access.manage && canSendMaterial(state).ok,
      cancelChallan: access.manage,
      openDelivery: openDelivery ? { id: openDelivery.id, number: openDelivery.number } : null,
      openParty: access.openParty,
    },
    /**
     * What completing it now means: pieces short of the target are listed as
     * wastage (no loss booked) and, for people who see costs, what each piece
     * received would cost once evened out (what reached stock ÷ pieces received).
     */
    completion: {
      short: project.quantities.remaining,
      perPiece: grades?.whenCompleted ?? null,
    },
    /** Why completing or cancelling, which this person could otherwise do, is not offered. */
    notes: {
      complete:
        access.close && !completable && openDelivery && canCompleteProject(state, null).ok
          ? `Confirm or cancel the open delivery ${openDelivery.number} before completing ${project.code}.`
          : completable && !writeOff
            ? `${wipText ? `${wipText} of ` : "Some of "}${project.code}'s cost has not moved to stock yet. Receive the final delivery, or ask Accounts to complete it and write the rest off.`
            : null,
    },
  };
}

export type ProjectScreen = Awaited<ReturnType<typeof getProjectScreen>>;

/**
 * What the project form needs: categories, today and the usual target day for a
 * new project, or an existing project's values and which of them are locked
 * (a closed project keeps all but its name and notes; one started from a
 * proforma or a sales order keeps its buyer), and the pieces to make per colour
 * and size (`blocks`, a style each). "Start production" on an order or a
 * proforma (`from`) fills a new project in from it (`source`); "Order now" on
 * the Home screen's low stock (`from.restockStyleId`) starts an in-house one for
 * the style (`restock`).
 */
export async function getProjectForm(
  ctx: CompanyContext,
  projectId?: string,
  from: { orderId?: string; proformaId?: string; restockStyleId?: string; batchId?: string } = {},
) {
  const tz = ctx.company.timezone;
  const today = localDay(new Date(), tz);
  const [categories, batches, presets] = await Promise.all([
    listCategoryOptions(ctx),
    findOpenBatches(ctx),
    listRatioPresets(ctx),
  ]);
  // "Add a style" on a batch: the new project starts in it, at its factory and by its day.
  const inBatch = from.batchId && !projectId ? batches.find((b) => b.id === from.batchId) : null;
  if (from.batchId && !projectId && !inBatch) {
    throw new AppError("NOT_FOUND", "That master batch is not open for new styles.");
  }
  const base = {
    today,
    defaultTargetOn: inBatch?.targetOn ?? addDays(today, DEFAULT_PRODUCTION_LEAD_DAYS),
    categories: categories.map((c) => ({ id: c.id, label: c.path.join(" › ") })),
    /** Open master batches a style can join, and the one it starts in. */
    batches,
    batch: inBatch ?? null,
    /** Size ratios ("S 1, M 2, L 2, XL 1") to fill a colour's sizes from a total. */
    ratioPresets: presets.map((p) => ({
      id: p.id,
      name: p.name,
      entries: p.entries.map((e) => ({ sizeId: e.sizeId, sizeName: e.size.name, ratio: e.ratio })),
    })),
  };
  if (!projectId) {
    if (from.restockStyleId && !from.orderId && !from.proformaId) {
      const restock = await restockSource(ctx, from.restockStyleId);
      return {
        ...base,
        project: null,
        locked: null,
        source: null,
        restock: restock.restock,
        blocks: restock.blocks,
      };
    }
    const started = await formSource(ctx, from, base.defaultTargetOn, today);
    return {
      ...base,
      project: null,
      locked: null,
      source: started?.source ?? null,
      restock: null,
      blocks: started?.blocks ?? [],
    };
  }
  const p = await ctx.db.productionProject.findUnique({
    where: { id: projectId },
    include: {
      style: { select: { id: true, code: true, name: true } },
      factory: { select: { id: true, code: true, name: true } },
      buyer: { select: { id: true, code: true, name: true } },
      proforma: { select: { id: true, number: true } },
      salesOrder: { select: { id: true, number: true } },
      batch: { select: { id: true, code: true, name: true } },
      targetLines: { select: { variantId: true, quantity: true } },
    },
  });
  if (!p) throw new AppError("NOT_FOUND", "Production project not found.");
  const closed = p.status === "COMPLETED" || p.status === "CANCELLED";
  // Its own batch stays a choice even once that batch is done.
  const batchChoices =
    p.batch && !batches.some((b) => b.id === p.batch!.id)
      ? [{ ...p.batch, kind: "CM" as const, factory: null, targetOn: null }, ...batches]
      : batches;
  return {
    ...base,
    batches: batchChoices,
    source: null,
    restock: null,
    blocks: await formBlocks(ctx, sumTargets(p.targetLines)),
    project: {
      id: p.id,
      code: p.code,
      name: p.name,
      batch: p.batch,
      targetUnitCost: p.targetUnitCost ? fixed(p.targetUnitCost) : null,
      status: p.status,
      categoryId: p.categoryId,
      style: p.style,
      factory: p.factory,
      factoryName: p.factoryName,
      buyer: p.buyer,
      startOn: localDay(p.startDate, tz),
      targetOn: localDay(p.targetDate, tz),
      targetQuantity: p.targetQuantity,
      notes: p.notes,
      proforma: p.proforma,
      salesOrder: p.salesOrder,
    },
    locked: { closed, buyer: Boolean(p.proformaId || p.salesOrderId) },
  };
}

export type ProjectForm = Awaited<ReturnType<typeof getProjectForm>>;

/**
 * The colours by sizes of the styles given, from one read of their SKUs: those
 * on the style's matrix, and the ones in `keep` even if taken off it since.
 */
async function styleGrids(ctx: CompanyContext, styleIds: string[], keep: string[] = []) {
  if (styleIds.length === 0) return [];
  const [styles, variants] = await Promise.all([
    ctx.db.style.findMany({
      where: { id: { in: styleIds } },
      select: { id: true, code: true, name: true, isActive: true },
    }),
    ctx.db.productVariant.findMany({
      where: { styleId: { in: styleIds }, OR: [{ removedAt: null }, { id: { in: keep } }] },
      select: {
        id: true,
        sku: true,
        isActive: true,
        styleId: true,
        color: { select: { id: true, name: true, hexCode: true, sortOrder: true } },
        size: { select: { id: true, name: true, sortOrder: true } },
      },
    }),
  ]);
  const byId = new Map(styles.map((style) => [style.id, style]));
  return styleIds.flatMap((styleId): IntakeMatrix[] => {
    const style = byId.get(styleId);
    if (!style) return [];
    const ofStyle = variants.filter((v) => v.styleId === styleId);
    const { colors, sizes } = matrixAxes(ofStyle);
    const byCell = new Map(ofStyle.map((v) => [`${v.color.id}:${v.size.id}`, v]));
    return [
      {
        style,
        sizes: sizes.map((size) => ({ id: size.id, name: size.name })),
        rows: colors.map((color) => ({
          color: { id: color.id, name: color.name, hexCode: color.hexCode },
          cells: sizes.map((size) => {
            const v = byCell.get(`${color.id}:${size.id}`);
            return v ? { variantId: v.id, sku: v.sku, isActive: v.isActive } : null;
          }),
        })),
      },
    ];
  });
}

/** The styles of the SKUs given, in the order their SKUs come. */
async function stylesOf(ctx: CompanyContext, variantIds: string[]) {
  if (variantIds.length === 0) return [];
  const rows = await ctx.db.productVariant.findMany({
    where: { id: { in: variantIds } },
    select: { id: true, styleId: true },
  });
  const styleOf = new Map(rows.map((v) => [v.id, v.styleId]));
  return [...new Set(variantIds.flatMap((id) => styleOf.get(id) ?? []))];
}

/** The form's grid: a block per style with its pieces per SKU. */
async function formBlocks(ctx: CompanyContext, targets: ReadonlyMap<string, number>) {
  const ids = [...targets.keys()];
  const grids = await styleGrids(ctx, await stylesOf(ctx, ids), ids);
  return grids.map((matrix) => {
    const skus = new Set(
      matrix.rows.flatMap((r) => r.cells.flatMap((c) => (c ? c.variantId : []))),
    );
    return {
      matrix,
      quantities: Object.fromEntries([...targets].filter(([id]) => skus.has(id))),
    };
  });
}

/**
 * "Order now" on the Home screen's low stock: a new in-house project for the
 * style, its colours and sizes ready to fill in, and which of its SKUs are below
 * the low stock threshold (available A-grade pieces, as the Insights count them).
 */
async function restockSource(ctx: CompanyContext, styleId: string) {
  const style = await ctx.db.style.findUnique({
    where: { id: styleId },
    select: { id: true, code: true, name: true, categoryId: true },
  });
  if (!style) throw new AppError("NOT_FOUND", "Style not found.");
  const threshold = ctx.company.lowStockThreshold;
  const [grids, balances] = await Promise.all([
    styleGrids(ctx, [style.id]),
    ctx.db.stockBalance.groupBy({
      by: ["variantId", "grade"],
      where: { variant: { styleId: style.id } },
      _sum: { quantity: true, reserved: true },
    }),
  ]);
  const available = new Map<string, number>();
  for (const b of balances) {
    const before = available.get(b.variantId) ?? 0;
    const sellable = b.grade === "A_GRADE" ? (b._sum.quantity ?? 0) - (b._sum.reserved ?? 0) : 0;
    available.set(b.variantId, before + sellable);
  }
  const matrix = grids[0];
  // SKUs stocked before and now below the threshold; a cell never made is not "low".
  const low = (matrix?.rows ?? [])
    .flatMap((row) =>
      row.cells.flatMap((cell, i) => {
        if (!cell || !cell.isActive || !available.has(cell.variantId)) return [];
        const left = available.get(cell.variantId)!;
        if (left >= threshold) return [];
        const size = matrix!.sizes[i]!;
        return [
          {
            variantId: cell.variantId,
            sku: cell.sku,
            colorName: row.color.name,
            sizeName: size.name,
            available: left,
          },
        ];
      }),
    )
    .sort((a, b) => a.available - b.available || a.sku.localeCompare(b.sku));
  return {
    blocks: matrix ? [{ matrix, quantities: {} as Record<string, number> }] : [],
    restock: {
      style: { id: style.id, code: style.code, name: style.name },
      categoryId: style.categoryId,
      name: `Restock: ${style.name} (${style.code})`,
      threshold,
      /** Its SKUs below the threshold, the emptiest first. */
      low,
    },
  };
}

/** Why a proforma item's pieces are not on the grid, as the form says it. */
const UNPLACED_TEXT: Record<UnplacedReason, string> = {
  NO_STYLE: "not a style in Products",
  NO_SKUS: "its style has no colours and sizes yet",
  NO_COLOUR: "its colour is not one of the style's",
  NO_SIZES: "its sizes are not the style's",
};

/**
 * "Start production" on a sales order or a proforma: the project filled in from
 * it (its buyer, a name, a target day, the style) and the grid of what is left
 * to make: an order's pieces still to deliver, or a proforma's items on their
 * SKUs, less what projects already started from it make.
 */
async function formSource(
  ctx: CompanyContext,
  from: { orderId?: string; proformaId?: string },
  defaultTargetOn: string,
  today: string,
) {
  if (from.orderId) {
    const order = await ctx.db.salesOrder.findUnique({
      where: { id: from.orderId },
      select: {
        id: true,
        number: true,
        status: true,
        proformaId: true,
        shipmentDate: true,
        party: { select: { id: true, code: true, name: true, systemRole: true } },
        items: { select: { variantId: true, quantity: true }, orderBy: { id: "asc" } },
      },
    });
    if (!order) throw new AppError("NOT_FOUND", "Sales order not found.");
    assertAllowed(canStartFromOrder(order, order.party ? { walkIn: isWalkIn(order.party) } : null));
    const [delivered, others] = await Promise.all([
      deliveredByVariant(prisma, order.id),
      startedFrom(ctx, [
        { salesOrderId: order.id },
        ...(order.proformaId ? [{ proformaId: order.proformaId }] : []),
      ]),
    ]);
    const due = sumTargets(order.items);
    const left = lessTargets(lessTargets(due, delivered), others.made);
    const shipOn = dateOnly(order.shipmentDate);
    return sourceOf(ctx, {
      kind: "ORDER" as const,
      id: order.id,
      number: order.number,
      buyer: order.party!,
      targetOn: shipOn && shipOn >= today ? shipOn : defaultTargetOn,
      left,
      unplaced: [],
      others: others.rows,
    });
  }
  if (!from.proformaId) return null;
  const proforma = await ctx.db.proformaInvoice.findUnique({
    where: { id: from.proformaId },
    select: {
      id: true,
      number: true,
      status: true,
      quotationId: true,
      party: { select: { id: true, code: true, name: true } },
      salesOrder: { select: { number: true } },
    },
  });
  if (!proforma) throw new AppError("NOT_FOUND", "Proforma invoice not found.");
  assertAllowed(canStartFromProforma(proforma, proforma.salesOrder));
  const [placed, others] = await Promise.all([
    proformaTargets(prisma, ctx.company.id, proforma.quotationId),
    startedFrom(ctx, [{ proformaId: proforma.id }]),
  ]);
  return sourceOf(ctx, {
    kind: "PROFORMA" as const,
    id: proforma.id,
    number: proforma.number,
    buyer: proforma.party,
    targetOn: defaultTargetOn,
    left: lessTargets(placed.targets, others.made),
    unplaced: placed.unplaced.map((u) => ({ ...u, why: UNPLACED_TEXT[u.reason] })),
    others: others.rows,
  });
}

/**
 * Projects already started from an order or a proforma (not cancelled), and what their grids
 * make; `onGrid` is false for one made without colours and sizes, whose pieces the form cannot
 * take out of the boxes.
 */
async function startedFrom(ctx: CompanyContext, or: Prisma.ProductionProjectWhereInput[]) {
  const rows = await ctx.db.productionProject.findMany({
    where: { status: { not: "CANCELLED" }, OR: or },
    select: {
      id: true,
      code: true,
      targetQuantity: true,
      targetLines: { select: { variantId: true, quantity: true } },
    },
    orderBy: [{ startDate: "asc" }, { id: "asc" }],
  });
  return {
    made: sumTargets(rows.flatMap((r) => r.targetLines)),
    rows: rows.map((r) => ({
      id: r.id,
      code: r.code,
      pieces: r.targetQuantity,
      onGrid: r.targetLines.length > 0,
    })),
  };
}

async function sourceOf(
  ctx: CompanyContext,
  s: {
    kind: "ORDER" | "PROFORMA";
    id: string;
    number: string;
    buyer: { id: string; code: string; name: string };
    targetOn: string;
    left: ReadonlyMap<string, number>;
    unplaced: Array<{ description: string; quantity: number; styleId: string | null; why: string }>;
    others: Array<{ id: string; code: string; pieces: number; onGrid: boolean }>;
  },
) {
  const blocks = await formBlocks(ctx, s.left);
  // The style the grid starts with, else that of an item left off it (to fill in by hand).
  const firstId = blocks[0]?.matrix.style.id ?? s.unplaced.find((u) => u.styleId)?.styleId;
  const style = firstId
    ? await ctx.db.style.findUnique({
        where: { id: firstId },
        select: { id: true, code: true, name: true, categoryId: true },
      })
    : null;
  return {
    blocks,
    source: {
      kind: s.kind,
      id: s.id,
      number: s.number,
      /** Whether this person opens Sales, so Cancel can go back to it. */
      openSale: ctx.can("sales.view"),
      buyer: { id: s.buyer.id, code: s.buyer.code, name: s.buyer.name },
      name: `${s.buyer.name} — ${s.number}`,
      targetOn: s.targetOn,
      style: style ? { id: style.id, code: style.code, name: style.name } : null,
      categoryId: style?.categoryId ?? null,
      pieces: targetTotal(s.left),
      /** Proforma items whose pieces could not go on the grid, and why. */
      unplaced: s.unplaced,
      /** Projects already started from it; the grid leaves out what those `onGrid` make. */
      others: s.others,
    },
  };
}

/**
 * Open sales orders and proformas a new project can start from, newest first, by number or
 * buyer: a named buyer's order not yet packed, or a proforma not yet an order nor cancelled (as
 * canStartFromOrder and canStartFromProforma allow). Numbers, buyers and pieces only, no
 * prices, for Production Managers, who start projects but do not open Sales.
 */
export async function findSalesToStart(ctx: CompanyContext, query: { search?: string } = {}) {
  const search = (query.search ?? "").trim().slice(0, 100);
  const matches = search
    ? {
        OR: [
          { number: { contains: search, mode: "insensitive" as const } },
          { party: { is: { name: { contains: search, mode: "insensitive" as const } } } },
        ],
      }
    : {};
  const [orders, proformas] = await Promise.all([
    ctx.db.salesOrder.findMany({
      where: {
        status: { in: [...ORDER_OPEN_FOR_PRODUCTION] },
        party: { is: { systemRole: null } },
        ...matches,
      },
      select: {
        id: true,
        number: true,
        status: true,
        createdAt: true,
        party: { select: { name: true } },
        items: { select: { quantity: true } },
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: 10,
    }),
    ctx.db.proformaInvoice.findMany({
      where: { status: { notIn: ["CANCELLED", "CONVERTED"] }, ...matches },
      select: {
        id: true,
        number: true,
        status: true,
        createdAt: true,
        party: { select: { name: true } },
        quotation: { select: { items: { select: { quantity: true } } } },
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: 10,
    }),
  ]);
  const pieces = (items: Array<{ quantity: number }>) => items.reduce((s, i) => s + i.quantity, 0);
  const sales = [
    ...orders.map((o) => ({
      at: o.createdAt.getTime(),
      sale: {
        kind: "ORDER" as const,
        id: o.id,
        number: o.number,
        buyer: o.party?.name ?? "",
        orderStatus: o.status,
        proformaStatus: null,
        pieces: pieces(o.items),
      },
    })),
    ...proformas.map((p) => ({
      at: p.createdAt.getTime(),
      sale: {
        kind: "PROFORMA" as const,
        id: p.id,
        number: p.number,
        buyer: p.party.name,
        orderStatus: null,
        proformaStatus: p.status,
        pieces: pieces(p.quotation?.items ?? []),
      },
    })),
  ];
  return sales
    .sort((a, b) => b.at - a.at)
    .slice(0, 12)
    .map((s) => s.sale);
}

export type SaleToStart = Awaited<ReturnType<typeof findSalesToStart>>[number];

/**
 * The project page's grid: per style, its colours by sizes with the pieces to
 * make and those received into stock (confirmed deliveries, A- and B-grade),
 * keeping only the colours and sizes with either. Null without a grid.
 */
async function targetTable(
  ctx: CompanyContext,
  projectId: string,
  lines: Array<{ variantId: string; quantity: number }>,
  completed: boolean,
) {
  if (lines.length === 0) return null;
  const receivedRows = await prisma.stockIntakeLine.groupBy({
    by: ["variantId"],
    where: { intake: { projectId, status: "CONFIRMED" } },
    _sum: { quantity: true },
  });
  const target = sumTargets(lines);
  const received = new Map(receivedRows.map((r) => [r.variantId, r._sum.quantity ?? 0]));
  const ids = [...new Set([...target.keys(), ...received.keys()])];
  const grids = await styleGrids(ctx, await stylesOf(ctx, ids), ids);
  const styles = grids.map((m) => {
    const cellOf = (variantId: string) => {
      const cell = { target: target.get(variantId) ?? 0, received: received.get(variantId) ?? 0 };
      // Once the project is completed, pieces never received are wastage.
      return { ...cell, short: completed ? Math.max(cell.target - cell.received, 0) : 0 };
    };
    const used = (c: { target: number; received: number }) => c.target > 0 || c.received > 0;
    const keepSize = m.sizes.map((_, i) =>
      m.rows.some((r) => r.cells[i] && used(cellOf(r.cells[i]!.variantId))),
    );
    const rows = m.rows
      .map((row) => {
        const cells = row.cells
          .filter((_, i) => keepSize[i])
          .map((c) => (c && used(cellOf(c.variantId)) ? cellOf(c.variantId) : null));
        return {
          color: row.color,
          cells,
          target: cells.reduce((s, c) => s + (c?.target ?? 0), 0),
          received: cells.reduce((s, c) => s + (c?.received ?? 0), 0),
          short: cells.reduce((s, c) => s + (c?.short ?? 0), 0),
        };
      })
      .filter((row) => row.cells.some(Boolean));
    return {
      style: { id: m.style.id, code: m.style.code, name: m.style.name },
      sizes: m.sizes.filter((_, i) => keepSize[i]).map((size) => size.name),
      rows,
      target: rows.reduce((s, r) => s + r.target, 0),
      received: rows.reduce((s, r) => s + r.received, 0),
      short: rows.reduce((s, r) => s + r.short, 0),
    };
  });
  return {
    styles,
    target: styles.reduce((s, x) => s + x.target, 0),
    received: styles.reduce((s, x) => s + x.received, 0),
    /** Completed: the pieces per colour and size never received (wastage). */
    short: styles.reduce((s, x) => s + x.short, 0),
  };
}

// =============================================================================
// Pickers
// =============================================================================

/**
 * Suppliers (a factory, a fabric mill) or buyers to choose on a project or a
 * bill: open accounts only, never Walk-in customers.
 */
export async function findProductionParties(
  ctx: CompanyContext,
  query: { kind: "SUPPLIER" | "BUYER"; search?: string },
) {
  const search = (query.search ?? "").trim().slice(0, 100);
  const rows = await ctx.db.party.findMany({
    where: {
      kind: { in: [query.kind, "BOTH"] },
      // One-time ("Random") suppliers are only for the ready stock they came with.
      ...(query.kind === "SUPPLIER" ? { oneTime: false } : {}),
      status: { in: ["ACTIVE", "DORMANT"] },
      ...(search
        ? {
            OR: [
              { name: { contains: search, mode: "insensitive" } },
              { code: { contains: search, mode: "insensitive" } },
              { contactPerson: { contains: search, mode: "insensitive" } },
              { phone: { contains: search } },
            ],
          }
        : {}),
    },
    orderBy: [{ name: "asc" }, { id: "asc" }],
    take: 21,
  });
  return rows
    .filter((p) => !isWalkIn(p))
    .slice(0, 20)
    .map((p) => ({ id: p.id, code: p.code, name: p.name, phone: p.phone, city: p.city }));
}

export type PartyOption = Awaited<ReturnType<typeof findProductionParties>>[number];

/**
 * Projects to charge a bill to (any open project) or to receive goods for
 * (active or on hold), newest first.
 */
export async function findProjects(
  ctx: CompanyContext,
  query: { search?: string; purpose: "COST" | "RECEIVE" },
) {
  const search = (query.search ?? "").trim().slice(0, 100);
  const statuses: ProductionStatus[] =
    query.purpose === "RECEIVE" ? ["ACTIVE", "ON_HOLD"] : ["PLANNED", "ACTIVE", "ON_HOLD"];
  const rows = await ctx.db.productionProject.findMany({
    where: {
      status: { in: statuses },
      ...(search
        ? {
            OR: [
              { code: { contains: search, mode: "insensitive" } },
              { name: { contains: search, mode: "insensitive" } },
              { buyer: { name: { contains: search, mode: "insensitive" } } },
            ],
          }
        : {}),
    },
    include: { buyer: { select: { name: true } } },
    orderBy: [{ startDate: "desc" }, { id: "desc" }],
    take: 20,
  });
  return rows.map((p) => ({
    id: p.id,
    code: p.code,
    name: p.name,
    status: p.status,
    stage: p.stage,
    buyerLabel: p.buyer?.name ?? "In-House",
  }));
}

export type ProjectOption = Awaited<ReturnType<typeof findProjects>>[number];

/** Active styles to make or receive. */
export async function findProductionStyles(ctx: CompanyContext, query: { search?: string } = {}) {
  const page = await listStyles(ctx, {
    search: (query.search ?? "").trim().slice(0, 100) || undefined,
    take: 20,
  });
  return page.items.map((s) => ({
    id: s.id,
    code: s.code,
    name: s.name,
    categoryId: s.categoryId,
    skuCount: s.variantCount,
  }));
}

export type StyleOption = Awaited<ReturnType<typeof findProductionStyles>>[number];

/** A style's colours by sizes, each cell the SKU received into (no prices or costs). */
export async function getIntakeMatrix(ctx: CompanyContext, styleId: string) {
  const style = await ctx.db.style.findUnique({ where: { id: styleId } });
  if (!style) throw new AppError("NOT_FOUND", "Style not found.");
  const matrix = await getStyleMatrix(ctx, styleId);
  return {
    style: { id: style.id, code: style.code, name: style.name, isActive: style.isActive },
    sizes: matrix.sizes.map((s) => ({ id: s.id, name: s.name })),
    rows: matrix.rows.map((row) => ({
      color: row.color,
      cells: row.cells.map((cell) =>
        cell ? { variantId: cell.variantId, sku: cell.sku, isActive: cell.isActive } : null,
      ),
    })),
  };
}

export type IntakeMatrix = Awaited<ReturnType<typeof getIntakeMatrix>>;

// =============================================================================
// Factory deliveries (Move to Stock)
// =============================================================================

type ListedIntake = Awaited<ReturnType<typeof listIntakes>>["items"][number];

function presentIntakeRow(i: ListedIntake, tz: string) {
  return {
    id: i.id,
    number: i.number,
    status: i.status,
    project: i.project,
    warehouse: i.warehouse?.name ?? null,
    pieces: i.pieces,
    bGradePieces: i.bGradePieces,
    totalCost: i.totalCost ? fixed(i.totalCost) : null,
    madeOn: localDay(i.createdAt, tz),
    confirmedOn: i.confirmedAt ? localDay(i.confirmedAt, tz) : null,
  };
}

export type IntakeRow = ReturnType<typeof presentIntakeRow>;

export async function listIntakeRows(ctx: CompanyContext, raw: unknown = {}) {
  const page = await listIntakes(ctx, raw);
  const tz = ctx.company.timezone;
  return { items: page.items.map((i) => presentIntakeRow(i, tz)), nextCursor: page.nextCursor };
}

/** The Deliveries tab: the first page, and whether this person may receive goods. */
export async function getIntakeList(ctx: CompanyContext, raw: unknown = {}) {
  return { ...(await listIntakeRows(ctx, raw)), canCreate: productionAccess(ctx).receive };
}

export type IntakeList = Awaited<ReturnType<typeof getIntakeList>>;

type IntakeData = Awaited<ReturnType<typeof getIntake>>;
type IntakeLine = IntakeData["lines"][number];

/** Lines by style, then colour, each colour's sizes in catalogue order. */
function intakeGroups(lines: IntakeLine[], sizeOrder: Map<string, number>) {
  const byStyle = new Map<string, { style: IntakeLine["style"]; lines: IntakeLine[] }>();
  for (const line of lines) {
    const group = byStyle.get(line.style.id) ?? { style: line.style, lines: [] };
    group.lines.push(line);
    byStyle.set(line.style.id, group);
  }
  return [...byStyle.values()].map(({ style, lines: mine }) => {
    const colors = new Map<
      string,
      {
        color: IntakeLine["color"];
        grade: StockGrade;
        sizes: Array<{ size: string; quantity: number }>;
      }
    >();
    for (const l of mine) {
      const key = `${l.color.name}:${l.grade}`;
      const row = colors.get(key) ?? { color: l.color, grade: l.grade, sizes: [] };
      row.sizes.push({ size: l.size, quantity: l.quantity });
      colors.set(key, row);
    }
    const rows = [...colors.values()].map((row) => ({
      ...row,
      sizes: row.sizes.sort((a, b) => (sizeOrder.get(a.size) ?? 0) - (sizeOrder.get(b.size) ?? 0)),
      pieces: row.sizes.reduce((s, x) => s + x.quantity, 0),
    }));
    return {
      style: { id: style.id, code: style.code, name: style.name },
      pieces: mine.reduce((s, l) => s + l.quantity, 0),
      rows,
    };
  });
}

/** The cost per A- and B-grade piece from each line's cost (weighted by pieces). */
function perGrade(lines: Array<{ grade: StockGrade; quantity: number; unitCost: Amount }>) {
  const of = (grade: StockGrade) => {
    const mine = lines.filter((l) => l.grade === grade);
    const pieces = mine.reduce((s, l) => s + l.quantity, 0);
    if (pieces === 0) return null;
    const value = mine.reduce((s, l) => s.plus(l.unitCost.times(l.quantity)), ZERO);
    return fixed(money(value.dividedBy(pieces)));
  };
  return { a: of("A_GRADE"), b: of("B_GRADE") };
}

type Preview = {
  projectCostRemaining: Amount;
  thisDelivery: { totalCost: Amount; lines: Array<{ lineId: string; unitCost: Amount }> };
  asFinalDelivery: { totalCost: Amount; lines: Array<{ lineId: string; unitCost: Amount }> };
  exceedsRemaining: boolean;
};

type CostOption = { totalCost: string; perPiece: { a: string | null; b: string | null } };
type PreviewScreen =
  { error: string } | { error: null; remaining: string; share: CostOption; final: CostOption };

/** What confirming would move into stock: as a part delivery, and as the final one. */
function presentPreview(intake: IntakeData): PreviewScreen | null {
  const preview = intake.costPreview as Preview | { error: string } | null;
  if (!preview) return null;
  if ("error" in preview) return { error: preview.error };
  const option = (plan: Preview["thisDelivery"]): CostOption => {
    const cost = new Map(plan.lines.map((l) => [l.lineId, l.unitCost]));
    return {
      totalCost: fixed(plan.totalCost),
      perPiece: perGrade(intake.lines.map((l) => ({ ...l, unitCost: cost.get(l.id) ?? ZERO }))),
    };
  };
  return {
    error: null,
    remaining: fixed(preview.projectCostRemaining),
    share: option(preview.thisDelivery),
    final: option(preview.asFinalDelivery),
  };
}

/**
 * Completing a project with this draft delivery as its last: the pieces it
 * will have and those short of the target (wastage), and for people who see
 * costs what every piece will cost once evened out: all of the project's cost
 * that reaches stock (this delivery takes what is left) ÷ the pieces received.
 */
async function completionPreview(
  ctx: CompanyContext,
  intake: IntakeData,
  project: NonNullable<IntakeData["project"]>,
  seeCosts: boolean,
) {
  const aPieces = project.producedQtyA + intake.pieces.aGrade;
  const bPieces = project.producedQtyB + intake.pieces.bGrade;
  const received = aPieces + bPieces;
  let perPiece: { a: string | null; b: string | null } | null = null;
  if (seeCosts) {
    const summary = await projectCostSummary(prisma, ctx.company.id, project.id);
    perPiece = perPieceText(
      evenCostPerPiece({
        aPieces,
        bPieces,
        total: summary.inStock.plus(summary.wip),
        method: intake.costAllocation,
        bGradeRatio: intake.bGradeCostRatio,
      }),
    );
  }
  return {
    target: project.targetQuantity,
    received,
    short: Math.max(project.targetQuantity - received, 0),
    perPiece,
  };
}

/** Pieces of a confirmed delivery no longer free in its warehouse (sold, reserved, bad stock). */
async function undoShortfall(ctx: CompanyContext, intakeId: string) {
  const intake = await ctx.db.stockIntake.findUnique({
    where: { id: intakeId },
    select: {
      warehouseId: true,
      lines: {
        select: {
          variantId: true,
          grade: true,
          quantity: true,
          variant: { select: { sku: true } },
        },
      },
    },
  });
  if (!intake?.warehouseId) return [];
  const balances = await ctx.db.stockBalance.findMany({
    where: {
      warehouseId: intake.warehouseId,
      variantId: { in: intake.lines.map((l) => l.variantId) },
    },
    select: { variantId: true, grade: true, quantity: true, reserved: true },
  });
  const free = new Map(
    balances.map((b) => [`${b.variantId}:${b.grade}`, Math.max(b.quantity - b.reserved, 0)]),
  );
  return intake.lines.flatMap((l) => {
    const left = free.get(`${l.variantId}:${l.grade}`) ?? 0;
    return left >= l.quantity
      ? []
      : [
          {
            sku: l.variant.sku,
            grade: l.grade === "A_GRADE" ? ("A" as const) : ("B" as const),
            free: left,
            quantity: l.quantity,
          },
        ];
  });
}

/**
 * One factory delivery: what came in by style, colour, size and grade, and for
 * people who see costs what it carried into stock (or would carry, while it is
 * a draft) per A- and B-grade piece.
 */
export async function getIntakeScreen(ctx: CompanyContext, intakeId: string) {
  const intake = await getIntake(ctx, intakeId);
  const access = productionAccess(ctx);
  const tz = ctx.company.timezone;
  const sizes = await listSizes(ctx);
  const sizeOrder = new Map(sizes.map((s, i) => [s.name, i]));
  const project = intake.project;
  const draft = canChangeDelivery(intake).ok;
  const receiveVerdict = project ? canReceiveGoods(project) : null;
  const receivable = receiveVerdict?.ok ?? false;
  const short =
    access.manage && intake.status === "CONFIRMED" ? await undoShortfall(ctx, intake.id) : [];
  const undo = access.manage ? canUndoDelivery(intake, project, short) : null;
  const otherOpen =
    project && draft
      ? await ctx.db.stockIntake.count({
          where: {
            projectId: project.id,
            id: { not: intake.id },
            status: { in: ["DRAFT", "PARSED"] },
          },
        })
      : 0;
  const costLines = access.seeCosts
    ? intake.lines.map((l) => ({ ...l, unitCost: l.unitCost ?? ZERO }))
    : [];
  // Its pieces' cost once the project was completed and every piece evened out.
  const evened =
    intake.status === "CONFIRMED" && intake.lines.some((l) => l.costAdjustment?.isZero() === false)
      ? perGrade(
          costLines.map((l) => ({
            ...l,
            unitCost: l.unitCost.plus((l.costAdjustment ?? ZERO).dividedBy(l.quantity)),
          })),
        )
      : null;
  const completeProject = Boolean(access.manage && receivable && otherOpen === 0);
  // Completing with this delivery: what is short, and what each piece would cost.
  const completion =
    completeProject && project
      ? await completionPreview(ctx, intake, project, access.seeCosts)
      : null;

  return {
    intake: {
      id: intake.id,
      number: intake.number,
      status: intake.status,
      project: project
        ? {
            id: project.id,
            code: project.code,
            name: project.name,
            status: project.status,
            target: project.targetQuantity,
            received: project.producedQtyA + project.producedQtyB,
          }
        : null,
      warehouse: intake.warehouse?.name ?? null,
      sourceFile: intake.sourceFile
        ? { id: intake.sourceFile.id, fileName: intake.sourceFile.fileName }
        : null,
      costAllocation: intake.costAllocation,
      bGradePercent: intake.bGradeCostRatio
        ? Number(intake.bGradeCostRatio.times(100).toFixed(1))
        : null,
      notes: intake.notes,
      pieces: intake.pieces,
      groups: intakeGroups(intake.lines, sizeOrder),
      madeOn: localDay(intake.createdAt, tz),
      confirmedOn: intake.confirmedAt ? localDay(intake.confirmedAt, tz) : null,
      reversal: intake.reversal
        ? {
            on: localDay(intake.reversal.at, tz),
            by: intake.reversal.by?.name ?? null,
            reason: intake.reversal.reason,
          }
        : null,
      correctionOf: intake.correctionOf,
      corrections: intake.corrections,
    },
    /** Cost figures: Production Managers and Accounts only. */
    costs: access.seeCosts
      ? {
          totalCost: intake.totalCost ? fixed(intake.totalCost) : null,
          perPiece: intake.status === "CONFIRMED" ? perGrade(costLines) : null,
          /** Completed project: what a piece of each grade costs since it was evened out. */
          evened,
          preview: draft ? presentPreview(intake) : null,
        }
      : null,
    /** Completing the project with this delivery (Production Managers). */
    completion,
    can: {
      edit: access.receive && draft,
      confirm: access.receive && draft && receivable && intake.lines.length > 0,
      cancel: access.receive && draft,
      /** Also mark the project completed with the final delivery (Production Managers). */
      completeProject,
      /** Set the cost it carries by hand instead of its share (manual costing sets it per piece). */
      setTotal: access.seeCosts && intake.costAllocation !== "MANUAL",
      undo: undo?.ok ?? false,
    },
    notes: {
      undo: undo && !undo.ok && intake.status === "CONFIRMED" ? undo.message : null,
      receive: draft && receiveVerdict && !receiveVerdict.ok ? receiveVerdict.message : null,
    },
  };
}

export type IntakeScreen = Awaited<ReturnType<typeof getIntakeScreen>>;

type FormBlock = {
  matrix: IntakeMatrix;
  /** Pieces per SKU, A- and B-grade. */
  a: Record<string, number>;
  b: Record<string, number>;
};

type PlanCells = Record<string, { target: number; received: number }>;

/**
 * What the receiving grid shows in each box of a project with a target grid:
 * the pieces to make of that SKU and those received so far (confirmed
 * deliveries, both grades), and the styles the grid covers, by style code.
 */
async function receivingPlan(ctx: CompanyContext, projectId: string) {
  const [targets, receivedRows] = await Promise.all([
    prisma.productionTargetLine.findMany({
      where: { projectId },
      select: {
        variantId: true,
        quantity: true,
        variant: { select: { styleId: true, style: { select: { code: true } } } },
      },
    }),
    prisma.stockIntakeLine.groupBy({
      by: ["variantId"],
      where: { intake: { companyId: ctx.company.id, projectId, status: "CONFIRMED" } },
      _sum: { quantity: true },
    }),
  ]);
  const received = new Map(receivedRows.map((r) => [r.variantId, r._sum.quantity ?? 0]));
  const cells: PlanCells = {};
  for (const t of targets) {
    if (t.quantity > 0)
      cells[t.variantId] = { target: t.quantity, received: received.get(t.variantId) ?? 0 };
  }
  const styleIds = [
    ...new Map(
      [...targets]
        .sort((a, b) => a.variant.style.code.localeCompare(b.variant.style.code))
        .map((t) => [t.variant.styleId, t.variant.styleId]),
    ).keys(),
  ];
  return { cells, styleIds };
}

const emptyBlocks = (ctx: CompanyContext, styleIds: string[]) =>
  Promise.all(
    styleIds.map(async (id): Promise<FormBlock> => ({
      matrix: await getIntakeMatrix(ctx, id),
      a: {},
      b: {},
    })),
  );

/**
 * What the delivery form needs: the project, warehouses, the costing choices
 * for people who see costs, and the styles to fill in: a draft's own lines and
 * the project's target grid (or its style when it has no grid), with each
 * box's pieces to make and received so far (`plan`).
 */
export async function getIntakeForm(
  ctx: CompanyContext,
  options: { projectId?: string; intakeId?: string },
) {
  const access = productionAccess(ctx);
  const [warehouses, defaultWarehouse] = await Promise.all([
    listWarehouses(ctx),
    getDefaultWarehouse(ctx),
  ]);
  const base = {
    warehouses: warehouses.map((w) => ({ id: w.id, name: w.name })),
    defaultWarehouseId: defaultWarehouse.id,
    seeCosts: access.seeCosts,
    defaultBGradePercent: DEFAULT_B_GRADE_RATIO * 100,
  };

  if (options.intakeId) {
    const intake = await getIntake(ctx, options.intakeId);
    assertAllowed(canChangeDelivery(intake));
    if (!intake.project) throw new AppError("NOT_FOUND", "Production project not found.");
    const plan = await receivingPlan(ctx, intake.project.id);
    const lineStyles = [...new Set(intake.lines.map((l) => l.style.id))];
    const styleIds = [...lineStyles, ...plan.styleIds.filter((id) => !lineStyles.includes(id))];
    const blocks = new Map(
      (await emptyBlocks(ctx, styleIds)).map((block) => [block.matrix.style.id, block]),
    );
    for (const line of intake.lines) {
      const block = blocks.get(line.style.id)!;
      (line.grade === "A_GRADE" ? block.a : block.b)[line.variantId] = line.quantity;
    }
    const unit = (grade: StockGrade) => {
      const line = intake.lines.find((l) => l.grade === grade);
      return access.seeCosts && line?.unitCost ? line.unitCost.toFixed(2) : "";
    };
    return {
      ...base,
      project: {
        id: intake.project.id,
        code: intake.project.code,
        name: intake.project.name,
        styleId: null,
      },
      intake: {
        id: intake.id,
        number: intake.number,
        warehouseId: intake.warehouse?.id ?? defaultWarehouse.id,
        costAllocation: intake.costAllocation as CostAllocationMethod,
        bGradePercent: intake.bGradeCostRatio
          ? Number(intake.bGradeCostRatio.times(100).toFixed(1))
          : base.defaultBGradePercent,
        unitCostA: intake.costAllocation === "MANUAL" ? unit("A_GRADE") : "",
        unitCostB: intake.costAllocation === "MANUAL" ? unit("B_GRADE") : "",
        notes: intake.notes ?? "",
        sourceFile: intake.sourceFile
          ? { id: intake.sourceFile.id, fileName: intake.sourceFile.fileName }
          : null,
      },
      blocks: [...blocks.values()],
      plan: plan.cells,
    };
  }

  if (!options.projectId) {
    return { ...base, project: null, intake: null, blocks: [], plan: {} as PlanCells };
  }
  const project = await ctx.db.productionProject.findUnique({
    where: { id: options.projectId },
    select: { id: true, code: true, name: true, status: true, styleId: true },
  });
  if (!project) throw new AppError("NOT_FOUND", "Production project not found.");
  assertAllowed(canReceiveGoods(project));
  const plan = await receivingPlan(ctx, project.id);
  const styleIds =
    plan.styleIds.length > 0 ? plan.styleIds : project.styleId ? [project.styleId] : [];
  return {
    ...base,
    project: { id: project.id, code: project.code, name: project.name, styleId: project.styleId },
    intake: null,
    blocks: await emptyBlocks(ctx, styleIds),
    plan: plan.cells,
  };
}

export type IntakeForm = Awaited<ReturnType<typeof getIntakeForm>>;

// =============================================================================
// Supplier bills (Split Bill) and cost heads
// =============================================================================

type ListedBill = Awaited<ReturnType<typeof listBills>>["items"][number];

function presentBillRow(b: ListedBill, tz: string) {
  return {
    id: b.id,
    number: b.number,
    supplier: partyOf(b.supplier),
    supplierRef: b.supplierRef,
    billOn: localDay(b.billDate, tz),
    status: b.status,
    paymentType: b.paymentType,
    total: fixed(b.totalAmount),
    paid: fixed(b.paidAmount),
    due: fixed(b.dueAmount),
    projects: [...new Set(b.allocations.flatMap((a) => (a.project ? [a.project.code] : [])))],
    /** Raw materials bought into the store, rather than a cost shared across projects. */
    isMaterialPurchase: b._count.items > 0,
  };
}

export type BillRow = ReturnType<typeof presentBillRow>;

export async function listBillRows(ctx: CompanyContext, raw: unknown = {}) {
  const page = await listBills(ctx, raw);
  const tz = ctx.company.timezone;
  return { items: page.items.map((b) => presentBillRow(b, tz)), nextCursor: page.nextCursor };
}

/** The Bills tab: the first page, and whether this person may enter a bill. */
export async function getBillList(ctx: CompanyContext, raw: unknown = {}) {
  return { ...(await listBillRows(ctx, raw)), canCreate: productionAccess(ctx).recordCosts };
}

export type BillList = Awaited<ReturnType<typeof getBillList>>;

/**
 * One supplier bill: how it is shared across projects (or the raw materials it
 * bought), what was paid on it, and whether this person may pay or void it.
 */
export async function getBillScreen(ctx: CompanyContext, billId: string) {
  const bill = await getBill(ctx, billId);
  const access = productionAccess(ctx);
  const tz = ctx.company.timezone;
  const projectIds = [
    ...new Set(bill.allocations.flatMap((a) => (a.projectId ? [a.projectId] : []))),
  ];
  const projects = new Map(
    bill.allocations.flatMap((a) => (a.project ? [[a.project.id, a.project] as const] : [])),
  );
  const state = { ...bill, itemCount: bill.items.length };
  const voidVerdict = access.voidBills
    ? canVoidBill(
        state,
        billShares(
          bill.allocations,
          projects,
          await projectCostSummaries(prisma, ctx.company.id, projectIds),
        ),
      )
    : null;
  const canPay = access.payOut && canPayBill(bill).ok;

  return {
    bill: {
      id: bill.id,
      number: bill.number,
      supplier: { ...partyOf(bill.supplier)!, phone: bill.supplier.phone },
      supplierRef: bill.supplierRef,
      billOn: localDay(bill.billDate, tz),
      status: bill.status,
      paymentType: bill.paymentType,
      total: fixed(bill.totalAmount),
      paid: fixed(bill.paidAmount),
      due: fixed(bill.dueAmount),
      notes: bill.notes,
      attachment: bill.attachment
        ? { id: bill.attachment.id, fileName: bill.attachment.fileName }
        : null,
      warehouse: bill.warehouse?.name ?? null,
      purchaseOrder: bill.purchaseOrder
        ? { id: bill.purchaseOrder.id, number: bill.purchaseOrder.number }
        : null,
      shares: bill.allocations.map((a) => ({
        id: a.id,
        project: a.project
          ? { id: a.project.id, code: a.project.code, name: a.project.name }
          : null,
        head: a.expenseHead.name,
        amount: fixed(a.amount),
        description: a.description,
      })),
      items: bill.items.map((i) => ({
        id: i.id,
        material: { code: i.rawMaterial.code, name: i.rawMaterial.name },
        unit: i.rawMaterial.unit,
        quantity: i.quantity.toFixed(3).replace(/\.?0+$/, ""),
        unitPrice: fixed(i.unitPrice),
        amount: fixed(i.amount),
      })),
      payments: bill.payments.map((p) => ({
        id: p.id,
        number: p.number,
        amount: fixed(p.amount),
        method: p.method,
        paidOn: localDay(p.paymentDate, tz),
        reference: p.reference,
        account: p.account?.name ?? null,
      })),
    },
    /** The cash, bank and wallet accounts it is paid from (for people who pay it). */
    accounts: canPay ? await listMoneyAccounts(ctx) : [],
    /** A raw material purchase also opens in Raw materials, where it is returned or voided. */
    materialsHref:
      bill.items.length > 0 && ctx.can("materials.view") && canSeeMaterialCosts(ctx)
        ? `/materials/purchases/${bill.id}`
        : null,
    can: {
      pay: canPay,
      void: voidVerdict?.ok ?? false,
      openParty: access.openParty,
    },
    notes: {
      void: voidVerdict && !voidVerdict.ok && bill.status !== "VOID" ? voidVerdict.message : null,
    },
  };
}

export type BillScreen = Awaited<ReturnType<typeof getBillScreen>>;

/**
 * What the bill form needs: the active cost heads, today, how it may be paid
 * (Due always; Cash/Bank for Accounts) and the project it starts on, if any.
 */
export async function getBillForm(ctx: CompanyContext, options: { projectId?: string } = {}) {
  const access = productionAccess(ctx);
  const heads = await listCostHeads(ctx);
  let project: ProjectOption | null = null;
  if (options.projectId) {
    const p = await ctx.db.productionProject.findUnique({
      where: { id: options.projectId },
      include: { buyer: { select: { name: true } } },
    });
    if (p && canAddCost(p).ok) {
      project = {
        id: p.id,
        code: p.code,
        name: p.name,
        status: p.status,
        stage: p.stage,
        buyerLabel: p.buyer?.name ?? "In-House",
      };
    }
  }
  return {
    today: localDay(new Date(), ctx.company.timezone),
    heads: heads.map((h) => ({ id: h.id, name: h.name, category: h.category })),
    canPayNow: access.payOut,
    /** The cash, bank and wallet accounts a paid-now cost comes out of (Accounts only). */
    accounts: access.payOut ? await listMoneyAccounts(ctx) : [],
    project,
  };
}

export type BillForm = Awaited<ReturnType<typeof getBillForm>>;

/**
 * The cost heads bills and costs are filed under, archived ones too, who may
 * change them, and the ledger accounts their costs reach in the Chart of
 * Accounts (cost.service posts every project cost to Work in Progress, a Due
 * one against Accounts Payable; a delivery moves it into Finished Goods).
 */
export async function getCostHeadsScreen(ctx: CompanyContext) {
  const [heads, acc] = await Promise.all([
    listCostHeads(ctx, { includeInactive: true }),
    ensureControlAccounts(ctx.company.id),
  ]);
  const ledger = await ctx.db.ledgerAccount.findMany({
    where: { id: { in: [acc.WORK_IN_PROGRESS, acc.PAYABLE, acc.INVENTORY] } },
    select: { id: true, code: true, name: true },
  });
  const account = (id: string) => {
    const a = ledger.find((l) => l.id === id);
    return a ? { id: a.id, code: a.code, name: a.name } : null;
  };
  return {
    heads: heads.map((h) => ({
      id: h.id,
      name: h.name,
      category: h.category as ExpenseCategory,
      isActive: h.isActive,
    })),
    canManage: productionAccess(ctx).manage,
    /** Where their costs are booked; the accounts open for people with accounts.view. */
    books: {
      cost: account(acc.WORK_IN_PROGRESS),
      owed: account(acc.PAYABLE),
      delivered: account(acc.INVENTORY),
      canOpen: ctx.can("accounts.view"),
    },
  };
}

export type CostHeadsScreen = Awaited<ReturnType<typeof getCostHeadsScreen>>;
