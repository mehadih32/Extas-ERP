import type { Prisma, ProductionStatus } from "@prisma/client";
import { z } from "zod";

import { localDay } from "@/lib/dates";
import { AppError } from "@/lib/errors";
import type { RequestMeta } from "@/lib/request-meta";
import { lockRow } from "@/lib/row-lock";
import { runTransaction } from "@/lib/transaction";
import { auditInCompany } from "@/modules/audit/audit.service";
import type { CompanyContext } from "@/modules/auth/context";
import { deleteStoredFile, storeUpload } from "@/modules/files/file.service";
import { isWalkIn } from "@/modules/parties/walk-in";
import { isProjectClosed } from "@/modules/production/project-costs";
import { referenceSchema } from "@/modules/production/tech-pack-files.service";
import {
  assertCanChange,
  assertManage,
  assertView,
  createTechPackRow,
  ensureProjectTechPack,
  loadTechPack,
} from "@/modules/production/tech-pack-spec.service";

/*
 * Tech Pack as its own module (v6.4): every tech pack of the company in one
 * list (search, and filters for buyer, style, season and status), a new tech
 * pack started from the buyer's brief and references before any order or
 * production project exists, its details, and its links: to the style in
 * production when the order comes (a project takes one tech pack; the
 * project's bookings then follow its approval) and to a catalogue style. Links
 * change only while nothing rests on them: not approved, fabric part not
 * locked. Read with production.view; started, changed and linked with
 * production.manage. Each start, change and link is logged under the tech
 * pack (and a link under the project too).
 */

/** The reference files a new tech pack takes at once. */
export const MAX_START_FILES = 6;

const PAGE_SIZE = 50;

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max, `Use at most ${max} characters.`)
    .optional()
    .transform((v) => (v === undefined ? undefined : v || null));

const optionalId = z
  .string()
  .trim()
  .max(40)
  .nullish()
  .transform((v) => (v === undefined ? undefined : v || null));

const title = z
  .string({ message: "Give the tech pack a title." })
  .trim()
  .min(1, "Give the tech pack a title.")
  .max(160, "Use at most 160 characters.");

const detailsSchema = z.object({
  title,
  buyerId: optionalId,
  season: optionalText(40),
  brief: optionalText(5000),
});

const startSchema = detailsSchema.extend({
  styleId: optionalId,
  link: referenceSchema.shape.link,
});

/** A buyer of this company (not a supplier, not Walk-in customers). */
async function assertBuyer(ctx: CompanyContext, buyerId: string | null | undefined) {
  if (!buyerId) return;
  const party = await ctx.db.party.findUnique({
    where: { id: buyerId },
    select: { kind: true, systemRole: true },
  });
  if (!party || party.kind === "SUPPLIER" || isWalkIn(party)) {
    throw new AppError("NOT_FOUND", "That buyer was not found.", {
      buyerId: ["That buyer was not found."],
    });
  }
}

/** A catalogue style of this company. */
async function findStyle(ctx: CompanyContext, styleId: string) {
  const style = await ctx.db.style.findUnique({
    where: { id: styleId },
    select: { id: true, code: true, name: true },
  });
  if (!style) {
    throw new AppError("NOT_FOUND", "That style was not found.", {
      styleId: ["That style was not found."],
    });
  }
  return style;
}

const auditTechPack = (
  ctx: CompanyContext,
  meta: RequestMeta | undefined,
  db: Prisma.TransactionClient,
  entityType: "TechPack" | "ProductionProject",
  entityId: string,
  action: "CREATE" | "UPDATE",
  summary: string,
) => auditInCompany(ctx, meta, { action, entityType, entityId, summary }, db);

// ---------------------------------------------------------------- start

/**
 * A new tech pack from the buyer's brief and references (photos and a link),
 * with no order or production project needed. Returns its id and number.
 */
export async function createTechPack(
  ctx: CompanyContext,
  raw: unknown,
  uploads: ReadonlyArray<{ fileName: string; bytes: Buffer }> = [],
  meta?: RequestMeta,
) {
  assertManage(ctx);
  const input = startSchema.parse(raw);
  if (uploads.length > MAX_START_FILES) {
    throw new AppError("VALIDATION", `Add at most ${MAX_START_FILES} files at once.`, {
      files: [`Add at most ${MAX_START_FILES} files at once.`],
    });
  }
  await assertBuyer(ctx, input.buyerId);
  if (input.styleId) await findStyle(ctx, input.styleId);
  const stored: Array<{ id: string }> = [];
  try {
    for (const upload of uploads) stored.push(await storeUpload(ctx, upload, meta));
    return await startTechPack(ctx, input, stored, meta);
  } catch (error) {
    // Not started: the photos stored for it are not kept (nothing points to them).
    await dropUnused(ctx, stored);
    throw error;
  }
}

