import { Prisma } from "@prisma/client";

import { localDay } from "@/lib/dates";
import type { Db } from "@/lib/db-types";
import { AppError } from "@/lib/errors";
import { prisma } from "@/lib/prisma";
import type { RequestMeta } from "@/lib/request-meta";
import { lockRow } from "@/lib/row-lock";
import { runTransaction } from "@/lib/transaction";
import { auditInCompany } from "@/modules/audit/audit.service";
import type { CompanyContext } from "@/modules/auth/context";
import { styleGrids } from "@/modules/production/material-need.service";
import { techPackGaps } from "@/modules/production/tech-pack-gaps";
import {
  assertView,
  ensureProjectTechPack,
  loadTechPack,
} from "@/modules/production/tech-pack-spec.service";
import {
  diffFabricParts,
  diffTrimsParts,
  type FabricChange,
  type FabricPart,
  readChanges,
  readFabricPart,
  readTrimsPart,
  type TrimsPart,
} from "@/modules/production/tech-pack";
import { trimsPartsOf } from "@/modules/production/tech-pack-trims.service";

/*
 * A style's tech pack approval. Its fabric part (the fabrics, their use per
 * piece and the pieces per colour and size, tech-pack.ts) is locked first when
 * the owner chose Fabric first for the order, so its fabric can be booked
 * before the rest is settled; then the whole tech pack is approved for
 * production, once no red cell is left (tech-pack-gaps.ts: a missing
 * measurement, a red AI draft line, a logo without the owner's tick). Nothing
 * is frozen: the style can still change, and what changed since the lock or
 * the approval shows in red until it is locked or approved again. Its trims
 * part (trims, collar, cuff: tech-pack-trims.service.ts) is kept on approval
 * too (v6.4.2): a change afterwards is shown with who made it and when, and
 * waits to be approved again ("Approve the trims again", or the whole tech
 * pack again); until then the style's collar, cuff and trims bookings wait,
 * and its fabric bookings do not. Read with production.view; locking and
 * approving need production.techpack.approve (the owner's by default).
 */

const trimmed = (d: Prisma.Decimal) => d.toFixed(4).replace(/\.?0+$/, "") || "0";

/** The styles' fabric parts as they are now, by project id. */
export async function fabricPartsOf(
  db: Db,
  projects: ReadonlyArray<{ id: string; targetQuantity: number }>,
): Promise<Map<string, FabricPart>> {
  const ids = projects.map((p) => p.id);
  const parts = new Map<string, FabricPart>();
  if (ids.length === 0) return parts;
  const [needs, grids] = await Promise.all([
    db.productionMaterialNeed.findMany({
      where: { projectId: { in: ids }, rawMaterial: { kind: "FABRIC" } },
      orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
      select: {
        projectId: true,
        perPiece: true,
        wastagePercent: true,
        split: true,
        placement: true,
        rawMaterial: {
          select: { code: true, name: true, specification: true, color: true, unit: true },
        },
      },
    }),
    styleGrids(db, ids),
  ]);
  for (const p of projects) {
    const grid = grids.get(p.id) ?? [];
    parts.set(p.id, {
      fabrics: needs
        .filter((n) => n.projectId === p.id)
        .map((n) => ({
          code: n.rawMaterial.code,
          name: n.rawMaterial.name,
          specification: n.rawMaterial.specification,
          colour: n.rawMaterial.color,
          unit: n.rawMaterial.unit,
          perPiece: trimmed(n.perPiece),
          wastagePercent: trimmed(n.wastagePercent),
          split: n.split,
          placement: n.placement,
        })),
      pieces:
        grid.length > 0
          ? grid.map((c) => ({ colour: c.colorName, size: c.sizeName, quantity: c.quantity }))
          : [{ colour: "All colours", size: "All sizes", quantity: p.targetQuantity }],
    });
  }
  return parts;
}

