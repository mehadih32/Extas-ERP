import { type AuditAction, Prisma, type ProductionStatus } from "@prisma/client";
import { z } from "zod";

import type { Db } from "@/lib/db-types";
import { AppError } from "@/lib/errors";
import { nextDocumentNumber } from "@/lib/numbering";
import { prisma } from "@/lib/prisma";
import type { RequestMeta } from "@/lib/request-meta";
import { lockRow } from "@/lib/row-lock";
import { runTransaction } from "@/lib/transaction";
import { auditAsAi } from "@/modules/ai/account";
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
 * A tech pack (v6.4: its own record, TP-2026-00001, started from a buyer's
 * brief or from a production project, and linked to one when the order
 * comes): the measurement chart made from the buyer's few points (S21) and
 * the owner's instructions for the AI. Every
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

// ---------------------------------------------------------------- the tech pack itself

const techPackSelect = {
  id: true,
  number: true,
  title: true,
  season: true,
  brief: true,
  status: true,
  fabricLockedAt: true,
  createdAt: true,
  updatedAt: true,
  buyer: { select: { id: true, name: true } },
  style: { select: { id: true, code: true, name: true } },
  createdBy: { select: { name: true } },
  project: {
    select: {
      id: true,
      code: true,
      name: true,
      status: true,
      targetQuantity: true,
      style: { select: { code: true, name: true } },
      buyer: { select: { name: true } },
    },
  },
} satisfies Prisma.TechPackSelect;

type TechPackRow = Prisma.TechPackGetPayload<{ select: typeof techPackSelect }>;

/**
 * A tech pack as its pages and services see it: its own number, title, buyer,
 * season and brief, and the style in production it is linked to once the order
 * comes (null until then). `code` and `name` name it in the logs and the AI's
 * cost lines; `record` is what they are kept against: the style in production
 * once linked (so the style's log and AI box show it, as before v6.4), else the
 * tech pack itself.
 */
export type TechPackDoc = TechPackRow & {
  number: string;
  code: string;
  name: string;
  record: { type: "ProductionProject" | "TechPack"; id: string; label: string };
};

export function techPackDoc(row: TechPackRow): TechPackDoc {
  const number = row.number ?? "Tech pack";
  const code = row.project?.code ?? number;
  return {
    ...row,
    number,
    code,
    name: row.project?.name ?? (row.title || number),
    record: row.project
      ? { type: "ProductionProject", id: row.project.id, label: code }
      : { type: "TechPack", id: row.id, label: code },
  };
}

/** A tech pack of this company (not found for anyone else's). */
export async function loadTechPack(ctx: CompanyContext, techPackId: string): Promise<TechPackDoc> {
  const row = await ctx.db.techPack.findUnique({
    where: { id: techPackId },
    select: techPackSelect,
  });
  if (!row) throw new AppError("NOT_FOUND", "Tech pack not found.");
  return techPackDoc(row);
}

/** A tech pack linked to a closed style (completed or cancelled) keeps as it is. */
export function assertCanChange(tp: {
  code: string;
  project: { status: ProductionStatus } | null;
}) {
  if (tp.project && isProjectClosed(tp.project)) {
    throw new AppError(
      "CONFLICT",
      `${tp.code} is ${tp.project.status.toLowerCase()}; its tech pack can no longer change.`,
    );
  }
}

