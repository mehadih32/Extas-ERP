import { type MeasurementUnit, Prisma, type RawMaterialKind } from "@prisma/client";
import { z } from "zod";

import { localDay } from "@/lib/dates";
import { AppError } from "@/lib/errors";
import { prisma } from "@/lib/prisma";
import type { RequestMeta } from "@/lib/request-meta";
import { runTransaction } from "@/lib/transaction";
import { auditInCompany } from "@/modules/audit/audit.service";
import type { CompanyContext } from "@/modules/auth/context";
import { assertCanKeepStore } from "@/modules/materials/access";
import { writeIssue } from "@/modules/materials/issue.service";
import { issueSchema } from "@/modules/materials/schemas";
import { listStores } from "@/modules/materials/screens.service";
import { resolveStore } from "@/modules/materials/stock";
import { PROJECT_MATERIAL_MOVES } from "@/modules/materials/usage";
import { formatQuantity } from "@/modules/materials/valuation";
import { planStyles } from "@/modules/production/material-need.service";
import { roundUpFor } from "@/modules/production/material-plan";
import { OPEN_STATUSES } from "@/modules/production/timeline";

/*
 * Issuing a master batch's materials from the store to its styles in one go,
 * colour by colour: each style's planned need of each material split over the
 * garment colours it is for, what the style already took from the store (less
 * what it gave back) and what is still to issue. Saving writes one issue note
 * (MI-) per style, all of them or none, each charging only what that style
 * took at the store's average cost; the colours are written on the note. The
 * store and Production Managers (materials.manage), as on any issue note.
 */

const ZERO = new Prisma.Decimal(0);
const TX_OPTIONS = { timeout: 60_000 };
const trimmed = (d: Prisma.Decimal) => {
  const text = d.toFixed(3).replace(/\.?0+$/, "");
  return text === "-0" || text === "" ? "0" : text;
};
const max0 = (d: Prisma.Decimal) => (d.isNegative() ? ZERO : d);

const id = z.string().min(1);

export const batchIssueSchema = z.object({
  warehouseId: id.optional(),
  date: z.iso.date().optional(),
  /** Who took the materials (the cutting master, the factory's man). */
  receivedBy: z.string().trim().max(120).nullish(),
  note: z.string().trim().max(300).nullish(),
  lines: z
    .array(
      z.object({
        projectId: id,
        materialId: id,
        /** The garment colour it is for; empty for a material shared by all colours. */
        colorName: z.string().trim().max(60).nullish(),
        quantity: z.number().positive().max(100_000_000).multipleOf(0.001),
      }),
    )
    .min(1, "Enter what goes to at least one style")
    .max(500)
    .refine(
      (lines) =>
        new Set(lines.map((l) => `${l.projectId}|${l.materialId}|${l.colorName ?? ""}`)).size ===
        lines.length,
      "List each style, material and colour once",
    ),
});

async function loadBatch(ctx: CompanyContext, batchId: string) {
  const batch = await ctx.db.productionBatch.findUnique({
    where: { id: batchId },
    select: { id: true, code: true, name: true },
  });
  if (!batch) throw new AppError("NOT_FOUND", "Master batch not found.");
  return batch;
}

/** What each of the batch's open styles holds of each material (issued less returned). */
export async function heldByStyle(db: typeof prisma, companyId: string, projectIds: string[]) {
  const rows = await db.rawMaterialMovement.groupBy({
    by: ["productionProjectId", "rawMaterialId"],
    where: {
      companyId,
      productionProjectId: { in: projectIds },
      type: { in: PROJECT_MATERIAL_MOVES },
    },
    _sum: { quantity: true },
  });
  // Issues are negative on the stock card and returns positive: what is held is the opposite.
  return new Map(
    rows.map((r) => [
      `${r.productionProjectId}|${r.rawMaterialId}`,
      ZERO.minus(r._sum.quantity ?? ZERO),
    ]),
  );
}

/**
 * The issue screen: each material the batch's open styles plan for, what is in
 * the chosen store, and per style its need by colour, what it already holds and
 * what is still to issue (shared over its colours by their need).
 */