const techPackSelect = {
  status: true,
  fabricLock: true,
  fabricLockedAt: true,
  approvedPart: true,
  approvedAt: true,
  trimsPart: true,
  trimsApprovedAt: true,
  fabricLockedBy: { select: { name: true } },
  approvedBy: { select: { name: true } },
  trimsApprover: { select: { name: true } },
} satisfies Prisma.TechPackSelect;

type TechPackRow = Prisma.TechPackGetPayload<{ select: typeof techPackSelect }>;

/** Where a style's tech pack stands. */
export type TechPackState = {
  status: "DRAFT" | "APPROVED";
  /** The fabric part is locked (Fabric first), or the whole tech pack approved. */
  fabricLocked: boolean;
  fabricLockedAt: Date | null;
  fabricLockedBy: string | null;
  approvedAt: Date | null;
  approvedBy: string | null;
  /** What changed in the fabric part since it was locked or approved (shown in red). */
  changes: FabricChange[];
  /** Whether the style has any fabric in its materials per piece yet. */
  hasFabric: boolean;
  /**
   * What changed in the trims part (trims, collar, cuff) since it was approved: while
   * any did, the part waits to be approved again, and so do its trims bookings.
   */
  trimsChanges: FabricChange[];
  /** When its trims part was last approved, and by whom (null before an approval). */
  trimsApprovedAt: Date | null;
  trimsApprovedBy: string | null;
};

/** A tech pack's state from its row and the style's fabric and trims parts now. */
export function techPackState(
  row: TechPackRow | null,
  now: FabricPart,
  trimsNow: TrimsPart = { items: [] },
): TechPackState {
  const approved = row?.status === "APPROVED";
  const kept = readFabricPart(approved ? row?.approvedPart : row?.fabricLock);
  // A tech pack approved before v6.4.2 kept no trims part: nothing counts as changed
  // until its first change after that, which keeps the part as it was (noteTrimsChange).
  const trimsKept = approved ? readTrimsPart(row?.trimsPart) : null;
  return {
    status: approved ? "APPROVED" : "DRAFT",
    fabricLocked: Boolean(row && (approved || row.fabricLockedAt)),
    fabricLockedAt: row?.fabricLockedAt ?? null,
    fabricLockedBy: row?.fabricLockedBy?.name ?? null,
    approvedAt: approved ? row!.approvedAt : null,
    approvedBy: approved ? (row!.approvedBy?.name ?? null) : null,
    changes: kept ? diffFabricParts(kept, now) : [],
    hasFabric: now.fabrics.length > 0,
    trimsChanges: trimsKept ? diffTrimsParts(trimsKept, trimsNow) : [],
    trimsApprovedAt: approved ? (row!.trimsApprovedAt ?? row!.approvedAt) : null,
    trimsApprovedBy: !approved
      ? null
      : row!.trimsApprovedAt
        ? (row!.trimsApprover?.name ?? null)
        : (row!.approvedBy?.name ?? null),
  };
}

/** The tech pack states of styles, by project id (a style without a row is a draft). */
export async function techPackStates(
  db: Db,
  projects: ReadonlyArray<{ id: string; targetQuantity: number }>,
): Promise<Map<string, TechPackState>> {
  const ids = projects.map((p) => p.id);
  const [parts, trims, rows] = await Promise.all([
    fabricPartsOf(db, projects),
    trimsPartsOf(db, ids),
    db.techPack.findMany({
      where: { projectId: { in: ids } },
      select: { projectId: true, ...techPackSelect },
    }),
  ]);
  const byProject = new Map(rows.map((r) => [r.projectId, r]));
  return new Map(
    projects.map((p) => [
      p.id,
      techPackState(byProject.get(p.id) ?? null, parts.get(p.id)!, trims.get(p.id)!),
    ]),
  );
}

async function loadProject(ctx: CompanyContext, projectId: string) {
  const project = await ctx.db.productionProject.findUnique({
    where: { id: projectId },
    select: { id: true, code: true, name: true, status: true, targetQuantity: true },
  });
  if (!project) throw new AppError("NOT_FOUND", "Production project not found.");
  return project;
}

