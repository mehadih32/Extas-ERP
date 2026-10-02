import { Prisma, type ProductionStatus } from "@prisma/client";

import { daysBetween, localDay, startOfDayInZone, toInstant } from "@/lib/dates";
import { AppError } from "@/lib/errors";
import { nextDocumentNumber } from "@/lib/numbering";
import { prisma } from "@/lib/prisma";
import type { RequestMeta } from "@/lib/request-meta";
import { lockRow } from "@/lib/row-lock";
import { auditInCompany } from "@/modules/audit/audit.service";
import type { CompanyContext } from "@/modules/auth/context";
import { assertPartyCanTransact } from "@/modules/parties/party.service";
import { ZERO } from "@/modules/production/costing";
import {
  assertCanWriteOff,
  canSeeProductionCosts,
  isProjectClosed,
  type ProjectCostSummary,
  projectCostSummaries,
  projectCostSummary,
  writeOffProjectWip,
} from "@/modules/production/project-costs";
import {
  cancelProjectSchema,
  completeProjectSchema,
  createProjectSchema,
  listProjectsSchema,
  setStageSchema,
  setStatusSchema,
  updateProjectSchema,
} from "@/modules/production/schemas";
import {
  isStageBackward,
  OPEN_STATUSES,
  projectTimeline,
  STAGE_LABELS,
  STAGE_ORDER,
  stageBadge,
} from "@/modules/production/timeline";

type Tx = Prisma.TransactionClient;

/** Default lead time for a production project started by a proforma advance. */
export const DEFAULT_PRODUCTION_LEAD_DAYS = 45;

const projectInclude = {
  category: { select: { id: true, name: true } },
  style: { select: { id: true, code: true, name: true } },
  factory: { select: { id: true, code: true, name: true, phone: true } },
  buyer: { select: { id: true, code: true, name: true } },
  proforma: { select: { id: true, number: true, status: true } },
} satisfies Prisma.ProductionProjectInclude;

type ProjectRow = Prisma.ProductionProjectGetPayload<{ include: typeof projectInclude }>;

/** The project card of the Production Overview (and each row of the project list). */
function projectCard(
  ctx: CompanyContext,
  p: ProjectRow,
  costs: ProjectCostSummary | undefined,
  now: Date,
) {
  const produced = p.producedQtyA + p.producedQtyB;
  return {
    id: p.id,
    code: p.code,
    name: p.name,
    status: p.status,
    stage: stageBadge(p.stage),
    isInHouse: p.isInHouse,
    buyer: p.buyer,
    buyerLabel: p.buyer?.name ?? "In-House",
    factory: p.factory,
    factoryLabel: p.factory?.name ?? p.factoryName ?? null,
    category: p.category,
    style: p.style,
    proforma: p.proforma,
    startDate: p.startDate,
    targetDate: p.targetDate,
    completedAt: p.completedAt,
    timeline: projectTimeline(p, now, ctx.company.timezone),
    quantities: {
      target: p.targetQuantity,
      producedA: p.producedQtyA,
      producedB: p.producedQtyB,
      produced,
      remaining: Math.max(p.targetQuantity - produced, 0),
    },
    // Money figures only for roles that may see production costs.
    costs:
      costs && canSeeProductionCosts(ctx)
        ? {
            ...costs,
            estimatedCostPerPiece: costs.totalCost
              .dividedBy(p.targetQuantity)
              .toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP),
          }
        : null,
  };
}

function notActiveMessage(p: { code: string; status: ProductionStatus }) {
  if (p.status === "PLANNED") return `${p.code} has not started yet; start it first.`;
  if (p.status === "ON_HOLD") return `${p.code} is on hold; resume it first.`;
  return `${p.code} is ${p.status.toLowerCase()}.`;
}

/** Checks the category, style, factory (a supplier) and buyer the user picked. */
async function resolveProjectRefs(
  ctx: CompanyContext,
  input: {
    categoryId?: string | null;
    styleId?: string | null;
    factoryId?: string | null;
    buyerId?: string | null;
  },
) {
  const refs: {
    categoryId?: string | null;
    styleId?: string | null;
    factoryId?: string | null;
    buyerId?: string | null;
  } = {};
  if (input.styleId) {
    const style = await ctx.db.style.findUnique({ where: { id: input.styleId } });
    if (!style) throw new AppError("NOT_FOUND", "Style not found.");
    refs.styleId = style.id;
    if (input.categoryId === undefined) refs.categoryId = style.categoryId;
  } else if (input.styleId === null) refs.styleId = null;
  if (input.categoryId) {
    const category = await ctx.db.category.findUnique({ where: { id: input.categoryId } });
    if (!category) throw new AppError("NOT_FOUND", "Category not found.");
    refs.categoryId = category.id;
  } else if (input.categoryId === null) refs.categoryId = null;
  if (input.factoryId) {
    refs.factoryId = (await assertPartyCanTransact(ctx, input.factoryId, "PURCHASE")).id;
  } else if (input.factoryId === null) refs.factoryId = null;
  if (input.buyerId) {
    refs.buyerId = (await assertPartyCanTransact(ctx, input.buyerId, "SALE")).id;
  } else if (input.buyerId === null) refs.buyerId = null;
  return refs;
}

