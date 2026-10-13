import { Prisma } from "@prisma/client";
import { z } from "zod";

import { dateColumn, dateOnly, localDay } from "@/lib/dates";
import { AppError } from "@/lib/errors";
import { nextDocumentNumber } from "@/lib/numbering";
import { prisma } from "@/lib/prisma";
import { checkRateLimit } from "@/lib/rate-limit";
import type { RequestMeta } from "@/lib/request-meta";
import { lockRow } from "@/lib/row-lock";
import { runTransaction } from "@/lib/transaction";
import { auditInCompany } from "@/modules/audit/audit.service";
import type { CompanyContext } from "@/modules/auth/context";
import { readStoredFile } from "@/modules/files/file.service";
import { canSeeMaterialCosts } from "@/modules/materials/access";
import {
  canonicalSize,
  defaultIntakeParser,
  type IntakeParser,
  normalizeCode,
} from "@/modules/production/ai-intake";
import { heldByStyle } from "@/modules/production/batch-issue.service";
import {
  addUp,
  type CheckNeed,
  type CrossCheck,
  crossCheck,
  cellKey,
  type CutLine,
  cutLineSchema,
  type EmbroideryLine,
  fabricUsedSchema,
  milestone,
  milestoneWarning,
  readCutLines,
  readEmbroideryLines,
  readFabricUsed,
} from "@/modules/production/cutting";
import { lockSupplierAccount } from "@/modules/accounts/supplier-settlement";
import { money } from "@/modules/production/costing";
import {
  canLogFaults,
  chargesOwnSpoilage,
  createFault,
  deductFaultTx,
  logFaultTx,
} from "@/modules/production/fault.service";
import { addUpGrades, linePieces, readGradeLines } from "@/modules/production/finishing";
import { planStyles, styleGrids } from "@/modules/production/material-need.service";
import { isProjectClosed } from "@/modules/production/project-costs";
import { activeMembers, membersWith } from "@/modules/reminders/audience";
import { sendInApp } from "@/modules/reminders/notification.service";

/*
 * A style's cutting and embroidery: cutting reports (pieces cut by colour and
 * size on a day, typed in or read by AI from a photo of the cutting sheet, with
 * the fabric used), the cross-checks of what was cut against the fabric, the
 * collars and cuffs and the accessories (an instant alert when one falls
 * short), cut pieces sent out for embroidery or print and what came back (good
 * and spoiled, spoiled ones replaced from cutting at once), the cutting and
 * sewing milestones, and the Fabric Fault Note into the supplier fault log.
 * Everyone in Production reads it; Production Managers record it.
 */

const SEWN = ["WASH_QC", "FINISHING", "COMPLETED"];
const id = z.string().min(1);
const day = z.iso.date();
const note = z.string().trim().max(1000).nullish();

export const cuttingReportSchema = z.object({
  cutOn: day.optional(),
  lines: z.array(cutLineSchema).min(1).max(500),
  fabricUsed: z.array(fabricUsedSchema).max(20).optional(),
  photoId: id.nullish(),
  readByAi: z.boolean().optional(),
  note,
});

export const milestonesSchema = z.object({ cutBy: day.nullish(), sewBy: day.nullish() });

export const sendEmbroiderySchema = z.object({
  kind: z.enum(["EMBROIDERY", "PRINT"]),
  partyId: id.nullish(),
  sentOn: day.optional(),
  dueOn: day.nullish(),
  lines: z.array(cutLineSchema).min(1).max(500),
  note,
});

export const receiveEmbroiderySchema = z.object({
  receivedOn: day.optional(),
  lines: z
    .array(
      z.object({
        colorName: z.string().nullish(),
        sizeName: z.string().nullish(),
        received: z.number().int().min(0).max(1_000_000),
        spoiled: z.number().int().min(0).max(1_000_000),
      }),
    )
    .min(1)
    .max(500),
});

export const replaceSchema = z.object({
  cutOn: day.optional(),
  lines: z.array(cutLineSchema).min(1).max(500),
  /** Also put the spoiled pieces in the embroidery or print house's fault log. */
  logFault: z.boolean().optional(),
});

export const fabricFaultSchema = z.object({
  materialId: id,
  supplierId: id,
  quantity: z.number().positive().max(100_000_000).multipleOf(0.001),
  amount: z.number().min(0).max(1_000_000_000).multipleOf(0.01).nullish(),
  photoId: id.nullish(),
  note: z.string().trim().min(3, "Say what was wrong").max(1000),
});

function assertCanRecord(ctx: CompanyContext) {
  if (!ctx.can("production.manage")) {
    throw new AppError("FORBIDDEN", "Only Production Managers record cutting and embroidery.");
  }
}

const projectSelect = {
  id: true,
  code: true,
  name: true,
  status: true,
  stage: true,
  targetQuantity: true,
  targetDate: true,
  cutBy: true,
  sewBy: true,
  batch: { select: { id: true, code: true, name: true } },
  style: { select: { code: true, name: true } },
} satisfies Prisma.ProductionProjectSelect;

async function loadProject(ctx: CompanyContext, projectId: string) {
  const project = await ctx.db.productionProject.findUnique({
    where: { id: projectId },
    select: projectSelect,
  });
  if (!project) throw new AppError("NOT_FOUND", "Production project not found.");
  return project;
}

function assertOpen(project: {
  code: string;
  status: Parameters<typeof isProjectClosed>[0]["status"];
}) {
  if (isProjectClosed(project)) {
    throw new AppError(
      "CONFLICT",
      `${project.code} is ${project.status.toLowerCase()}; cutting and embroidery are closed.`,
    );
  }
}

/** The style's cells: its grid (colour × size, with pieces to make), or one cell for a style without one. */
async function cellsOf(projectId: string, targetQuantity: number) {
  const grid = (await styleGrids(prisma, [projectId])).get(projectId) ?? [];
  const cells = grid.filter((c) => c.quantity > 0);
  return cells.length > 0
    ? cells.map((c) => ({
        colorName: c.colorName as string | null,
        sizeName: c.sizeName as string | null,
        target: c.quantity,
      }))
    : [{ colorName: null, sizeName: null, target: targetQuantity }];
}

