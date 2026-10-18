import { Prisma } from "@prisma/client";

import { localDay } from "@/lib/dates";
import type { Db } from "@/lib/db-types";
import { AppError } from "@/lib/errors";
import { formatDay } from "@/lib/format";
import { prisma } from "@/lib/prisma";
import type { RequestMeta } from "@/lib/request-meta";
import { lockRow } from "@/lib/row-lock";
import { aiText } from "@/modules/ai/ai-text";
import { auditInCompany } from "@/modules/audit/audit.service";
import type { CompanyContext } from "@/modules/auth/context";
import { loadActiveMaterials } from "@/modules/materials/stock";
import {
  assertMaterialImages,
  dropUnusedMaterialImages,
} from "@/modules/production/material-image.service";
import { type GridCell, type NeedPart, planNeed } from "@/modules/production/material-plan";
import { isProjectClosed } from "@/modules/production/project-costs";
import { setMaterialNeedsSchema, techPackNotesSchema } from "@/modules/production/schemas";
import { noteTrimsChange, trimsPartsOf } from "@/modules/production/tech-pack-trims.service";

/*
 * A style's "Materials per piece" (its bill of materials): what one piece takes
 * of each raw material, with the wastage ordered on top, how it is ordered (one
 * total, per colour, or per colour and size for collars and cuffs), where it
 * goes and a picture. With the style's pieces per colour and size it says what
 * to order, and the purchase orders made for its batch say how much of that is
 * ordered already. Read with production.view, changed with production.manage;
 * no prices, so the store and the factory may see it too.
 */

const ZERO = new Prisma.Decimal(0);

export const needMaterialSelect = {
  id: true,
  code: true,
  name: true,
  kind: true,
  unit: true,
  color: true,
  specification: true,
  supplier: { select: { id: true, code: true, name: true } },
} satisfies Prisma.RawMaterialSelect;

/** The styles' pieces per colour and size, in the company's colour and size order. */
export async function styleGrids(db: Db, projectIds: string[]) {
  const rows = await db.productionTargetLine.findMany({
    where: { projectId: { in: projectIds } },
    select: {
      projectId: true,
      quantity: true,
      variant: {
        select: {
          color: { select: { name: true, sortOrder: true } },
          size: { select: { name: true, sortOrder: true } },
        },
      },
    },
  });
  rows.sort(
    (a, b) =>
      a.variant.color.sortOrder - b.variant.color.sortOrder ||
      a.variant.color.name.localeCompare(b.variant.color.name) ||
      a.variant.size.sortOrder - b.variant.size.sortOrder ||
      a.variant.size.name.localeCompare(b.variant.size.name),
  );
  const grids = new Map<string, GridCell[]>();
  for (const r of rows) {
    const grid = grids.get(r.projectId) ?? [];
    grid.push({
      colorName: r.variant.color.name,
      sizeName: r.variant.size.name,
      quantity: r.quantity,
    });
    grids.set(r.projectId, grid);
  }
  return grids;
}

const orderedKey = (projectId: string, materialId: string) => `${projectId}|${materialId}`;

/**
 * What is on purchase orders for the styles, by style and material: their shares
 * of batch orders, and the lines of orders made for the style itself. Cancelled
 * orders count nothing; one closed early counts what arrived.
 */
export async function orderedFor(db: Db, projectIds: string[]) {
  const ordered = new Map<string, Prisma.Decimal>();
  const add = (projectId: string, materialId: string, quantity: Prisma.Decimal) => {
    const key = orderedKey(projectId, materialId);
    ordered.set(key, (ordered.get(key) ?? ZERO).plus(quantity));
  };
  const arrived = (line: { quantity: Prisma.Decimal; receivedQty: Prisma.Decimal }) =>
    line.quantity.gt(0) ? line.receivedQty.dividedBy(line.quantity) : ZERO;
  if (projectIds.length === 0) return ordered;
  const [shares, lines] = await Promise.all([
    db.purchaseOrderLineShare.findMany({
      where: { projectId: { in: projectIds }, line: { order: { status: { not: "CANCELLED" } } } },
      select: {
        projectId: true,
        quantity: true,
        line: {
          select: {
            rawMaterialId: true,
            quantity: true,
            receivedQty: true,
            order: { select: { status: true } },
          },
        },
      },
    }),
    db.purchaseOrderLine.findMany({
      where: {
        shares: { none: {} },
        order: { projectId: { in: projectIds }, status: { not: "CANCELLED" } },
      },
      select: {
        rawMaterialId: true,
        quantity: true,
        receivedQty: true,
        order: { select: { projectId: true, status: true } },
      },
    }),
  ]);
  for (const s of shares) {
    const closed = s.line.order.status === "CLOSED";
    add(s.projectId, s.line.rawMaterialId, closed ? s.quantity.times(arrived(s.line)) : s.quantity);
  }
  for (const l of lines) {
    add(
      l.order.projectId!,
      l.rawMaterialId,
      l.order.status === "CLOSED" ? l.receivedQty : l.quantity,
    );
  }
  return ordered;
}

