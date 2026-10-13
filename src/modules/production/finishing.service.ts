import { type FinishingKind, Prisma, type StockGrade } from "@prisma/client";
import { z } from "zod";

import { dateColumn, dateOnly, localDay } from "@/lib/dates";
import { AppError } from "@/lib/errors";
import { nextDocumentNumber } from "@/lib/numbering";
import { prisma } from "@/lib/prisma";
import type { RequestMeta } from "@/lib/request-meta";
import { lockRow } from "@/lib/row-lock";
import { assertAllowed } from "@/lib/verdict";
import { auditInCompany } from "@/modules/audit/audit.service";
import type { CompanyContext } from "@/modules/auth/context";
import { getDefaultWarehouse, listWarehouses } from "@/modules/inventory/stock.service";
import { cellKey } from "@/modules/production/cutting";
import { cutByCell } from "@/modules/production/cutting.service";
import { logFaultTx } from "@/modules/production/fault.service";
import {
  addUpGrades,
  countLineSchema,
  finalUnitCost,
  finishingCell,
  type GradeLine,
  type Grades,
  mendingLineSchema,
  missingLineSchema,
  NO_GRADES,
  readGradeLines,
} from "@/modules/production/finishing";
import { confirmIntakeTx, lineRows } from "@/modules/production/intake.service";
import {
  canSeeProductionCosts,
  isProjectClosed,
  projectCostSummary,
} from "@/modules/production/project-costs";
import { completeProjectTx } from "@/modules/production/project.service";
import { canReceiveGoods } from "@/modules/production/rules";
import { activeMembers, membersWith } from "@/modules/reminders/audience";
import { sendInApp } from "@/modules/reminders/notification.service";

/*
 * A style's finishing and QC at the factory, by colour and size:
 *   - finishing counts grade the pieces A, B or C (to mending), with rejects
 *     (sewing faults) kept apart from missing ones;
 *   - "Back from mending" turns C pieces into A, B or reject;
 *   - "Receive Full Packing List" moves every A and B piece not yet in stock to
 *     the Sales stock on one delivery (C pieces, rejects and missing pieces
 *     never go), records what is missing (cut but never counted: lost or
 *     stolen) in the factory's fault log at the final unit cost, and can close
 *     the style, which evens every piece out to total cost ÷ (A + B).
 * Everyone in Production reads it; Production Managers and the store (who
 * receive goods) record it; costs follow the production cost rule.
 */

const id = z.string().min(1);
const day = z.iso.date();
const note = z.string().trim().max(1000).nullish();

export const finishingCountSchema = z.object({
  countedOn: day.optional(),
  lines: z.array(countLineSchema).min(1).max(500),
  fileId: id.nullish(),
  note,
});

export const mendingSchema = z.object({
  countedOn: day.optional(),
  lines: z.array(mendingLineSchema).min(1).max(500),
  note,
});

export const packingListSchema = z.object({
  countedOn: day.optional(),
  /** What is missing by colour and size (the first, full packing list only). */
  missing: z.array(missingLineSchema).max(500).optional(),
  warehouseId: id.nullish(),
  /** Close the style once its pieces are in stock (Production Managers). */
  closeStyle: z.boolean().optional(),
  /** Take the pieces in at no cost when the style has none left to give them. */
  allowZeroCost: z.boolean().optional(),
  fileId: id.nullish(),
  note,
});

/** Counting at finishing: Production Managers and the store, who receive goods. */
export function canCountFinishing(ctx: Pick<CompanyContext, "can">) {
  return ctx.can("production.manage") || ctx.can("production.stock_intake");
}

function assertCanCount(ctx: CompanyContext) {
  if (!canCountFinishing(ctx)) {
    throw new AppError("FORBIDDEN", "Only Production Managers and the store record finishing.");
  }
}

export const finishingProjectSelect = {
  id: true,
  code: true,
  name: true,
  status: true,
  stage: true,
  styleId: true,
  targetQuantity: true,
  factoryId: true,
  factoryName: true,
  factory: { select: { id: true, name: true } },
  batch: { select: { id: true, code: true, name: true } },
} satisfies Prisma.ProductionProjectSelect;