/** Keeps each line to a cell of the style (and each cell once), dropping empty ones. */
function checkLines(
  lines: Array<{ colorName?: string | null; sizeName?: string | null; quantity: number }>,
  cells: Array<{ colorName: string | null; sizeName: string | null }>,
  field = "lines",
): CutLine[] {
  const known = new Set(cells.map((c) => cellKey(c.colorName, c.sizeName)));
  const seen = new Set<string>();
  const out: CutLine[] = [];
  lines.forEach((l, i) => {
    const key = cellKey(l.colorName, l.sizeName);
    if (!known.has(key)) {
      throw new AppError("VALIDATION", `Line ${i + 1} is not a colour and size of this style.`, {
        [`${field}.${i}`]: ["Choose a colour and size of the style"],
      });
    }
    if (seen.has(key)) {
      throw new AppError("VALIDATION", "List each colour and size once.", {
        [`${field}.${i}`]: ["Listed twice"],
      });
    }
    seen.add(key);
    if (l.quantity > 0) {
      out.push({
        colorName: l.colorName ?? null,
        sizeName: l.sizeName ?? null,
        quantity: l.quantity,
      });
    }
  });
  if (out.length === 0) {
    throw new AppError("VALIDATION", "Enter the pieces of at least one colour and size.", {
      [field]: ["Nothing entered"],
    });
  }
  return out;
}

function assertPastDay(value: string | undefined, today: string, field: string, what: string) {
  if (value && value > today) {
    throw new AppError("VALIDATION", `${what} cannot be on a later day.`, {
      [field]: ["Choose today or an earlier day"],
    });
  }
}

/** A picture or scan uploaded by this company. */
async function assertPhoto(ctx: CompanyContext, photoId: string | null | undefined) {
  if (!photoId) return null;
  const file = await ctx.db.fileAsset.findUnique({ where: { id: photoId }, select: { id: true } });
  if (!file) throw new AppError("NOT_FOUND", "The photo was not found. Upload it again.");
  return file.id;
}

const issuedNumber = (n: number) => String(Math.round(n * 1000) / 1000);

/** Pieces of the style by cell: cut, sent out, back good, spoiled, still out. */
function tally(
  cells: Array<{ colorName: string | null; sizeName: string | null; target: number }>,
  reports: Array<{ lines: CutLine[] }>,
  jobs: Array<{ lines: EmbroideryLine[] }>,
) {
  const cut = addUp(reports.map((r) => r.lines));
  const sum = (pick: (l: EmbroideryLine) => number) => {
    const m = new Map<string, number>();
    for (const j of jobs) {
      for (const l of j.lines) {
        const key = cellKey(l.colorName, l.sizeName);
        m.set(key, (m.get(key) ?? 0) + pick(l));
      }
    }
    return m;
  };
  const sent = sum((l) => l.sent);
  const back = sum((l) => l.received);
  const spoiled = sum((l) => l.spoiled);
  return cells.map((c) => {
    const key = cellKey(c.colorName, c.sizeName);
    const s = sent.get(key) ?? 0;
    return {
      ...c,
      cut: cut.get(key) ?? 0,
      sent: s,
      back: back.get(key) ?? 0,
      spoiled: spoiled.get(key) ?? 0,
      out: s - (back.get(key) ?? 0) - (spoiled.get(key) ?? 0),
    };
  });
}

/** The cross-checks of what was cut against each material per piece of the style. */
async function checksFor(
  ctx: CompanyContext,
  project: { id: string; targetQuantity: number },
  reports: Array<{ lines: CutLine[]; fabricUsed: Array<{ materialId: string; quantity: number }> }>,
) {
  const planned = (await planStyles(prisma, [project])).get(project.id) ?? [];
  if (planned.length === 0) return [];
  const held = await heldByStyle(prisma, ctx.company.id, [project.id]);
  const shares = await prisma.purchaseOrderLineShare.findMany({
    where: {
      projectId: project.id,
      line: { order: { status: { not: "CANCELLED" } } },
    },
    select: {
      colorName: true,
      sizeName: true,
      quantity: true,
      line: { select: { rawMaterialId: true } },
    },
  });
  const cuts = addUp(reports.map((r) => r.lines));
  const checks: CrossCheck[] = [];
  for (const need of planned) {
    const ordered = new Map<string, number>();
    for (const s of shares.filter((x) => x.line.rawMaterialId === need.materialId)) {
      const key = cellKey(s.colorName, s.sizeName);
      ordered.set(key, (ordered.get(key) ?? 0) + Number(s.quantity));
    }
    const parts = need.parts.map((p) => ({
      colorName: p.colorName,
      sizeName: p.sizeName,
      pieces: p.pieces,
    }));
    // Usage as given on reports, with the pieces those reports cut in the need's cells.
    let used = 0;
    let pieces = 0;
    for (const r of reports) {
      const given = r.fabricUsed.filter((f) => f.materialId === need.materialId);
      if (given.length === 0) continue;
      used += given.reduce((t, f) => t + f.quantity, 0);
      const mine = addUp([r.lines]);
      for (const p of parts) {
        for (const [key, n] of mine) {
          const [colour, size] = key.split("|");
          if (
            (p.colorName === null || colour === p.colorName) &&
            (p.sizeName === null || size === p.sizeName)
          ) {
            pieces += n;
          }
        }
      }
    }
    const checkNeed: CheckNeed = {
      material: {
        id: need.material.id,
        code: need.material.code,
        name: need.material.name,
        kind: need.material.kind,
        unit: need.material.unit,
      },
      placement: need.placement,
      split: need.split,
      perPiece: need.perPiece
        .times(new Prisma.Decimal(100).plus(need.wastagePercent))
        .dividedBy(100)
        .toNumber(),
      parts,
      held: Number(held.get(`${project.id}|${need.materialId}`) ?? 0),
      ordered,
    };
    const check = crossCheck(checkNeed, cuts, pieces > 0 ? { used, pieces } : undefined);
    if (check) checks.push(check);
  }
  const order = { SHORT: 0, WARN: 1, OK: 2 };
  return checks.sort((a, b) => order[a.level] - order[b.level]);
}

