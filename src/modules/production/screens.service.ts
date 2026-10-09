import type {
  BillStatus,
  CostAllocationMethod,
  ExpenseCategory,
  PaymentMethod,
  PaymentType,
  Prisma,
  ProductionStatus,
  StockGrade,
} from "@prisma/client";

import { addDays, localDay } from "@/lib/dates";
import { AppError } from "@/lib/errors";
import { prisma } from "@/lib/prisma";
import { assertAllowed } from "@/lib/verdict";
import type { CompanyContext } from "@/modules/auth/context";
import { listSizes } from "@/modules/inventory/catalog.service";
import { getStyleMatrix } from "@/modules/inventory/matrix.service";
import { listCategoryOptions } from "@/modules/inventory/screens.service";
import { getDefaultWarehouse, listWarehouses } from "@/modules/inventory/stock.service";
import { listStyles } from "@/modules/inventory/style.service";
import { canSeeMaterialCosts } from "@/modules/materials/access";
import { isWalkIn } from "@/modules/parties/walk-in";
import {
  billShares,
  getBill,
  getProjectCostSheet,
  listBills,
  listCostHeads,
} from "@/modules/production/cost.service";
import { DEFAULT_B_GRADE_RATIO, money, ZERO } from "@/modules/production/costing";
import { getIntake, listIntakes } from "@/modules/production/intake.service";
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
} from "@/modules/production/project.service";
import {
  canAddCost,
  canCancelProject,
  canChangeDelivery,
  canCompleteProject,
  canPayBill,
  canReceiveGoods,
  canSetStatus,
  canUndoDelivery,
  canVoidBill,
  canVoidDirectCost,
  canWriteOffOnClose,
  isDraftDelivery,
  stageMoves,
} from "@/modules/production/rules";
import { STAGE_LABELS, STAGE_ORDER } from "@/modules/production/timeline";
import { RECEIVE_METHODS } from "@/modules/sales/choices";

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