/** Removes stored photos no tech pack points to (record and bytes); a failure here is only logged. */
async function dropUnused(ctx: CompanyContext, stored: ReadonlyArray<{ id: string }>) {
  if (stored.length === 0) return;
  try {
    const unused = await ctx.db.fileAsset.findMany({
      where: { id: { in: stored.map((f) => f.id) }, techPackReferences: { none: {} } },
      select: { id: true, storagePath: true },
    });
    for (const file of unused) {
      const { count } = await ctx.db.fileAsset.deleteMany({
        where: { id: file.id, techPackReferences: { none: {} } },
      });
      if (count > 0) await deleteStoredFile(file);
    }
  } catch (error) {
    console.error(
      "[tech-pack] photos of a tech pack that was not started were not removed",
      error instanceof Error ? error.message : error,
    );
  }
}

/** The new tech pack with its references, once its photos are stored. */
async function startTechPack(
  ctx: CompanyContext,
  input: z.infer<typeof startSchema>,
  stored: ReadonlyArray<{ id: string }>,
  meta?: RequestMeta,
) {
  const from = input.brief
    ? " from the buyer's brief"
    : stored.length > 0 || input.link
      ? " from references"
      : "";
  return runTransaction(async (tx) => {
    const made = await createTechPackRow(ctx, tx, {
      title: input.title,
      buyerId: input.buyerId ?? null,
      styleId: input.styleId ?? null,
      season: input.season ?? null,
      brief: input.brief ?? null,
    });
    for (const file of stored) {
      await tx.techPackReference.create({
        data: {
          companyId: ctx.company.id,
          techPackId: made.id,
          fileId: file.id,
          savedById: ctx.user.id,
        },
      });
    }
    if (input.link) {
      await tx.techPackReference.create({
        data: {
          companyId: ctx.company.id,
          techPackId: made.id,
          link: input.link,
          savedById: ctx.user.id,
        },
      });
    }
    const number = made.number ?? "";
    await auditTechPack(
      ctx,
      meta,
      tx,
      "TechPack",
      made.id,
      "CREATE",
      `Started tech pack ${number} "${input.title}"${from}`,
    );
    return { id: made.id, number };
  });
}

/** A style in production with its tech pack (if it has one) and whether it is still open. */
async function loadProject(ctx: CompanyContext, projectId: string) {
  const project = await ctx.db.productionProject.findUnique({
    where: { id: projectId },
    select: {
      id: true,
      code: true,
      name: true,
      status: true,
      buyerId: true,
      styleId: true,
      techPack: { select: { id: true, number: true } },
    },
  });
  if (!project) throw new AppError("NOT_FOUND", "Production project not found.");
  return project;
}

function assertOpenProject(project: { code: string; status: ProductionStatus }) {
  if (isProjectClosed(project)) {
    throw new AppError(
      "CONFLICT",
      `${project.code} is ${project.status.toLowerCase()}; a tech pack cannot be started or linked there.`,
    );
  }
}

/** Starts a style in production's own tech pack (from its project page). */
export async function startProjectTechPack(
  ctx: CompanyContext,
  projectId: string,
  meta?: RequestMeta,
) {
  assertManage(ctx);
  const project = await loadProject(ctx, projectId);
  assertOpenProject(project);
  return runTransaction(async (tx) => {
    await lockRow(tx, "ProductionProject", project.id);
    const taken = await tx.techPack.findUnique({
      where: { projectId: project.id },
      select: { number: true },
    });
    if (taken) {
      throw new AppError(
        "CONFLICT",
        `${project.code} already has its tech pack ${taken.number ?? ""}. Open it from the project.`,
      );
    }
    const made = await createTechPackRow(ctx, tx, {
      title: project.name,
      projectId: project.id,
      buyerId: project.buyerId,
      styleId: project.styleId,
    });
    const number = made.number ?? "";
    const summary = `Started tech pack ${number} for ${project.code} ${project.name}`;
    await auditTechPack(ctx, meta, tx, "TechPack", made.id, "CREATE", summary);
    await auditTechPack(ctx, meta, tx, "ProductionProject", project.id, "UPDATE", summary);
    return { id: made.id, number };
  });
}

