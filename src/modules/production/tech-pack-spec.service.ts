import { Prisma } from "@prisma/client";
import { z } from "zod";

import type { Db } from "@/lib/db-types";
import { AppError } from "@/lib/errors";
import type { RequestMeta } from "@/lib/request-meta";
import { lockRow } from "@/lib/row-lock";
import { runTransaction } from "@/lib/transaction";
import { auditInCompany } from "@/modules/audit/audit.service";
import type { CompanyContext } from "@/modules/auth/context";
import { isProjectClosed } from "@/modules/production/project-costs";
import {
  INSTRUCTION_SECTIONS,
  type InstructionSection,
} from "@/modules/production/tech-pack-labels";
import {
  chartSignals,
  convertMeasure,
  gradeChart,
  ITEM_KINDS,
  type ItemKind,
  type MeasureUnit,
  roundMeasure,
  TOP_SIZES,
  type ValueSource,
} from "@/modules/production/measurements";

/*
 * A style's tech pack beside its fabric part: the measurement chart made from
 * the buyer's few points (S21) and the owner's instructions for the AI. Every
 * value carries where it came from: the buyer or a person (green, confirmed),
 * the grading rules (yellow, an AI guess until someone confirms it) or nothing
 * (red, missing). Making the chart again never loses what people typed. Read
 * with production.view, changed with production.manage.
 */

export { INSTRUCTION_SECTIONS };
export type Instructions = Partial<Record<InstructionSection, string>>;

export function readInstructions(value: Prisma.JsonValue | null | undefined): Instructions {
  const out: Instructions = {};
  if (!value || typeof value !== "object" || Array.isArray(value)) return out;
  for (const section of INSTRUCTION_SECTIONS) {
    const text = (value as Record<string, unknown>)[section];
    if (typeof text === "string" && text.trim()) out[section] = text.trim();
  }
  return out;
}

const SOURCES: readonly ValueSource[] = ["BUYER", "RULE", "OWNER"];

type Cells = Record<string, number | null>;
type CellSources = Record<string, ValueSource>;

function readCells(value: Prisma.JsonValue): Cells {
  const out: Cells = {};
  if (!value || typeof value !== "object" || Array.isArray(value)) return out;
  for (const [size, v] of Object.entries(value)) {
    out[size] = typeof v === "number" && Number.isFinite(v) ? v : null;
  }
  return out;
}

function readSources(value: Prisma.JsonValue): CellSources {
  const out: CellSources = {};
  if (!value || typeof value !== "object" || Array.isArray(value)) return out;
  for (const [size, v] of Object.entries(value)) {
    if (SOURCES.includes(v as ValueSource)) out[size] = v as ValueSource;
  }
  return out;
}

const trimmed = (d: Prisma.Decimal) => Number(d.toFixed(4));

/** Projects the tech pack belongs to; a closed one keeps its tech pack as it is. */
export async function loadTechPackProject(ctx: CompanyContext, projectId: string) {
  const project = await ctx.db.productionProject.findUnique({
    where: { id: projectId },
    select: {
      id: true,
      code: true,
      name: true,
      status: true,
      targetQuantity: true,
      style: { select: { code: true, name: true } },
      buyer: { select: { name: true } },
    },
  });
  if (!project) throw new AppError("NOT_FOUND", "Production project not found.");
  return project;
}

export type TechPackProject = Awaited<ReturnType<typeof loadTechPackProject>>;

export function assertCanChange(project: Pick<TechPackProject, "code" | "status">) {
  if (isProjectClosed(project)) {
    throw new AppError(
      "CONFLICT",
      `${project.code} is ${project.status.toLowerCase()}; its tech pack can no longer change.`,
    );
  }
}

export function assertManage(ctx: CompanyContext) {
  if (!ctx.can("production.manage")) {
    throw new AppError(
      "FORBIDDEN",
      "You do not have permission to change tech packs (production.manage).",
    );
  }
}

/** The style's tech pack row, made when the first part of it is saved. */
export async function ensureTechPack(ctx: CompanyContext, projectId: string, db: Db) {
  const row = await db.techPack.upsert({
    where: { projectId },
    create: { companyId: ctx.company.id, projectId },
    update: {},
    select: { id: true },
  });
  return row.id;
}

// ---------------------------------------------------------------- the chart

const measure = z.coerce
  .number({ message: "Give a number." })
  .positive("Give a number above 0.")
  .max(500, "That is too big for a garment measurement.");