/**
 * Hands what is ordered of each material to the style's needs of it in turn
 * (one material can be needed twice, say rib for the collar and the cuffs): how
 * much of each need is covered.
 */
export function coverNeeds<T extends { materialId: string; total: Prisma.Decimal }>(
  needs: readonly T[],
  ordered: (materialId: string) => Prisma.Decimal,
) {
  const left = new Map<string, Prisma.Decimal>();
  return needs.map((need) => {
    const available = left.get(need.materialId) ?? ordered(need.materialId);
    const covered = Prisma.Decimal.min(available, need.total);
    left.set(need.materialId, available.minus(covered));
    return { ...need, covered, toOrder: need.total.minus(covered) };
  });
}

/** A need with what the style's pieces make of it. */
export type PlannedNeed = {
  id: string;
  materialId: string;
  material: Prisma.RawMaterialGetPayload<{ select: typeof needMaterialSelect }>;
  perPiece: Prisma.Decimal;
  wastagePercent: Prisma.Decimal;
  split: "TOTAL" | "COLOUR" | "COLOUR_SIZE";
  placement: string | null;
  imageId: string | null;
  notes: string | null;
  parts: NeedPart[];
  total: Prisma.Decimal;
  covered: Prisma.Decimal;
  toOrder: Prisma.Decimal;
};

/** The styles' needs worked out over their pieces, with what is ordered, by style. */
export async function planStyles(
  db: Db,
  styles: ReadonlyArray<{ id: string; targetQuantity: number }>,
): Promise<Map<string, PlannedNeed[]>> {
  const ids = styles.map((s) => s.id);
  const [needs, grids, ordered] = await Promise.all([
    db.productionMaterialNeed.findMany({
      where: { projectId: { in: ids } },
      include: { rawMaterial: { select: needMaterialSelect } },
      orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
    }),
    styleGrids(db, ids),
    orderedFor(db, ids),
  ]);
  const planned = new Map<string, PlannedNeed[]>();
  for (const style of styles) {
    const grid = grids.get(style.id) ?? [];
    const rows = needs
      .filter((n) => n.projectId === style.id)
      .map((n) => {
        const plan = planNeed(n, n.rawMaterial.unit, grid, style.targetQuantity);
        return {
          id: n.id,
          materialId: n.rawMaterialId,
          material: n.rawMaterial,
          perPiece: n.perPiece,
          wastagePercent: n.wastagePercent,
          split: n.split,
          placement: n.placement,
          imageId: n.imageId,
          notes: n.notes,
          parts: plan.parts,
          total: plan.total,
        };
      });
    planned.set(
      style.id,
      coverNeeds(rows, (materialId) => ordered.get(orderedKey(style.id, materialId)) ?? ZERO),
    );
  }
  return planned;
}

const styleSelect = {
  id: true,
  code: true,
  name: true,
  status: true,
  targetQuantity: true,
  targetDate: true,
  techPackNotes: true,
  notes: true,
  factoryName: true,
  factory: { select: { id: true, name: true, phone: true, address: true, city: true } },
  buyer: { select: { id: true, name: true } },
  style: { select: { id: true, code: true, name: true } },
  category: { select: { name: true } },
  batch: { select: { id: true, code: true, name: true, kind: true } },
} satisfies Prisma.ProductionProjectSelect;

/** Changing a style's materials list and making notes is production.manage's. */
function assertCanManage(ctx: CompanyContext) {
  if (!ctx.can("production.manage")) {
    throw new AppError(
      "FORBIDDEN",
      "You do not have permission to change a style's materials (production.manage).",
    );
  }
}

async function loadStyle(ctx: CompanyContext, projectId: string) {
  const project = await ctx.db.productionProject.findUnique({
    where: { id: projectId },
    select: styleSelect,
  });
  if (!project) throw new AppError("NOT_FOUND", "Production project not found.");
  return project;
}

/** A style's materials per piece, what they come to and what is ordered, and its grid. */
export async function getMaterialNeeds(ctx: CompanyContext, projectId: string) {
  const project = await loadStyle(ctx, projectId);
  const [planned, grids] = await Promise.all([
    planStyles(prisma, [project]),
    styleGrids(prisma, [project.id]),
  ]);
  return {
    project,
    grid: grids.get(project.id) ?? [],
    needs: planned.get(project.id) ?? [],
  };
}

export type MaterialNeeds = Awaited<ReturnType<typeof getMaterialNeeds>>;