function assertDateOrder(ctx: CompanyContext, startDate: Date, targetDate: Date) {
  const tz = ctx.company.timezone;
  if (daysBetween(localDay(startDate, tz), localDay(targetDate, tz)) < 0) {
    throw new AppError("VALIDATION", "The target date is before the start date.", {
      targetDate: ["Must be on or after the start date"],
    });
  }
}

// =============================================================================
// Create / edit
// =============================================================================

/** Blueprint "Create Production Project": name, category, factory, target date and quantity, buyer or In-House. */
export async function createProject(ctx: CompanyContext, raw: unknown, meta?: RequestMeta) {
  const input = createProjectSchema.parse(raw);
  const refs = await resolveProjectRefs(ctx, input);
  const tz = ctx.company.timezone;
  const startDate = input.startDate ? toInstant(input.startDate, tz) : new Date();
  const targetDate = toInstant(input.targetDate, tz);
  assertDateOrder(ctx, startDate, targetDate);
  const status = input.status ?? "ACTIVE";

  const project = await prisma.$transaction(async (tx) => {
    const created = await tx.productionProject.create({
      data: {
        companyId: ctx.company.id,
        code: await nextDocumentNumber(tx, ctx.company.id, "PRODUCTION_PROJECT"),
        name: input.name,
        categoryId: refs.categoryId ?? null,
        styleId: refs.styleId ?? null,
        factoryId: refs.factoryId ?? null,
        factoryName: refs.factoryId ? null : (input.factoryName ?? null),
        buyerId: refs.buyerId ?? null,
        isInHouse: !refs.buyerId,
        status,
        startDate,
        targetDate,
        targetQuantity: input.targetQuantity,
        notes: input.notes ?? null,
        ...(status === "ACTIVE"
          ? { stageLogs: { create: { stage: "FABRIC_SOURCING" as const, startedAt: startDate } } }
          : {}),
      },
    });
    await auditInCompany(
      ctx,
      meta,
      {
        action: "CREATE",
        entityType: "ProductionProject",
        entityId: created.id,
        summary: `Production project ${created.code} "${created.name}": ${created.targetQuantity} pcs by ${localDay(targetDate, tz)}${refs.buyerId ? "" : " (In-House)"}`,
      },
      tx,
    );
    return created;
  });
  return getProject(ctx, project.id);
}

/**
 * Blueprint: the proforma advance "routes funds to Accounts & creates a
 * Production project". Called by Sales once the advance is fully received.
 */
export async function createProjectFromProformaTx(
  tx: Tx,
  ctx: CompanyContext,
  proforma: { id: string; number: string; partyId: string; quotationId: string | null },
  meta?: RequestMeta,
) {
  const [party, items] = await Promise.all([
    tx.party.findUniqueOrThrow({ where: { id: proforma.partyId }, select: { name: true } }),
    proforma.quotationId
      ? tx.quotationItem.findMany({
          where: { quotationId: proforma.quotationId },
          orderBy: { sortOrder: "asc" },
        })
      : Promise.resolve([]),
  ]);
  const targetDate = new Date(Date.now() + DEFAULT_PRODUCTION_LEAD_DAYS * 86_400_000);
  const project = await tx.productionProject.create({
    data: {
      companyId: ctx.company.id,
      code: await nextDocumentNumber(tx, ctx.company.id, "PRODUCTION_PROJECT"),
      name: `${party.name} — ${proforma.number}`,
      categoryId: items.find((i) => i.categoryId)?.categoryId ?? null,
      styleId: items.find((i) => i.styleId)?.styleId ?? null,
      buyerId: proforma.partyId,
      proformaId: proforma.id,
      targetDate,
      targetQuantity: Math.max(
        items.reduce((s, i) => s + i.quantity, 0),
        1,
      ),
      notes: `Started automatically when the advance for ${proforma.number} was received.`,
      stageLogs: { create: { stage: "FABRIC_SOURCING" } },
    },
  });
  await auditInCompany(
    ctx,
    meta,
    {
      action: "CREATE",
      entityType: "ProductionProject",
      entityId: project.id,
      summary: `Production project ${project.code} started from ${proforma.number}`,
    },
    tx,
  );
  return project;
}