/** The cutting and sewing milestones of a style today. */
function milestonesOf(
  project: {
    cutBy: Date | null;
    sewBy: Date | null;
    stage: string;
    status: string;
    targetQuantity: number;
  },
  cutPieces: number,
  today: string,
) {
  return {
    cutting: milestone(dateOnly(project.cutBy), cutPieces >= project.targetQuantity, today),
    sewing: milestone(
      dateOnly(project.sewBy),
      SEWN.includes(project.stage) || project.status === "COMPLETED",
      today,
    ),
  };
}

/** The cutting page: cells with what was cut and sent out, reports, jobs, checks and dates. */
export async function getCuttingScreen(ctx: CompanyContext, projectId: string) {
  const project = await loadProject(ctx, projectId);
  const tz = ctx.company.timezone;
  const today = localDay(new Date(), tz);
  const [cells, reportRows, jobRows] = await Promise.all([
    cellsOf(project.id, project.targetQuantity),
    ctx.db.cuttingReport.findMany({
      where: { projectId: project.id },
      select: {
        id: true,
        number: true,
        kind: true,
        cutOn: true,
        lines: true,
        fabricUsed: true,
        photoId: true,
        readByAi: true,
        note: true,
        createdBy: { select: { name: true } },
        embroideryJob: { select: { number: true } },
      },
      orderBy: [{ cutOn: "desc" }, { number: "desc" }],
    }),
    ctx.db.embroideryJob.findMany({
      where: { projectId: project.id },
      select: {
        id: true,
        number: true,
        kind: true,
        sentOn: true,
        dueOn: true,
        receivedOn: true,
        lines: true,
        note: true,
        party: { select: { id: true, name: true, supplierCategories: true } },
        replacements: { select: { lines: true } },
      },
      orderBy: [{ sentOn: "desc" }, { number: "desc" }],
    }),
  ]);
  const reports = reportRows.map((r) => ({
    ...r,
    lines: readCutLines(r.lines),
    fabricUsed: readFabricUsed(r.fabricUsed),
  }));
  const jobs = jobRows.map((j) => ({ ...j, lines: readEmbroideryLines(j.lines) }));
  const grid = tally(cells, reports, jobs);
  const cut = grid.reduce((t, c) => t + c.cut, 0);
  const spoiled = grid.reduce((t, c) => t + c.spoiled, 0);
  const checks = await checksFor(ctx, project, reports);
  const dates = milestonesOf(project, cut - spoiled, today);
  const materials = await ctx.db.productionMaterialNeed.findMany({
    where: { projectId: project.id, rawMaterial: { kind: "FABRIC" } },
    select: {
      rawMaterial: {
        select: {
          id: true,
          code: true,
          name: true,
          unit: true,
          supplier: { select: { id: true, code: true, name: true } },
        },
      },
    },
    orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
  });
  const fabrics = [...new Map(materials.map((m) => [m.rawMaterial.id, m.rawMaterial])).values()];
  const open = !isProjectClosed(project);
  const warnings = [
    milestoneWarning(
      "Cutting",
      dates.cutting,
      `${cut - spoiled} of ${project.targetQuantity} pieces cut`,
    ),
    milestoneWarning("Sewing", dates.sewing),
  ].filter((w): w is NonNullable<typeof w> => w !== null);
  return {
    today,
    project: {
      id: project.id,
      code: project.code,
      name: project.name,
      status: project.status,
      target: project.targetQuantity,
      targetOn: dateOnly(project.targetDate)!,
      cutBy: dateOnly(project.cutBy),
      sewBy: dateOnly(project.sewBy),
      batch: project.batch,
    },
    hasGrid: cells.some((c) => c.colorName !== null),
    colours: [...new Set(cells.map((c) => c.colorName))],
    sizes: [...new Set(cells.map((c) => c.sizeName))],
    cells: grid,
    totals: {
      cut,
      spoiled,
      out: grid.reduce((t, c) => t + c.out, 0),
      replaced: reports
        .filter((r) => r.kind === "REPLACEMENT")
        .reduce((t, r) => t + r.lines.reduce((u, l) => u + l.quantity, 0), 0),
    },
    milestones: dates,
    warnings,
    checks,
    reports: reports.map((r) => ({
      id: r.id,
      number: r.number,
      kind: r.kind,
      cutOn: dateOnly(r.cutOn)!,
      pieces: r.lines.reduce((t, l) => t + l.quantity, 0),
      lines: r.lines,
      fabricUsed: r.fabricUsed.map((f) => {
        const m = fabrics.find((x) => x.id === f.materialId);
        return { code: m?.code ?? "", unit: m?.unit ?? "KG", quantity: issuedNumber(f.quantity) };
      }),
      photoId: r.photoId,
      readByAi: r.readByAi,
      note: r.note,
      by: r.createdBy?.name ?? null,
      forJob: r.embroideryJob?.number ?? null,
    })),
    jobs: jobs.map((j) => {
      const sent = j.lines.reduce((t, l) => t + l.sent, 0);
      const back = j.lines.reduce((t, l) => t + l.received, 0);
      const bad = j.lines.reduce((t, l) => t + l.spoiled, 0);
      const replaced = addUp(j.replacements.map((r) => readCutLines(r.lines)));
      // Spoiled pieces of each colour and size not cut again yet.
      const toReplace = j.lines
        .map((l) => ({
          colorName: l.colorName,
          sizeName: l.sizeName,
          quantity: l.spoiled - (replaced.get(cellKey(l.colorName, l.sizeName)) ?? 0),
        }))
        .filter((l) => l.quantity > 0);
      return {
        id: j.id,
        number: j.number,
        kind: j.kind,
        party: j.party
          ? {
              id: j.party.id,
              name: j.party.name,
              /** An embroidery or print house: its spoiled pieces come off its own Supplier Due. */
              chargesSpoilage: chargesOwnSpoilage(j.party.supplierCategories),
            }
          : null,
        sentOn: dateOnly(j.sentOn)!,
        dueOn: dateOnly(j.dueOn),
        receivedOn: dateOnly(j.receivedOn),
        lines: j.lines,
        sent,
        back,
        spoiled: bad,
        out: sent - back - bad,
        toReplace: toReplace.reduce((t, l) => t + l.quantity, 0),
        toReplaceLines: toReplace,
        late: Boolean(j.dueOn && sent - back - bad > 0 && dateOnly(j.dueOn)! < today),
        note: j.note,
      };
    }),
    fabrics: fabrics.map((f) => ({
      id: f.id,
      code: f.code,
      name: f.name,
      unit: f.unit,
      supplier: f.supplier,
    })),
    can: {
      record: ctx.can("production.manage") && open,
      faultNote: canLogFaults(ctx) && open,
      seeValues: canSeeMaterialCosts(ctx),
      readAi: defaultIntakeParser() !== null,
    },
  };
}