type Project = Prisma.ProductionProjectGetPayload<{ select: typeof finishingProjectSelect }>;

async function loadProject(ctx: CompanyContext, projectId: string) {
  const project = await ctx.db.productionProject.findUnique({
    where: { id: projectId },
    select: finishingProjectSelect,
  });
  if (!project) throw new AppError("NOT_FOUND", "Production project not found.");
  return project;
}

function assertOpen(project: Pick<Project, "code" | "status">) {
  if (isProjectClosed(project)) {
    throw new AppError(
      "CONFLICT",
      `${project.code} is ${project.status.toLowerCase()}; finishing is closed.`,
    );
  }
}

function assertPastDay(value: string | undefined, today: string, field: string) {
  if (value && value > today) {
    throw new AppError("VALIDATION", "It cannot be on a later day.", {
      [field]: ["Choose today or an earlier day"],
    });
  }
}

async function assertFile(ctx: CompanyContext, fileId: string | null | undefined) {
  if (!fileId) return null;
  const file = await ctx.db.fileAsset.findUnique({ where: { id: fileId }, select: { id: true } });
  if (!file) throw new AppError("NOT_FOUND", "The file was not found. Upload it again.");
  return file.id;
}

type Db = Prisma.TransactionClient;

/**
 * The style's cells: its grid (colour × size, with pieces to make and the SKU
 * they go to stock as), or one cell for a style without one, whose pieces can
 * go to stock only when the style has a single SKU.
 */
async function cellsOf(db: Db, project: Pick<Project, "id" | "styleId" | "targetQuantity">) {
  const rows = await db.productionTargetLine.findMany({
    where: { projectId: project.id, quantity: { gt: 0 } },
    select: {
      variantId: true,
      quantity: true,
      variant: {
        select: {
          color: { select: { name: true, sortOrder: true } },
          size: { select: { name: true, sortOrder: true } },
        },
      },
    },
  });
  if (rows.length > 0) {
    rows.sort(
      (a, b) =>
        a.variant.color.sortOrder - b.variant.color.sortOrder ||
        a.variant.color.name.localeCompare(b.variant.color.name) ||
        a.variant.size.sortOrder - b.variant.size.sortOrder ||
        a.variant.size.name.localeCompare(b.variant.size.name),
    );
    return rows.map((r) => ({
      colorName: r.variant.color.name as string | null,
      sizeName: r.variant.size.name as string | null,
      target: r.quantity,
      variantId: r.variantId as string | null,
    }));
  }
  const skus = project.styleId
    ? await db.productVariant.findMany({
        where: { styleId: project.styleId, isActive: true },
        select: { id: true },
        take: 2,
      })
    : [];
  return [
    {
      colorName: null,
      sizeName: null,
      target: project.targetQuantity,
      variantId: skus.length === 1 ? skus[0]!.id : null,
    },
  ];
}