const CLOSED_EDITABLE = new Set(["name", "notes"]);

export async function updateProject(
  ctx: CompanyContext,
  projectId: string,
  raw: unknown,
  meta?: RequestMeta,
) {
  const input = updateProjectSchema.parse(raw);
  const project = await ctx.db.productionProject.findUnique({
    where: { id: projectId },
    include: { proforma: { select: { number: true } } },
  });
  if (!project) throw new AppError("NOT_FOUND", "Production project not found.");
  const changed = Object.keys(input).filter((k) => input[k as keyof typeof input] !== undefined);
  if (isProjectClosed(project) && changed.some((k) => !CLOSED_EDITABLE.has(k))) {
    throw new AppError(
      "CONFLICT",
      `${project.code} is ${project.status.toLowerCase()}; only its name and notes can change.`,
    );
  }
  if (project.proformaId && input.buyerId !== undefined && input.buyerId !== project.buyerId) {
    throw new AppError(
      "CONFLICT",
      `${project.code} was started from ${project.proforma?.number}; its buyer cannot change.`,
    );
  }
  const refs = await resolveProjectRefs(ctx, input);
  const tz = ctx.company.timezone;
  const startDate = input.startDate ? toInstant(input.startDate, tz) : project.startDate;
  const targetDate = input.targetDate ? toInstant(input.targetDate, tz) : project.targetDate;
  assertDateOrder(ctx, startDate, targetDate);

  const data: Prisma.ProductionProjectUncheckedUpdateInput = {
    name: input.name,
    notes: input.notes,
    targetQuantity: input.targetQuantity,
    startDate: input.startDate ? startDate : undefined,
    targetDate: input.targetDate ? targetDate : undefined,
    categoryId: refs.categoryId,
    styleId: refs.styleId,
  };
  if (refs.factoryId) {
    data.factoryId = refs.factoryId;
    data.factoryName = null;
  } else {
    if (refs.factoryId === null) data.factoryId = null;
    if (input.factoryName !== undefined) data.factoryName = input.factoryName;
  }
  if (refs.buyerId !== undefined) {
    data.buyerId = refs.buyerId;
    data.isInHouse = !refs.buyerId;
  }
  await prisma.$transaction(async (tx) => {
    await tx.productionProject.update({ where: { id: project.id }, data });
    await auditInCompany(
      ctx,
      meta,
      {
        action: "UPDATE",
        entityType: "ProductionProject",
        entityId: project.id,
        summary: `Updated ${project.code}: ${changed.join(", ")}`,
      },
      tx,
    );
  });
  return getProject(ctx, project.id);
}

// =============================================================================
// Reading
// =============================================================================

export async function getProject(ctx: CompanyContext, projectId: string) {
  const project = await ctx.db.productionProject.findUnique({
    where: { id: projectId },
    include: {
      ...projectInclude,
      stageLogs: { orderBy: [{ startedAt: "asc" }, { id: "asc" }] },
      stockIntakes: {
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        select: {
          id: true,
          number: true,
          status: true,
          method: true,
          totalCost: true,
          confirmedAt: true,
          createdAt: true,
          lines: { select: { grade: true, quantity: true } },
        },
      },
    },
  });
  if (!project) throw new AppError("NOT_FOUND", "Production project not found.");
  const now = new Date();
  const tz = ctx.company.timezone;
  const showCosts = canSeeProductionCosts(ctx);
  const costs = await projectCostSummary(prisma, ctx.company.id, project.id);
  return {
    ...projectCard(ctx, project, costs, now),
    notes: project.notes,
    createdAt: project.createdAt,
    updatedAt: project.updatedAt,
    stageHistory: project.stageLogs.map((log) => ({
      id: log.id,
      stage: log.stage,
      label: STAGE_LABELS[log.stage],
      startedAt: log.startedAt,
      completedAt: log.completedAt,
      days: Math.max(
        daysBetween(localDay(log.startedAt, tz), localDay(log.completedAt ?? now, tz)),
        0,
      ),
      note: log.note,
    })),
    deliveries: project.stockIntakes.map((intake) => ({
      id: intake.id,
      number: intake.number,
      status: intake.status,
      method: intake.method,
      pieces: intake.lines.reduce((s, l) => s + l.quantity, 0),
      bGradePieces: intake.lines
        .filter((l) => l.grade === "B_GRADE")
        .reduce((s, l) => s + l.quantity, 0),
      totalCost: showCosts ? intake.totalCost : null,
      confirmedAt: intake.confirmedAt,
      createdAt: intake.createdAt,
    })),
  };
}