export async function getBatchIssue(ctx: CompanyContext, batchId: string, warehouseId?: string) {
  assertCanKeepStore(ctx);
  const batch = await loadBatch(ctx, batchId);
  const styles = await ctx.db.productionProject.findMany({
    where: { batchId: batch.id, status: { in: [...OPEN_STATUSES] } },
    select: { id: true, code: true, name: true, targetQuantity: true },
    orderBy: { code: "asc" },
  });
  const stores = await listStores(ctx);
  const store =
    stores.find((s) => s.id === warehouseId) ?? stores.find((s) => s.isDefault) ?? stores[0];
  const planned = await planStyles(prisma, styles);
  const held = await heldByStyle(
    prisma,
    ctx.company.id,
    styles.map((s) => s.id),
  );
  type StyleRow = {
    projectId: string;
    code: string;
    name: string;
    needed: Prisma.Decimal;
    held: Prisma.Decimal;
    colours: Map<string, Prisma.Decimal>;
  };
  const byMaterial = new Map<
    string,
    {
      material: {
        id: string;
        code: string;
        name: string;
        kind: RawMaterialKind;
        unit: MeasurementUnit;
      };
      styles: StyleRow[];
    }
  >();
  for (const style of styles) {
    for (const need of planned.get(style.id) ?? []) {
      const entry = byMaterial.get(need.materialId) ?? {
        material: {
          id: need.material.id,
          code: need.material.code,
          name: need.material.name,
          kind: need.material.kind,
          unit: need.material.unit,
        },
        styles: [],
      };
      let row = entry.styles.find((s) => s.projectId === style.id);
      if (!row) {
        row = {
          projectId: style.id,
          code: style.code,
          name: style.name,
          needed: ZERO,
          held: held.get(`${style.id}|${need.materialId}`) ?? ZERO,
          colours: new Map(),
        };
        entry.styles.push(row);
      }
      row.needed = row.needed.plus(need.total);
      for (const part of need.parts) {
        const key = part.colorName ?? "";
        row.colours.set(key, (row.colours.get(key) ?? ZERO).plus(part.quantity));
      }
      byMaterial.set(need.materialId, entry);
    }
  }
  const ids = [...byMaterial.keys()];
  const inStore = store
    ? new Map(
        (
          await ctx.db.rawMaterialStock.findMany({
            where: { warehouseId: store.id, rawMaterialId: { in: ids } },
            select: { rawMaterialId: true, quantity: true },
          })
        ).map((s) => [s.rawMaterialId, s.quantity]),
      )
    : new Map<string, Prisma.Decimal>();
  const materials = [...byMaterial.values()]
    .sort(
      (a, b) =>
        KIND_ORDER.indexOf(a.material.kind) - KIND_ORDER.indexOf(b.material.kind) ||
        a.material.code.localeCompare(b.material.code),
    )
    .map((entry) => {
      const unit = entry.material.unit;
      const rows = entry.styles.map((s) => {
        const toIssue = max0(s.needed.minus(s.held));
        const share = s.needed.gt(0) ? toIssue.dividedBy(s.needed) : ZERO;
        const colours = [...s.colours.entries()]
          .filter(([, q]) => q.gt(0))
          .map(([colorName, needed]) => ({
            colorName: colorName || null,
            needed: trimmed(needed),
            toIssue: trimmed(roundUpFor(unit, needed.times(share))),
          }));
        return {
          projectId: s.projectId,
          code: s.code,
          name: s.name,
          needed: trimmed(s.needed),
          held: trimmed(s.held),
          toIssue: trimmed(toIssue),
          colours:
            colours.length > 0
              ? colours
              : [
                  {
                    colorName: null,
                    needed: trimmed(s.needed),
                    toIssue: trimmed(roundUpFor(unit, toIssue)),
                  },
                ],
        };
      });
      const needed = entry.styles.reduce((t, s) => t.plus(s.needed), ZERO);
      const heldAll = entry.styles.reduce((t, s) => t.plus(s.held), ZERO);
      const toIssue = entry.styles.reduce((t, s) => t.plus(max0(s.needed.minus(s.held))), ZERO);
      const stock = inStore.get(entry.material.id) ?? ZERO;
      return {
        material: entry.material,
        inStore: trimmed(stock),
        needed: trimmed(needed),
        held: trimmed(heldAll),
        toIssue: trimmed(toIssue),
        /** The store has less than what is still to issue. */
        short: toIssue.gt(stock),
        styles: rows,
      };
    });
  return {
    batch,
    today: localDay(new Date(), ctx.company.timezone),
    stores: stores.map((s) => ({ id: s.id, name: s.name, isDefault: s.isDefault })),
    storeId: store?.id ?? "",
    styles: styles.map((s) => ({ id: s.id, code: s.code, name: s.name })),
    materials,
  };
}