function assertOpen(project: {
  code: string;
  status: Parameters<typeof isProjectClosed>[0]["status"];
}) {
  if (isProjectClosed(project)) {
    throw new AppError(
      "CONFLICT",
      `${project.code} is ${project.status.toLowerCase()}; its materials can no longer change.`,
    );
  }
}

/**
 * Replaces a style's materials per piece (an empty list clears them). Pictures
 * no need points to any more are deleted.
 */
export async function setMaterialNeeds(
  ctx: CompanyContext,
  projectId: string,
  raw: unknown,
  meta?: RequestMeta,
) {
  assertCanManage(ctx);
  const { needs } = setMaterialNeedsSchema.parse(raw);
  const project = await loadStyle(ctx, projectId);
  assertOpen(project);
  const materials =
    needs.length > 0
      ? await loadActiveMaterials(
          ctx,
          needs.map((n) => n.materialId),
        )
      : new Map();
  await assertMaterialImages(
    ctx,
    needs.map((n) => n.imageId),
  );
  const before = await prisma.$transaction(async (tx) => {
    await lockRow(tx, "ProductionProject", project.id);
    const old = await tx.productionMaterialNeed.findMany({
      where: { projectId: project.id },
      select: { imageId: true },
    });
    // The trims part before the change: once the tech pack is approved, a change waits
    // to be approved again (tech-pack-trims.service.ts).
    const trimsBefore = (await trimsPartsOf(tx, [project.id])).get(project.id)!;
    await tx.productionMaterialNeed.deleteMany({ where: { projectId: project.id } });
    if (needs.length > 0) {
      await tx.productionMaterialNeed.createMany({
        data: needs.map((n, i) => ({
          companyId: ctx.company.id,
          projectId: project.id,
          rawMaterialId: n.materialId,
          perPiece: new Prisma.Decimal(n.perPiece),
          wastagePercent: new Prisma.Decimal(n.wastagePercent ?? 0),
          split: n.split ?? "TOTAL",
          placement: n.placement ?? null,
          imageId: n.imageId ?? null,
          notes: n.notes ?? null,
          sortOrder: i,
        })),
      });
    }
    await auditInCompany(
      ctx,
      meta,
      {
        action: "UPDATE",
        entityType: "ProductionProject",
        entityId: project.id,
        summary:
          needs.length === 0
            ? `Cleared the materials per piece of ${project.code}`
            : `Materials per piece of ${project.code}: ${needs
                .map((n) => `${materials.get(n.materialId)!.code} ${n.perPiece}`)
                .join(", ")}`.slice(0, 500),
      },
      tx,
    );
    const trimsChanged = await noteTrimsChange(tx, {
      companyId: ctx.company.id,
      projectId: project.id,
      userId: ctx.user.id,
      before: trimsBefore,
    });
    if (trimsChanged) {
      await auditInCompany(
        ctx,
        meta,
        {
          action: "UPDATE",
          entityType: "ProductionProject",
          entityId: project.id,
          summary:
            `The trims of ${project.code} changed after its tech pack was approved (${trimsChanged
              .map((c) => c.item)
              .join(", ")}): they wait to be approved again`.slice(0, 500),
        },
        tx,
      );
    }
    return old.map((o) => o.imageId);
  });
  await dropUnusedMaterialImages(prisma, before);
  return getMaterialNeeds(ctx, project.id);
}

/** Saves the making notes printed on the tech pack. */
export async function setTechPackNotes(
  ctx: CompanyContext,
  projectId: string,
  raw: unknown,
  meta?: RequestMeta,
) {
  assertCanManage(ctx);
  const { notes } = techPackNotesSchema.parse(raw);
  const project = await loadStyle(ctx, projectId);
  assertOpen(project);
  await prisma.$transaction(async (tx) => {
    await tx.productionProject.update({
      where: { id: project.id },
      data: { techPackNotes: notes || null },
    });
    await auditInCompany(
      ctx,
      meta,
      {
        action: "UPDATE",
        entityType: "ProductionProject",
        entityId: project.id,
        summary: notes
          ? `Tech pack notes of ${project.code} saved (${notes.length} characters)`
          : `Cleared the tech pack notes of ${project.code}`,
      },
      tx,
    );
  });
  return { id: project.id, code: project.code };
}

// --- Tech pack notes ----------------------------------------------------------------

const UNIT_WORDS: Record<string, string> = {
  PCS: "pcs",
  METER: "m",
  YARD: "yd",
  KG: "kg",
  GRAM: "g",
  ROLL: "roll",
  DOZEN: "dozen",
  GROSS: "gross",
  CONE: "cone",
  SET: "set",
  LB: "lb",
};

const trim = (d: Prisma.Decimal, places: number) => {
  const text = d.toFixed(places).replace(/\.?0+$/, "");
  return text === "-0" ? "0" : text;
};