/** "S, M, L" or "S M L XL" into sizes. */
const sizeList = z
  .string()
  .trim()
  .min(1, "Give the sizes, e.g. S, M, L, XL, 2XL.")
  .transform((text) =>
    text
      .split(/[\s,;/]+/)
      .map((s) => s.trim().toUpperCase())
      .filter(Boolean),
  )
  .pipe(
    z
      .array(z.string().max(8, "A size has at most 8 characters."))
      .min(1, "Give the sizes, e.g. S, M, L, XL, 2XL.")
      .max(12, "Give at most 12 sizes.")
      .refine((sizes) => new Set(sizes).size === sizes.length, "A size is given twice."),
  );

export const chartSchema = z
  .object({
    garmentKind: z.enum(ITEM_KINDS, { message: "Pick the garment." }),
    unit: z.enum(["INCH", "CM"]),
    sizes: sizeList,
    baseSize: z.string().trim().toUpperCase().min(1, "Give the size the buyer measured."),
    chest: measure,
    chestBasis: z.enum(["AUTO", "FULL", "HALF"]).default("AUTO"),
    chestGrade: z
      .union([z.literal("").transform(() => null), measure.max(20, "That grade is too big.")])
      .nullish(),
    length: z.union([z.literal("").transform(() => null), measure]).nullish(),
    /** The buyer's other points (read from their sheet): they win over the rules. */
    points: z
      .array(z.object({ code: z.string().trim().min(1), size: z.string().trim(), value: measure }))
      .max(200)
      .default([]),
  })
  .refine((c) => c.sizes.includes(c.baseSize), {
    message: "The buyer's size must be one of the sizes.",
    path: ["baseSize"],
  });

export type ChartInput = z.input<typeof chartSchema>;

/**
 * Makes the style's measurement chart from the buyer's few points. A chart
 * made before keeps every value a person typed or confirmed (and its own added
 * rows); the rules fill the rest again.
 */
export async function makeChart(
  ctx: CompanyContext,
  projectId: string,
  raw: unknown,
  meta?: RequestMeta,
) {
  assertManage(ctx);
  const input = chartSchema.parse(raw);
  const project = await loadTechPackProject(ctx, projectId);
  assertCanChange(project);
  const chart = gradeChart({
    item: input.garmentKind,
    unit: input.unit,
    sizes: input.sizes,
    baseSize: input.baseSize,
    chest: input.chest,
    chestBasis: input.chestBasis,
    chestGrade: input.chestGrade ?? null,
    length: input.length ?? null,
    buyer: input.points.map((p) => ({ ...p, size: p.size.toUpperCase() })),
  });
  await runTransaction(async (tx) => {
    await lockRow(tx, "ProductionProject", project.id);
    const techPackId = await ensureTechPack(ctx, project.id, tx);
    const before = await tx.techPackMeasurement.findMany({ where: { techPackId } });
    const kept = new Map(before.map((r) => [r.code, r]));
    const sameUnit = (
      await tx.techPack.findUniqueOrThrow({
        where: { id: techPackId },
        select: { measureUnit: true },
      })
    ).measureUnit;
    const madeCodes = new Set(chart.rows.map((r) => r.code));
    let order = 0;
    for (const row of chart.rows) {
      const old = kept.get(row.code);
      const values = { ...row.values };
      const sources = { ...row.sources };
      if (old) {
        // A value a person typed or confirmed stays (in the chart's new unit).
        const oldValues = readCells(old.values);
        const oldSources = readSources(old.sources);
        for (const size of input.sizes) {
          const v = oldValues[size];
          if (oldSources[size] === "OWNER" && v !== null && v !== undefined) {
            values[size] =
              sameUnit === input.unit
                ? v
                : roundMeasure(convertMeasure(v, sameUnit as MeasureUnit), input.unit);
            sources[size] = "OWNER";
          }
        }
      }
      const data = {
        name: row.name,
        howTo: row.howTo,
        rule: row.rule,
        tolerance: row.tolerance,
        critical: row.critical,
        sortOrder: order++,
        values: values as Prisma.InputJsonValue,
        sources: sources as Prisma.InputJsonValue,
      };
      if (old) await tx.techPackMeasurement.update({ where: { id: old.id }, data });
      else {
        await tx.techPackMeasurement.create({
          data: { companyId: ctx.company.id, techPackId, code: row.code, ...data },
        });
      }
    }
    // Rows people added themselves stay after the chart's own, sizes refreshed.
    for (const old of before.filter((r) => !madeCodes.has(r.code))) {
      const oldValues = readCells(old.values);
      const oldSources = readSources(old.sources);
      await tx.techPackMeasurement.update({
        where: { id: old.id },
        data: {
          sortOrder: order++,
          values: Object.fromEntries(input.sizes.map((s) => [s, oldValues[s] ?? null])),
          sources: Object.fromEntries(input.sizes.map((s) => [s, oldSources[s] ?? "OWNER"])),
        },
      });
    }
    await tx.techPack.update({
      where: { id: techPackId },
      data: {
        garmentKind: input.garmentKind,
        measureUnit: input.unit,
        chestBasis: chart.chestBasis,
        sizeRun: input.sizes,
        baseSize: input.baseSize,
        chartQuestions: chart.questions,
      },
    });
    await auditInCompany(
      ctx,
      meta,
      {
        action: "UPDATE",
        entityType: "ProductionProject",
        entityId: project.id,
        summary: `Made the measurement chart of ${project.code} from the buyer's points (${input.sizes.join(", ")}, ${chart.rows.length} measurements)`,
      },
      tx,
    );
  });
  return getChart(ctx, project.id);
}