/** A change to the trims part, as the tech pack shows it: what, who and when. */
export type TrimsChangeEntry = {
  at: Date;
  /** The day, in the company's time zone. */
  day: string;
  by: string | null;
  changes: FabricChange[];
};

/** The changes kept to a tech pack's trims part since it was last approved, newest first. */
async function trimsChangesSince(
  db: Db,
  techPackId: string,
  since: Date | null,
  timeZone: string,
): Promise<TrimsChangeEntry[]> {
  const rows = await db.techPackChange.findMany({
    where: { techPackId, part: "TRIMS", ...(since ? { createdAt: { gt: since } } : {}) },
    orderBy: { createdAt: "desc" },
    take: 50,
    select: { createdAt: true, changes: true, changedBy: { select: { name: true } } },
  });
  return rows.map((r) => ({
    at: r.createdAt,
    day: localDay(r.createdAt, timeZone),
    by: r.changedBy?.name ?? null,
    changes: readChanges(r.changes),
  }));
}

/** A style's tech pack: its state and what this person may do with it. */
export async function getTechPack(ctx: CompanyContext, projectId: string) {
  assertView(ctx);
  const project = await loadProject(ctx, projectId);
  const linked = await ctx.db.techPack.findUnique({
    where: { projectId: project.id },
    select: { id: true, number: true },
  });
  // The style was found through the company's own client; its parts are read with it too.
  const [states, gaps] = await Promise.all([
    techPackStates(prisma, [project]),
    techPackGaps(prisma, linked?.id ?? null),
  ]);
  const state = states.get(project.id)!;
  const trimsLog =
    linked && state.trimsChanges.length > 0
      ? await trimsChangesSince(prisma, linked.id, state.trimsApprovedAt, ctx.company.timezone)
      : [];
  const may = ctx.can("production.techpack.approve");
  return {
    ...state,
    /** Who changed the trims part since it was approved, when, and what (newest first). */
    trimsLog,
    /** The style's tech pack (null until one is started or linked). */
    techPackId: linked?.id ?? null,
    number: linked?.number ?? null,
    /** A tech pack is approved through its style in production; this one has it. */
    needsProject: false as boolean,
    /** The red cells that keep it from approval (lines people can read). */
    gaps,
    can: {
      lock: may && state.hasFabric && (!state.fabricLocked || state.changes.length > 0),
      approve:
        may &&
        state.hasFabric &&
        gaps.length === 0 &&
        (state.status !== "APPROVED" || state.changes.length > 0),
      /** The trims part changed after approval: it is approved again on its own. */
      approveTrims: may && state.status === "APPROVED" && state.trimsChanges.length > 0,
    },
  };
}

export type TechPack = Awaited<ReturnType<typeof getTechPack>>;

/**
 * A tech pack's approval as its own page shows it: its style's, once linked;
 * until then a draft that waits for a style in production (nothing to lock or
 * approve without the style's fabric part).
 */
export async function getTechPackApproval(
  ctx: CompanyContext,
  tp: { id: string; number: string; project: { id: string } | null },
): Promise<TechPack> {
  if (tp.project) return getTechPack(ctx, tp.project.id);
  // The tech pack was found through the company's own client; its parts are read with it too.
  const [row, gaps] = await Promise.all([
    prisma.techPack.findUnique({ where: { id: tp.id }, select: techPackSelect }),
    techPackGaps(prisma, tp.id),
  ]);
  return {
    ...techPackState(row, { fabrics: [], pieces: [] }),
    trimsLog: [],
    techPackId: tp.id,
    number: tp.number,
    needsProject: true,
    gaps,
    can: { lock: false, approve: false, approveTrims: false },
  };
}

