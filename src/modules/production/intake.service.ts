import { Prisma, type StockGrade } from "@prisma/client";
import type { z } from "zod";

import { AppError } from "@/lib/errors";
import { nextDocumentNumber } from "@/lib/numbering";
import { prisma } from "@/lib/prisma";
import type { RequestMeta } from "@/lib/request-meta";
import { lockRow, lockRows } from "@/lib/row-lock";
import { ensureControlAccounts } from "@/modules/accounts/control-accounts";
import { postJournalEntry } from "@/modules/accounts/journal.service";
import { auditInCompany } from "@/modules/audit/audit.service";
import type { CompanyContext } from "@/modules/auth/context";
import { readStoredFile } from "@/modules/files/file.service";
import { getDefaultWarehouse, weightedAverageCost } from "@/modules/inventory/stock.service";
import {
  defaultIntakeParser,
  type IntakeParser,
  matchParsedLines,
  normalizeCode,
  type UnmatchedLine,
} from "@/modules/production/ai-intake";
import { DEFAULT_B_GRADE_RATIO, planIntakeCost } from "@/modules/production/costing";
import {
  canSeeProductionCosts,
  isProjectClosed,
  projectCostSummary,
} from "@/modules/production/project-costs";
import { completeProjectTx } from "@/modules/production/project.service";
import {
  confirmIntakeSchema,
  createIntakeSchema,
  listIntakesSchema,
  updateIntakeSchema,
} from "@/modules/production/schemas";

/*
 * "Move to Stock": a factory delivery for a production project becomes stock.
 *   1. Draft: quantities typed in (lines or the colour x size matrix), or a
 *      packing-list photo / PDF read by AI and matched to SKUs (PARSED).
 *   2. Confirm: pieces enter the warehouse as A- or B-grade, the delivery takes
 *      its share of the project's cost (Dr Inventory, Cr Work in Progress) and
 *      each SKU's average cost is re-weighted.
 */

type IntakeLinesInput = Pick<z.output<typeof createIntakeSchema>, "lines" | "matrix">;
type LineInput = { variantId: string; grade: StockGrade; quantity: number; unitCost?: number };

const DRAFT_STATUSES = ["DRAFT", "PARSED"] as const;

function assertDraft(intake: { number: string; status: string }) {
  if (!(DRAFT_STATUSES as readonly string[]).includes(intake.status)) {
    throw new AppError("CONFLICT", `${intake.number} is already ${intake.status.toLowerCase()}.`);
  }
}

function assertCanReceive(project: { code: string; status: string }) {
  if (project.status === "ACTIVE" || project.status === "ON_HOLD") return;
  throw new AppError(
    "CONFLICT",
    project.status === "PLANNED"
      ? `${project.code} has not started yet; start it first.`
      : `${project.code} is ${project.status.toLowerCase()}; it cannot receive goods.`,
  );
}

async function resolveWarehouse(ctx: CompanyContext, warehouseId?: string) {
  if (!warehouseId) return getDefaultWarehouse(ctx);
  const warehouse = await ctx.db.warehouse.findUnique({ where: { id: warehouseId } });
  if (!warehouse) throw new AppError("NOT_FOUND", "Warehouse not found.");
  return warehouse;
}

