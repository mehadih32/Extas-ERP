import { Prisma, type ProductionStatus } from "@prisma/client";

import { localDay, toInstant } from "@/lib/dates";
import { AppError } from "@/lib/errors";
import { nextDocumentNumber } from "@/lib/numbering";
import { prisma } from "@/lib/prisma";
import type { RequestMeta } from "@/lib/request-meta";
import { auditInCompany } from "@/modules/audit/audit.service";
import type { CompanyContext } from "@/modules/auth/context";
import { assertPartyCanTransact } from "@/modules/parties/party.service";
import { batchCostGuard } from "@/modules/production/cost-guard";
import { ZERO } from "@/modules/production/costing";
import { canSeeProductionCosts } from "@/modules/production/project-costs";
import {
  type BatchState,
  createBatchSchema,
  listBatchesSchema,
  updateBatchSchema,
} from "@/modules/production/schemas";
import { OPEN_STATUSES, projectTimeline } from "@/modules/production/timeline";

/*
 * Master batches: one umbrella over the styles made together (say 5,000 polo
 * shirts in several brands at one factory). Each style is a production project of
 * its own, with its colours and sizes, target price, costs and deliveries; the
 * batch adds them up and its state follows them:
 *   EMPTY    no style yet
 *   PLANNED  no style started
 *   ACTIVE   a style in production or on hold
 *   DONE     every style completed or cancelled
 * Batches are read with production.view and changed with production.manage
 * (the actions check); money figures follow canSeeProductionCosts.
 */

const CLOSED: readonly ProductionStatus[] = ["COMPLETED", "CANCELLED"];

const batchInclude = {
  factory: { select: { id: true, code: true, name: true } },
  createdBy: { select: { id: true, name: true } },
  projects: {
    select: {
      id: true,
      code: true,
      name: true,
      status: true,
      startDate: true,
      targetDate: true,
      completedAt: true,
      targetQuantity: true,
      producedQtyA: true,
      producedQtyB: true,
      totalCost: true,
      targetUnitCost: true,
    },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  },
} satisfies Prisma.ProductionBatchInclude;

type BatchRow = Prisma.ProductionBatchGetPayload<{ include: typeof batchInclude }>;
type StyleRow = BatchRow["projects"][number];

/** A batch's state from its styles' statuses. */
export function batchState(statuses: readonly ProductionStatus[]): BatchState {
  if (statuses.length === 0) return "EMPTY";
  if (statuses.every((s) => CLOSED.includes(s))) return "DONE";
  if (statuses.some((s) => s === "ACTIVE" || s === "ON_HOLD")) return "ACTIVE";
  return "PLANNED";
}

/** The batches in a state, as a filter (the same rules as batchState). */
function stateWhere(state: BatchState): Prisma.ProductionBatchWhereInput {
  switch (state) {
    case "EMPTY":
      return { projects: { none: {} } };
    case "DONE":
      return { projects: { some: {}, every: { status: { in: [...CLOSED] } } } };
    case "ACTIVE":
      return { projects: { some: { status: { in: ["ACTIVE", "ON_HOLD"] } } } };
    case "PLANNED":
      return {
        AND: [
          { projects: { some: { status: "PLANNED" } } },
          { projects: { none: { status: { in: ["ACTIVE", "ON_HOLD"] } } } },
        ],
      };
  }
}

/**
 * The batch's days: from its first style's start to its own target day (or its
 * latest style's), done when every style is closed. Null with no day to aim for.
 */
function batchTimeline(batch: BatchRow, state: BatchState, now: Date, tz: string) {
  const styles = batch.projects;
  const latest = (dates: Date[]) =>
    dates.length > 0 ? new Date(Math.max(...dates.map((d) => d.getTime()))) : null;
  const earliest = (dates: Date[]) =>
    dates.length > 0 ? new Date(Math.min(...dates.map((d) => d.getTime()))) : null;
  const target = batch.targetDate ?? latest(styles.map((s) => s.targetDate));
  if (!target) return null;
  const done = state === "DONE";
  return projectTimeline(
    {
      startDate: earliest(styles.map((s) => s.startDate)) ?? batch.createdAt,
      targetDate: target,
      completedAt: done
        ? latest(styles.flatMap((s) => (s.completedAt ? [s.completedAt] : [])))
        : null,
      status: done ? "COMPLETED" : state === "ACTIVE" ? "ACTIVE" : "PLANNED",
    },
    now,
    tz,
  );
}

/**
 * What a batch adds up to: its styles, pieces, days and (for people who see
 * costs) its cost so far and cost guard, from each style's cached cost (or the
 * live figures given in `liveCosts`).
 */