export type CuttingScreen = Awaited<ReturnType<typeof getCuttingScreen>>;

/** Alerts Production (and the store, which issues) when cutting runs short of something. */
async function alertShortages(
  ctx: CompanyContext,
  tx: Prisma.TransactionClient,
  project: { id: string; code: string },
  checks: CrossCheck[],
  what: string,
) {
  const short = checks.filter((c) => c.level === "SHORT");
  if (short.length === 0) return;
  const members = await activeMembers(ctx.company.id, tx);
  const to = membersWith(members, ["production.manage", "materials.manage"]).map((userId) => ({
    userId,
  }));
  await sendInApp(tx, ctx.company.id, to, {
    subject: `Cutting shortage on ${project.code}`,
    body: `${what}: ${short.map((c) => c.text).join(" ")}`,
    entityType: "ProductionProject",
    entityId: project.id,
  });
}

/** Saves a cutting report (typed in, or read by AI and checked), then checks it and alerts. */
export async function createCuttingReport(
  ctx: CompanyContext,
  projectId: string,
  raw: unknown,
  meta?: RequestMeta,
) {
  const input = cuttingReportSchema.parse(raw);
  assertCanRecord(ctx);
  const project = await loadProject(ctx, projectId);
  assertOpen(project);
  const today = localDay(new Date(), ctx.company.timezone);
  assertPastDay(input.cutOn, today, "cutOn", "A cutting report");
  const cells = await cellsOf(project.id, project.targetQuantity);
  const lines = checkLines(input.lines, cells);
  const fabricUsed = input.fabricUsed ?? [];
  if (fabricUsed.length > 0) {
    const ids = new Set(
      (
        await ctx.db.productionMaterialNeed.findMany({
          where: { projectId: project.id, rawMaterial: { kind: "FABRIC" } },
          select: { rawMaterialId: true },
        })
      ).map((n) => n.rawMaterialId),
    );
    if (fabricUsed.some((f) => !ids.has(f.materialId))) {
      throw new AppError("VALIDATION", "Fabric used must be one of the style's materials.", {
        fabricUsed: ["Choose a fabric of the style"],
      });
    }
  }
  const photoId = await assertPhoto(ctx, input.photoId);
  const pieces = lines.reduce((t, l) => t + l.quantity, 0);
  const made = await prisma.$transaction(async (tx) => {
    await lockRow(tx, "ProductionProject", project.id);
    const report = await tx.cuttingReport.create({
      data: {
        companyId: ctx.company.id,
        projectId: project.id,
        number: await nextDocumentNumber(tx, ctx.company.id, "CUTTING_REPORT"),
        cutOn: dateColumn(input.cutOn ?? today),
        lines,
        fabricUsed,
        photoId,
        readByAi: Boolean(input.readByAi && photoId),
        note: input.note ?? null,
        createdById: ctx.user.id,
      },
      select: { id: true, number: true },
    });
    await auditInCompany(
      ctx,
      meta,
      {
        action: "CREATE",
        entityType: "CuttingReport",
        entityId: report.id,
        summary: `Cutting report ${report.number} for ${project.code}: ${pieces} pieces cut${input.readByAi && photoId ? " (read by AI from the photo)" : ""}`,
      },
      tx,
    );
    return report;
  });
  const checks = await checksFor(ctx, project, await reportsOf(ctx, project.id));
  if (checks.some((c) => c.level === "SHORT")) {
    await prisma.$transaction((tx) =>
      alertShortages(ctx, tx, project, checks, `After ${made.number} (${pieces} pieces cut)`),
    );
  }
  return {
    id: made.id,
    number: made.number,
    pieces,
    shortages: checks.filter((c) => c.level === "SHORT").length,
  };
}

/**
 * Each cell's pieces cut and good (spoiled ones taken off) and those still out
 * for embroidery or print, for finishing; null when no cutting was recorded.
 */
export async function cutByCell(
  db: Pick<Prisma.TransactionClient, "cuttingReport" | "embroideryJob">,
  projectId: string,
) {
  const [reports, jobs] = await Promise.all([
    db.cuttingReport.findMany({ where: { projectId }, select: { lines: true } }),
    db.embroideryJob.findMany({ where: { projectId }, select: { lines: true } }),
  ]);
  if (reports.length === 0) return null;
  const cells = new Map<string, { good: number; out: number }>();
  for (const [key, cut] of addUp(reports.map((r) => readCutLines(r.lines)))) {
    cells.set(key, { good: cut, out: 0 });
  }
  for (const j of jobs) {
    for (const l of readEmbroideryLines(j.lines)) {
      const key = cellKey(l.colorName, l.sizeName);
      const cell = cells.get(key) ?? { good: 0, out: 0 };
      cells.set(key, {
        good: cell.good - l.spoiled,
        out: cell.out + l.sent - l.received - l.spoiled,
      });
    }
  }
  return cells;
}

async function reportsOf(ctx: CompanyContext, projectId: string) {
  const rows = await ctx.db.cuttingReport.findMany({
    where: { projectId },
    select: { lines: true, fabricUsed: true },
  });
  return rows.map((r) => ({
    lines: readCutLines(r.lines),
    fabricUsed: readFabricUsed(r.fabricUsed),
  }));
}

