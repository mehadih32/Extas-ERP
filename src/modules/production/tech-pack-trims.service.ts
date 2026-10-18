import { Prisma } from "@prisma/client";

import type { Db } from "@/lib/db-types";
import { diffTrimsParts, type TrimsPart } from "@/modules/production/tech-pack";

/*
 * A style's trims part (v6.4.2): its trims, collar, cuff and the rest of its
 * materials per piece that are not fabric. The tech pack keeps it when it is
 * approved. A change to it afterwards is kept with who made it and when
 * (TechPackChange) and shows on the tech pack, and the part waits to be
 * approved again by someone who approves tech packs: until then the style's
 * collar, cuff and trims bookings wait too (the owner's override with a
 * reason still works). Fabric is the fabric part's (tech-pack.ts) and its
 * bookings do not wait for this.
 */

type Tx = Prisma.TransactionClient;

const trimmed = (d: Prisma.Decimal) => d.toFixed(4).replace(/\.?0+$/, "") || "0";

/** The styles' trims parts as they are now, by project id. */
export async function trimsPartsOf(db: Db, projectIds: readonly string[]) {
  const parts = new Map<string, TrimsPart>(projectIds.map((id) => [id, { items: [] }]));
  if (projectIds.length === 0) return parts;
  const needs = await db.productionMaterialNeed.findMany({
    where: { projectId: { in: [...projectIds] }, rawMaterial: { kind: { not: "FABRIC" } } },
    orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
    select: {
      projectId: true,
      perPiece: true,
      wastagePercent: true,
      split: true,
      placement: true,
      notes: true,
      imageId: true,
      rawMaterial: {
        select: {
          code: true,
          name: true,
          kind: true,
          specification: true,
          color: true,
          unit: true,
        },
      },
    },
  });
  const seen = new Map<string, number>();
  for (const n of needs) {
    // The same trim used twice (a label at the neck and the side) keeps two items apart.
    const key = `${n.projectId}|${n.rawMaterial.code}`;
    const count = (seen.get(key) ?? 0) + 1;
    seen.set(key, count);
    parts.get(n.projectId)!.items.push({
      code: count === 1 ? n.rawMaterial.code : `${n.rawMaterial.code} (${count})`,
      name: n.rawMaterial.name,
      kind: n.rawMaterial.kind,
      specification: n.rawMaterial.specification,
      colour: n.rawMaterial.color,
      unit: n.rawMaterial.unit,
      perPiece: trimmed(n.perPiece),
      wastagePercent: trimmed(n.wastagePercent),
      split: n.split,
      placement: n.placement,
      notes: n.notes,
      imageId: n.imageId,
    });
  }
  return parts;
}

/**
 * After a style's materials per piece changed (inside the same transaction,
 * with the style locked): when its tech pack is approved, what changed in its
 * trims part is kept with who changed it. A tech pack approved before v6.4.2
 * kept no trims part: the part as it was just before this change is taken as
 * the approved one, so this change and every later one counts.
 */
export async function noteTrimsChange(
  tx: Tx,
  input: {
    companyId: string;
    projectId: string;
    userId: string;
    /** The trims part just before the change. */
    before: TrimsPart;
  },
) {
  const techPack = await tx.techPack.findUnique({
    where: { projectId: input.projectId },
    select: { id: true, status: true, trimsPart: true, approvedAt: true, approvedById: true },
  });
  if (!techPack || techPack.status !== "APPROVED") return null;
  if (!techPack.trimsPart) {
    await tx.techPack.update({
      where: { id: techPack.id },
      data: {
        trimsPart: input.before as unknown as Prisma.InputJsonValue,
        trimsApprovedAt: techPack.approvedAt,
        trimsApproverId: techPack.approvedById,
      },
    });
  }
  const after = (await trimsPartsOf(tx, [input.projectId])).get(input.projectId)!;
  const changes = diffTrimsParts(input.before, after);
  if (changes.length === 0) return null;
  await tx.techPackChange.create({
    data: {
      companyId: input.companyId,
      techPackId: techPack.id,
      part: "TRIMS",
      changes: changes as unknown as Prisma.InputJsonValue,
      changedById: input.userId,
      // The app's clock, as the approval's (trimsApprovedAt), so "since" compares alike.
      createdAt: new Date(),
    },
  });
  return changes;
}
