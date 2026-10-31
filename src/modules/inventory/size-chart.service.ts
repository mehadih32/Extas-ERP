import type { Prisma } from "@prisma/client";
import { z } from "zod";

import { AppError } from "@/lib/errors";
import { prisma } from "@/lib/prisma";
import type { RequestMeta } from "@/lib/request-meta";
import { auditInCompany } from "@/modules/audit/audit.service";
import type { CompanyContext } from "@/modules/auth/context";

import { DEFAULT_POINTS, type Garment, GARMENTS, MAX_POINTS } from "./size-chart-points";

/*
 * A style's size chart (2026-10-31)
 * ---------------------------------
 * What each size measures (S: chest 38, M: chest 40), as the shops show it to
 * their customers. It starts with the usual measurements of the garment (a top
 * or a bottom), which can be renamed, removed or added to, and can be filled
 * from the style's tech pack with one button. Values are kept per size id, so
 * renaming a size keeps its numbers. The shops get it through the e-commerce
 * API (GET /catalog/size-charts and size_chart.changed); what a shop changes on
 * its own site stays there.
 */

const value = z.preprocess(
  (v) => (v === "" || v === undefined ? null : v),
  z.union([
    z.null(),
    z.coerce
      .number({ message: "A number like 38 or 38.5" })
      .positive("Above 0")
      .max(999, "At most 999")
      .transform((n) => Math.round(n * 100) / 100),
  ]),
);

export const sizeChartSchema = z.object({
  garment: z.enum(GARMENTS).default("TOP"),
  unit: z.enum(["INCH", "CM"]).default("INCH"),
  points: z
    .array(
      z.object({
        name: z.string().trim().min(1, "Name the measurement").max(40, "At most 40 characters"),
        /** By size id. */
        values: z.record(z.string().max(40), value),
      }),
    )
    .max(MAX_POINTS, `At most ${MAX_POINTS} measurements`),
});

export type SizeChartInput = z.infer<typeof sizeChartSchema>;
export type SizeChartPoint = { name: string; values: Record<string, number | null> };

/** The style's sizes in order (those on its matrix now). */
export async function styleSizes(db: Prisma.TransactionClient, styleId: string) {
  const variants = await db.productVariant.findMany({
    where: { styleId, removedAt: null },
    select: { size: { select: { id: true, name: true, sortOrder: true } } },
  });
  return [...new Map(variants.map((v) => [v.size.id, v.size])).values()].sort(
    (a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name),
  );
}

/** Points kept with only the style's sizes, names deduplicated, empty measurements left in. */
function cleanPoints(input: SizeChartInput, sizeIds: Set<string>): SizeChartPoint[] {
  const seen = new Set<string>();
  return input.points.map((p, i) => {
    const key = p.name.toLowerCase();
    if (seen.has(key)) {
      throw new AppError("VALIDATION", `"${p.name}" is in the chart twice.`, {
        [`points.${i}.name`]: ["Each measurement once"],
      });
    }
    seen.add(key);
    return {
      name: p.name,
      values: Object.fromEntries(
        Object.entries(p.values).filter(([sizeId, v]) => sizeIds.has(sizeId) && v !== null),
      ),
    };
  });
}

/** Saves a style's chart inside `tx` (also used when a style is added from "Buy ready stock"). */
export async function saveSizeChartTx(
  tx: Prisma.TransactionClient,
  companyId: string,
  styleId: string,
  input: SizeChartInput,
  userId: string,
) {
  const sizes = await styleSizes(tx, styleId);
  const points = cleanPoints(input, new Set(sizes.map((s) => s.id)));
  const data = {
    garment: input.garment,
    unit: input.unit,
    points: points as unknown as Prisma.InputJsonArray,
    updatedById: userId,
  };
  return tx.styleSizeChart.upsert({
    where: { styleId },
    create: { ...data, companyId, styleId },
    update: data,
  });
}

function assertCanEdit(ctx: CompanyContext) {
  if (!ctx.can("inventory.manage")) {
    throw new AppError("FORBIDDEN", "You may not change a style's size chart.");
  }
}

const pointsOf = (json: Prisma.JsonValue): SizeChartPoint[] =>
  Array.isArray(json) ? (json as unknown as SizeChartPoint[]) : [];