/** Deletes a cutting report entered by mistake (not one whose pieces went out for embroidery). */
export async function deleteCuttingReport(
  ctx: CompanyContext,
  reportId: string,
  meta?: RequestMeta,
) {
  assertCanRecord(ctx);
  const report = await ctx.db.cuttingReport.findUnique({
    where: { id: reportId },
    select: { id: true, number: true, lines: true, project: { select: projectSelect } },
  });
  if (!report) throw new AppError("NOT_FOUND", "Cutting report not found.");
  assertOpen(report.project);
  const project = report.project;
  await prisma.$transaction(async (tx) => {
    await lockRow(tx, "ProductionProject", project.id);
    // What is left cut must still cover what went out for embroidery or print.
    const others = await tx.cuttingReport.findMany({
      where: { projectId: project.id, id: { not: report.id } },
      select: { lines: true },
    });
    const jobs = await tx.embroideryJob.findMany({
      where: { projectId: project.id },
      select: { lines: true },
    });
    const left = addUp(others.map((o) => readCutLines(o.lines)));
    for (const j of jobs) {
      for (const l of readEmbroideryLines(j.lines)) {
        if (l.sent > (left.get(cellKey(l.colorName, l.sizeName)) ?? 0)) {
          throw new AppError(
            "CONFLICT",
            `${report.number}'s pieces went out for embroidery or print; it cannot be deleted.`,
          );
        }
      }
    }
    // And what was counted at finishing.
    const counted = addUpGrades(
      (
        await tx.finishingReport.findMany({
          where: { projectId: project.id, NOT: { intake: { status: "REVERSED" } } },
          select: { lines: true },
        })
      ).map((r) => readGradeLines(r.lines)),
    );
    const spoiled = new Map<string, number>();
    for (const j of jobs) {
      for (const l of readEmbroideryLines(j.lines)) {
        const key = cellKey(l.colorName, l.sizeName);
        spoiled.set(key, (spoiled.get(key) ?? 0) + l.spoiled);
      }
    }
    for (const [key, grades] of counted) {
      if (linePieces(grades) > (left.get(key) ?? 0) - (spoiled.get(key) ?? 0)) {
        throw new AppError(
          "CONFLICT",
          `${report.number}'s pieces are counted at finishing; it cannot be deleted.`,
        );
      }
    }
    await tx.cuttingReport.delete({ where: { id: report.id } });
    await auditInCompany(
      ctx,
      meta,
      {
        action: "DELETE",
        entityType: "CuttingReport",
        entityId: report.id,
        summary: `Deleted cutting report ${report.number} of ${project.code}`,
      },
      tx,
    );
  });
  return { id: report.id, number: report.number };
}

/**
 * Reads a photo of the cutting sheet with AI into pieces by colour and size of
 * the style, to check and save. Nothing is saved here. Without AI set up it
 * says so, and the pieces are typed in.
 */
export async function readCuttingPhoto(
  ctx: CompanyContext,
  projectId: string,
  photoId: string,
  parser: IntakeParser | null = defaultIntakeParser(),
) {
  assertCanRecord(ctx);
  const project = await loadProject(ctx, projectId);
  const file = await ctx.db.fileAsset.findUnique({ where: { id: photoId } });
  if (!file) throw new AppError("NOT_FOUND", "The photo was not found. Upload it again.");
  if (!parser) {
    throw new AppError(
      "UNAVAILABLE",
      "AI reading is not set up yet (AI_API_KEY and AI_INTAKE_MODEL). Type the pieces into the grid.",
    );
  }
  checkRateLimit(`ai-cutting:${ctx.user.id}`, 10, 60_000);
  const cells = await cellsOf(project.id, project.targetQuantity);
  const colours = [
    ...new Set(cells.map((c) => c.colorName).filter((c): c is string => Boolean(c))),
  ];
  const sizes = [...new Set(cells.map((c) => c.sizeName).filter((s): s is string => Boolean(s)))];
  const parsed = await parser.parse(
    { bytes: await readStoredFile(file), mimeType: file.mimeType, fileName: file.fileName },
    {
      document: "CUTTING_REPORT",
      projectStyle: project.style ?? { code: project.code, name: project.name },
      styleCodes: project.style ? [project.style.code] : [],
      colors: colours,
      sizes,
    },
  );
  const byColour = new Map(colours.map((c) => [normalizeCode(c), c]));
  const bySize = new Map(sizes.map((s) => [canonicalSize(s), s]));
  const found = new Map<string, CutLine>();
  const unmatched: Array<{ color: string | null; size: string | null; quantity: number }> = [];
  for (const l of parsed.lines) {
    const colorName =
      cells[0]!.colorName === null
        ? null
        : (byColour.get(normalizeCode(l.color ?? "")) ?? undefined);
    const sizeName =
      cells[0]!.sizeName === null ? null : (bySize.get(canonicalSize(l.size ?? "")) ?? undefined);
    if (colorName === undefined || sizeName === undefined) {
      unmatched.push({ color: l.color, size: l.size, quantity: l.quantity });
      continue;
    }
    const key = cellKey(colorName, sizeName);
    const line = found.get(key) ?? { colorName, sizeName, quantity: 0 };
    line.quantity += l.quantity;
    found.set(key, line);
  }
  return {
    lines: [...found.values()],
    unmatched,
    confidence: Math.round(parsed.confidence * 100),
    notes: parsed.notes,
  };
}