/** Lines and matrix cells as SKU x grade lines; repeats are added up. */
async function resolveIntakeLines(
  ctx: CompanyContext,
  input: IntakeLinesInput,
): Promise<LineInput[]> {
  const raw: Array<LineInput & { styleId?: string }> = [];
  for (const l of input.lines ?? []) {
    raw.push({
      variantId: l.variantId,
      grade: l.grade ?? "A_GRADE",
      quantity: l.quantity,
      unitCost: l.unitCost,
    });
  }
  for (const entry of input.matrix ?? []) {
    for (const [variantId, quantity] of Object.entries(entry.quantities)) {
      if (quantity > 0) {
        raw.push({ variantId, grade: entry.grade ?? "A_GRADE", quantity, styleId: entry.styleId });
      }
    }
  }
  if (raw.length === 0) return [];
  const variants = await ctx.db.productVariant.findMany({
    where: { id: { in: [...new Set(raw.map((l) => l.variantId))] } },
    include: { style: { select: { isActive: true } } },
  });
  const byId = new Map(variants.map((v) => [v.id, v]));
  const merged = new Map<string, LineInput>();
  for (const line of raw) {
    const v = byId.get(line.variantId);
    if (!v) throw new AppError("VALIDATION", "One of the SKUs was not found.");
    if (!v.isActive || !v.style.isActive) {
      throw new AppError("VALIDATION", `${v.sku} is archived; restore it before receiving stock.`);
    }
    if (line.styleId && line.styleId !== v.styleId) {
      throw new AppError("VALIDATION", `${v.sku} does not belong to the chosen style.`);
    }
    const key = `${v.id}:${line.grade}`;
    const existing = merged.get(key);
    if (!existing) {
      merged.set(key, { ...line, variantId: v.id });
      continue;
    }
    if (
      line.unitCost !== undefined &&
      existing.unitCost !== undefined &&
      line.unitCost !== existing.unitCost
    ) {
      throw new AppError("VALIDATION", `${v.sku} is entered twice with different costs.`);
    }
    existing.quantity += line.quantity;
    existing.unitCost ??= line.unitCost;
  }
  return [...merged.values()].map(({ variantId, grade, quantity, unitCost }) => ({
    variantId,
    grade,
    quantity,
    unitCost,
  }));
}

const lineRows = (intakeId: string, lines: LineInput[]) =>
  lines.map((l) => ({
    intakeId,
    variantId: l.variantId,
    grade: l.grade,
    quantity: l.quantity,
    unitCost: new Prisma.Decimal(l.unitCost ?? 0).toDecimalPlaces(4),
  }));

// =============================================================================
// Drafts
// =============================================================================

/**
 * Starts a delivery for a project. With a packing-list file and no lines, the
 * file is read by AI straight away; if that is not possible the draft is kept
 * and `aiError` says why, so quantities can be typed in instead.
 */
export async function createIntake(
  ctx: CompanyContext,
  raw: unknown,
  meta?: RequestMeta,
  parser: IntakeParser | null = defaultIntakeParser(),
) {
  const input = createIntakeSchema.parse(raw);
  const project = await ctx.db.productionProject.findUnique({ where: { id: input.projectId } });
  if (!project) throw new AppError("NOT_FOUND", "Production project not found.");
  assertCanReceive(project);
  const warehouse = await resolveWarehouse(ctx, input.warehouseId);
  if (input.sourceFileId) {
    const file = await ctx.db.fileAsset.findUnique({ where: { id: input.sourceFileId } });
    if (!file) throw new AppError("NOT_FOUND", "The uploaded packing list was not found.");
  }
  const lines = await resolveIntakeLines(ctx, input);
  const readWithAi = Boolean(input.sourceFileId) && (input.parse ?? lines.length === 0);
  const pieces = lines.reduce((s, l) => s + l.quantity, 0);

  const intake = await prisma.$transaction(async (tx) => {
    const created = await tx.stockIntake.create({
      data: {
        companyId: ctx.company.id,
        number: await nextDocumentNumber(tx, ctx.company.id, "STOCK_INTAKE"),
        projectId: project.id,
        warehouseId: warehouse.id,
        sourceFileId: input.sourceFileId ?? null,
        method: readWithAi ? "AI_OCR" : "MANUAL",
        costAllocation: input.costAllocation ?? "EQUAL_PER_PIECE",
        bGradeCostRatio:
          input.bGradeCostRatio ??
          (input.costAllocation === "B_GRADE_RATIO" ? DEFAULT_B_GRADE_RATIO : null),
        notes: input.notes ?? null,
      },
    });
    if (lines.length > 0) {
      await tx.stockIntakeLine.createMany({ data: lineRows(created.id, lines) });
    }
    await auditInCompany(
      ctx,
      meta,
      {
        action: "CREATE",
        entityType: "StockIntake",
        entityId: created.id,
        summary: `Delivery ${created.number} for ${project.code}: ${
          readWithAi ? "packing list uploaded for AI reading" : `${pieces} pcs entered`
        }`,
      },
      tx,
    );
    return created;
  });

  let aiError: string | null = null;
  if (readWithAi) {
    try {
      await parseIntake(ctx, intake.id, meta, parser);
    } catch (error) {
      if (!(error instanceof AppError)) console.error("[ai-intake]", error);
      aiError =
        error instanceof AppError
          ? error.message
          : "The AI reader failed. Enter the quantities by hand.";
    }
  }
  return { ...(await getIntake(ctx, intake.id)), aiError };
}

