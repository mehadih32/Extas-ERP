import { Prisma } from "@prisma/client";

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
  diffFabricParts,
  type FabricChange,
  type FabricPart,
  readFabricPart,
} from "@/modules/production/tech-pack";

/*
 * A style's tech pack approval. Its fabric part (the fabrics, their use per
 * piece and the pieces per colour and size, tech-pack.ts) is locked first when
 * the owner chose Fabric first for the order, so its fabric can be booked
 * before the rest is settled; then the whole tech pack is approved for
 * production, once no red cell is left (tech-pack-gaps.ts: a missing
 * measurement, a red AI draft line, a logo without the owner's tick). Nothing
 * is frozen: the style can still change, and what changed since the lock or
 * the approval shows in red until it is locked or approved again. Read with
 * production.view; locking and approving need production.techpack.approve
 * (the owner's by default).
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
  fabricLockedBy: { select: { name: true } },
  approvedBy: { select: { name: true } },
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
};

/** A tech pack's state from its row and the style's fabric part now. */
export function techPackState(row: TechPackRow | null, now: FabricPart): TechPackState {
  const approved = row?.status === "APPROVED";
  const kept = readFabricPart(approved ? row?.approvedPart : row?.fabricLock);
  return {
    status: approved ? "APPROVED" : "DRAFT",
    fabricLocked: Boolean(row && (approved || row.fabricLockedAt)),
    fabricLockedAt: row?.fabricLockedAt ?? null,
    fabricLockedBy: row?.fabricLockedBy?.name ?? null,
    approvedAt: approved ? row!.approvedAt : null,
    approvedBy: approved ? (row!.approvedBy?.name ?? null) : null,
    changes: kept ? diffFabricParts(kept, now) : [],
    hasFabric: now.fabrics.length > 0,
  };
}

/** The tech pack states of styles, by project id (a style without a row is a draft). */
export async function techPackStates(
  db: Db,
  projects: ReadonlyArray<{ id: string; targetQuantity: number }>,
): Promise<Map<string, TechPackState>> {
  const [parts, rows] = await Promise.all([
    fabricPartsOf(db, projects),
    db.techPack.findMany({
      where: { projectId: { in: projects.map((p) => p.id) } },
      select: { projectId: true, ...techPackSelect },
    }),
  ]);
  const byProject = new Map(rows.map((r) => [r.projectId, r]));
  return new Map(
    projects.map((p) => [p.id, techPackState(byProject.get(p.id) ?? null, parts.get(p.id)!)]),
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

/** A style's tech pack: its state and what this person may do with it. */
export async function getTechPack(ctx: CompanyContext, projectId: string) {
  const project = await loadProject(ctx, projectId);
  // The style was found through the company's own client; its parts are read with it too.
  const [states, gaps] = await Promise.all([
    techPackStates(prisma, [project]),
    techPackGaps(prisma, project.id),
  ]);
  const state = states.get(project.id)!;
  const may = ctx.can("production.techpack.approve");
  return {
    ...state,
    /** The red cells that keep it from approval (lines people can read). */
    gaps,
    can: {
      lock: may && state.hasFabric && (!state.fabricLocked || state.changes.length > 0),
      approve:
        may &&
        state.hasFabric &&
        gaps.length === 0 &&
        (state.status !== "APPROVED" || state.changes.length > 0),
    },
  };
}

export type TechPack = Awaited<ReturnType<typeof getTechPack>>;

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
 * Locks a style's fabric part as it is now (Fabric first): its fabric can then
 * be booked before the whole tech pack is approved. Locking again takes the
 * part's changes in.
 */
export async function lockFabricPart(ctx: CompanyContext, projectId: string, meta?: RequestMeta) {
  assertCanApprove(ctx);
  const project = await loadProject(ctx, projectId);
  await runTransaction(async (tx) => {
    await lockRow(tx, "ProductionProject", project.id);
    const part = (await fabricPartsOf(tx, [project])).get(project.id)!;
    assertHasFabric(project.code, part);
    const now = new Date();
    const lock = part as unknown as Prisma.InputJsonValue;
    await tx.techPack.upsert({
      where: { projectId: project.id },
      create: {
        companyId: ctx.company.id,
        projectId: project.id,
        fabricLock: lock,
        fabricLockedAt: now,
        fabricLockedById: ctx.user.id,
      },
      update: { fabricLock: lock, fabricLockedAt: now, fabricLockedById: ctx.user.id },
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
export async function approveTechPack(ctx: CompanyContext, projectId: string, meta?: RequestMeta) {
  assertCanApprove(ctx);
  const project = await loadProject(ctx, projectId);
  await runTransaction(async (tx) => {
    await lockRow(tx, "ProductionProject", project.id);
    const part = (await fabricPartsOf(tx, [project])).get(project.id)!;
    assertHasFabric(project.code, part);
    const gaps = await techPackGaps(tx, project.id);
    if (gaps.length > 0) {
      throw new AppError(
        "CONFLICT",
        `${project.code} still has red cells: ${gaps.join("; ")}. Fix them on its tech pack first.`,
      );
    }
    const now = new Date();
    const kept = part as unknown as Prisma.InputJsonValue;
    const approved = {
      status: "APPROVED" as const,
      approvedPart: kept,
      approvedAt: now,
      approvedById: ctx.user.id,
      fabricLock: kept,
      fabricLockedAt: now,
      fabricLockedById: ctx.user.id,
    };
    await tx.techPack.upsert({
      where: { projectId: project.id },
      create: { companyId: ctx.company.id, projectId: project.id, ...approved },
      update: approved,
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