/** Everything finishing works from, read in one go (inside a transaction when changing). */
export async function stateOf(db: Db, ctx: CompanyContext, project: Project) {
  const [cells, cut, stocked, rows] = await Promise.all([
    cellsOf(db, project),
    cutByCell(db, project.id),
    db.stockIntakeLine.groupBy({
      by: ["variantId", "grade"],
      where: {
        intake: { companyId: ctx.company.id, projectId: project.id, status: "CONFIRMED" },
      },
      _sum: { quantity: true },
    }),
    db.finishingReport.findMany({
      where: { projectId: project.id },
      select: {
        id: true,
        number: true,
        kind: true,
        countedOn: true,
        lines: true,
        note: true,
        fileId: true,
        createdAt: true,
        createdBy: { select: { name: true } },
        intake: { select: { id: true, number: true, status: true } },
        fault: { select: { id: true, number: true, status: true, amount: true } },
      },
      orderBy: [{ countedOn: "desc" }, { number: "desc" }],
    }),
  ]);
  const reports = rows.map((r) => ({
    ...r,
    lines: readGradeLines(r.lines),
    /** A packing list whose delivery was undone no longer stands. */
    stands: r.intake?.status !== "REVERSED",
  }));
  const counted = addUpGrades(reports.filter((r) => r.stands).map((r) => r.lines));
  const single = cells.length === 1 && cells[0]!.colorName === null;
  const inStock = (variantId: string | null, grade: StockGrade) =>
    stocked
      .filter((s) => s.grade === grade && (single || s.variantId === variantId))
      .reduce((t, s) => t + (s._sum.quantity ?? 0), 0);
  const grid = cells.map((c) => {
    const key = cellKey(c.colorName, c.sizeName);
    const input = {
      counted: counted.get(key) ?? NO_GRADES,
      inStock: { a: inStock(c.variantId, "A_GRADE"), b: inStock(c.variantId, "B_GRADE") },
      cut: cut ? (cut.get(key) ?? { good: 0, out: 0 }) : null,
    };
    return { ...c, ...finishingCell(input), input };
  });
  const sum = (pick: (c: (typeof grid)[number]) => number) => grid.reduce((t, c) => t + pick(c), 0);
  const packed = reports.find((r) => r.kind === "PACKING_LIST" && r.stands) ?? null;
  return {
    cells: grid,
    cutRecorded: cut !== null,
    reports,
    packed,
    totals: {
      target: sum((c) => c.target),
      cut: cut ? sum((c) => c.input.cut!.good) : null,
      out: cut ? sum((c) => c.input.cut!.out) : null,
      a: sum((c) => c.a),
      b: sum((c) => c.b),
      c: sum((c) => c.c),
      reject: sum((c) => c.reject),
      missing: sum((c) => c.missing),
      notCounted: cut ? sum((c) => c.notCounted ?? 0) : null,
      toStock: { a: sum((c) => c.toStock.a), b: sum((c) => c.toStock.b) },
      inStock: { a: sum((c) => c.inStock.a), b: sum((c) => c.inStock.b) },
    },
  };
}

const cellLabel = (c: { colorName: string | null; sizeName: string | null }) =>
  [c.colorName, c.sizeName].filter(Boolean).join(" ") || "All pieces";

/** Keeps each line to a cell of the style, once, dropping empty ones. */
function matchCells<L extends { colorName?: string | null; sizeName?: string | null }>(
  lines: L[],
  cells: Array<{ colorName: string | null; sizeName: string | null }>,
  pieces: (line: L) => number,
): Array<{ line: L; index: number; cell: number }> {
  const seen = new Set<string>();
  const out: Array<{ line: L; index: number; cell: number }> = [];
  lines.forEach((line, index) => {
    const key = cellKey(line.colorName, line.sizeName);
    const cell = cells.findIndex((c) => cellKey(c.colorName, c.sizeName) === key);
    if (cell < 0) {
      throw new AppError(
        "VALIDATION",
        `Line ${index + 1} is not a colour and size of this style.`,
        {
          [`lines.${index}`]: ["Choose a colour and size of the style"],
        },
      );
    }
    if (seen.has(key)) {
      throw new AppError("VALIDATION", "List each colour and size once.", {
        [`lines.${index}`]: ["Listed twice"],
      });
    }
    seen.add(key);
    if (pieces(line) > 0) out.push({ line, index, cell });
  });
  return out;
}

const gradeLine = (
  c: { colorName: string | null; sizeName: string | null },
  g: Partial<Grades>,
): GradeLine => ({
  colorName: c.colorName,
  sizeName: c.sizeName,
  a: g.a ?? 0,
  b: g.b ?? 0,
  c: g.c ?? 0,
  reject: g.reject ?? 0,
  missing: g.missing ?? 0,
});

// =============================================================================
// The finishing page
// =============================================================================