/** The chart for the style's page: its sizes, the chart (or the garment's start) and whether a tech pack can fill it. */
export async function getSizeChart(ctx: CompanyContext, styleId: string) {
  const style = await ctx.db.style.findUnique({
    where: { id: styleId },
    select: { id: true, sizeChart: true, _count: { select: { techPacks: true } } },
  });
  if (!style) throw new AppError("NOT_FOUND", "There is no such style.");
  // The style was found through the company's own client above.
  const sizes = (await styleSizes(prisma, styleId)).map(({ id, name }) => ({ id, name }));
  const chart = style.sizeChart;
  return {
    sizes,
    saved: Boolean(chart),
    garment: (chart?.garment ?? "TOP") as Garment,
    unit: chart?.unit ?? "INCH",
    points: chart
      ? pointsOf(chart.points)
      : DEFAULT_POINTS.TOP.map((name): SizeChartPoint => ({ name, values: {} })),
    updatedAt: chart?.updatedAt.toISOString() ?? null,
    canEdit: ctx.can("inventory.manage"),
    hasTechPack: style._count.techPacks > 0,
  };
}

export type SizeChartScreen = Awaited<ReturnType<typeof getSizeChart>>;

export async function saveSizeChart(
  ctx: CompanyContext,
  styleId: string,
  raw: unknown,
  meta?: RequestMeta,
) {
  assertCanEdit(ctx);
  const input = sizeChartSchema.parse(raw);
  const style = await ctx.db.style.findUnique({
    where: { id: styleId },
    select: { id: true, code: true },
  });
  if (!style) throw new AppError("NOT_FOUND", "There is no such style.");
  await prisma.$transaction(async (tx) => {
    const saved = await saveSizeChartTx(tx, ctx.company.id, style.id, input, ctx.user.id);
    await auditInCompany(
      ctx,
      meta,
      {
        action: "UPDATE",
        entityType: "Style",
        entityId: style.id,
        summary: `Size chart of ${style.code}: ${pointsOf(saved.points)
          .map((p) => p.name)
          .join(", ")} (${saved.unit === "INCH" ? "inches" : "cm"})`,
      },
      tx,
    );
  });
  return getSizeChart(ctx, style.id);
}

/**
 * The chart from the style's newest tech pack (its measurements and size run),
 * in the tech pack's unit, for the person to check and save; nothing is saved.
 */
export async function sizeChartFromTechPack(ctx: CompanyContext, styleId: string) {
  assertCanEdit(ctx);
  const techPack = await ctx.db.techPack.findFirst({
    where: { styleId, measurements: { some: {} } },
    orderBy: [{ approvedAt: { sort: "desc", nulls: "last" } }, { updatedAt: "desc" }],
    select: {
      number: true,
      measureUnit: true,
      garmentKind: true,
      measurements: { orderBy: { sortOrder: "asc" }, select: { name: true, values: true } },
    },
  });
  if (!techPack) {
    throw new AppError("NOT_FOUND", "This style has no tech pack with measurements yet.");
  }
  const byName = new Map(
    (await styleSizes(prisma, styleId)).map((s) => [s.name.toUpperCase(), s.id]),
  );
  // Each name once, at most MAX_POINTS: the chart must save as it is filled.
  const seen = new Set<string>();
  const points: SizeChartPoint[] = [];
  let left = 0;
  for (const m of techPack.measurements) {
    const name = m.name.trim().slice(0, 40);
    const key = name.toLowerCase();
    if (!name || seen.has(key)) continue;
    if (points.length >= MAX_POINTS) {
      left += 1;
      continue;
    }
    seen.add(key);
    const values: Record<string, number | null> = {};
    for (const [size, v] of Object.entries((m.values ?? {}) as Record<string, unknown>)) {
      const id = byName.get(size.toUpperCase());
      if (id && typeof v === "number" && v > 0 && v <= 999) values[id] = Math.round(v * 100) / 100;
    }
    points.push({ name, values });
  }
  return {
    techPack: techPack.number,
    // Tech packs are for tops (polo, tee, shirt).
    garment: (techPack.garmentKind ? "TOP" : "OTHER") as Garment,
    unit: techPack.measureUnit,
    points,
    /** Measurements left out past the chart's limit. */
    left,
  };
}

/** A chart as the shops get it: values by size name, in the style's size order. */
export function presentSizeChartForShop(
  chart: { unit: string; points: Prisma.JsonValue; updatedAt: Date },
  style: { code: string; name: string },
  sizes: Array<{ id: string; name: string }>,
) {
  return {
    styleCode: style.code,
    styleName: style.name,
    unit: chart.unit === "CM" ? ("cm" as const) : ("inch" as const),
    sizes: sizes.map((s) => s.name),
    points: pointsOf(chart.points).map((p) => ({
      name: p.name,
      values: Object.fromEntries(sizes.map((s) => [s.name, p.values[s.id] ?? null])),
    })),
    updatedAt: chart.updatedAt.toISOString(),
  };
}

export type ShopSizeChart = ReturnType<typeof presentSizeChartForShop>;