const cellSchema = z.object({
  code: z.string().trim().min(1),
  size: z.string().trim().min(1),
  value: z.union([z.literal("").transform(() => null), z.null(), measure]),
});

async function loadRow(ctx: CompanyContext, projectId: string, code: string) {
  const project = await loadTechPackProject(ctx, projectId);
  assertCanChange(project);
  const techPack = await ctx.db.techPack.findUnique({
    where: { projectId: project.id },
    select: { id: true, sizeRun: true, measureUnit: true },
  });
  const row = techPack
    ? await ctx.db.techPackMeasurement.findUnique({
        where: { techPackId_code: { techPackId: techPack.id, code } },
      })
    : null;
  if (!techPack || !row) throw new AppError("NOT_FOUND", "That measurement is not in the chart.");
  return { project, techPack, row };
}

/** One cell typed by a person: it turns green (or red when cleared). */
export async function setMeasurement(
  ctx: CompanyContext,
  projectId: string,
  raw: unknown,
  meta?: RequestMeta,
) {
  assertManage(ctx);
  const input = cellSchema.parse(raw);
  const { project, techPack, row } = await loadRow(ctx, projectId, input.code);
  if (!techPack.sizeRun.includes(input.size)) {
    throw new AppError("VALIDATION", `${input.size} is not one of the chart's sizes.`);
  }
  const values = readCells(row.values);
  const sources = readSources(row.sources);
  const was = values[input.size];
  values[input.size] =
    input.value === null ? null : roundMeasure(input.value, techPack.measureUnit as MeasureUnit);
  sources[input.size] = "OWNER";
  await ctx.db.techPackMeasurement.update({
    where: { id: row.id },
    data: { values, sources },
  });
  await auditInCompany(ctx, meta, {
    action: "UPDATE",
    entityType: "ProductionProject",
    entityId: project.id,
    summary: `${project.code}: ${row.name} at ${input.size} ${was ?? "missing"} → ${values[input.size] ?? "missing"}`,
  });
  return getChart(ctx, project.id);
}

/** Confirms a row's rule-made values as they are: they turn green. */
export async function confirmMeasurementRow(
  ctx: CompanyContext,
  projectId: string,
  code: string,
  meta?: RequestMeta,
) {
  assertManage(ctx);
  const { project, row } = await loadRow(ctx, projectId, code);
  const values = readCells(row.values);
  const sources = readSources(row.sources);
  let confirmed = 0;
  for (const [size, value] of Object.entries(values)) {
    if (value !== null && sources[size] === "RULE") {
      sources[size] = "OWNER";
      confirmed += 1;
    }
  }
  if (confirmed > 0) {
    await ctx.db.techPackMeasurement.update({ where: { id: row.id }, data: { sources } });
    await auditInCompany(ctx, meta, {
      action: "UPDATE",
      entityType: "ProductionProject",
      entityId: project.id,
      summary: `${project.code}: confirmed ${row.name} (${confirmed} size(s))`,
    });
  }
  return getChart(ctx, project.id);
}

export const addRowSchema = z.object({
  name: z.string().trim().min(2, "Name the measurement.").max(80),
  howTo: z.string().trim().max(200).optional(),
  tolerance: z.coerce.number().min(0).max(10).default(0.25),
  critical: z.boolean().default(false),
});