/** Reads (or re-reads) the delivery's packing list with AI, replacing its lines. */
export async function parseIntake(
  ctx: CompanyContext,
  intakeId: string,
  meta?: RequestMeta,
  parser: IntakeParser | null = defaultIntakeParser(),
) {
  const intake = await ctx.db.stockIntake.findUnique({
    where: { id: intakeId },
    include: {
      sourceFile: true,
      project: { select: { style: { select: { id: true, code: true, name: true } } } },
    },
  });
  if (!intake) throw new AppError("NOT_FOUND", "Delivery not found.");
  assertDraft(intake);
  if (!intake.sourceFile) {
    throw new AppError("VALIDATION", "Upload the factory packing list first.");
  }
  if (!parser) {
    throw new AppError(
      "UNAVAILABLE",
      "AI reading is not set up yet (AI_API_KEY and AI_INTAKE_MODEL). Enter the quantities by hand.",
    );
  }
  const projectStyle = intake.project?.style ?? null;
  const [styles, colors, sizes, bytes] = await Promise.all([
    ctx.db.style.findMany({
      where: { isActive: true },
      select: { id: true, code: true },
      orderBy: { code: "asc" },
      take: 1000,
    }),
    ctx.db.color.findMany({
      select: { name: true },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    }),
    ctx.db.size.findMany({
      select: { name: true },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    }),
    readStoredFile(intake.sourceFile),
  ]);
  const parsed = await parser.parse(
    { bytes, mimeType: intake.sourceFile.mimeType, fileName: intake.sourceFile.fileName },
    {
      projectStyle: projectStyle ? { code: projectStyle.code, name: projectStyle.name } : null,
      styleCodes: styles.slice(0, 200).map((s) => s.code),
      colors: colors.map((c) => c.name),
      sizes: sizes.map((s) => s.name),
    },
  );

  // Candidate SKUs: the project's style, styles named on the list, SKUs printed on it.
  const printedCodes = new Set(
    parsed.lines.flatMap((l) => (l.styleCode ? [normalizeCode(l.styleCode)] : [])),
  );
  const styleIds = styles.filter((s) => printedCodes.has(normalizeCode(s.code))).map((s) => s.id);
  if (projectStyle) styleIds.push(projectStyle.id);
  const skus = parsed.lines.flatMap((l) => (l.sku ? [l.sku.toUpperCase()] : []));
  const variants = await ctx.db.productVariant.findMany({
    where: {
      isActive: true,
      style: { isActive: true },
      OR: [{ styleId: { in: styleIds } }, { sku: { in: skus } }],
    },
    include: {
      style: { select: { code: true } },
      color: { select: { name: true } },
      size: { select: { name: true } },
    },
  });
  const match = matchParsedLines(
    parsed.lines,
    variants.map((v) => ({
      id: v.id,
      sku: v.sku,
      styleId: v.styleId,
      styleCode: v.style.code,
      colorName: v.color.name,
      sizeName: v.size.name,
    })),
    projectStyle?.id ?? null,
  );
  const matchedPieces = match.lines.reduce((s, l) => s + l.quantity, 0);

  await prisma.$transaction(async (tx) => {
    await lockRow(tx, "StockIntake", intake.id);
    const current = await tx.stockIntake.findFirstOrThrow({
      where: { id: intake.id, companyId: ctx.company.id },
    });
    assertDraft(current);
    await tx.stockIntakeLine.deleteMany({ where: { intakeId: intake.id } });
    if (match.lines.length > 0) {
      await tx.stockIntakeLine.createMany({ data: lineRows(intake.id, match.lines) });
    }
    await tx.stockIntake.update({
      where: { id: intake.id },
      data: {
        method: "AI_OCR",
        status: "PARSED",
        aiConfidence: new Prisma.Decimal(parsed.confidence * 100).toDecimalPlaces(2),
        aiRawResult: {
          model: parsed.model,
          confidence: parsed.confidence,
          notes: parsed.notes,
          lines: parsed.lines,
          unmatched: match.unmatched,
        } as Prisma.InputJsonValue,
      },
    });
    await auditInCompany(
      ctx,
      meta,
      {
        action: "UPDATE",
        entityType: "StockIntake",
        entityId: intake.id,
        summary: `AI read the packing list for ${intake.number}: ${match.lines.length} SKU lines (${matchedPieces} pcs)${
          match.unmatched.length ? `, ${match.unmatched.length} line(s) to check by hand` : ""
        }`,
      },
      tx,
    );
  });
  return getIntake(ctx, intake.id);
}