/** The finishing page: each colour and size graded, the reports, the packing list and the final unit cost. */
export async function getFinishingScreen(ctx: CompanyContext, projectId: string) {
  const project = await loadProject(ctx, projectId);
  const today = localDay(new Date(), ctx.company.timezone);
  const state = await stateOf(prisma, ctx, project);
  const { totals } = state;
  const seeCosts = canSeeProductionCosts(ctx);
  const open = !isProjectClosed(project);
  const canCount = canCountFinishing(ctx) && open;
  const canReceive = ctx.can("production.stock_intake") && canReceiveGoods(project).ok;
  const good = totals.a + totals.b;
  let cost: { total: string; good: number; perPiece: string | null } | null = null;
  if (seeCosts) {
    const summary = await projectCostSummary(prisma, ctx.company.id, project.id);
    const perPiece = finalUnitCost(summary.totalCost, good);
    cost = { total: summary.totalCost.toFixed(2), good, perPiece: perPiece?.toFixed(2) ?? null };
  }
  const toStock = totals.toStock.a + totals.toStock.b;
  const [warehouses, defaultWarehouse] = canReceive
    ? await Promise.all([listWarehouses(ctx), getDefaultWarehouse(ctx)])
    : [[], null];
  return {
    today,
    project: {
      id: project.id,
      code: project.code,
      name: project.name,
      status: project.status,
      stage: project.stage,
      target: project.targetQuantity,
      batch: project.batch,
      factory: project.factory?.name ?? project.factoryName ?? null,
      /** The factory is a supplier in the app, so missing pieces go to its fault log. */
      factoryInLog: Boolean(project.factoryId),
    },
    hasGrid: state.cells.some((c) => c.colorName !== null),
    colours: [...new Set(state.cells.map((c) => c.colorName))],
    cells: state.cells.map((c) => ({
      colorName: c.colorName,
      sizeName: c.sizeName,
      target: c.target,
      cut: c.input.cut?.good ?? null,
      out: c.input.cut?.out ?? null,
      a: c.a,
      b: c.b,
      c: c.c,
      reject: c.reject,
      missing: c.missing,
      notCounted: c.notCounted,
      free: c.free,
      inStock: c.inStock,
      toStock: c.toStock,
      /** Its A and B pieces have an SKU to go to stock as. */
      stockable: c.variantId !== null,
    })),
    cutRecorded: state.cutRecorded,
    totals,
    packed: state.packed
      ? {
          number: state.packed.number,
          on: dateOnly(state.packed.countedOn)!,
          intake: state.packed.intake,
          missing: state.packed.lines.reduce((t, l) => t + l.missing, 0),
          fault: state.packed.fault
            ? { id: state.packed.fault.id, number: state.packed.fault.number }
            : null,
        }
      : null,
    reports: state.reports.map((r) => ({
      id: r.id,
      number: r.number,
      kind: r.kind,
      on: dateOnly(r.countedOn)!,
      lines: r.lines,
      totals: r.lines.reduce(
        (t, l) => ({
          a: t.a + l.a,
          b: t.b + l.b,
          c: t.c + l.c,
          reject: t.reject + l.reject,
          missing: t.missing + l.missing,
        }),
        NO_GRADES,
      ),
      stands: r.stands,
      intake: r.intake,
      fault: r.fault ? { id: r.fault.id, number: r.fault.number, status: r.fault.status } : null,
      fileId: r.fileId,
      note: r.note,
      by: r.createdBy?.name ?? null,
    })),
    cost,
    warehouses: warehouses.map((w) => ({ id: w.id, name: w.name })),
    defaultWarehouseId: defaultWarehouse?.id ?? null,
    can: {
      count: canCount && !state.packed,
      mend: canCount && totals.c > 0,
      deleteReports: canCount,
      receive: canReceive && (toStock > 0 || (!state.packed && good + totals.reject > 0)),
      close: ctx.can("production.manage"),
      seeCosts,
    },
  };
}

export type FinishingScreen = Awaited<ReturnType<typeof getFinishingScreen>>;

// =============================================================================
// Counts and mending
// =============================================================================