/** A measurement the rules do not make (a pocket position, a label height): empty, so red. */
export async function addMeasurementRow(
  ctx: CompanyContext,
  projectId: string,
  raw: unknown,
  meta?: RequestMeta,
) {
  assertManage(ctx);
  const input = addRowSchema.parse(raw);
  const project = await loadTechPackProject(ctx, projectId);
  assertCanChange(project);
  const techPack = await ctx.db.techPack.findUnique({
    where: { projectId: project.id },
    select: { id: true, sizeRun: true, _count: { select: { measurements: true } } },
  });
  if (!techPack || techPack.sizeRun.length === 0) {
    throw new AppError("CONFLICT", "Make the chart first, then add measurements to it.");
  }
  const code = `OWN_${input.name
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "_")
    .replace(/^_|_$/g, "")}`;
  const taken = await ctx.db.techPackMeasurement.count({
    where: { techPackId: techPack.id, code },
  });
  if (taken > 0) throw new AppError("CONFLICT", `${input.name} is in the chart already.`);
  await ctx.db.techPackMeasurement.create({
    data: {
      companyId: ctx.company.id,
      techPackId: techPack.id,
      code,
      name: input.name,
      howTo: input.howTo || null,
      rule: "Added by hand",
      tolerance: input.tolerance,
      critical: input.critical,
      sortOrder: techPack._count.measurements,
      values: Object.fromEntries(techPack.sizeRun.map((s) => [s, null])),
      sources: Object.fromEntries(techPack.sizeRun.map((s) => [s, "OWNER"])),
    },
  });
  await auditInCompany(ctx, meta, {
    action: "UPDATE",
    entityType: "ProductionProject",
    entityId: project.id,
    summary: `${project.code}: added ${input.name} to the measurement chart`,
  });
  return getChart(ctx, project.id);
}

/** Takes a measurement out of the chart (it can be made again from the buyer's points). */
export async function removeMeasurementRow(
  ctx: CompanyContext,
  projectId: string,
  code: string,
  meta?: RequestMeta,
) {
  assertManage(ctx);
  const { project, row } = await loadRow(ctx, projectId, code);
  await ctx.db.techPackMeasurement.delete({ where: { id: row.id } });
  await auditInCompany(ctx, meta, {
    action: "UPDATE",
    entityType: "ProductionProject",
    entityId: project.id,
    summary: `${project.code}: took ${row.name} out of the measurement chart`,
  });
  return getChart(ctx, project.id);
}

export type ChartLine = {
  code: string;
  name: string;
  howTo: string | null;
  rule: string | null;
  tolerance: number;
  critical: boolean;
  values: Cells;
  sources: CellSources;
};

/** The style's chart as plain numbers (the screen, the PDF and the AI read it). */
export async function getChart(ctx: CompanyContext, projectId: string) {
  const techPack = await ctx.db.techPack.findUnique({
    where: { projectId },
    select: {
      garmentKind: true,
      measureUnit: true,
      chestBasis: true,
      sizeRun: true,
      baseSize: true,
      chartQuestions: true,
      measurements: { orderBy: [{ sortOrder: "asc" }, { code: "asc" }] },
    },
  });
  const rows: ChartLine[] = (techPack?.measurements ?? []).map((m) => ({
    code: m.code,
    name: m.name,
    howTo: m.howTo,
    rule: m.rule,
    tolerance: trimmed(m.tolerance),
    critical: m.critical,
    values: readCells(m.values),
    sources: readSources(m.sources),
  }));
  return {
    garmentKind: (techPack?.garmentKind ?? null) as ItemKind | null,
    unit: (techPack?.measureUnit ?? "INCH") as MeasureUnit,
    chestBasis: techPack?.chestBasis ?? null,
    sizes: techPack?.sizeRun ?? [],
    baseSize: techPack?.baseSize ?? null,
    questions: techPack?.chartQuestions ?? [],
    rows,
    signals: chartSignals(rows),
  };
}

export type Chart = Awaited<ReturnType<typeof getChart>>;

/** The sizes offered when a chart is first made. */
export const DEFAULT_SIZES = TOP_SIZES.slice(1, 7).join(", ");

// ---------------------------------------------------------------- instructions

const instructionsSchema = z.object(
  Object.fromEntries(
    INSTRUCTION_SECTIONS.map((s) => [
      s,
      z.string().trim().max(2000, "Keep it to 2,000 characters.").optional(),
    ]),
  ) as Record<InstructionSection, z.ZodOptional<z.ZodString>>,
);

/** The owner's instructions for the AI, read before every draft; they outrank its guesses. */
export async function setInstructions(
  ctx: CompanyContext,
  projectId: string,
  raw: unknown,
  meta?: RequestMeta,
) {
  assertManage(ctx);
  const input = instructionsSchema.parse(raw);
  const project = await loadTechPackProject(ctx, projectId);
  assertCanChange(project);
  const instructions = readInstructions(input as Prisma.JsonValue);
  await runTransaction(async (tx) => {
    const techPackId = await ensureTechPack(ctx, project.id, tx);
    await tx.techPack.update({
      where: { id: techPackId },
      data: { instructions: instructions as Prisma.InputJsonValue },
    });
    await auditInCompany(
      ctx,
      meta,
      {
        action: "UPDATE",
        entityType: "ProductionProject",
        entityId: project.id,
        summary: `${project.code}: saved the instructions for the AI (${Object.keys(instructions).join(", ") || "none"})`,
      },
      tx,
    );
  });
  return instructions;
}