/** Corrects a draft: warehouse, costing method, notes, or all its lines. */
export async function updateIntake(
  ctx: CompanyContext,
  intakeId: string,
  raw: unknown,
  meta?: RequestMeta,
) {
  const input = updateIntakeSchema.parse(raw);
  const intake = await ctx.db.stockIntake.findUnique({ where: { id: intakeId } });
  if (!intake) throw new AppError("NOT_FOUND", "Delivery not found.");
  assertDraft(intake);
  const lines =
    input.lines !== undefined || input.matrix !== undefined
      ? await resolveIntakeLines(ctx, input)
      : null;
  const warehouse = input.warehouseId ? await resolveWarehouse(ctx, input.warehouseId) : null;

  await prisma.$transaction(async (tx) => {
    await lockRow(tx, "StockIntake", intake.id);
    const current = await tx.stockIntake.findFirstOrThrow({
      where: { id: intake.id, companyId: ctx.company.id },
    });
    assertDraft(current);
    if (lines) {
      await tx.stockIntakeLine.deleteMany({ where: { intakeId: intake.id } });
      if (lines.length > 0) {
        await tx.stockIntakeLine.createMany({ data: lineRows(intake.id, lines) });
      }
    }
    await tx.stockIntake.update({
      where: { id: intake.id },
      data: {
        warehouseId: warehouse?.id,
        costAllocation: input.costAllocation,
        bGradeCostRatio:
          input.bGradeCostRatio ??
          (input.costAllocation === "B_GRADE_RATIO" && current.bGradeCostRatio === null
            ? DEFAULT_B_GRADE_RATIO
            : undefined),
        notes: input.notes,
      },
    });
    await auditInCompany(
      ctx,
      meta,
      {
        action: "UPDATE",
        entityType: "StockIntake",
        entityId: intake.id,
        summary: `Updated delivery ${intake.number}${
          lines ? `: ${lines.reduce((s, l) => s + l.quantity, 0)} pcs` : ""
        }`,
      },
      tx,
    );
  });
  return getIntake(ctx, intake.id);
}

export async function cancelIntake(ctx: CompanyContext, intakeId: string, meta?: RequestMeta) {
  await prisma.$transaction(async (tx) => {
    await lockRow(tx, "StockIntake", intakeId);
    const intake = await tx.stockIntake.findFirst({
      where: { id: intakeId, companyId: ctx.company.id },
    });
    if (!intake) throw new AppError("NOT_FOUND", "Delivery not found.");
    assertDraft(intake);
    await tx.stockIntake.update({ where: { id: intake.id }, data: { status: "CANCELLED" } });
    await auditInCompany(
      ctx,
      meta,
      {
        action: "STATUS_CHANGE",
        entityType: "StockIntake",
        entityId: intake.id,
        summary: `Cancelled delivery ${intake.number}`,
      },
      tx,
    );
  });
  return getIntake(ctx, intakeId);
}

// =============================================================================
// Confirm: Move to Stock
// =============================================================================

/**
 * Puts the delivery into stock. The cost it carries defaults to its share of
 * the project's remaining cost (all of it on the final delivery), split per
 * piece by the costing method; it can also be given as `totalCost`.
 */