/** A finishing count: pieces graded A, B or C (to mending) and rejects, by colour and size. */
export async function createFinishingCount(
  ctx: CompanyContext,
  projectId: string,
  raw: unknown,
  meta?: RequestMeta,
) {
  const input = finishingCountSchema.parse(raw);
  assertCanCount(ctx);
  const project = await loadProject(ctx, projectId);
  assertOpen(project);
  const today = localDay(new Date(), ctx.company.timezone);
  assertPastDay(input.countedOn, today, "countedOn");
  const fileId = await assertFile(ctx, input.fileId);
  return prisma.$transaction(async (tx) => {
    await lockRow(tx, "ProductionProject", project.id);
    const state = await stateOf(tx, ctx, project);
    if (state.packed) {
      throw new AppError(
        "CONFLICT",
        `The full packing list ${state.packed.number} is received; nothing more is counted on ${project.code}.`,
      );
    }
    const matched = matchCells(input.lines, state.cells, (l) => l.a + l.b + l.c + l.reject);
    if (matched.length === 0) {
      throw new AppError("VALIDATION", "Enter the pieces of at least one colour and size.", {
        lines: ["Nothing entered"],
      });
    }
    const lines: GradeLine[] = [];
    for (const { line, index, cell } of matched) {
      const c = state.cells[cell]!;
      const was = c.input.counted;
      const next = finishingCell({
        ...c.input,
        counted: {
          a: was.a + line.a,
          b: was.b + line.b,
          c: was.c + line.c,
          reject: was.reject + line.reject,
          missing: was.missing,
        },
      });
      if (next.free !== null && next.free < 0) {
        const left = Math.max(c.free ?? 0, 0);
        throw new AppError(
          "VALIDATION",
          `Only ${left} more ${cellLabel(c)} ${left === 1 ? "piece is" : "pieces are"} cut and back to count.`,
          { [`lines.${index}`]: [`No more than ${left}`] },
        );
      }
      lines.push(gradeLine(c, line));
    }
    const sum = (pick: (l: GradeLine) => number) => lines.reduce((t, l) => t + pick(l), 0);
    const made = await tx.finishingReport.create({
      data: {
        companyId: ctx.company.id,
        projectId: project.id,
        number: await nextDocumentNumber(tx, ctx.company.id, "FINISHING_REPORT"),
        kind: "COUNT",
        countedOn: dateColumn(input.countedOn ?? today),
        lines,
        fileId,
        note: input.note ?? null,
        createdById: ctx.user.id,
      },
      select: { id: true, number: true },
    });
    const pieces = { a: sum((l) => l.a), b: sum((l) => l.b), c: sum((l) => l.c) };
    const rejects = sum((l) => l.reject);
    await auditInCompany(
      ctx,
      meta,
      {
        action: "CREATE",
        entityType: "FinishingReport",
        entityId: made.id,
        summary: `Finishing count ${made.number} for ${project.code}: ${pieces.a} A-grade, ${pieces.b} B-grade, ${pieces.c} C-grade (mending), ${rejects} rejects`,
      },
      tx,
    );
    return { id: made.id, number: made.number, ...pieces, reject: rejects };
  });
}

/** C pieces back from mending, as A, B or reject. */
export async function backFromMending(
  ctx: CompanyContext,
  projectId: string,
  raw: unknown,
  meta?: RequestMeta,
) {
  const input = mendingSchema.parse(raw);
  assertCanCount(ctx);
  const project = await loadProject(ctx, projectId);
  assertOpen(project);
  const today = localDay(new Date(), ctx.company.timezone);
  assertPastDay(input.countedOn, today, "countedOn");
  return prisma.$transaction(async (tx) => {
    await lockRow(tx, "ProductionProject", project.id);
    const state = await stateOf(tx, ctx, project);
    const matched = matchCells(input.lines, state.cells, (l) => l.a + l.b + l.reject);
    if (matched.length === 0) {
      throw new AppError("VALIDATION", "Enter the pieces back from mending.", {
        lines: ["Nothing entered"],
      });
    }
    const lines: GradeLine[] = [];
    for (const { line, index, cell } of matched) {
      const c = state.cells[cell]!;
      const back = line.a + line.b + line.reject;
      if (back > c.c) {
        throw new AppError(
          "VALIDATION",
          `Only ${c.c} ${cellLabel(c)} ${c.c === 1 ? "piece is" : "pieces are"} at mending.`,
          { [`lines.${index}`]: [`No more than ${c.c}`] },
        );
      }
      lines.push(gradeLine(c, { a: line.a, b: line.b, c: -back, reject: line.reject }));
    }
    const sum = (pick: (l: GradeLine) => number) => lines.reduce((t, l) => t + pick(l), 0);
    const made = await tx.finishingReport.create({
      data: {
        companyId: ctx.company.id,
        projectId: project.id,
        number: await nextDocumentNumber(tx, ctx.company.id, "FINISHING_REPORT"),
        kind: "MENDING",
        countedOn: dateColumn(input.countedOn ?? today),
        lines,
        note: input.note ?? null,
        createdById: ctx.user.id,
      },
      select: { id: true, number: true },
    });
    const result = { a: sum((l) => l.a), b: sum((l) => l.b), reject: sum((l) => l.reject) };
    await auditInCompany(
      ctx,
      meta,
      {
        action: "CREATE",
        entityType: "FinishingReport",
        entityId: made.id,
        summary: `${made.number}: ${result.a + result.b + result.reject} pieces of ${project.code} back from mending (${result.a} A-grade, ${result.b} B-grade, ${result.reject} rejects)`,
      },
      tx,
    );
    return { id: made.id, number: made.number, ...result };
  });
}