function assertCanApprove(ctx: CompanyContext) {
  if (!ctx.can("production.techpack.approve")) {
    throw new AppError(
      "FORBIDDEN",
      "You do not have permission to lock fabric parts or approve tech packs (production.techpack.approve).",
    );
  }
}

function assertHasFabric(code: string, part: FabricPart) {
  if (part.fabrics.length === 0) {
    throw new AppError(
      "CONFLICT",
      `${code} has no fabric in its materials per piece yet. Add its fabric first.`,
    );
  }
}

/**
 * The style's tech pack inside the transaction, with the style locked: started
 * if it has none yet, or, when a tech pack was named, refused if the link
 * changed meanwhile.
 */
async function techPackForApproval(
  ctx: CompanyContext,
  tx: Prisma.TransactionClient,
  project: { id: string; code: string },
  expected: string | undefined,
) {
  await lockRow(tx, "ProductionProject", project.id);
  if (expected) {
    const found = await tx.techPack.findUnique({
      where: { projectId: project.id },
      select: { id: true },
    });
    if (found?.id !== expected) {
      throw new AppError(
        "CONFLICT",
        `The tech pack of ${project.code} changed meanwhile. Open it again.`,
      );
    }
    return expected;
  }
  return ensureProjectTechPack(ctx, project.id, tx);
}

/**
 * Locks a style's fabric part as it is now (Fabric first): its fabric can then
 * be booked before the whole tech pack is approved. Locking again takes the
 * part's changes in.
 */
export async function lockFabricPart(
  ctx: CompanyContext,
  projectId: string,
  meta?: RequestMeta,
  techPackId?: string,
) {
  assertCanApprove(ctx);
  const project = await loadProject(ctx, projectId);
  await runTransaction(async (tx) => {
    const id = await techPackForApproval(ctx, tx, project, techPackId);
    const part = (await fabricPartsOf(tx, [project])).get(project.id)!;
    assertHasFabric(project.code, part);
    const now = new Date();
    await tx.techPack.update({
      where: { id },
      data: {
        fabricLock: part as unknown as Prisma.InputJsonValue,
        fabricLockedAt: now,
        fabricLockedById: ctx.user.id,
      },
    });
    await auditInCompany(
      ctx,
      meta,
      {
        action: "UPDATE",
        entityType: "ProductionProject",
        entityId: project.id,
        summary: `Locked the fabric part of ${project.code} (${part.fabrics
          .map((f) => f.code)
          .join(", ")})`,
      },
      tx,
    );
  });
  return getTechPack(ctx, project.id);
}

/**
 * Approves a style's tech pack for production as it is now (its fabric part
 * locked with it). Approving again takes the changes in.
 */
export async function approveTechPack(
  ctx: CompanyContext,
  projectId: string,
  meta?: RequestMeta,
  techPackId?: string,
) {
  assertCanApprove(ctx);
  const project = await loadProject(ctx, projectId);
  await runTransaction(async (tx) => {
    const id = await techPackForApproval(ctx, tx, project, techPackId);
    const part = (await fabricPartsOf(tx, [project])).get(project.id)!;
    assertHasFabric(project.code, part);
    const gaps = await techPackGaps(tx, id);
    if (gaps.length > 0) {
      throw new AppError(
        "CONFLICT",
        `${project.code} still has red cells: ${gaps.join("; ")}. Fix them on its tech pack first.`,
      );
    }
    const now = new Date();
    const kept = part as unknown as Prisma.InputJsonValue;
    const trims = (await trimsPartsOf(tx, [project.id])).get(project.id)!;
    await tx.techPack.update({
      where: { id },
      data: {
        status: "APPROVED",
        approvedPart: kept,
        approvedAt: now,
        approvedById: ctx.user.id,
        fabricLock: kept,
        fabricLockedAt: now,
        fabricLockedById: ctx.user.id,
        // Its trims, collar and cuff are approved with it.
        trimsPart: trims as unknown as Prisma.InputJsonValue,
        trimsApprovedAt: now,
        trimsApproverId: ctx.user.id,
      },
    });
    await auditInCompany(
      ctx,
      meta,
      {
        action: "UPDATE",
        entityType: "ProductionProject",
        entityId: project.id,
        summary: `Approved the tech pack of ${project.code} for production`,
      },
      tx,
    );
  });
  return getTechPack(ctx, project.id);
}