const KIND_ORDER = ["FABRIC", "TRIM", "ACCESSORY", "PACKAGING", "OTHER"];

export type BatchIssue = Awaited<ReturnType<typeof getBatchIssue>>;

/**
 * Issues to the batch's styles: one issue note per style with its materials
 * (each the sum over its colours), the colours written on the note. All the
 * notes are saved together or none is, so a store short of one material stops
 * the lot with the store's figure.
 */
export async function issueToStyles(
  ctx: CompanyContext,
  batchId: string,
  raw: unknown,
  meta?: RequestMeta,
) {
  const input = batchIssueSchema.parse(raw);
  assertCanKeepStore(ctx);
  const batch = await loadBatch(ctx, batchId);
  const today = localDay(new Date(), ctx.company.timezone);
  if (input.date && input.date > today) {
    throw new AppError("VALIDATION", "Materials cannot be issued on a later day.", {
      date: ["Choose today or an earlier day"],
    });
  }
  const projectIds = [...new Set(input.lines.map((l) => l.projectId))];
  const projects = await ctx.db.productionProject.findMany({
    where: { id: { in: projectIds }, batchId: batch.id },
    select: { id: true, code: true },
  });
  if (projects.length !== projectIds.length) {
    throw new AppError("VALIDATION", `Each line must be for a style of ${batch.code}.`, {
      lines: ["Choose a style of this batch"],
    });
  }
  const materials = new Map(
    (
      await ctx.db.rawMaterial.findMany({
        where: { id: { in: [...new Set(input.lines.map((l) => l.materialId))] } },
        select: { id: true, code: true, unit: true },
      })
    ).map((m) => [m.id, m]),
  );
  if (materials.size !== new Set(input.lines.map((l) => l.materialId)).size) {
    throw new AppError("NOT_FOUND", "Raw material not found.");
  }
  const store = await resolveStore(ctx, input.warehouseId);

  // Per style: each material's total, and what went to each colour for the note.
  const perStyle = projects
    .sort((a, b) => a.code.localeCompare(b.code))
    .map((p) => {
      const lines = input.lines.filter((l) => l.projectId === p.id);
      const byMaterial = new Map<string, { total: Prisma.Decimal; colours: string[] }>();
      for (const l of lines) {
        const m = materials.get(l.materialId)!;
        const entry = byMaterial.get(m.id) ?? { total: ZERO, colours: [] };
        entry.total = entry.total.plus(l.quantity);
        if (l.colorName) {
          entry.colours.push(`${l.colorName} ${formatQuantity(l.quantity, m.unit)}`);
        }
        byMaterial.set(m.id, entry);
      }
      const colourText = [...byMaterial.entries()]
        .filter(([, e]) => e.colours.length > 0)
        .map(([mid, e]) => `${materials.get(mid)!.code}: ${e.colours.join(", ")}`)
        .join("; ");
      const note = [
        `${batch.code} batch issue`,
        colourText ? `by colour ${colourText}` : null,
        input.note || null,
      ]
        .filter(Boolean)
        .join(". ");
      return {
        project: p,
        issue: issueSchema.parse({
          projectId: p.id,
          warehouseId: store.id,
          date: input.date,
          receivedBy: input.receivedBy ?? undefined,
          note: note.length > 1000 ? `${note.slice(0, 997)}...` : note,
          lines: [...byMaterial.entries()].map(([materialId, e]) => ({
            materialId,
            quantity: e.total.toNumber(),
          })),
        }),
      };
    });

  const made = await runTransaction(async (tx) => {
    const out: Array<{ id: string; project: string }> = [];
    for (const s of perStyle) {
      out.push({ id: await writeIssue(tx, ctx, s.issue, store, meta), project: s.project.code });
    }
    const numbers = await tx.materialIssue.findMany({
      where: { id: { in: out.map((o) => o.id) } },
      select: { id: true, number: true },
    });
    const numberOf = new Map(numbers.map((n) => [n.id, n.number]));
    const notes = out.map((o) => ({ id: o.id, number: numberOf.get(o.id)!, project: o.project }));
    await auditInCompany(
      ctx,
      meta,
      {
        action: "CREATE",
        entityType: "ProductionBatch",
        entityId: batch.id,
        summary: `Issued ${batch.code}'s materials to its styles from ${store.name}: ${notes
          .map((n) => `${n.number} to ${n.project}`)
          .join(", ")}`,
      },
      tx,
    );
    return notes;
  }, TX_OPTIONS);
  return { batch: { id: batch.id, code: batch.code }, issues: made };
}