/** Sets the days cutting and sewing are to be done by (empty: no milestone). */
export async function setMilestones(
  ctx: CompanyContext,
  projectId: string,
  raw: unknown,
  meta?: RequestMeta,
) {
  const input = milestonesSchema.parse(raw);
  assertCanRecord(ctx);
  const project = await loadProject(ctx, projectId);
  assertOpen(project);
  if (input.cutBy && input.sewBy && input.sewBy < input.cutBy) {
    throw new AppError("VALIDATION", "Sewing cannot be done before cutting.", {
      sewBy: ["Choose a day on or after cutting"],
    });
  }
  const target = dateOnly(project.targetDate)!;
  for (const [field, value] of [
    ["cutBy", input.cutBy],
    ["sewBy", input.sewBy],
  ] as const) {
    if (value && value > target) {
      throw new AppError("VALIDATION", "A milestone cannot be after the style's target day.", {
        [field]: [`Choose ${target} or earlier`],
      });
    }
  }
  await prisma.$transaction(async (tx) => {
    await tx.productionProject.update({
      where: { id: project.id },
      data: {
        cutBy: input.cutBy ? dateColumn(input.cutBy) : null,
        sewBy: input.sewBy ? dateColumn(input.sewBy) : null,
      },
    });
    await auditInCompany(
      ctx,
      meta,
      {
        action: "UPDATE",
        entityType: "ProductionProject",
        entityId: project.id,
        summary: `${project.code}: cutting by ${input.cutBy ?? "not set"}, sewing by ${input.sewBy ?? "not set"}`,
      },
      tx,
    );
  });
  return { id: project.id, code: project.code };
}

/** Sends cut pieces out for embroidery or print (no more than is cut and not already out). */
export async function sendToEmbroidery(
  ctx: CompanyContext,
  projectId: string,
  raw: unknown,
  meta?: RequestMeta,
) {
  const input = sendEmbroiderySchema.parse(raw);
  assertCanRecord(ctx);
  const project = await loadProject(ctx, projectId);
  assertOpen(project);
  const today = localDay(new Date(), ctx.company.timezone);
  assertPastDay(input.sentOn, today, "sentOn", "Sending");
  if (input.dueOn && input.dueOn < (input.sentOn ?? today)) {
    throw new AppError("VALIDATION", "The pieces cannot be due back before they are sent.", {
      dueOn: ["Choose a later day"],
    });
  }
  const party = input.partyId
    ? await ctx.db.party.findUnique({
        where: { id: input.partyId },
        select: { id: true, name: true, kind: true },
      })
    : null;
  if (input.partyId && (!party || party.kind === "BUYER")) {
    throw new AppError("NOT_FOUND", "Supplier not found.");
  }
  const cells = await cellsOf(project.id, project.targetQuantity);
  const lines = checkLines(input.lines, cells);
  const made = await prisma.$transaction(async (tx) => {
    await lockRow(tx, "ProductionProject", project.id);
    const reports = await tx.cuttingReport.findMany({
      where: { projectId: project.id },
      select: { lines: true },
    });
    const jobs = await tx.embroideryJob.findMany({
      where: { projectId: project.id },
      select: { lines: true },
    });
    const cut = addUp(reports.map((r) => readCutLines(r.lines)));
    const sent = new Map<string, number>();
    for (const j of jobs) {
      for (const l of readEmbroideryLines(j.lines)) {
        const key = cellKey(l.colorName, l.sizeName);
        sent.set(key, (sent.get(key) ?? 0) + l.sent);
      }
    }
    lines.forEach((l, i) => {
      const key = cellKey(l.colorName, l.sizeName);
      const free = (cut.get(key) ?? 0) - (sent.get(key) ?? 0);
      if (l.quantity > free) {
        throw new AppError(
          "CONFLICT",
          `${[l.colorName, l.sizeName].filter(Boolean).join(" ") || "The style"}: ${Math.max(free, 0)} cut pieces are free to send, not ${l.quantity}.`,
          { [`lines.${i}`]: [`${Math.max(free, 0)} free to send`] },
        );
      }
    });
    const job = await tx.embroideryJob.create({
      data: {
        companyId: ctx.company.id,
        projectId: project.id,
        number: await nextDocumentNumber(tx, ctx.company.id, "EMBROIDERY_JOB"),
        kind: input.kind,
        partyId: party?.id ?? null,
        sentOn: dateColumn(input.sentOn ?? today),
        dueOn: input.dueOn ? dateColumn(input.dueOn) : null,
        lines: lines.map((l) => ({
          colorName: l.colorName,
          sizeName: l.sizeName,
          sent: l.quantity,
          received: 0,
          spoiled: 0,
        })),
        note: input.note ?? null,
        createdById: ctx.user.id,
      },
      select: { id: true, number: true },
    });
    await auditInCompany(
      ctx,
      meta,
      {
        action: "CREATE",
        entityType: "EmbroideryJob",
        entityId: job.id,
        summary: `Sent ${lines.reduce((t, l) => t + l.quantity, 0)} pieces of ${project.code} for ${input.kind === "PRINT" ? "print" : "embroidery"}${party ? ` to ${party.name}` : ""} (${job.number})`,
      },
      tx,
    );
    return job;
  });
  return made;
}

/**
 * What a cut piece of a style is worth: the fabric issued to it (less what came
 * back) over the pieces cut, replacements included. Collars, trims and
 * accessories are not in a cut piece yet. Null while no fabric is issued or
 * nothing is cut.
 */
export async function cutPieceCost(
  db: Prisma.TransactionClient,
  companyId: string,
  projectId: string,
) {
  const [fabric, reports] = await Promise.all([
    db.rawMaterialMovement.aggregate({
      where: {
        companyId,
        productionProjectId: projectId,
        type: { in: ["ISSUE_TO_PRODUCTION", "RETURN_FROM_PRODUCTION"] },
        rawMaterial: { kind: "FABRIC" },
      },
      _sum: { value: true },
    }),
    db.cuttingReport.findMany({ where: { projectId }, select: { lines: true } }),
  ]);
  // Issues take value out of the store (negative), returns bring it back.
  const value = new Prisma.Decimal(0).minus(fabric._sum.value ?? 0);
  const cut = reports.reduce(
    (t, r) => t + readCutLines(r.lines).reduce((n, l) => n + l.quantity, 0),
    0,
  );
  if (cut <= 0 || value.lte(0)) return null;
  return { perPiece: money(value.dividedBy(cut)), cut };
}

/**
 * Takes pieces back from embroidery or print, good and spoiled, a little at a
 * time if need be. Says how many came back spoiled, to replace from cutting.
 * Pieces an embroidery or print house spoiled are theirs: they go in its fault
 * log at the fabric in a cut piece and come off its own Supplier Due at once
 * (never the factory's); with no fabric issued yet, the fault waits to be valued.
 */