export async function confirmIntake(
  ctx: CompanyContext,
  intakeId: string,
  raw: unknown = {},
  meta?: RequestMeta,
) {
  const input = confirmIntakeSchema.parse(raw);
  if (input.completeProject && !ctx.can("production.manage")) {
    throw new AppError(
      "FORBIDDEN",
      "Only Production Managers can complete a project. Confirm this as the final delivery instead.",
    );
  }
  const companyId = ctx.company.id;
  await prisma.$transaction(
    async (tx) => {
      await lockRow(tx, "StockIntake", intakeId);
      const intake = await tx.stockIntake.findFirst({
        where: { id: intakeId, companyId },
        include: {
          lines: {
            orderBy: { id: "asc" },
            include: {
              variant: {
                select: { sku: true, isActive: true, style: { select: { isActive: true } } },
              },
            },
          },
        },
      });
      if (!intake) throw new AppError("NOT_FOUND", "Delivery not found.");
      assertDraft(intake);
      if (intake.lines.length === 0) {
        throw new AppError("VALIDATION", "Add the received quantities first.");
      }
      if (!intake.projectId) {
        throw new AppError("VALIDATION", "Choose the production project for this delivery.");
      }
      await lockRow(tx, "ProductionProject", intake.projectId);
      const project = await tx.productionProject.findFirstOrThrow({
        where: { id: intake.projectId, companyId },
      });
      assertCanReceive(project);
      for (const line of intake.lines) {
        if (!line.variant.isActive || !line.variant.style.isActive) {
          throw new AppError(
            "VALIDATION",
            `${line.variant.sku} is archived; restore it before receiving stock.`,
          );
        }
      }
      let warehouseId = input.warehouseId ?? intake.warehouseId;
      if (input.warehouseId) {
        const warehouse = await tx.warehouse.findFirst({
          where: { id: input.warehouseId, companyId },
        });
        if (!warehouse) throw new AppError("NOT_FOUND", "Warehouse not found.");
      }
      warehouseId ??= (await getDefaultWarehouse(ctx)).id;

      const costs = await projectCostSummary(tx, companyId, project.id);
      const plan = planIntakeCost({
        lines: intake.lines.map((l) => ({
          grade: l.grade,
          quantity: l.quantity,
          unitCost: l.unitCost,
        })),
        method: intake.costAllocation,
        bGradeRatio: intake.bGradeCostRatio,
        wip: costs.wip,
        received: project.producedQtyA + project.producedQtyB,
        target: project.targetQuantity,
        final: Boolean(input.finalDelivery || input.completeProject),
        totalOverride: input.totalCost,
      });
      if (plan.exceedsRemaining) {
        throw new AppError(
          "VALIDATION",
          `Only ${costs.wip.toFixed(2)} of ${project.code}'s cost is left to move into stock.`,
          { totalCost: [`At most ${costs.wip.toFixed(2)}`] },
        );
      }
      if (plan.total.isZero() && !input.allowZeroCost) {
        throw new AppError(
          "VALIDATION",
          intake.costAllocation === "MANUAL"
            ? `Enter the cost per piece on the lines (manual costing), or confirm with "allow zero cost".`
            : costs.totalCost.isZero()
              ? `No cost is recorded on ${project.code} yet, so these pieces would enter stock at zero cost. Record its bills first, or confirm with "allow zero cost".`
              : `${project.code} has no cost left for these pieces (it has all moved to stock). Confirm with "allow zero cost" to receive them anyway.`,
        );
      }

      // Re-weight each SKU's average cost with the pieces coming in (A and B together).
      const variantIds = [...new Set(intake.lines.map((l) => l.variantId))];
      await lockRows(tx, "ProductVariant", variantIds);
      const onHand = await tx.stockBalance.groupBy({
        by: ["variantId"],
        where: { variantId: { in: variantIds } },
        _sum: { quantity: true },
      });
      const onHandBy = new Map(onHand.map((r) => [r.variantId, r._sum.quantity ?? 0]));
      const variants = await tx.productVariant.findMany({
        where: { id: { in: variantIds } },
        select: { id: true, avgCost: true },
      });
      for (const v of variants) {
        let qty = 0;
        let value = new Prisma.Decimal(0);
        intake.lines.forEach((l, i) => {
          if (l.variantId !== v.id) return;
          qty += l.quantity;
          value = value.plus(plan.unitCosts[i]!.times(l.quantity));
        });
        const avg = weightedAverageCost(
          onHandBy.get(v.id) ?? 0,
          Number(v.avgCost),
          qty,
          qty > 0 ? value.dividedBy(qty).toNumber() : 0,
        );
        await tx.productVariant.update({
          where: { id: v.id },
          data: { avgCost: new Prisma.Decimal(avg.toFixed(4)) },
        });
      }

      for (const [i, line] of intake.lines.entries()) {
        const unitCost = plan.unitCosts[i]!;
        const key = { variantId: line.variantId, warehouseId, grade: line.grade };
        await tx.stockBalance.upsert({
          where: { variantId_warehouseId_grade: key },
          create: { ...key, companyId, quantity: line.quantity },
          update: { quantity: { increment: line.quantity } },
        });
        await tx.stockMovement.create({
          data: {
            ...key,
            companyId,
            type: "PRODUCTION_IN",
            quantity: line.quantity,
            unitCost,
            referenceType: "StockIntake",
            referenceId: intake.id,
            note: `${intake.number} · ${project.code}`,
            createdById: ctx.user.id,
          },
        });
        await tx.stockIntakeLine.update({ where: { id: line.id }, data: { unitCost } });
      }

      if (plan.total.gt(0)) {
        const acc = await ensureControlAccounts(companyId, tx);
        await postJournalEntry(tx, {
          companyId,
          description: `Goods received ${intake.number} — ${project.code} ${project.name}`,
          sourceType: "STOCK_INTAKE",
          sourceId: intake.id,
          postedById: ctx.user.id,
          lines: [
            { accountId: acc.INVENTORY, debit: plan.total, memo: intake.number },
            { accountId: acc.WORK_IN_PROGRESS, credit: plan.total, memo: project.code },
          ],
        });
      }

      const aGrade = intake.lines
        .filter((l) => l.grade === "A_GRADE")
        .reduce((s, l) => s + l.quantity, 0);
      const bGrade = plan.pieces - aGrade;
      await tx.stockIntake.update({
        where: { id: intake.id },
        data: { status: "CONFIRMED", confirmedAt: new Date(), totalCost: plan.total, warehouseId },
      });
      await tx.productionProject.update({
        where: { id: project.id },
        data: { producedQtyA: { increment: aGrade }, producedQtyB: { increment: bGrade } },
      });
      await auditInCompany(
        ctx,
        meta,
        {
          action: "STOCK_ADJUSTMENT",
          entityType: "StockIntake",
          entityId: intake.id,
          summary: `Moved ${plan.pieces} pcs to stock from ${project.code} (${aGrade} A-grade, ${bGrade} B-grade), cost ${plan.total.toFixed(2)} — ${intake.number}`,
        },
        tx,
      );
      if (input.completeProject) await completeProjectTx(tx, ctx, project.id, {}, meta);
    },
    { timeout: 60_000 },
  );
  return getIntake(ctx, intakeId);
}