/** What a style in production's tech pack panel opens: its tech pack, or how to get one. */
export async function getProjectTechPackStart(ctx: CompanyContext, projectId: string) {
  assertView(ctx);
  const project = await loadProject(ctx, projectId);
  const may = ctx.can("production.manage") && !project.techPack && !isProjectClosed(project);
  return {
    techPackId: project.techPack?.id ?? null,
    number: project.techPack?.number ?? null,
    project: { id: project.id, code: project.code, name: project.name, status: project.status },
    can: { start: may, link: may },
  };
}

// ---------------------------------------------------------------- the list

const listSchema = z.object({
  q: z.string().trim().max(100).optional().catch(undefined),
  buyer: z.string().trim().max(40).optional().catch(undefined),
  style: z.string().trim().max(40).optional().catch(undefined),
  season: z.string().trim().max(40).optional().catch(undefined),
  status: z.enum(["DRAFT", "FABRIC_LOCKED", "APPROVED"]).optional().catch(undefined),
  page: z.coerce.number().int().min(1).max(10_000).optional().catch(undefined),
});

export type TechPackListQuery = z.input<typeof listSchema>;

/** Where a tech pack stands in the list: a draft, its fabric part locked, or approved. */
export type TechPackListStatus = "DRAFT" | "FABRIC_LOCKED" | "APPROVED";

const STATUS_WHERE: Record<TechPackListStatus, Prisma.TechPackWhereInput> = {
  DRAFT: { status: "DRAFT", fabricLockedAt: null },
  FABRIC_LOCKED: { status: "DRAFT", fabricLockedAt: { not: null } },
  APPROVED: { status: "APPROVED" },
};