export async function receiveFromEmbroidery(
  ctx: CompanyContext,
  jobId: string,
  raw: unknown,
  meta?: RequestMeta,
) {
  const input = receiveEmbroiderySchema.parse(raw);
  assertCanRecord(ctx);
  const found = await ctx.db.embroideryJob.findUnique({
    where: { id: jobId },
    select: {
      id: true,
      projectId: true,
      number: true,
      kind: true,
      party: { select: { id: true, name: true, supplierCategories: true } },
    },
  });
  if (!found) throw new AppError("NOT_FOUND", "Embroidery or print job not found.");
  const project = await loadProject(ctx, found.projectId);
  assertOpen(project);
  const today = localDay(new Date(), ctx.company.timezone);
  assertPastDay(input.receivedOn, today, "receivedOn", "Receiving");
  const house =
    found.party && chargesOwnSpoilage(found.party.supplierCategories) ? found.party : null;
  const companyId = ctx.company.id;
  const result = await runTransaction(
    async (tx) => {
      // The house's account before anything else (lock order): spoiled pieces move its Supplier Due.
      if (house) await lockSupplierAccount(tx, companyId, house.id);
      await lockRow(tx, "ProductionProject", project.id);
      const job = await tx.embroideryJob.findUniqueOrThrow({
        where: { id: found.id },
        select: { lines: true },
      });
      const lines = readEmbroideryLines(job.lines);
      let good = 0;
      let bad = 0;
      input.lines.forEach((l, i) => {
        const line = lines.find(
          (x) => cellKey(x.colorName, x.sizeName) === cellKey(l.colorName, l.sizeName),
        );
        if (!line) {
          throw new AppError("VALIDATION", `Line ${i + 1} was not sent on ${found.number}.`, {
            [`lines.${i}`]: ["Not on this job"],
          });
        }
        const out = line.sent - line.received - line.spoiled;
        if (l.received + l.spoiled > out) {
          throw new AppError(
            "VALIDATION",
            `${[line.colorName, line.sizeName].filter(Boolean).join(" ") || "The style"}: only ${out} pieces are still out.`,
            { [`lines.${i}`]: [`${out} still out`] },
          );
        }
        line.received += l.received;
        line.spoiled += l.spoiled;
        good += l.received;
        bad += l.spoiled;
      });
      if (good + bad === 0) {
        throw new AppError("VALIDATION", "Enter the pieces that came back.", {
          lines: ["Nothing came back"],
        });
      }
      const allBack = lines.every((l) => l.sent === l.received + l.spoiled);
      await tx.embroideryJob.update({
        where: { id: found.id },
        data: {
          lines,
          receivedOn: allBack ? dateColumn(input.receivedOn ?? today) : null,
        },
      });
      await auditInCompany(
        ctx,
        meta,
        {
          action: "UPDATE",
          entityType: "EmbroideryJob",
          entityId: found.id,
          summary: `${found.number} (${project.code}): ${good} pieces back good${bad ? `, ${bad} spoiled` : ""}${allBack ? "; all back" : ""}`,
        },
        tx,
      );
      let charged: {
        number: string;
        amount: string | null;
        perPiece: string | null;
        entry: string | null;
      } | null = null;
      if (house && bad > 0) {
        const cost = await cutPieceCost(tx, companyId, project.id);
        const amount = cost ? money(cost.perPiece.times(bad)) : null;
        const what = found.kind === "PRINT" ? "print" : "embroidery";
        const note = cost
          ? `${bad} pieces of ${project.code} spoiled at ${what} on ${found.number}, at ${cost.perPiece.toFixed(2)} a cut piece (materials issued ÷ ${cost.cut} pieces cut)`
          : `${bad} pieces of ${project.code} spoiled at ${what} on ${found.number}; no materials issued yet, so the value is to agree`;
        const fault = await logFaultTx(tx, ctx, meta, {
          supplier: house,
          kind: "SPOILED_PIECES",
          batchId: project.batch?.id ?? null,
          projectId: project.id,
          rawMaterialId: null,
          quantity: bad,
          amount: amount ? amount.toNumber() : null,
          note,
          occurredOn: input.receivedOn ?? today,
          photoId: null,
        });
        const entry =
          amount && amount.gt(0)
            ? await deductFaultTx(tx, ctx, { ...fault, amount, note }, house)
            : null;
        charged = {
          number: fault.number,
          amount: amount ? amount.toFixed(2) : null,
          perPiece: cost ? cost.perPiece.toFixed(2) : null,
          entry: entry?.number ?? null,
        };
      }
      return {
        good,
        spoiled: bad,
        /** The house's fault for the spoiled pieces, taken off its Supplier Due when valued. */
        charged,
        spoiledLines: input.lines
          .filter((l) => l.spoiled > 0)
          .map((l) => ({
            colorName: l.colorName ?? null,
            sizeName: l.sizeName ?? null,
            quantity: l.spoiled,
          })),
      };
    },
    { timeout: 30_000 },
  );
  return { id: found.id, number: found.number, ...result };
}

/**
 * "Replace from cutting immediately": a replacement cutting report for pieces
 * spoiled at embroidery or print (no more than were spoiled and not yet
 * replaced), alerting Production, and if asked the spoiled pieces in the
 * embroidery or print house's fault log.
 */