/** "0.285 kg a piece + 5%", "3 a piece" (pieces need no unit). */
export function perPieceText(need: {
  perPiece: Prisma.Decimal;
  wastagePercent: Prisma.Decimal;
  material: { unit: string };
}) {
  const unit =
    need.material.unit === "PCS"
      ? ""
      : ` ${UNIT_WORDS[need.material.unit] ?? need.material.unit.toLowerCase()}`;
  const waste = need.wastagePercent.gt(0) ? ` + ${trim(need.wastagePercent, 2)}%` : "";
  return `${trim(need.perPiece, 4)}${unit} a piece${waste}`;
}

/** The colours and sizes on a grid, each once, in order. */
export function gridAxes(grid: readonly GridCell[]) {
  const colours: string[] = [];
  const sizes: string[] = [];
  for (const c of grid) {
    if (!colours.includes(c.colorName)) colours.push(c.colorName);
    if (!sizes.includes(c.sizeName)) sizes.push(c.sizeName);
  }
  return { colours, sizes };
}

/** Making notes from the facts alone, when AI is not set up or does not answer. */
export function ruleTechPackNotes(data: MaterialNeeds, tz: string): string {
  const { project: p, grid, needs } = data;
  const { colours, sizes } = gridAxes(grid);
  const lines: string[] = [];
  lines.push(
    `${p.name}: ${p.targetQuantity} pieces${
      colours.length > 0 ? ` in ${colours.join(", ")}` : ""
    }${sizes.length > 0 ? `, sizes ${sizes.join(", ")}` : ""}.`,
  );
  const fabrics = needs.filter((n) => n.material.kind === "FABRIC");
  const trims = needs.filter((n) => n.material.kind !== "FABRIC");
  for (const f of fabrics) {
    const spec = f.material.specification ? ` (${f.material.specification})` : "";
    lines.push(
      `${f.placement ?? "Fabric"}: ${f.material.name}${spec}, ${perPieceText(f)}${
        f.split === "COLOUR_SIZE" ? ", knitted to each colour and size" : ""
      }.`,
    );
  }
  for (const t of trims) {
    lines.push(
      `${t.placement ?? "Trim"}: ${t.material.name}, ${perPieceText(t)}${t.notes ? `. ${t.notes}` : ""}.`,
    );
  }
  if (needs.some((n) => n.split === "COLOUR_SIZE")) {
    lines.push("Match each collar and cuff to its body colour and size before sewing.");
  }
  lines.push("Check the first pieces of each size against the size chart before bulk cutting.");
  lines.push("Keep the cut panels of each colour together and count them on the cutting report.");
  if (p.targetDate) lines.push(`Finish by ${formatDay(localDay(p.targetDate, tz))}.`);
  return lines.map((l) => `• ${l}`).join("\n");
}

/**
 * A first draft of the making notes for the tech pack, from the style, its
 * pieces and its materials per piece: worded by AI when it is set up (only these
 * facts are sent, no prices or names of people), otherwise from rules.
 */
export async function draftTechPackNotes(ctx: CompanyContext, projectId: string) {
  const data = await getMaterialNeeds(ctx, projectId);
  const { project: p, grid, needs } = data;
  const { colours, sizes } = gridAxes(grid);
  const ai = await aiText(
    ctx.company.id,
    {
      why: `Making notes for the tech pack of ${p.code}`,
      record: { type: "ProductionProject", id: p.id, label: p.code },
      instructions:
        "You write the making notes on a garment tech pack for a factory in Bangladesh. " +
        "Use plain, short English a factory supervisor understands. Write 6 to 10 bullet lines " +
        "starting with '• ': fabric and where it goes, trims and their placement, collar and cuff " +
        "matching, stitching and finishing checks, measurement checks before bulk cutting, and " +
        "packing. Use only the facts given; do not invent measurements or prices.",
      facts: {
        style: p.name,
        category: p.category?.name ?? null,
        pieces: p.targetQuantity,
        colours,
        sizes,
        finishBy: p.targetDate ? localDay(p.targetDate, ctx.company.timezone) : null,
        materials: needs.map((n) => ({
          material: n.material.name,
          kind: n.material.kind,
          specification: n.material.specification,
          colour: n.material.color,
          perPiece: perPieceText(n),
          placement: n.placement,
          orderedBy: n.split,
          notes: n.notes,
        })),
        projectNotes: p.notes?.slice(0, 600) ?? null,
      },
      maxTokens: 500,
      maxChars: 2000,
    },
    ctx.user.id,
  );
  return ai
    ? { text: ai, byAi: true }
    : { text: ruleTechPackNotes(data, ctx.company.timezone), byAi: false };
}