function summarise(
  ctx: CompanyContext,
  batch: BatchRow,
  now: Date,
  liveCosts?: ReadonlyMap<string, Prisma.Decimal>,
) {
  const tz = ctx.company.timezone;
  const styles = batch.projects;
  const state = batchState(styles.map((s) => s.status));
  const costOf = (s: StyleRow) => liveCosts?.get(s.id) ?? s.totalCost;
  // Cancelled styles make nothing more: their pieces leave the target.
  const counted = styles.filter((s) => s.status !== "CANCELLED");
  const target = counted.reduce((n, s) => n + s.targetQuantity, 0);
  const producedA = styles.reduce((n, s) => n + s.producedQtyA, 0);
  const producedB = styles.reduce((n, s) => n + s.producedQtyB, 0);
  const totalCost = styles.reduce((sum, s) => sum.plus(costOf(s)), ZERO);
  const openStyles = styles.filter((s) => OPEN_STATUSES.includes(s.status));
  const today = localDay(now, tz);
  return {
    id: batch.id,
    code: batch.code,
    name: batch.name,
    kind: batch.kind,
    factory: batch.factory,
    targetDate: batch.targetDate,
    notes: batch.notes,
    createdAt: batch.createdAt,
    createdBy: batch.createdBy,
    state,
    styleCount: styles.length,
    openStyles: openStyles.length,
    /** Open styles past their own target day. */
    lateStyles: openStyles.filter((s) => localDay(s.targetDate, tz) < today).length,
    timeline: batchTimeline(batch, state, now, tz),
    quantities: {
      target,
      producedA,
      producedB,
      produced: producedA + producedB,
      remaining: Math.max(target - producedA - producedB, 0),
    },
    costs: canSeeProductionCosts(ctx)
      ? {
          totalCost,
          perPiece:
            target > 0
              ? totalCost.dividedBy(target).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP)
              : null,
          guard: batchCostGuard(
            counted.map((s) => ({
              totalCost: costOf(s),
              targetQuantity: s.targetQuantity,
              targetUnitCost: s.targetUnitCost,
            })),
          ),
        }
      : null,
  };
}

export type BatchSummary = ReturnType<typeof summarise>;

// =============================================================================
// Create / edit / delete
// =============================================================================

export async function createBatch(ctx: CompanyContext, raw: unknown, meta?: RequestMeta) {
  const input = createBatchSchema.parse(raw);
  const tz = ctx.company.timezone;
  const factoryId = input.factoryId
    ? (await assertPartyCanTransact(ctx, input.factoryId, "PURCHASE")).id
    : null;
  const batch = await prisma.$transaction(async (tx) => {
    const created = await tx.productionBatch.create({
      data: {
        companyId: ctx.company.id,
        code: await nextDocumentNumber(tx, ctx.company.id, "PRODUCTION_BATCH"),
        name: input.name,
        kind: input.kind ?? "CM",
        factoryId,
        targetDate: input.targetDate ? toInstant(input.targetDate, tz) : null,
        notes: input.notes ?? null,
        createdById: ctx.user.id,
      },
    });
    await auditInCompany(
      ctx,
      meta,
      {
        action: "CREATE",
        entityType: "ProductionBatch",
        entityId: created.id,
        summary: `Master batch ${created.code} "${created.name}" (${created.kind})${
          created.targetDate ? ` by ${localDay(created.targetDate, tz)}` : ""
        }`,
      },
      tx,
    );
    return created;
  });
  return getBatch(ctx, batch.id);
}

export async function updateBatch(
  ctx: CompanyContext,
  batchId: string,
  raw: unknown,
  meta?: RequestMeta,
) {
  const input = updateBatchSchema.parse(raw);
  const batch = await ctx.db.productionBatch.findUnique({ where: { id: batchId } });
  if (!batch) throw new AppError("NOT_FOUND", "Master batch not found.");
  const changed = Object.keys(input).filter((k) => input[k as keyof typeof input] !== undefined);
  const data: Prisma.ProductionBatchUncheckedUpdateInput = {
    name: input.name,
    kind: input.kind,
    notes: input.notes,
  };
  if (input.factoryId) {
    data.factoryId = (await assertPartyCanTransact(ctx, input.factoryId, "PURCHASE")).id;
  } else if (input.factoryId === null) data.factoryId = null;
  if (input.targetDate !== undefined) {
    data.targetDate = input.targetDate ? toInstant(input.targetDate, ctx.company.timezone) : null;
  }
  await prisma.$transaction(async (tx) => {
    await tx.productionBatch.update({ where: { id: batch.id }, data });
    await auditInCompany(
      ctx,
      meta,
      {
        action: "UPDATE",
        entityType: "ProductionBatch",
        entityId: batch.id,
        summary: `Updated master batch ${batch.code}: ${changed.join(", ") || "nothing"}`,
      },
      tx,
    );
  });
  return getBatch(ctx, batch.id);
}