export async function listProjects(ctx: CompanyContext, raw: unknown = {}) {
  const q = listProjectsSchema.parse(raw);
  const take = q.take ?? 50;
  const now = new Date();
  const tz = ctx.company.timezone;
  const and: Prisma.ProductionProjectWhereInput[] = [];
  if (q.status) and.push({ status: q.status });
  if (q.stage) and.push({ stage: q.stage });
  if (q.buyerId) and.push({ buyerId: q.buyerId });
  if (q.factoryId) and.push({ factoryId: q.factoryId });
  if (q.inHouse !== undefined) and.push({ isInHouse: q.inHouse });
  if (q.overdue) {
    and.push({
      status: { in: [...OPEN_STATUSES] },
      targetDate: { lt: startOfDayInZone(localDay(now, tz), tz) },
    });
  }
  if (q.search) {
    const contains = { contains: q.search, mode: "insensitive" as const };
    and.push({
      OR: [
        { code: contains },
        { name: contains },
        { factoryName: contains },
        { factory: { name: contains } },
        { buyer: { name: contains } },
      ],
    });
  }
  const rows = await ctx.db.productionProject.findMany({
    where: { AND: and },
    include: projectInclude,
    orderBy: [{ startDate: "desc" }, { id: "desc" }],
    take: take + 1,
    ...(q.cursor ? { cursor: { id: q.cursor }, skip: 1 } : {}),
  });
  const hasMore = rows.length > take;
  const page = hasMore ? rows.slice(0, take) : rows;
  const costs = canSeeProductionCosts(ctx)
    ? await projectCostSummaries(
        prisma,
        ctx.company.id,
        page.map((p) => p.id),
      )
    : new Map<string, ProjectCostSummary>();
  return {
    items: page.map((p) => projectCard(ctx, p, costs.get(p.id), now)),
    nextCursor: hasMore ? page[page.length - 1]?.id : undefined,
  };
}

/**
 * Production Overview Dashboard: a card per open project (overdue first, then
 * by target date) with its timeline and stage badge, plus counts per stage.
 */
export async function getProductionOverview(ctx: CompanyContext) {
  const now = new Date();
  const tz = ctx.company.timezone;
  const today = localDay(now, tz);
  const open = await ctx.db.productionProject.findMany({
    where: { status: { in: [...OPEN_STATUSES] } },
    include: projectInclude,
    orderBy: [{ targetDate: "asc" }, { id: "asc" }],
    take: 500,
  });
  const showCosts = canSeeProductionCosts(ctx);
  const costs = showCosts
    ? await projectCostSummaries(
        prisma,
        ctx.company.id,
        open.map((p) => p.id),
      )
    : new Map<string, ProjectCostSummary>();
  const cards = open.map((p) => projectCard(ctx, p, costs.get(p.id), now));
  const projects = [
    ...cards.filter((c) => c.timeline.isOverdue),
    ...cards.filter((c) => !c.timeline.isOverdue),
  ];
  const completedThisMonth = await ctx.db.productionProject.count({
    where: {
      status: "COMPLETED",
      completedAt: { gte: startOfDayInZone(`${today.slice(0, 8)}01`, tz) },
    },
  });
  const working = cards.filter((c) => c.status !== "PLANNED");
  const sum = (pick: (s: ProjectCostSummary) => Prisma.Decimal) =>
    [...costs.values()].reduce((total, s) => total.plus(pick(s)), ZERO);

  return {
    today,
    timezone: tz,
    counts: {
      planned: cards.filter((c) => c.status === "PLANNED").length,
      active: cards.filter((c) => c.status === "ACTIVE").length,
      onHold: cards.filter((c) => c.status === "ON_HOLD").length,
      overdue: cards.filter((c) => c.timeline.isOverdue).length,
      dueSoon: cards.filter((c) => c.timeline.dueSoon).length,
      completedThisMonth,
    },
    byStage: STAGE_ORDER.filter((s) => s !== "COMPLETED").map((stage) => ({
      stage,
      label: STAGE_LABELS[stage],
      count: working.filter((c) => c.stage.key === stage).length,
    })),
    totals: showCosts
      ? {
          totalCost: sum((s) => s.totalCost),
          inStock: sum((s) => s.inStock),
          wip: sum((s) => s.wip),
        }
      : null,
    projects,
  };
}