/**
 * Approves a style's trims part (trims, collar, cuff) again after it changed
 * since the tech pack was approved, as it is now: its collar, cuff and trims
 * bookings can then be approved. The fabric part is not touched (its changes
 * are approved with the whole tech pack). The people who approve tech packs
 * do it (production.techpack.approve).
 */
export async function approveTrimsPart(
  ctx: CompanyContext,
  projectId: string,
  meta?: RequestMeta,
  techPackId?: string,
) {
  assertCanApprove(ctx);
  const project = await loadProject(ctx, projectId);
  await runTransaction(async (tx) => {
    const id = await techPackForApproval(ctx, tx, project, techPackId);
    const row = await tx.techPack.findUniqueOrThrow({ where: { id }, select: techPackSelect });
    if (row.status !== "APPROVED") {
      throw new AppError(
        "CONFLICT",
        `The tech pack of ${project.code} is not approved yet. Approve the whole tech pack: its trims are approved with it.`,
      );
    }
    const trims = (await trimsPartsOf(tx, [project.id])).get(project.id)!;
    const kept = readTrimsPart(row.trimsPart);
    const changes = kept ? diffTrimsParts(kept, trims) : [];
    if (changes.length === 0) {
      throw new AppError(
        "CONFLICT",
        `The trims of ${project.code} have not changed since they were approved.`,
      );
    }
    await tx.techPack.update({
      where: { id },
      data: {
        trimsPart: trims as unknown as Prisma.InputJsonValue,
        trimsApprovedAt: new Date(),
        trimsApproverId: ctx.user.id,
      },
    });
    await auditInCompany(
      ctx,
      meta,
      {
        action: "UPDATE",
        entityType: "ProductionProject",
        entityId: project.id,
        summary: `Approved the trims of ${project.code} again (${changes
          .map((c) => c.item)
          .join(", ")})`.slice(0, 500),
      },
      tx,
    );
  });
  return getTechPack(ctx, project.id);
}

/** The style in production a tech pack is linked to; approval needs one. */
async function linkedProjectOf(ctx: CompanyContext, techPackId: string) {
  assertCanApprove(ctx);
  const tp = await loadTechPack(ctx, techPackId);
  if (!tp.project) {
    throw new AppError(
      "CONFLICT",
      `${tp.number} is not linked to a style in production yet. Link it to a production project first: its fabric part and pieces come from there.`,
    );
  }
  return { techPackId: tp.id, projectId: tp.project.id };
}

/** Locks the fabric part of a tech pack's style in production (from the tech pack's page). */
export async function lockFabricPartOf(
  ctx: CompanyContext,
  techPackId: string,
  meta?: RequestMeta,
) {
  const linked = await linkedProjectOf(ctx, techPackId);
  return lockFabricPart(ctx, linked.projectId, meta, linked.techPackId);
}

/** Approves a tech pack for its style in production (from the tech pack's page). */
export async function approveTechPackOf(
  ctx: CompanyContext,
  techPackId: string,
  meta?: RequestMeta,
) {
  const linked = await linkedProjectOf(ctx, techPackId);
  return approveTechPack(ctx, linked.projectId, meta, linked.techPackId);
}

/** Approves the trims part of a tech pack's style again (from the tech pack's page). */
export async function approveTrimsPartOf(
  ctx: CompanyContext,
  techPackId: string,
  meta?: RequestMeta,
) {
  const linked = await linkedProjectOf(ctx, techPackId);
  return approveTrimsPart(ctx, linked.projectId, meta, linked.techPackId);
}