export function assertView(ctx: CompanyContext) {
  if (!ctx.can("production.view")) {
    throw new AppError(
      "FORBIDDEN",
      "You do not have permission to see tech packs (production.view).",
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

const touchTechPack = (db: Db, id: string) =>
  db.techPack.update({ where: { id }, data: { updatedAt: new Date() }, select: { id: true } });

/**
 * Logs a change to a tech pack (under its style in production once linked, as
 * before v6.4) and marks it updated for the list. An export changes nothing.
 */
export async function logTechPack(
  ctx: { company: { id: string }; user: { id: string }; byAi?: boolean },
  meta: RequestMeta | undefined,
  tp: Pick<TechPackDoc, "id" | "record">,
  input: { action: AuditAction; summary: string },
  db: Db = prisma,
) {
  await auditInCompany(
    ctx,
    meta,
    {
      action: input.action,
      entityType: tp.record.type,
      entityId: tp.record.id,
      summary: input.summary,
    },
    db,
  );
  if (input.action !== "EXPORT") await touchTechPack(db, tp.id);
}

/**
 * Logs what the AI made on a tech pack in the AI's own name, marked AI, with
 * the person who asked for it named (v6.4: the AI's work is never saved as the
 * person's), and marks the tech pack updated.
 */
export async function logTechPackAiWork(
  ctx: CompanyContext,
  tp: Pick<TechPackDoc, "id" | "record">,
  input: { action: "CREATE" | "UPDATE"; summary: string },
  db: Db = prisma,
) {
  await auditAsAi(
    ctx.company.id,
    {
      action: input.action,
      entityType: tp.record.type,
      entityId: tp.record.id,
      summary: ctx.byAi ? input.summary : `${input.summary} (asked by ${ctx.user.name})`,
    },
    db,
  );
  await touchTechPack(db, tp.id);
}

/**
 * A new tech pack row with the next number (TP-2026-00001). Pass the
 * transaction, so the number is only taken when the tech pack is saved.
 */
export async function createTechPackRow(
  ctx: CompanyContext,
  db: Db,
  data: {
    title: string;
    projectId?: string | null;
    buyerId?: string | null;
    styleId?: string | null;
    season?: string | null;
    brief?: string | null;
  },
) {
  return db.techPack.create({
    data: {
      companyId: ctx.company.id,
      number: await nextDocumentNumber(db, ctx.company.id, "TECH_PACK"),
      createdById: ctx.user.id,
      ...data,
    },
    select: { id: true, number: true },
  });
}

/** The id of a style in production's tech pack, or null while it has none. */
export async function techPackIdOfProject(ctx: CompanyContext, projectId: string) {
  const project = await ctx.db.productionProject.findUnique({
    where: { id: projectId },
    select: { id: true, techPack: { select: { id: true } } },
  });
  if (!project) throw new AppError("NOT_FOUND", "Production project not found.");
  return project.techPack?.id ?? null;
}

/** A style in production's tech pack id, for its old addresses; not found when it has none. */
export async function requireProjectTechPack(ctx: CompanyContext, projectId: string) {
  const id = await techPackIdOfProject(ctx, projectId);
  if (!id) throw new AppError("NOT_FOUND", "This production project has no tech pack yet.");
  return id;
}

/**
 * A style in production's tech pack, started (numbered, titled and filled from
 * the style) the first time a part of it is saved from the project, as before
 * v6.4. The project is locked while it looks, so two saves start one tech pack.
 * Returns its id; inside a transaction, pass it.
 */
export async function ensureProjectTechPack(
  ctx: CompanyContext,
  projectId: string,
  tx?: Prisma.TransactionClient,
): Promise<string> {
  const project = await ctx.db.productionProject.findUnique({
    where: { id: projectId },
    select: { id: true, name: true, buyerId: true, styleId: true },
  });
  if (!project) throw new AppError("NOT_FOUND", "Production project not found.");
  const work = async (db: Prisma.TransactionClient) => {
    await lockRow(db, "ProductionProject", project.id);
    const found = await db.techPack.findUnique({
      where: { projectId: project.id },
      select: { id: true },
    });
    if (found) return found.id;
    const made = await createTechPackRow(ctx, db, {
      title: project.name,
      projectId: project.id,
      buyerId: project.buyerId,
      styleId: project.styleId,
    });
    return made.id;
  };
  return tx ? work(tx) : runTransaction(work);
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
  techPackId: string,
  raw: unknown,
  meta?: RequestMeta,
) {
  assertManage(ctx);
  const input = chartSchema.parse(raw);
  const tp = await loadTechPack(ctx, techPackId);
  assertCanChange(tp);
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
    await lockRow(tx, "TechPack", tp.id);
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
    await logTechPack(
      ctx,
      meta,
      tp,
      {
        action: "UPDATE",
        summary: `Made the measurement chart of ${tp.code} from the buyer's points (${input.sizes.join(", ")}, ${chart.rows.length} measurements)`,
      },
      tx,
    );
  });
  return getChart(ctx, tp.id);
}

const cellSchema = z.object({
  code: z.string().trim().min(1),
  size: z.string().trim().min(1),
  value: z.union([z.literal("").transform(() => null), z.null(), measure]),
});

async function loadRow(ctx: CompanyContext, techPackId: string, code: string) {
  const tp = await loadTechPack(ctx, techPackId);
  assertCanChange(tp);
  const techPack = await ctx.db.techPack.findUnique({
    where: { id: tp.id },
    select: { id: true, sizeRun: true, measureUnit: true },
  });
  const row = techPack
    ? await ctx.db.techPackMeasurement.findUnique({
        where: { techPackId_code: { techPackId: techPack.id, code } },
      })
    : null;
  if (!techPack || !row) throw new AppError("NOT_FOUND", "That measurement is not in the chart.");
  return { tp, techPack, row };
}

/** One cell typed by a person: it turns green (or red when cleared). */
export async function setMeasurement(
  ctx: CompanyContext,
  techPackId: string,
  raw: unknown,
  meta?: RequestMeta,
) {
  assertManage(ctx);
  const input = cellSchema.parse(raw);
  const { tp, techPack, row } = await loadRow(ctx, techPackId, input.code);
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
  await logTechPack(ctx, meta, tp, {
    action: "UPDATE",
    summary: `${tp.code}: ${row.name} at ${input.size} ${was ?? "missing"} → ${values[input.size] ?? "missing"}`,
  });
  return getChart(ctx, tp.id);
}

/** Confirms a row's rule-made values as they are: they turn green. */
export async function confirmMeasurementRow(
  ctx: CompanyContext,
  techPackId: string,
  code: string,
  meta?: RequestMeta,
) {
  assertManage(ctx);
  const { tp, row } = await loadRow(ctx, techPackId, code);
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
    await logTechPack(ctx, meta, tp, {
      action: "UPDATE",
      summary: `${tp.code}: confirmed ${row.name} (${confirmed} size(s))`,
    });
  }
  return getChart(ctx, tp.id);
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
  techPackId: string,
  raw: unknown,
  meta?: RequestMeta,
) {
  assertManage(ctx);
  const input = addRowSchema.parse(raw);
  const tp = await loadTechPack(ctx, techPackId);
  assertCanChange(tp);
  const techPack = await ctx.db.techPack.findUnique({
    where: { id: tp.id },
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
  await logTechPack(ctx, meta, tp, {
    action: "UPDATE",
    summary: `${tp.code}: added ${input.name} to the measurement chart`,
  });
  return getChart(ctx, tp.id);
}

/** Takes a measurement out of the chart (it can be made again from the buyer's points). */
export async function removeMeasurementRow(
  ctx: CompanyContext,
  techPackId: string,
  code: string,
  meta?: RequestMeta,
) {
  assertManage(ctx);
  const { tp, row } = await loadRow(ctx, techPackId, code);
  await ctx.db.techPackMeasurement.delete({ where: { id: row.id } });
  await logTechPack(ctx, meta, tp, {
    action: "UPDATE",
    summary: `${tp.code}: took ${row.name} out of the measurement chart`,
  });
  return getChart(ctx, tp.id);
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
export async function getChart(ctx: CompanyContext, techPackId: string) {
  const techPack = await ctx.db.techPack.findUnique({
    where: { id: techPackId },
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
  techPackId: string,
  raw: unknown,
  meta?: RequestMeta,
) {
  assertManage(ctx);
  const input = instructionsSchema.parse(raw);
  const tp = await loadTechPack(ctx, techPackId);
  assertCanChange(tp);
  const instructions = readInstructions(input as Prisma.JsonValue);
  await runTransaction(async (tx) => {
    await tx.techPack.update({
      where: { id: techPackId },
      data: { instructions: instructions as Prisma.InputJsonValue },
    });
    await logTechPack(
      ctx,
      meta,
      tp,
      {
        action: "UPDATE",
        summary: `${tp.code}: saved the instructions for the AI (${Object.keys(instructions).join(", ") || "none"})`,
      },
      tx,
    );
  });
  return instructions;
}