function presentCard(card: ProjectCard, tz: string) {
  const t = card.timeline;
  return {
    id: card.id,
    code: card.code,
    name: card.name,
    status: card.status,
    stage: card.stage,
    buyer: partyOf(card.buyer),
    isInHouse: card.isInHouse,
    factory: card.factory ? { id: card.factory.id, name: card.factory.name } : null,
    factoryLabel: card.factoryLabel,
    category: card.category ? { id: card.category.id, name: card.category.name } : null,
    style: card.style ? { id: card.style.id, code: card.style.code, name: card.style.name } : null,
    proforma: card.proforma ? { id: card.proforma.id, number: card.proforma.number } : null,
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
 * The Production Overview: a card per open project (overdue first), how many
 * are at each stage, and for people who see costs what sits in production.
 */
export async function getOverviewScreen(ctx: CompanyContext) {
  const overview = await getProductionOverview(ctx);
  const access = productionAccess(ctx);
  const tz = ctx.company.timezone;
  return {
    today: overview.today,
    counts: overview.counts,
    byStage: overview.byStage,
    totals: overview.totals
      ? {
          totalCost: fixed(overview.totals.totalCost),
          inStock: fixed(overview.totals.inStock),
          wip: fixed(overview.totals.wip),
        }
      : null,
    projects: overview.projects.map((card) => presentCard(card, tz)),
    canCreate: access.manage,
  };
}

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

/**
 * What the pieces received so far cost, A- and B-grade apart: the cost each
 * confirmed delivery moved into stock with them, per piece of each grade.
 */
async function gradeCosts(ctx: CompanyContext, projectId: string) {
  const lines = await prisma.stockIntakeLine.findMany({
    where: { intake: { companyId: ctx.company.id, projectId, status: "CONFIRMED" } },
    select: { grade: true, quantity: true, unitCost: true },
  });
  const of = (grade: StockGrade): GradeCost => {
    const mine = lines.filter((l) => l.grade === grade);
    const pieces = mine.reduce((s, l) => s + l.quantity, 0);
    const value = money(mine.reduce((s, l) => s.plus(l.unitCost.times(l.quantity)), ZERO));
    return {
      pieces,
      value: fixed(value),
      perPiece: pieces > 0 ? fixed(money(value.dividedBy(pieces))) : null,
    };
  };
  return { a: of("A_GRADE"), b: of("B_GRADE") };
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
        from: e.paidFrom ? `Paid from ${e.paidFrom.name}` : "Paid",
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
  const summary = await projectCostSummary(prisma, ctx.company.id, project.id);
  const wip = summary.wip;
  const [sheet, grades] = access.seeCosts
    ? await Promise.all([getProjectCostSheet(ctx, project.id), gradeCosts(ctx, project.id)])
    : [null, null];
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
            grades,
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
      openDelivery: openDelivery ? { id: openDelivery.id, number: openDelivery.number } : null,
      openParty: access.openParty,
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
 * (a closed project keeps all but its name and notes; one started by a
 * proforma keeps its buyer).
 */
export async function getProjectForm(ctx: CompanyContext, projectId?: string) {
  const tz = ctx.company.timezone;
  const today = localDay(new Date(), tz);
  const categories = await listCategoryOptions(ctx);
  const base = {
    today,
    defaultTargetOn: addDays(today, DEFAULT_PRODUCTION_LEAD_DAYS),
    categories: categories.map((c) => ({ id: c.id, label: c.path.join(" › ") })),
  };
  if (!projectId) return { ...base, project: null, locked: null };
  const p = await ctx.db.productionProject.findUnique({
    where: { id: projectId },
    include: {
      style: { select: { id: true, code: true, name: true } },
      factory: { select: { id: true, code: true, name: true } },
      buyer: { select: { id: true, code: true, name: true } },
      proforma: { select: { id: true, number: true } },
    },
  });
  if (!p) throw new AppError("NOT_FOUND", "Production project not found.");
  const closed = p.status === "COMPLETED" || p.status === "CANCELLED";
  return {
    ...base,
    project: {
      id: p.id,
      code: p.code,
      name: p.name,
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
    },
    locked: { closed, buyer: Boolean(p.proformaId) },
  };
}

export type ProjectForm = Awaited<ReturnType<typeof getProjectForm>>;

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
          preview: draft ? presentPreview(intake) : null,
        }
      : null,
    can: {
      edit: access.receive && draft,
      confirm: access.receive && draft && receivable && intake.lines.length > 0,
      cancel: access.receive && draft,
      /** Also mark the project completed with the final delivery (Production Managers). */
      completeProject: access.manage && receivable && otherOpen === 0,
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

/**
 * What the delivery form needs: the project, warehouses, the costing choices
 * for people who see costs, and the styles to fill in (a draft's own lines, or
 * the project's style for a new delivery).
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
    const blocks = new Map<string, FormBlock>();
    for (const line of intake.lines) {
      let block = blocks.get(line.style.id);
      if (!block) {
        block = { matrix: await getIntakeMatrix(ctx, line.style.id), a: {}, b: {} };
        blocks.set(line.style.id, block);
      }
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
    };
  }

  if (!options.projectId) return { ...base, project: null, intake: null, blocks: [] };
  const project = await ctx.db.productionProject.findUnique({
    where: { id: options.projectId },
    select: { id: true, code: true, name: true, status: true, styleId: true },
  });
  if (!project) throw new AppError("NOT_FOUND", "Production project not found.");
  assertAllowed(canReceiveGoods(project));
  const blocks: FormBlock[] = project.styleId
    ? [{ matrix: await getIntakeMatrix(ctx, project.styleId), a: {}, b: {} }]
    : [];
  return {
    ...base,
    project: { id: project.id, code: project.code, name: project.name, styleId: project.styleId },
    intake: null,
    blocks,
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
    methods: RECEIVE_METHODS,
    /** A raw material purchase also opens in Raw materials, where it is returned or voided. */
    materialsHref:
      bill.items.length > 0 && ctx.can("materials.view") && canSeeMaterialCosts(ctx)
        ? `/materials/purchases/${bill.id}`
        : null,
    can: {
      pay: access.payOut && canPayBill(bill).ok,
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
    methods: RECEIVE_METHODS as readonly PaymentMethod[],
    project,
  };
}

export type BillForm = Awaited<ReturnType<typeof getBillForm>>;

/** The cost heads bills and costs are filed under, archived ones too, and who may change them. */
export async function getCostHeadsScreen(ctx: CompanyContext) {
  const heads = await listCostHeads(ctx, { includeInactive: true });
  return {
    heads: heads.map((h) => ({
      id: h.id,
      name: h.name,
      category: h.category as ExpenseCategory,
      isActive: h.isActive,
    })),
    canManage: productionAccess(ctx).manage,
  };
}

export type CostHeadsScreen = Awaited<ReturnType<typeof getCostHeadsScreen>>;