// =============================================================================
// Reading
// =============================================================================

type AiResult = { model?: string; notes?: string | null; unmatched?: UnmatchedLine[] } | null;

export async function getIntake(ctx: CompanyContext, intakeId: string) {
  const intake = await ctx.db.stockIntake.findUnique({
    where: { id: intakeId },
    include: {
      project: {
        select: {
          id: true,
          code: true,
          name: true,
          status: true,
          targetQuantity: true,
          producedQtyA: true,
          producedQtyB: true,
        },
      },
      warehouse: { select: { id: true, name: true } },
      sourceFile: { select: { id: true, fileName: true, mimeType: true, sizeBytes: true } },
      lines: {
        include: {
          variant: {
            select: {
              id: true,
              sku: true,
              style: { select: { id: true, code: true, name: true } },
              color: { select: { name: true, hexCode: true, sortOrder: true } },
              size: { select: { name: true, sortOrder: true } },
            },
          },
        },
      },
    },
  });
  if (!intake) throw new AppError("NOT_FOUND", "Delivery not found.");
  const showCosts = canSeeProductionCosts(ctx);
  const lines = [...intake.lines].sort(
    (a, b) =>
      a.variant.style.code.localeCompare(b.variant.style.code) ||
      a.variant.color.sortOrder - b.variant.color.sortOrder ||
      a.variant.color.name.localeCompare(b.variant.color.name) ||
      a.variant.size.sortOrder - b.variant.size.sortOrder ||
      a.grade.localeCompare(b.grade),
  );
  const pieces = lines.reduce((s, l) => s + l.quantity, 0);
  const bGrade = lines.filter((l) => l.grade === "B_GRADE").reduce((s, l) => s + l.quantity, 0);

  // What confirming would move into stock now (cost figures for Production / Accounts only).
  let costPreview: Record<string, unknown> | null = null;
  const project = intake.project;
  if (
    showCosts &&
    project &&
    !isProjectClosed(project) &&
    (DRAFT_STATUSES as readonly string[]).includes(intake.status) &&
    lines.length > 0
  ) {
    const costs = await projectCostSummary(prisma, ctx.company.id, project.id);
    const base = {
      lines: lines.map((l) => ({ grade: l.grade, quantity: l.quantity, unitCost: l.unitCost })),
      method: intake.costAllocation,
      bGradeRatio: intake.bGradeCostRatio,
      wip: costs.wip,
      received: project.producedQtyA + project.producedQtyB,
      target: project.targetQuantity,
    };
    try {
      const share = planIntakeCost({ ...base, final: false });
      const last = planIntakeCost({ ...base, final: true });
      const perLine = (unitCosts: Prisma.Decimal[]) =>
        lines.map((l, i) => ({ lineId: l.id, unitCost: unitCosts[i] }));
      costPreview = {
        projectCostRemaining: costs.wip,
        thisDelivery: { totalCost: share.total, lines: perLine(share.unitCosts) },
        asFinalDelivery: { totalCost: last.total, lines: perLine(last.unitCosts) },
        exceedsRemaining: share.exceedsRemaining,
      };
    } catch (error) {
      if (!(error instanceof AppError)) throw error;
      costPreview = { error: error.message };
    }
  }

  const ai = intake.aiRawResult as AiResult;
  return {
    id: intake.id,
    number: intake.number,
    status: intake.status,
    method: intake.method,
    project,
    warehouse: intake.warehouse,
    sourceFile: intake.sourceFile,
    costAllocation: intake.costAllocation,
    bGradeCostRatio: intake.bGradeCostRatio,
    notes: intake.notes,
    pieces: { total: pieces, aGrade: pieces - bGrade, bGrade },
    totalCost: showCosts ? intake.totalCost : null,
    lines: lines.map((l) => ({
      id: l.id,
      variantId: l.variantId,
      sku: l.variant.sku,
      style: l.variant.style,
      color: { name: l.variant.color.name, hexCode: l.variant.color.hexCode },
      size: l.variant.size.name,
      grade: l.grade,
      quantity: l.quantity,
      unitCost: showCosts ? l.unitCost : null,
    })),
    ai:
      intake.method === "AI_OCR"
        ? {
            confidencePercent: intake.aiConfidence,
            model: ai?.model ?? null,
            notes: ai?.notes ?? null,
            unmatched: ai?.unmatched ?? [],
          }
        : null,
    costPreview,
    createdAt: intake.createdAt,
    confirmedAt: intake.confirmedAt,
  };
}