/** Deletes a batch that has no styles and no signed contract (one made by mistake). */
export async function deleteBatch(ctx: CompanyContext, batchId: string, meta?: RequestMeta) {
  const batch = await ctx.db.productionBatch.findUnique({
    where: { id: batchId },
    include: {
      _count: { select: { projects: true, contracts: { where: { signedOn: { not: null } } } } },
    },
  });
  if (!batch) throw new AppError("NOT_FOUND", "Master batch not found.");
  if (batch._count.projects > 0) {
    throw new AppError(
      "CONFLICT",
      `${batch.code} has ${batch._count.projects} ${batch._count.projects === 1 ? "style" : "styles"}; only an empty batch can be deleted.`,
    );
  }
  // Its draft contracts go with it; a signed one is kept.
  if (batch._count.contracts > 0) {
    throw new AppError("CONFLICT", `${batch.code} has a signed contract, so it is kept.`);
  }
  await prisma.$transaction(async (tx) => {
    await tx.productionBatch.delete({ where: { id: batch.id } });
    await auditInCompany(
      ctx,
      meta,
      {
        action: "DELETE",
        entityType: "ProductionBatch",
        entityId: batch.id,
        summary: `Deleted master batch ${batch.code} "${batch.name}" (no styles)`,
      },
      tx,
    );
  });
  return { id: batch.id, code: batch.code };
}

// =============================================================================
// Reading
// =============================================================================

/** One batch with what it adds up to; its styles' cards come from listProjects. */
export async function getBatch(
  ctx: CompanyContext,
  batchId: string,
  liveCosts?: ReadonlyMap<string, Prisma.Decimal>,
) {
  const batch = await ctx.db.productionBatch.findUnique({
    where: { id: batchId },
    include: batchInclude,
  });
  if (!batch) throw new AppError("NOT_FOUND", "Master batch not found.");
  return summarise(ctx, batch, new Date(), liveCosts);
}

export async function listBatches(ctx: CompanyContext, raw: unknown = {}) {
  const q = listBatchesSchema.parse(raw);
  const take = q.take ?? 30;
  const and: Prisma.ProductionBatchWhereInput[] = [];
  if (q.state) and.push(stateWhere(q.state));
  if (q.kind) and.push({ kind: q.kind });
  if (q.search) {
    const contains = { contains: q.search, mode: "insensitive" as const };
    and.push({
      OR: [
        { code: contains },
        { name: contains },
        { factory: { name: contains } },
        { projects: { some: { OR: [{ code: contains }, { name: contains }] } } },
      ],
    });
  }
  const rows = await ctx.db.productionBatch.findMany({
    where: { AND: and },
    include: batchInclude,
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: take + 1,
    ...(q.cursor ? { cursor: { id: q.cursor }, skip: 1 } : {}),
  });
  const hasMore = rows.length > take;
  const page = hasMore ? rows.slice(0, take) : rows;
  const now = new Date();
  return {
    items: page.map((b) => summarise(ctx, b, now)),
    nextCursor: hasMore ? page[page.length - 1]?.id : undefined,
  };
}

/** Batches a style can join: those not done yet, newest first. */
export async function findOpenBatches(ctx: CompanyContext, query: { search?: string } = {}) {
  const search = (query.search ?? "").trim().slice(0, 100);
  const rows = await ctx.db.productionBatch.findMany({
    where: {
      OR: [
        { projects: { none: {} } },
        { projects: { some: { status: { in: [...OPEN_STATUSES] } } } },
      ],
      ...(search
        ? {
            AND: [
              {
                OR: [
                  { code: { contains: search, mode: "insensitive" } },
                  { name: { contains: search, mode: "insensitive" } },
                ],
              },
            ],
          }
        : {}),
    },
    include: { factory: { select: { id: true, code: true, name: true } } },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: 50,
  });
  const tz = ctx.company.timezone;
  return rows.map((b) => ({
    id: b.id,
    code: b.code,
    name: b.name,
    kind: b.kind,
    factory: b.factory,
    targetOn: b.targetDate ? localDay(b.targetDate, tz) : null,
  }));
}

export type BatchOption = Awaited<ReturnType<typeof findOpenBatches>>[number];