// =============================================================================
// Stages and status
// =============================================================================

async function lockProject(tx: Tx, ctx: CompanyContext, projectId: string) {
  await lockRow(tx, "ProductionProject", projectId);
  const project = await tx.productionProject.findFirst({
    where: { id: projectId, companyId: ctx.company.id },
  });
  if (!project) throw new AppError("NOT_FOUND", "Production project not found.");
  return project;
}

/** Moves the stage badge; going back a stage (rework) needs a note. */
export async function setProjectStage(
  ctx: CompanyContext,
  projectId: string,
  raw: unknown,
  meta?: RequestMeta,
) {
  const input = setStageSchema.parse(raw);
  await prisma.$transaction(async (tx) => {
    const project = await lockProject(tx, ctx, projectId);
    if (project.status !== "ACTIVE") throw new AppError("CONFLICT", notActiveMessage(project));
    if (project.stage === input.stage) {
      throw new AppError("CONFLICT", `${project.code} is already at ${STAGE_LABELS[input.stage]}.`);
    }
    if (isStageBackward(project.stage, input.stage) && !input.note) {
      throw new AppError(
        "VALIDATION",
        `Say why ${project.code} goes back to ${STAGE_LABELS[input.stage]}.`,
        { note: ["Required when going back a stage"] },
      );
    }
    const now = new Date();
    await tx.productionStageLog.updateMany({
      where: { projectId: project.id, completedAt: null },
      data: { completedAt: now },
    });
    await tx.productionStageLog.create({
      data: { projectId: project.id, stage: input.stage, startedAt: now, note: input.note ?? null },
    });
    await tx.productionProject.update({
      where: { id: project.id },
      data: { stage: input.stage },
    });
    await auditInCompany(
      ctx,
      meta,
      {
        action: "STATUS_CHANGE",
        entityType: "ProductionProject",
        entityId: project.id,
        summary: `${project.code}: ${STAGE_LABELS[project.stage]} → ${STAGE_LABELS[input.stage]}${input.note ? ` (${input.note})` : ""}`,
      },
      tx,
    );
  });
  return getProject(ctx, projectId);
}

/** Starts a planned project, puts one on hold or resumes it. */
export async function setProjectStatus(
  ctx: CompanyContext,
  projectId: string,
  raw: unknown,
  meta?: RequestMeta,
) {
  const input = setStatusSchema.parse(raw);
  await prisma.$transaction(async (tx) => {
    const project = await lockProject(tx, ctx, projectId);
    const allowedFrom: ProductionStatus[] =
      input.status === "ACTIVE" ? ["PLANNED", "ON_HOLD"] : ["ACTIVE"];
    if (!allowedFrom.includes(project.status)) {
      throw new AppError(
        "CONFLICT",
        project.status === input.status
          ? `${project.code} is already ${input.status === "ACTIVE" ? "active" : "on hold"}.`
          : `${project.code} is ${project.status.toLowerCase()}.`,
      );
    }
    const now = new Date();
    const data: Prisma.ProductionProjectUpdateInput = { status: input.status };
    if (project.status === "PLANNED") {
      // Starting early moves the start date to today.
      if (project.startDate > now) data.startDate = now;
      const openLog = await tx.productionStageLog.count({
        where: { projectId: project.id, completedAt: null },
      });
      if (openLog === 0) {
        await tx.productionStageLog.create({
          data: { projectId: project.id, stage: project.stage, startedAt: now },
        });
      }
    }
    await tx.productionProject.update({ where: { id: project.id }, data });
    const verb =
      project.status === "PLANNED" ? "Started" : input.status === "ON_HOLD" ? "Held" : "Resumed";
    await auditInCompany(
      ctx,
      meta,
      {
        action: "STATUS_CHANGE",
        entityType: "ProductionProject",
        entityId: project.id,
        summary: `${verb} ${project.code}${input.note ? `: ${input.note}` : ""}`,
      },
      tx,
    );
  });
  return getProject(ctx, projectId);
}

/**
 * Marks a project completed. All its cost must have moved to stock first (the
 * final delivery takes whatever is left), unless Accounts writes the rest off.
 */