/** Deletes a count or mending return entered by mistake (never a packing list). */
export async function deleteFinishingReport(
  ctx: CompanyContext,
  reportId: string,
  meta?: RequestMeta,
) {
  assertCanCount(ctx);
  const report = await ctx.db.finishingReport.findUnique({
    where: { id: reportId },
    select: { id: true, number: true, kind: true, project: { select: finishingProjectSelect } },
  });
  if (!report) throw new AppError("NOT_FOUND", "Finishing report not found.");
  const project = report.project;
  assertOpen(project);
  if (report.kind === "PACKING_LIST") {
    throw new AppError(
      "CONFLICT",
      `${report.number} is a packing list; undo its delivery to take its pieces back out of stock.`,
    );
  }
  await prisma.$transaction(async (tx) => {
    await lockRow(tx, "ProductionProject", project.id);
    const state = await stateOf(tx, ctx, project);
    if (report.kind === "COUNT" && state.packed) {
      throw new AppError(
        "CONFLICT",
        `The full packing list ${state.packed.number} is received; its counts stay.`,
      );
    }
    const without = addUpGrades(
      state.reports.filter((r) => r.stands && r.id !== report.id).map((r) => r.lines),
    );
    for (const c of state.cells) {
      const left = without.get(cellKey(c.colorName, c.sizeName)) ?? NO_GRADES;
      if (left.c < 0) {
        throw new AppError(
          "CONFLICT",
          `${report.number}'s C-grade pieces came back from mending; it cannot be deleted.`,
        );
      }
    }
    await tx.finishingReport.delete({ where: { id: report.id } });
    await auditInCompany(
      ctx,
      meta,
      {
        action: "DELETE",
        entityType: "FinishingReport",
        entityId: report.id,
        summary: `Deleted ${report.kind === "COUNT" ? "finishing count" : "mending return"} ${report.number} of ${project.code}`,
      },
      tx,
    );
  });
  return { id: report.id, number: report.number };
}

// =============================================================================
// Receive Full Packing List
// =============================================================================

/**
 * The full packing list from the factory: every A and B piece counted and not
 * yet in stock goes to the Sales stock on one delivery (DEL-), with the rest
 * of the style's cost, so a piece costs total cost ÷ (A + B). C pieces,
 * rejects and missing pieces stay out. What is missing (pieces cut and never
 * counted, as given) goes into the factory's fault log at the final unit cost,
 * and Production is told. Later, mended pieces go to stock the same way.
 */