export async function listIntakes(ctx: CompanyContext, raw: unknown = {}) {
  const q = listIntakesSchema.parse(raw);
  const take = q.take ?? 50;
  const rows = await ctx.db.stockIntake.findMany({
    where: {
      ...(q.projectId ? { projectId: q.projectId } : {}),
      ...(q.status ? { status: q.status } : {}),
    },
    include: {
      project: { select: { id: true, code: true, name: true } },
      warehouse: { select: { id: true, name: true } },
      lines: { select: { grade: true, quantity: true } },
    },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: take + 1,
    ...(q.cursor ? { cursor: { id: q.cursor }, skip: 1 } : {}),
  });
  const hasMore = rows.length > take;
  const page = hasMore ? rows.slice(0, take) : rows;
  const showCosts = canSeeProductionCosts(ctx);
  return {
    items: page.map((i) => ({
      id: i.id,
      number: i.number,
      status: i.status,
      method: i.method,
      project: i.project,
      warehouse: i.warehouse,
      pieces: i.lines.reduce((s, l) => s + l.quantity, 0),
      bGradePieces: i.lines
        .filter((l) => l.grade === "B_GRADE")
        .reduce((s, l) => s + l.quantity, 0),
      totalCost: showCosts ? i.totalCost : null,
      createdAt: i.createdAt,
      confirmedAt: i.confirmedAt,
    })),
    nextCursor: hasMore ? page[page.length - 1]?.id : undefined,
  };
}