export async function completeProjectTx(
  tx: Tx,
  ctx: CompanyContext,
  projectId: string,
  options: { writeOffReason?: string; note?: string | null },
  meta?: RequestMeta,
) {
  const project = await lockProject(tx, ctx, projectId);
  if (project.status !== "ACTIVE" && project.status !== "ON_HOLD") {
    throw new AppError(
      "CONFLICT",
      project.status === "PLANNED"
        ? `${project.code} has not started; start it or cancel it.`
        : `${project.code} is already ${project.status.toLowerCase()}.`,
    );
  }
  const openIntake = await tx.stockIntake.findFirst({
    where: {
      companyId: ctx.company.id,
      projectId: project.id,
      status: { in: ["DRAFT", "PARSED"] },
    },
  });
  if (openIntake) {
    throw new AppError(
      "CONFLICT",
      `Confirm or cancel the open delivery ${openIntake.number} before completing ${project.code}.`,
    );
  }
  const costs = await projectCostSummary(tx, ctx.company.id, project.id);
  if (costs.wip.gt(0)) {
    if (!options.writeOffReason) {
      throw new AppError(
        "CONFLICT",
        `${costs.wip.toFixed(2)} of ${project.code}'s cost has not moved to stock yet. Receive the final delivery with Move to Stock, or complete it with a write-off reason.`,
      );
    }
    assertCanWriteOff(ctx, costs.wip);
    await writeOffProjectWip(tx, ctx, project, costs.wip, options.writeOffReason);
  }
  const now = new Date();
  await tx.productionStageLog.updateMany({
    where: { projectId: project.id, completedAt: null },
    data: { completedAt: now },
  });
  await tx.productionStageLog.create({
    data: {
      projectId: project.id,
      stage: "COMPLETED",
      startedAt: now,
      completedAt: now,
      note: options.note ?? null,
    },
  });
  await tx.productionProject.update({
    where: { id: project.id },
    data: { status: "COMPLETED", stage: "COMPLETED", completedAt: now },
  });
  const produced = project.producedQtyA + project.producedQtyB;
  await auditInCompany(
    ctx,
    meta,
    {
      action: "STATUS_CHANGE",
      entityType: "ProductionProject",
      entityId: project.id,
      summary: `Completed ${project.code}: ${produced} of ${project.targetQuantity} pcs received${
        costs.wip.gt(0) ? `, ${costs.wip.toFixed(2)} written off (${options.writeOffReason})` : ""
      }`,
    },
    tx,
  );
}

export async function completeProject(
  ctx: CompanyContext,
  projectId: string,
  raw: unknown = {},
  meta?: RequestMeta,
) {
  const input = completeProjectSchema.parse(raw);
  await prisma.$transaction((tx) => completeProjectTx(tx, ctx, projectId, input, meta));
  return getProject(ctx, projectId);
}

/**
 * Stops a project. Open deliveries are cancelled; any cost that never reached
 * stock is written off as a production loss (Accounts only).
 */
export async function cancelProject(
  ctx: CompanyContext,
  projectId: string,
  raw: unknown,
  meta?: RequestMeta,
) {
  const { reason } = cancelProjectSchema.parse(raw);
  await prisma.$transaction(async (tx) => {
    const project = await lockProject(tx, ctx, projectId);
    if (isProjectClosed(project)) {
      throw new AppError("CONFLICT", `${project.code} is already ${project.status.toLowerCase()}.`);
    }
    const costs = await projectCostSummary(tx, ctx.company.id, project.id);
    if (costs.wip.gt(0)) {
      assertCanWriteOff(ctx, costs.wip);
      await writeOffProjectWip(tx, ctx, project, costs.wip, `cancelled — ${reason}`);
    }
    await tx.stockIntake.updateMany({
      where: {
        companyId: ctx.company.id,
        projectId: project.id,
        status: { in: ["DRAFT", "PARSED"] },
      },
      data: { status: "CANCELLED" },
    });
    await tx.productionStageLog.updateMany({
      where: { projectId: project.id, completedAt: null },
      data: { completedAt: new Date() },
    });
    await tx.productionProject.update({
      where: { id: project.id },
      data: { status: "CANCELLED" },
    });
    await auditInCompany(
      ctx,
      meta,
      {
        action: "STATUS_CHANGE",
        entityType: "ProductionProject",
        entityId: project.id,
        summary: `Cancelled ${project.code}: ${reason}${
          costs.wip.gt(0) ? ` (${costs.wip.toFixed(2)} of cost written off)` : ""
        }`,
      },
      tx,
    );
  });
  return getProject(ctx, projectId);
}