export async function replaceFromCutting(
  ctx: CompanyContext,
  jobId: string,
  raw: unknown,
  meta?: RequestMeta,
) {
  const input = replaceSchema.parse(raw);
  assertCanRecord(ctx);
  const job = await ctx.db.embroideryJob.findUnique({
    where: { id: jobId },
    select: {
      id: true,
      number: true,
      projectId: true,
      lines: true,
      partyId: true,
      party: { select: { name: true, supplierCategories: true } },
      replacements: { select: { lines: true } },
    },
  });
  if (!job) throw new AppError("NOT_FOUND", "Embroidery or print job not found.");
  const project = await loadProject(ctx, job.projectId);
  assertOpen(project);
  const today = localDay(new Date(), ctx.company.timezone);
  assertPastDay(input.cutOn, today, "cutOn", "A cutting report");
  const spoiled = new Map(
    readEmbroideryLines(job.lines).map((l) => [cellKey(l.colorName, l.sizeName), l.spoiled]),
  );
  const replaced = addUp(job.replacements.map((r) => readCutLines(r.lines)));
  const cells = [...spoiled.keys()].map((key) => {
    const [colorName, sizeName] = key.split("|");
    return { colorName: colorName || null, sizeName: sizeName || null };
  });
  const lines = checkLines(input.lines, cells);
  lines.forEach((l, i) => {
    const key = cellKey(l.colorName, l.sizeName);
    const left = (spoiled.get(key) ?? 0) - (replaced.get(key) ?? 0);
    if (l.quantity > left) {
      throw new AppError(
        "VALIDATION",
        `Only ${Math.max(left, 0)} spoiled pieces are left to replace there.`,
        {
          [`lines.${i}`]: [`${Math.max(left, 0)} to replace`],
        },
      );
    }
  });
  const pieces = lines.reduce((t, l) => t + l.quantity, 0);
  const report = await prisma.$transaction(async (tx) => {
    await lockRow(tx, "ProductionProject", project.id);
    const made = await tx.cuttingReport.create({
      data: {
        companyId: ctx.company.id,
        projectId: project.id,
        number: await nextDocumentNumber(tx, ctx.company.id, "CUTTING_REPORT"),
        kind: "REPLACEMENT",
        cutOn: dateColumn(input.cutOn ?? today),
        lines,
        embroideryJobId: job.id,
        note: `Replaces ${pieces} pieces spoiled on ${job.number}`,
        createdById: ctx.user.id,
      },
      select: { id: true, number: true },
    });
    await auditInCompany(
      ctx,
      meta,
      {
        action: "CREATE",
        entityType: "CuttingReport",
        entityId: made.id,
        summary: `${made.number}: ${pieces} pieces of ${project.code} cut again to replace those spoiled on ${job.number}`,
      },
      tx,
    );
    const members = await activeMembers(ctx.company.id, tx);
    await sendInApp(
      tx,
      ctx.company.id,
      membersWith(members, ["production.manage"]).map((userId) => ({ userId })),
      {
        subject: `Replace from cutting: ${project.code}`,
        body: `${pieces} pieces spoiled on ${job.number}${job.party ? ` (${job.party.name})` : ""} are to be cut again at once (${made.number}).`,
        entityType: "ProductionProject",
        entityId: project.id,
      },
    );
    return made;
  });
  let fault: { id: string; number: string } | null = null;
  // An embroidery or print house's spoiled pieces went in its fault log as they came back.
  const loggedOnReceive = job.party ? chargesOwnSpoilage(job.party.supplierCategories) : false;
  if (input.logFault && job.partyId && !loggedOnReceive && canLogFaults(ctx)) {
    fault = await createFault(
      ctx,
      {
        supplierId: job.partyId,
        kind: "QUALITY",
        projectId: project.id,
        quantity: pieces,
        note: `${pieces} pieces spoiled on ${job.number}, replaced from cutting by ${report.number}`,
      },
      meta,
    );
  }
  return { id: report.id, number: report.number, pieces, fault };
}

/** The Fabric Fault Note: faulty fabric found at cutting, into the supplier's fault log. */
export async function fabricFaultNote(
  ctx: CompanyContext,
  projectId: string,
  raw: unknown,
  meta?: RequestMeta,
) {
  const input = fabricFaultSchema.parse(raw);
  const project = await loadProject(ctx, projectId);
  assertOpen(project);
  const need = await ctx.db.productionMaterialNeed.findFirst({
    where: {
      projectId: project.id,
      rawMaterialId: input.materialId,
      rawMaterial: { kind: "FABRIC" },
    },
    select: { id: true },
  });
  if (!need) {
    throw new AppError("VALIDATION", "Choose a fabric of this style.", {
      materialId: ["Not a fabric of the style"],
    });
  }
  return createFault(
    ctx,
    {
      supplierId: input.supplierId,
      kind: "FABRIC_FAULT",
      projectId: project.id,
      materialId: input.materialId,
      quantity: input.quantity,
      amount: input.amount ?? null,
      photoId: input.photoId ?? null,
      note: input.note,
    },
    meta,
  );
}

/** The batch's styles whose cutting or sewing is late or due soon. */
export async function batchDateWarnings(ctx: CompanyContext, batchId: string) {
  const styles = await ctx.db.productionProject.findMany({
    where: {
      batchId,
      status: { in: ["PLANNED", "ACTIVE", "ON_HOLD"] },
      OR: [{ cutBy: { not: null } }, { sewBy: { not: null } }],
    },
    select: {
      id: true,
      code: true,
      name: true,
      stage: true,
      status: true,
      targetQuantity: true,
      cutBy: true,
      sewBy: true,
    },
    orderBy: { code: "asc" },
  });
  if (styles.length === 0) return [];
  const today = localDay(new Date(), ctx.company.timezone);
  const [reports, jobs] = await Promise.all([
    ctx.db.cuttingReport.findMany({
      where: { projectId: { in: styles.map((s) => s.id) } },
      select: { projectId: true, lines: true },
    }),
    ctx.db.embroideryJob.findMany({
      where: { projectId: { in: styles.map((s) => s.id) } },
      select: { projectId: true, lines: true },
    }),
  ]);
  return styles.flatMap((s) => {
    const cut = reports
      .filter((r) => r.projectId === s.id)
      .reduce((t, r) => t + readCutLines(r.lines).reduce((u, l) => u + l.quantity, 0), 0);
    const spoiled = jobs
      .filter((j) => j.projectId === s.id)
      .reduce((t, j) => t + readEmbroideryLines(j.lines).reduce((u, l) => u + l.spoiled, 0), 0);
    const m = milestonesOf(s, cut - spoiled, today);
    return [
      milestoneWarning("Cutting", m.cutting, `${cut - spoiled} of ${s.targetQuantity} pieces cut`),
      milestoneWarning("Sewing", m.sewing),
    ]
      .filter((w): w is NonNullable<typeof w> => w !== null)
      .map((w) => ({ project: { id: s.id, code: s.code, name: s.name }, ...w }));
  });
}