/** Every tech pack of the company, newest change first, with the list's filters. */
export async function listTechPacks(ctx: CompanyContext, raw: unknown) {
  assertView(ctx);
  const query = listSchema.parse(raw ?? {});
  const q = query.q || undefined;
  const text = (value: string) => ({ contains: value, mode: "insensitive" as const });
  const where: Prisma.TechPackWhereInput = {
    ...(query.buyer ? { buyerId: query.buyer } : {}),
    ...(query.style ? { styleId: query.style } : {}),
    ...(query.season ? { season: { equals: query.season, mode: "insensitive" } } : {}),
    ...(query.status ? STATUS_WHERE[query.status] : {}),
    ...(q
      ? {
          OR: [
            { number: text(q) },
            { title: text(q) },
            { season: text(q) },
            { buyer: { name: text(q) } },
            { style: { OR: [{ code: text(q) }, { name: text(q) }] } },
            { project: { OR: [{ code: text(q) }, { name: text(q) }] } },
          ],
        }
      : {}),
  };
  const page = query.page ?? 1;
  const [total, rows, buyers, styles, seasons] = await Promise.all([
    ctx.db.techPack.count({ where }),
    ctx.db.techPack.findMany({
      where,
      orderBy: [{ updatedAt: "desc" }, { id: "asc" }],
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      select: {
        id: true,
        number: true,
        title: true,
        season: true,
        status: true,
        fabricLockedAt: true,
        updatedAt: true,
        buyer: { select: { name: true } },
        style: { select: { id: true, code: true, name: true } },
        project: {
          select: {
            id: true,
            code: true,
            name: true,
            status: true,
            buyer: { select: { name: true } },
          },
        },
      },
    }),
    ctx.db.party.findMany({
      where: { techPacks: { some: {} } },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
    ctx.db.style.findMany({
      where: { techPacks: { some: {} } },
      orderBy: { code: "asc" },
      select: { id: true, code: true, name: true },
    }),
    ctx.db.techPack.findMany({
      where: { season: { not: null } },
      distinct: ["season"],
      orderBy: { season: "asc" },
      select: { season: true },
    }),
  ]);
  return {
    rows: rows.map((r) => ({
      id: r.id,
      number: r.number ?? "Tech pack",
      title: r.title,
      buyer: r.buyer?.name ?? r.project?.buyer?.name ?? null,
      style: r.style,
      season: r.season,
      status: (r.status === "APPROVED"
        ? "APPROVED"
        : r.fabricLockedAt
          ? "FABRIC_LOCKED"
          : "DRAFT") as TechPackListStatus,
      project: r.project
        ? { id: r.project.id, code: r.project.code, name: r.project.name, status: r.project.status }
        : null,
      updatedOn: localDay(r.updatedAt, ctx.company.timezone),
    })),
    total,
    page,
    pages: Math.max(1, Math.ceil(total / PAGE_SIZE)),
    query: { ...query, page },
    filters: {
      buyers,
      styles,
      seasons: [...new Set(seasons.map((s) => s.season!).filter(Boolean))],
    },
    can: { create: ctx.can("production.manage") },
  };
}

export type TechPackList = Awaited<ReturnType<typeof listTechPacks>>;

// ---------------------------------------------------------------- details

/**
 * Changes a tech pack's title, buyer, season and brief. Once it is approved,
 * its title, buyer and brief stay as approved, like its links; its season (a
 * label to find it by) still changes.
 */
export async function updateTechPackDetails(
  ctx: CompanyContext,
  techPackId: string,
  raw: unknown,
  meta?: RequestMeta,
) {
  assertManage(ctx);
  const input = detailsSchema.parse(raw);
  const tp = await loadTechPack(ctx, techPackId);
  assertCanChange(tp);
  await assertBuyer(ctx, input.buyerId);
  await runTransaction(async (tx) => {
    await lockRow(tx, "TechPack", tp.id);
    const now = await tx.techPack.findUniqueOrThrow({
      where: { id: tp.id },
      select: { status: true, title: true, buyerId: true, brief: true },
    });
    if (
      now.status === "APPROVED" &&
      (input.title !== now.title ||
        (input.buyerId !== undefined && input.buyerId !== now.buyerId) ||
        (input.brief !== undefined && input.brief !== now.brief))
    ) {
      throw new AppError(
        "CONFLICT",
        `${tp.number} is approved: its title, buyer and brief no longer change. Its season still can.`,
      );
    }
    await tx.techPack.update({
      where: { id: tp.id },
      data: {
        title: input.title,
        ...(input.buyerId !== undefined ? { buyerId: input.buyerId } : {}),
        ...(input.season !== undefined ? { season: input.season } : {}),
        ...(input.brief !== undefined ? { brief: input.brief } : {}),
      },
    });
    await auditTechPack(
      ctx,
      meta,
      tx,
      "TechPack",
      tp.id,
      "UPDATE",
      `${tp.number}: changed its details`,
    );
  });
  return { id: tp.id };
}

// ---------------------------------------------------------------- links

/** A tech pack's links change only while nothing rests on them. */
function assertLinksOpen(tp: { number: string; status: string; fabricLockedAt: Date | null }) {
  if (tp.status === "APPROVED") {
    throw new AppError("CONFLICT", `${tp.number} is approved; its links no longer change.`);
  }
  if (tp.fabricLockedAt) {
    throw new AppError(
      "CONFLICT",
      `${tp.number}'s fabric part is locked; its links no longer change.`,
    );
  }
}

const linkProjectSchema = z.object({ projectId: z.string().trim().max(40).nullable() });
const linkStyleSchema = z.object({ styleId: z.string().trim().max(40).nullable() });

/**
 * Links a tech pack to a style in production (or takes it off with null). A
 * project takes one tech pack; the project's style and buyer fill the tech
 * pack's when it has none. Its bookings then follow this tech pack's approval.
 */
export async function linkTechPackToProject(
  ctx: CompanyContext,
  techPackId: string,
  raw: unknown,
  meta?: RequestMeta,
) {
  assertManage(ctx);
  const input = linkProjectSchema.parse(raw);
  const tp = await loadTechPack(ctx, techPackId);
  assertCanChange(tp);
  assertLinksOpen(tp);
  const was = tp.project;
  const target = input.projectId ? await loadProject(ctx, input.projectId) : null;
  if (target?.id === was?.id) return { id: tp.id, projectId: was?.id ?? null };
  if (target) {
    assertOpenProject(target);
    if (target.techPack) {
      throw new AppError(
        "CONFLICT",
        `${target.code} already has its tech pack ${target.techPack.number ?? ""}. A production project takes one tech pack.`,
      );
    }
  }
  await runTransaction(async (tx) => {
    // The styles in production first (as approval locks them), then the tech pack.
    const projectIds = [was?.id, target?.id].filter((id): id is string => Boolean(id)).sort();
    for (const id of projectIds) await lockRow(tx, "ProductionProject", id);
    await lockRow(tx, "TechPack", tp.id);
    const now = await tx.techPack.findUniqueOrThrow({
      where: { id: tp.id },
      select: { projectId: true, status: true, fabricLockedAt: true, buyerId: true, styleId: true },
    });
    if (now.projectId !== (was?.id ?? null)) {
      throw new AppError("CONFLICT", `${tp.number} was linked meanwhile. Open it again.`);
    }
    assertLinksOpen({ number: tp.number, ...now });
    if (target) {
      const taken = await tx.techPack.findUnique({
        where: { projectId: target.id },
        select: { number: true },
      });
      if (taken) {
        throw new AppError(
          "CONFLICT",
          `${target.code} already has its tech pack ${taken.number ?? ""}. A production project takes one tech pack.`,
        );
      }
    }
    await tx.techPack.update({
      where: { id: tp.id },
      data: {
        projectId: target?.id ?? null,
        ...(target && !now.buyerId && target.buyerId ? { buyerId: target.buyerId } : {}),
        ...(target && !now.styleId && target.styleId ? { styleId: target.styleId } : {}),
      },
    });
    if (was) {
      const off = `Took tech pack ${tp.number} off ${was.code} ${was.name}`;
      await auditTechPack(ctx, meta, tx, "TechPack", tp.id, "UPDATE", off);
      await auditTechPack(ctx, meta, tx, "ProductionProject", was.id, "UPDATE", off);
    }
    if (target) {
      const on = `Linked tech pack ${tp.number} to ${target.code} ${target.name}`;
      await auditTechPack(ctx, meta, tx, "TechPack", tp.id, "UPDATE", on);
      await auditTechPack(ctx, meta, tx, "ProductionProject", target.id, "UPDATE", on);
    }
  });
  return { id: tp.id, projectId: target?.id ?? null };
}

/** Links a tech pack to a catalogue style (or takes it off with null). */
export async function linkTechPackToStyle(
  ctx: CompanyContext,
  techPackId: string,
  raw: unknown,
  meta?: RequestMeta,
) {
  assertManage(ctx);
  const input = linkStyleSchema.parse(raw);
  const tp = await loadTechPack(ctx, techPackId);
  assertCanChange(tp);
  assertLinksOpen(tp);
  const style = input.styleId ? await findStyle(ctx, input.styleId) : null;
  if (style?.id === tp.style?.id) return { id: tp.id, styleId: style?.id ?? null };
  await runTransaction(async (tx) => {
    await lockRow(tx, "TechPack", tp.id);
    const now = await tx.techPack.findUniqueOrThrow({
      where: { id: tp.id },
      select: { status: true, fabricLockedAt: true },
    });
    assertLinksOpen({ number: tp.number, ...now });
    await tx.techPack.update({ where: { id: tp.id }, data: { styleId: style?.id ?? null } });
    const summary = style
      ? `Linked tech pack ${tp.number} to the style ${style.code} ${style.name}`
      : `Took tech pack ${tp.number} off the style ${tp.style!.code} ${tp.style!.name}`;
    await auditTechPack(ctx, meta, tx, "TechPack", tp.id, "UPDATE", summary);
  });
  return { id: tp.id, styleId: style?.id ?? null };
}

// ---------------------------------------------------------------- pickers

const searchText = (search: string) => search.trim().slice(0, 100);

/** Styles in production a tech pack can be linked to: open, without a tech pack of their own. */
export async function findLinkableProjects(ctx: CompanyContext, search: string) {
  assertManage(ctx);
  const q = searchText(search);
  const rows = await ctx.db.productionProject.findMany({
    where: {
      status: { in: ["PLANNED", "ACTIVE", "ON_HOLD"] },
      techPack: { is: null },
      ...(q
        ? {
            OR: [
              { code: { contains: q, mode: "insensitive" } },
              { name: { contains: q, mode: "insensitive" } },
              { buyer: { name: { contains: q, mode: "insensitive" } } },
            ],
          }
        : {}),
    },
    orderBy: { createdAt: "desc" },
    take: 20,
    select: { id: true, code: true, name: true, buyer: { select: { name: true } } },
  });
  return rows.map((r) => ({ id: r.id, code: r.code, name: r.name, buyer: r.buyer?.name ?? null }));
}

const unlinkedWhere = (q: string): Prisma.TechPackWhereInput => ({
  projectId: null,
  ...(q
    ? {
        OR: [
          { number: { contains: q, mode: "insensitive" } },
          { title: { contains: q, mode: "insensitive" } },
          { buyer: { name: { contains: q, mode: "insensitive" } } },
        ],
      }
    : {}),
});

/** Tech packs a style in production can take: not linked to one yet, not approved or locked. */
export async function findLinkableTechPacks(ctx: CompanyContext, search: string) {
  assertManage(ctx);
  const rows = await ctx.db.techPack.findMany({
    where: { ...unlinkedWhere(searchText(search)), status: "DRAFT", fabricLockedAt: null },
    orderBy: { updatedAt: "desc" },
    take: 20,
    select: { id: true, number: true, title: true, buyer: { select: { name: true } } },
  });
  return rows.map((r) => ({
    id: r.id,
    number: r.number ?? "Tech pack",
    title: r.title,
    buyer: r.buyer?.name ?? null,
  }));
}

/**
 * Where Save to Tech Pack can save a reference: tech packs not linked to a
 * style in production yet, and the open styles in production (saving to one
 * starts its tech pack if it has none).
 */
export async function pickSaveTargets(ctx: CompanyContext, search: string) {
  assertManage(ctx);
  const q = searchText(search);
  const [techPacks, projects] = await Promise.all([
    ctx.db.techPack.findMany({
      where: unlinkedWhere(q),
      orderBy: { updatedAt: "desc" },
      take: 10,
      select: { id: true, number: true, title: true, buyer: { select: { name: true } } },
    }),
    ctx.db.productionProject.findMany({
      where: {
        status: { in: ["PLANNED", "ACTIVE", "ON_HOLD"] },
        ...(q
          ? {
              OR: [
                { code: { contains: q, mode: "insensitive" } },
                { name: { contains: q, mode: "insensitive" } },
              ],
            }
          : {}),
      },
      orderBy: { createdAt: "desc" },
      take: 15,
      select: { id: true, code: true, name: true, buyer: { select: { name: true } } },
    }),
  ]);
  return [
    ...techPacks.map((t) => ({
      kind: "TECH_PACK" as const,
      id: t.id,
      code: t.number ?? "Tech pack",
      name: t.title,
      buyer: t.buyer?.name ?? null,
    })),
    ...projects.map((p) => ({
      kind: "PROJECT" as const,
      id: p.id,
      code: p.code,
      name: p.name,
      buyer: p.buyer?.name ?? null,
    })),
  ];
}

export type SaveTarget = Awaited<ReturnType<typeof pickSaveTargets>>[number];

/**
 * The tech pack a Save to Tech Pack pick saves to: the tech pack itself, or an
 * open style in production's own (started if it has none yet).
 */
export async function techPackForSave(
  ctx: CompanyContext,
  target: { kind: "TECH_PACK" | "PROJECT"; id: string },
) {
  assertManage(ctx);
  if (target.kind !== "PROJECT") return target.id;
  const project = await loadProject(ctx, target.id);
  assertOpenProject(project);
  return project.techPack?.id ?? ensureProjectTechPack(ctx, project.id);
}

/** Buyers a tech pack can be for (the New tech pack and details forms). */
export async function findTechPackBuyers(ctx: CompanyContext, search: string) {
  assertManage(ctx);
  const q = searchText(search);
  const rows = await ctx.db.party.findMany({
    where: {
      kind: { in: ["BUYER", "BOTH"] },
      systemRole: null,
      ...(q
        ? {
            OR: [
              { name: { contains: q, mode: "insensitive" } },
              { code: { contains: q, mode: "insensitive" } },
            ],
          }
        : {}),
    },
    orderBy: { name: "asc" },
    take: 20,
    select: { id: true, code: true, name: true },
  });
  return rows;
}

/** Catalogue styles a tech pack can be linked to. */
export async function findTechPackStyles(ctx: CompanyContext, search: string) {
  assertManage(ctx);
  const q = searchText(search);
  return ctx.db.style.findMany({
    where: {
      isActive: true,
      ...(q
        ? {
            OR: [
              { code: { contains: q, mode: "insensitive" } },
              { name: { contains: q, mode: "insensitive" } },
            ],
          }
        : {}),
    },
    orderBy: { code: "asc" },
    take: 20,
    select: { id: true, code: true, name: true },
  });
}