export async function receivePackingList(
  ctx: CompanyContext,
  projectId: string,
  raw: unknown,
  meta?: RequestMeta,
) {
  const input = packingListSchema.parse(raw);
  if (!ctx.can("production.stock_intake")) {
    throw new AppError("FORBIDDEN", "Only Production and the store receive goods into stock.");
  }
  if (input.closeStyle && !ctx.can("production.manage")) {
    throw new AppError("FORBIDDEN", "Only Production Managers close a style.");
  }
  const project = await loadProject(ctx, projectId);
  assertAllowed(canReceiveGoods(project));
  const today = localDay(new Date(), ctx.company.timezone);
  assertPastDay(input.countedOn, today, "countedOn");
  const fileId = await assertFile(ctx, input.fileId);
  const countedOn = input.countedOn ?? today;

  const done = await prisma.$transaction(
    async (tx) => {
      await lockRow(tx, "ProductionProject", project.id);
      const state = await stateOf(tx, ctx, project);
      const first = !state.packed;

      const missing = new Map<number, number>();
      for (const { line, index, cell } of matchCells(
        input.missing ?? [],
        state.cells,
        (l) => l.quantity,
      )) {
        const c = state.cells[cell]!;
        if (!first) {
          throw new AppError(
            "VALIDATION",
            `Missing pieces were recorded on ${state.packed!.number} already.`,
            { [`missing.${index}`]: ["Recorded already"] },
          );
        }
        if (c.notCounted !== null && line.quantity > c.notCounted) {
          throw new AppError(
            "VALIDATION",
            `Only ${c.notCounted} ${cellLabel(c)} ${c.notCounted === 1 ? "piece is" : "pieces are"} cut and not counted.`,
            { [`missing.${index}`]: [`No more than ${c.notCounted}`] },
          );
        }
        missing.set(cell, line.quantity);
      }

      const toStock: Array<{ variantId: string; grade: StockGrade; quantity: number }> = [];
      for (const c of state.cells) {
        for (const [grade, quantity] of [
          ["A_GRADE", c.toStock.a],
          ["B_GRADE", c.toStock.b],
        ] as const) {
          if (quantity <= 0) continue;
          if (!c.variantId) {
            throw new AppError(
              "VALIDATION",
              `${project.code} has no colour and size grid to put its pieces in stock by; receive them on a delivery instead.`,
            );
          }
          toStock.push({ variantId: c.variantId, grade, quantity });
        }
      }
      const pieces = {
        a: toStock.filter((l) => l.grade === "A_GRADE").reduce((t, l) => t + l.quantity, 0),
        b: toStock.filter((l) => l.grade === "B_GRADE").reduce((t, l) => t + l.quantity, 0),
      };
      const missingTotal = [...missing.values()].reduce((t, n) => t + n, 0);
      if (toStock.length === 0 && missingTotal === 0 && !(first && input.closeStyle)) {
        throw new AppError(
          "VALIDATION",
          "Nothing to receive: every A and B piece counted is in stock already. Count the finishing first.",
        );
      }

      const number = await nextDocumentNumber(tx, ctx.company.id, "FINISHING_REPORT");
      let intake: { id: string; number: string } | null = null;
      if (toStock.length > 0) {
        intake = await tx.stockIntake.create({
          data: {
            companyId: ctx.company.id,
            number: await nextDocumentNumber(tx, ctx.company.id, "STOCK_INTAKE"),
            projectId: project.id,
            sourceFileId: fileId,
            method: "MANUAL",
            costAllocation: "EQUAL_PER_PIECE",
            notes: `Full packing list ${number}`,
          },
          select: { id: true, number: true },
        });
        await tx.stockIntakeLine.createMany({ data: lineRows(intake.id, toStock) });
        await auditInCompany(
          ctx,
          meta,
          {
            action: "CREATE",
            entityType: "StockIntake",
            entityId: intake.id,
            summary: `Delivery ${intake.number} for ${project.code}: ${pieces.a + pieces.b} pcs from the full packing list ${number}`,
          },
          tx,
        );
        await confirmIntakeTx(
          tx,
          ctx,
          intake.id,
          {
            warehouseId: input.warehouseId ?? undefined,
            finalDelivery: first,
            completeProject: Boolean(input.closeStyle),
            // Mended pieces after the full packing list come in at no cost; closing the
            // style evens every piece out again.
            allowZeroCost: Boolean(input.allowZeroCost) || !first,
          },
          meta,
        );
      } else if (input.closeStyle) {
        await completeProjectTx(tx, ctx, project.id, {}, meta);
      }

      // The final unit cost: all the style's cost over its A and B pieces.
      const summary = await projectCostSummary(tx, ctx.company.id, project.id);
      const unitCost = finalUnitCost(summary.totalCost, state.totals.a + state.totals.b);

      let fault: { id: string; number: string } | null = null;
      if (first) {
        // Missing pieces of a packing list whose delivery was undone are replaced by these.
        for (const old of state.reports) {
          if (old.kind !== "PACKING_LIST" || old.stands || old.fault?.status !== "OPEN") continue;
          await tx.supplierFault.update({
            where: { id: old.fault.id },
            data: {
              status: "WAIVED",
              settledAt: new Date(),
              settledById: ctx.user.id,
              settledNote: `Replaced by the packing list ${number}`,
            },
          });
          await auditInCompany(
            ctx,
            meta,
            {
              action: "UPDATE",
              entityType: "SupplierFault",
              entityId: old.fault.id,
              summary: `${old.fault.number} waived: its packing list ${old.number} was undone and replaced by ${number}`,
            },
            tx,
          );
        }
        if (missingTotal > 0 && project.factory) {
          const which = [...missing.entries()]
            .map(([cell, n]) => `${cellLabel(state.cells[cell]!)} ${n}`)
            .join(", ");
          fault = await logFaultTx(tx, ctx, meta, {
            supplier: project.factory,
            kind: "MISSING_PIECES",
            batchId: project.batch?.id ?? null,
            projectId: project.id,
            rawMaterialId: null,
            quantity: missingTotal,
            amount: unitCost ? unitCost.times(missingTotal).toNumber() : null,
            note: `${missingTotal} ${missingTotal === 1 ? "piece" : "pieces"} of ${project.code} missing at the full packing list ${number}: ${which}`,
            occurredOn: countedOn,
            photoId: null,
          });
        }
      }

      const made = await tx.finishingReport.create({
        data: {
          companyId: ctx.company.id,
          projectId: project.id,
          number,
          kind: "PACKING_LIST" satisfies FinishingKind,
          countedOn: dateColumn(countedOn),
          lines: state.cells
            .map((c, i) => gradeLine(c, { missing: missing.get(i) ?? 0 }))
            .filter((l) => l.missing > 0),
          intakeId: intake?.id ?? null,
          faultId: fault?.id ?? null,
          fileId,
          note: input.note ?? null,
          createdById: ctx.user.id,
        },
        select: { id: true, number: true },
      });
      const closed = Boolean(input.closeStyle);
      await auditInCompany(
        ctx,
        meta,
        {
          action: "CREATE",
          entityType: "FinishingReport",
          entityId: made.id,
          summary: `${first ? "Full packing list" : "Mended pieces"} ${made.number} for ${project.code}: ${pieces.a} A-grade and ${pieces.b} B-grade pieces to stock${intake ? ` on ${intake.number}` : ""}${first ? `, ${missingTotal} missing` : ""}${closed ? "; style closed" : ""}`,
        },
        tx,
      );
      if (missingTotal > 0) {
        const members = await activeMembers(ctx.company.id, tx);
        await sendInApp(
          tx,
          ctx.company.id,
          membersWith(members, ["production.manage"]).map((userId) => ({ userId })),
          {
            subject: `Missing pieces: ${project.code}`,
            body: `${missingTotal} ${missingTotal === 1 ? "piece" : "pieces"} of ${project.code} ${missingTotal === 1 ? "is" : "are"} missing at the full packing list ${made.number}${fault ? `; logged in ${project.factory!.name}'s fault log as ${fault.number}` : ""}.`,
            entityType: "ProductionProject",
            entityId: project.id,
          },
        );
      }
      return {
        id: made.id,
        number: made.number,
        intake,
        a: pieces.a,
        b: pieces.b,
        missing: missingTotal,
        fault,
        closed,
        unitCost: unitCost?.toFixed(2) ?? null,
      };
    },
    { timeout: 60_000 },
  );
  return done;
}

export type PackingListResult = Awaited<ReturnType<typeof receivePackingList>>;
